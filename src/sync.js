// Keeps your characters, chats and memories in step across devices when you're signed in.
//
// Everything is local first: the app always reads and writes the on-device database, and this
// file copies changes to your account (and brings changes from your other devices back).
// When two devices changed the same thing, the most recent change wins.
//
// The cloud itself sits behind a small adapter (sync-impl.js), so this logic stays testable.
import {
  onLocalChange, readAll, rawGet, rawPut, rawDelete, getSettings, saveSettingsRaw,
  getStats, setStatsRaw, getLikes, getLikesAt, setLikesRaw,
} from './db.js';
import { cloudEnabled } from './cloud.js';

const KINDS = ['characters', 'chats', 'memories', 'meta'];
const MAX_DOC_BYTES = 900_000; // Firestore's limit is 1 MB per document
const MAX_BATCH_BYTES = 3_000_000;

// The parts of your settings that follow you. Never includes your API key.
const PROFILE_FIELDS = [
  'userName', 'userPersona', 'nickname', 'bio', 'photo', 'personas', 'defaultPersonaId',
  'model', 'effort', 'replyLength', 'voiceURI', 'voiceRate', 'voiceMode', 'autoRead', 'adultConfirmedAt', 'showMature',
];

// ---- Small helpers around localStorage (it can be blocked, so never trust it) ----
const mem = new Map();
const store = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return mem.get(key) ?? null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      mem.set(key, value);
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      mem.delete(key);
    }
  },
};
const readJson = (key, fallback) => {
  try {
    return JSON.parse(store.get(key)) ?? fallback;
  } catch {
    return fallback;
  }
};

// ---- Who's signed in ----
export const getAccount = () => readJson('kindred.account', null);
const setAccount = (account) => (account ? store.set('kindred.account', JSON.stringify(account)) : store.remove('kindred.account'));

// ---- Status, for the Profile screen ----
let status = { state: 'off', at: 0, error: '', pending: 0, skipped: [] };
const listeners = new Set();
const setStatus = (patch) => {
  status = { ...status, ...patch };
  listeners.forEach((fn) => fn(status));
};
export const getStatus = () => status;
export function onStatus(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ---- The cloud adapter ----
let impl = null;
let fakeOn = false;
const loadImpl = async () => impl ?? (impl = await import('./sync-impl.js'));

/** For testing without a real project. */
export function __useFakeSync(fake) {
  impl = fake;
  fakeOn = true;
}
export const syncAvailable = () => fakeOn || cloudEnabled();

// ---- Remembering what still needs uploading ----
// A counter per item: if it changes while an upload is in flight, it stays queued.
const dirtyKey = (uid) => `kindred.dirty.${uid}`;
const loadDirty = (uid) => readJson(dirtyKey(uid), {});
const saveDirty = (uid, dirty) => store.set(dirtyKey(uid), JSON.stringify(dirty));
const lastKey = (uid) => `kindred.sync.last.${uid}`;
const initKey = (uid) => `kindred.sync.init.${uid}`;

function noteChange(kind, id) {
  const account = getAccount();
  if (!account) return;
  if (kind === 'characters' && id.startsWith('starter-')) return; // built in on every device
  const dirty = loadDirty(account.uid);
  const key = `${kind}/${id}`;
  dirty[key] = (dirty[key] ?? 0) + 1;
  saveDirty(account.uid, dirty);
  setStatus({ pending: Object.keys(dirty).length });
  schedule();
}

let timer = null;
const schedule = (ms = 2500) => {
  clearTimeout(timer);
  timer = setTimeout(() => flush().catch(() => {}), ms);
};

// ---- Turning local data into cloud documents and back ----

async function localDoc(kind, id) {
  if (kind === 'meta') {
    if (id === 'profile') {
      const s = await getSettings();
      const doc = {};
      for (const key of PROFILE_FIELDS) if (s[key] !== undefined) doc[key] = s[key];
      return { ...doc, updatedAt: s.profileUpdatedAt ?? Date.now() };
    }
    if (id === 'stats') {
      const stats = await getStats();
      return stats ? { ...stats, updatedAt: Date.now() } : null;
    }
    if (id === 'likes') return { ids: await getLikes(), updatedAt: (await getLikesAt()) || Date.now() };
    return null;
  }
  return (await rawGet(kind, id)) ?? null;
}

// How new this device's copy is, for deciding whose version wins.
async function localStamp(kind, id) {
  if (kind === 'meta') {
    if (id === 'profile') return (await getSettings()).profileUpdatedAt ?? 0;
    if (id === 'likes') return getLikesAt();
    return 0;
  }
  return (await rawGet(kind, id))?.updatedAt ?? 0;
}

/** Applies one cloud document to this device. Returns true if anything changed here. */
async function applyRemote(kind, id, data) {
  if (kind === 'meta') {
    if (id === 'profile') {
      const s = await getSettings();
      if ((s.profileUpdatedAt ?? 0) >= data.updatedAt) return false;
      const merged = { ...s };
      for (const key of PROFILE_FIELDS) if (key in data) merged[key] = data[key];
      merged.profileUpdatedAt = data.updatedAt;
      await saveSettingsRaw(merged);
      return true;
    }
    if (id === 'stats') {
      // Counters only ever go up, so keep whichever number is higher.
      const mine = (await getStats()) ?? {};
      const merged = { ...mine };
      let changed = false;
      for (const [key, value] of Object.entries(data)) {
        if (key === 'updatedAt' || typeof value !== 'number') continue;
        const next = key === 'joinedAt' ? Math.min(mine[key] ?? value, value) : Math.max(mine[key] ?? 0, value);
        if (next !== mine[key]) {
          merged[key] = next;
          changed = true;
        }
      }
      // Only call the stats "set up" once there's a join date; otherwise they get rebuilt from your chats.
      if (typeof merged.joinedAt === 'number' && !merged.initialized) {
        merged.initialized = true;
        changed = true;
      }
      if (changed) await setStatsRaw(merged);
      return changed;
    }
    if (id === 'likes') {
      if ((await getLikesAt()) >= data.updatedAt) return false;
      await setLikesRaw(data.ids ?? [], data.updatedAt);
      return true;
    }
    return false;
  }

  const mine = await rawGet(kind, id);
  if (data.deleted) {
    // Deleted on another device: remove it here too, unless it was changed here afterwards.
    if (mine && (mine.updatedAt ?? 0) <= data.updatedAt) {
      await rawDelete(kind, id);
      return true;
    }
    return false;
  }
  if (!mine || (mine.updatedAt ?? 0) < data.updatedAt) {
    const { deleted, ...record } = data;
    await rawPut(kind, record);
    return true;
  }
  return false;
}

// ---- Bringing changes in ----

async function pull(adapter, uid, { full = false } = {}) {
  const last = full ? {} : readJson(lastKey(uid), {});
  const seen = {}; // kind -> Map(id -> updatedAt), used by the first sync
  let applied = 0;
  for (const kind of KINDS) {
    seen[kind] = new Map();
    for (const { id, data } of await adapter.list(uid, kind, last[kind] ?? 0)) {
      seen[kind].set(id, data.updatedAt ?? 0);
      if (await applyRemote(kind, id, data)) applied++;
      last[kind] = Math.max(last[kind] ?? 0, data.updatedAt ?? 0);
    }
  }
  store.set(lastKey(uid), JSON.stringify(last));
  return { applied, seen };
}

// ---- Sending changes up ----

let flushing = false;
async function flush() {
  const account = getAccount();
  if (!account || flushing) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    setStatus({ state: 'offline' });
    return;
  }
  flushing = true;
  setStatus({ state: 'syncing', error: '' });
  try {
    const adapter = await loadImpl();
    const startedWith = loadDirty(account.uid);
    const keys = Object.keys(startedWith);
    const skipped = [];

    let ops = [];
    let bytes = 0;
    const sent = [];
    const send = async () => {
      if (!ops.length && !sent.length) return;
      if (ops.length) await adapter.write(account.uid, ops);
      // Only forget items that didn't change again while we were uploading.
      const now = loadDirty(account.uid);
      for (const key of sent) if (now[key] === startedWith[key]) delete now[key];
      saveDirty(account.uid, now);
      ops = [];
      bytes = 0;
      sent.length = 0;
    };

    for (const key of keys) {
      const slash = key.indexOf('/');
      const kind = key.slice(0, slash);
      const id = key.slice(slash + 1);
      const doc = await localDoc(kind, id);
      let data;
      if (doc) {
        data = JSON.parse(JSON.stringify(doc)); // drops undefined, which the cloud rejects
        const size = JSON.stringify(data).length;
        if (size > MAX_DOC_BYTES) {
          skipped.push(`${kind}/${id}`);
          sent.push(key); // don't retry something that can never fit
          continue;
        }
        bytes += size;
      } else if (kind === 'meta') {
        sent.push(key);
        continue;
      } else {
        data = { deleted: true, updatedAt: Date.now() }; // a tombstone tells other devices to delete it
      }
      ops.push({ kind, id, data });
      sent.push(key);
      if (ops.length >= 50 || bytes >= MAX_BATCH_BYTES) await send();
    }
    await send();
    setStatus({ state: 'idle', at: Date.now(), pending: Object.keys(loadDirty(account.uid)).length, skipped });
  } catch (err) {
    fail(err);
    throw err;
  } finally {
    flushing = false;
  }
}

function fail(err) {
  console.warn('Sync failed', err);
  let message = err?.message || 'Sync failed.';
  if (err?.code === 'permission-denied') {
    message = "Sync isn't allowed yet. Publish the updated Firestore rules from FIREBASE_SETUP.md, then tap Sync now.";
  } else if (err?.code === 'unavailable' || err?.code === 'network-request-failed') {
    message = "Couldn't reach the cloud. It will try again.";
  }
  setStatus({ state: 'error', error: message });
}

// ---- Putting it together ----

// Re-draw a main screen after new data arrives, but never while you're typing or mid-chat.
function refreshScreen() {
  const main = /^#?\/?$|^#\/(search|create|messages|me)$/.test(location.hash || '#/');
  const typing = document.activeElement?.matches?.('input, textarea, select');
  if (main && !typing) window.dispatchEvent(new HashChangeEvent('hashchange'));
}

/** Brings in what changed elsewhere, sends what changed here. */
export async function syncNow() {
  const account = getAccount();
  if (!account || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
    if (account) setStatus({ state: 'offline' });
    return;
  }
  setStatus({ state: 'syncing', error: '' });
  try {
    const adapter = await loadImpl();
    if (!store.get(initKey(account.uid))) {
      await firstSync(adapter, account);
    } else {
      const { applied } = await pull(adapter, account.uid);
      if (applied) refreshScreen();
    }
    await flush();
  } catch (err) {
    fail(err);
  }
}

// The first time an account is used on this device: merge everything both ways.
async function firstSync(adapter, account) {
  const { applied, seen } = await pull(adapter, account.uid, { full: true });
  const dirty = loadDirty(account.uid);
  const queue = (key) => (dirty[key] = (dirty[key] ?? 0) + 1);

  for (const kind of ['characters', 'chats', 'memories']) {
    for (const record of await readAll(kind)) {
      if (kind === 'characters' && record.id.startsWith('starter-')) continue;
      const theirs = seen[kind].get(record.id);
      if (theirs === undefined || (record.updatedAt ?? 0) > theirs) queue(`${kind}/${record.id}`);
    }
  }
  for (const id of ['profile', 'stats', 'likes']) {
    const theirs = seen.meta.get(id);
    if (theirs === undefined || (await localStamp('meta', id)) > theirs || id === 'stats') queue(`meta/${id}`);
  }
  saveDirty(account.uid, dirty);
  store.set(initKey(account.uid), '1');
  if (applied) refreshScreen();
}

let started = false;
let lastSyncAt = 0;
function startBackgroundSync() {
  if (started || typeof document === 'undefined') return;
  started = true;
  const maybeSync = () => {
    if (document.visibilityState === 'visible' && Date.now() - lastSyncAt > 20_000) {
      lastSyncAt = Date.now();
      syncNow();
    }
  };
  document.addEventListener('visibilitychange', maybeSync);
  window.addEventListener('online', () => syncNow());
  setInterval(maybeSync, 90_000);
}

/** Call once when the app opens. Does nothing unless you're signed in. */
export function initSync() {
  onLocalChange(noteChange);
  const account = getAccount();
  if (!account || !syncAvailable()) return;
  setStatus({ state: 'idle', pending: Object.keys(loadDirty(account.uid)).length });
  startBackgroundSync();
  lastSyncAt = Date.now();
  syncNow();
}

async function finishSignIn(account) {
  setAccount(account);
  setStatus({ state: 'syncing', error: '', pending: 0 });
  startBackgroundSync();
  lastSyncAt = Date.now();
  await syncNow();
  return account;
}

export async function signInWithGoogle() {
  return finishSignIn(await (await loadImpl()).signInGoogle());
}
export async function signInWithEmail(email, password, { create = false } = {}) {
  return finishSignIn(await (await loadImpl()).signInEmail({ email, password, create }));
}
export async function sendPasswordReset(email) {
  await (await loadImpl()).resetPassword(email);
}

export async function signOutAccount() {
  const account = getAccount();
  if (account) {
    try {
      await flush(); // get the last changes up before leaving
    } catch {
      /* signing out still goes ahead */
    }
    await (await loadImpl()).signOutNow();
  }
  clearTimeout(timer);
  setAccount(null);
  setStatus({ state: 'off', error: '', pending: 0, skipped: [] });
}
