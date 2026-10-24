// Everything is stored on the user's own device in IndexedDB.
// Photos are saved as resized JPEG data URLs inside the character record.

const DB_NAME = 'kindred';
const DB_VERSION = 2;

let dbPromise;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('characters')) {
          db.createObjectStore('characters', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('chats')) {
          const chats = db.createObjectStore('chats', { keyPath: 'id' });
          chats.createIndex('characterId', 'characterId');
        }
        if (!db.objectStoreNames.contains('memories')) {
          const memories = db.createObjectStore('memories', { keyPath: 'id' });
          memories.createIndex('characterId', 'characterId');
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function run(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

// The sync engine registers here to hear about every local change.
let changeHook = null;
export const onLocalChange = (fn) => {
  changeHook = fn;
};
const changed = (kind, id) => {
  try {
    changeHook?.(kind, id);
  } catch (err) {
    console.warn('Change hook failed', err);
  }
};

export const uid = () =>
  (crypto.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2));

// ---- Characters ----

export const listCharacters = async () => {
  const all = await run('characters', 'readonly', (s) => s.getAll());
  return all.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
};

export const getCharacter = (id) => run('characters', 'readonly', (s) => s.get(id));

export const saveCharacter = async (character) => {
  await run('characters', 'readwrite', (s) => s.put({ ...character, updatedAt: Date.now() }));
  changed('characters', character.id);
};

export async function deleteCharacter(id) {
  const chats = await listChats(id);
  for (const c of chats) await deleteChat(c.id);
  const memories = await listMemories(id);
  for (const m of memories) await deleteMemory(m.id);
  await run('characters', 'readwrite', (s) => s.delete(id));
  changed('characters', id);
}

// ---- Chats ----

export const listChats = async (characterId) => {
  const all = await run('chats', 'readonly', (s) => s.index('characterId').getAll(characterId));
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
};

export const getChat = (id) => run('chats', 'readonly', (s) => s.get(id));

export const saveChat = async (chat) => {
  await run('chats', 'readwrite', (s) => s.put({ ...chat, updatedAt: Date.now() }));
  changed('chats', chat.id);
};

export const deleteChat = async (id) => {
  await run('chats', 'readwrite', (s) => s.delete(id));
  changed('chats', id);
};

// ---- Memories ----
// Long-term facts a character remembers about you, shared by all chats with that character.
// Kept apart from the character itself so exporting a character never shares them.

export const listMemories = async (characterId) => {
  const all = await run('memories', 'readonly', (s) => s.index('characterId').getAll(characterId));
  return all.sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || a.createdAt - b.createdAt);
};

export const saveMemory = async (memory) => {
  await run('memories', 'readwrite', (s) => s.put({ ...memory, updatedAt: Date.now() }));
  changed('memories', memory.id);
};

export const deleteMemory = async (id) => {
  await run('memories', 'readwrite', (s) => s.delete(id));
  changed('memories', id);
};

// ---- Settings ----

const DEFAULT_SETTINGS = {
  apiKey: '',
  model: 'claude-opus-5-5',
  effort: 'low',
  replyLength: 'short',
  userName: 'You',
  userPersona: '',
  nickname: '',
  bio: '',
  photo: '',
  personas: [],
  defaultPersonaId: 'default',
  voiceURI: '',
  voiceRate: 1,
  voiceMode: 'speech',
  autoRead: false,
  adultConfirmedAt: 0,
  showMature: true,
};

export async function getSettings() {
  const saved = await run('settings', 'readonly', (s) => s.get('settings'));
  return { ...DEFAULT_SETTINGS, ...saved };
}

export const saveSettings = async (settings) => {
  await run('settings', 'readwrite', (s) => s.put({ ...settings, profileUpdatedAt: Date.now() }, 'settings'));
  changed('meta', 'profile');
};

// Used by sync when it brings settings in from the cloud (keeps their timestamp, doesn't re-upload).
export const saveSettingsRaw = (settings) => run('settings', 'readwrite', (s) => s.put(settings, 'settings'));

// ---- Everything at once (for stats and search) ----

export const listAllChats = () => run('chats', 'readonly', (s) => s.getAll());
export const listAllMemories = () => run('memories', 'readonly', (s) => s.getAll());

// ---- Profile stats ----
// Lifetime counters live in the settings store so deleting a chat doesn't erase your history.

export const getStats = () => run('settings', 'readonly', (s) => s.get('stats'));
export const setStats = async (stats) => {
  await run('settings', 'readwrite', (s) => s.put(stats, 'stats'));
  changed('meta', 'stats');
};
export const setStatsRaw = (stats) => run('settings', 'readwrite', (s) => s.put(stats, 'stats'));

// Adds to counters in a single transaction so two quick updates can't overwrite each other.
export function bumpStats(delta) {
  const done = run('settings', 'readwrite', (s) => {
    const req = s.get('stats');
    req.onsuccess = () => {
      const next = { ...(req.result ?? {}) };
      for (const [key, amount] of Object.entries(delta)) next[key] = (next[key] ?? 0) + amount;
      s.put(next, 'stats');
    };
    return req;
  });
  done.then(() => changed('meta', 'stats'));
  return done;
}

// ---- Liked characters ----

export const getLikesAt = async () => (await run('settings', 'readonly', (s) => s.get('likesAt'))) ?? 0;
// Used by sync when it brings likes in from the cloud.
export const setLikesRaw = async (ids, at) =>
  run('settings', 'readwrite', (s) => {
    s.put(at, 'likesAt');
    return s.put(ids, 'likes');
  });

export const getLikes = async () => (await run('settings', 'readonly', (s) => s.get('likes'))) ?? [];

export async function toggleLike(characterId) {
  const likes = new Set(await getLikes());
  if (likes.has(characterId)) likes.delete(characterId);
  else likes.add(characterId);
  await run('settings', 'readwrite', (s) => {
    s.put(Date.now(), 'likesAt');
    return s.put([...likes], 'likes');
  });
  changed('meta', 'likes');
  return likes.has(characterId);
}

// ---- Backup & restore ----

export const readAll = async (store) => {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store).objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
};

/** Everything on this device in one object. Your API key is left out on purpose. */
export async function exportAll() {
  const [characters, chats, memories, settings, stats, likes] = await Promise.all([
    readAll('characters'),
    readAll('chats'),
    readAll('memories'),
    getSettings(),
    getStats(),
    getLikes(),
  ]);
  const { apiKey, seeded, starterVersion, ...shareable } = settings;
  return { kindredBackup: 1, exportedAt: Date.now(), characters, chats, memories, settings: shareable, stats: stats ?? null, likes };
}

/**
 * Adds a backup's contents to this device. Records with the same id are replaced; nothing else is
 * deleted. Your current API key is kept, and counters keep whichever number is higher.
 * Returns how many characters, chats and memories came in.
 */
export async function importAll(data) {
  if (data?.kindredBackup !== 1) throw new Error("That file isn't a Kindred backup.");
  const withId = (list) => (Array.isArray(list) ? list.filter((item) => item && typeof item.id === 'string') : []);
  const characters = withId(data.characters);
  const chats = withId(data.chats).filter((chat) => Array.isArray(chat.messages));
  const memories = withId(data.memories);

  const db = await open();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(['characters', 'chats', 'memories', 'settings'], 'readwrite');
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);

    for (const c of characters) tx.objectStore('characters').put(c);
    for (const chat of chats) tx.objectStore('chats').put(chat);
    for (const m of memories) tx.objectStore('memories').put(m);

    const settingsStore = tx.objectStore('settings');

    if (data.settings && typeof data.settings === 'object') {
      const req = settingsStore.get('settings');
      req.onsuccess = () => {
        const current = req.result ?? {};
        settingsStore.put({ ...current, ...data.settings, apiKey: current.apiKey ?? '', seeded: current.seeded, starterVersion: current.starterVersion }, 'settings');
      };
    }

    if (data.stats && typeof data.stats === 'object') {
      const req = settingsStore.get('stats');
      req.onsuccess = () => {
        const current = req.result ?? {};
        const merged = { ...current, initialized: true };
        for (const [key, value] of Object.entries(data.stats)) {
          if (typeof value !== 'number') continue;
          merged[key] = key === 'joinedAt' ? Math.min(current[key] ?? value, value) : Math.max(current[key] ?? 0, value);
        }
        settingsStore.put(merged, 'stats');
      };
    }

    if (Array.isArray(data.likes)) {
      const req = settingsStore.get('likes');
      req.onsuccess = () => settingsStore.put([...new Set([...(req.result ?? []), ...data.likes.filter((id) => typeof id === 'string')])], 'likes');
    }
  });
  for (const c of characters) changed('characters', c.id);
  for (const chat of chats) changed('chats', chat.id);
  for (const m of memories) changed('memories', m.id);
  for (const id of ['profile', 'stats', 'likes']) changed('meta', id);
  return { characters: characters.length, chats: chats.length, memories: memories.length };
}

// ---- Raw access (used by sync; no timestamps added, no change hook) ----

export const rawGet = (store, id) => run(store, 'readonly', (s) => s.get(id));
export const rawPut = (store, record) => run(store, 'readwrite', (s) => s.put(record));
export const rawDelete = (store, id) => run(store, 'readwrite', (s) => s.delete(id));
