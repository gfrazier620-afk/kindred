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

export const uid = () =>
  (crypto.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2));

// ---- Characters ----

export const listCharacters = async () => {
  const all = await run('characters', 'readonly', (s) => s.getAll());
  return all.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
};

export const getCharacter = (id) => run('characters', 'readonly', (s) => s.get(id));

export const saveCharacter = (character) =>
  run('characters', 'readwrite', (s) => s.put({ ...character, updatedAt: Date.now() }));

export async function deleteCharacter(id) {
  const chats = await listChats(id);
  for (const c of chats) await deleteChat(c.id);
  const memories = await listMemories(id);
  for (const m of memories) await deleteMemory(m.id);
  await run('characters', 'readwrite', (s) => s.delete(id));
}

// ---- Chats ----

export const listChats = async (characterId) => {
  const all = await run('chats', 'readonly', (s) => s.index('characterId').getAll(characterId));
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
};

export const getChat = (id) => run('chats', 'readonly', (s) => s.get(id));

export const saveChat = (chat) =>
  run('chats', 'readwrite', (s) => s.put({ ...chat, updatedAt: Date.now() }));

export const deleteChat = (id) => run('chats', 'readwrite', (s) => s.delete(id));

// ---- Memories ----
// Long-term facts a character remembers about you, shared by all chats with that character.
// Kept apart from the character itself so exporting a character never shares them.

export const listMemories = async (characterId) => {
  const all = await run('memories', 'readonly', (s) => s.index('characterId').getAll(characterId));
  return all.sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || a.createdAt - b.createdAt);
};

export const saveMemory = (memory) =>
  run('memories', 'readwrite', (s) => s.put({ ...memory, updatedAt: Date.now() }));

export const deleteMemory = (id) => run('memories', 'readwrite', (s) => s.delete(id));

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
};

export async function getSettings() {
  const saved = await run('settings', 'readonly', (s) => s.get('settings'));
  return { ...DEFAULT_SETTINGS, ...saved };
}

export const saveSettings = (settings) =>
  run('settings', 'readwrite', (s) => s.put(settings, 'settings'));

// ---- Everything at once (for stats and search) ----

export const listAllChats = () => run('chats', 'readonly', (s) => s.getAll());
export const listAllMemories = () => run('memories', 'readonly', (s) => s.getAll());

// ---- Profile stats ----
// Lifetime counters live in the settings store so deleting a chat doesn't erase your history.

export const getStats = () => run('settings', 'readonly', (s) => s.get('stats'));
export const setStats = (stats) => run('settings', 'readwrite', (s) => s.put(stats, 'stats'));

// Adds to counters in a single transaction so two quick updates can't overwrite each other.
export function bumpStats(delta) {
  return run('settings', 'readwrite', (s) => {
    const req = s.get('stats');
    req.onsuccess = () => {
      const next = { ...(req.result ?? {}) };
      for (const [key, amount] of Object.entries(delta)) next[key] = (next[key] ?? 0) + amount;
      s.put(next, 'stats');
    };
    return req;
  });
}

// ---- Liked characters ----

export const getLikes = async () => (await run('settings', 'readonly', (s) => s.get('likes'))) ?? [];

export async function toggleLike(characterId) {
  const likes = new Set(await getLikes());
  if (likes.has(characterId)) likes.delete(characterId);
  else likes.add(characterId);
  await run('settings', 'readwrite', (s) => s.put([...likes], 'likes'));
  return likes.has(characterId);
}
