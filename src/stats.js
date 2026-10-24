import { listCharacters, listAllChats, listAllMemories, getStats, setStats, getLikes } from './db.js';

// Characters you made yourself (not the built-in starters, not imported files).
export const isMine = (character) => !character.id.startsWith('starter-') && !character.imported;

// Who a character is credited to in the feed.
export function creatorOf(character, settings) {
  if (character.id.startsWith('starter-')) return 'Kindred';
  if (isMine(character)) return settings.nickname || settings.userName || 'You';
  return character.creator || 'Someone';
}

/**
 * Everything the profile page shows. Lifetime counters are stored; the first time this runs
 * on a device that already has chats, they're filled in from what's there.
 */
export async function loadStats() {
  const [characters, chats, memories, likes] = await Promise.all([
    listCharacters(),
    listAllChats(),
    listAllMemories(),
    getLikes(),
  ]);

  let stored = await getStats();
  if (!stored?.initialized || !Number.isFinite(stored.joinedAt)) {
    const real = (ts) => (ts > 1e12 ? ts : Infinity);
    const earliest = Math.min(...chats.map((c) => real(c.createdAt)), ...characters.map((c) => real(c.createdAt)));
    // Counts rebuilt from your chats never replace a higher lifetime number already saved.
    const before = stored ?? {};
    const counted = {
      messagesSent: chats.reduce((n, c) => n + c.messages.filter((m) => m.role === 'user').length, 0),
      repliesReceived: chats.reduce((n, c) => n + c.messages.filter((m, i) => m.role === 'assistant' && i > 0).length, 0),
      chatsStarted: chats.length,
    };
    stored = {
      ...before,
      initialized: true,
      messagesSent: Math.max(before.messagesSent ?? 0, counted.messagesSent),
      repliesReceived: Math.max(before.repliesReceived ?? 0, counted.repliesReceived),
      chatsStarted: Math.max(before.chatsStarted ?? 0, counted.chatsStarted),
      joinedAt: Number.isFinite(earliest) ? earliest : Date.now(),
    };
    await setStats(stored);
  }

  const sentByCharacter = new Map();
  for (const chat of chats) {
    const sent = chat.messages.filter((m) => m.role === 'user').length;
    if (sent) sentByCharacter.set(chat.characterId, (sentByCharacter.get(chat.characterId) ?? 0) + sent);
  }
  const [topId, topCount] = [...sentByCharacter.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];

  return {
    ...stored,
    charactersCreated: characters.filter(isMine).length,
    charactersChatted: sentByCharacter.size,
    memories: memories.length,
    liked: likes.length,
    days: Math.max(1, Math.floor((Date.now() - stored.joinedAt) / 864e5) + 1),
    favorite: topId ? { character: characters.find((c) => c.id === topId), messages: topCount } : null,
  };
}
