import { listMemories, saveMemory, deleteMemory, uid } from './db.js';
import { extractMemories, summarizeChat } from './ai.js';

// How often memory runs, counted in chat messages (yours and the character's).
const EXTRACT_EVERY = 6;
// Once this many messages haven't been summarized, the older ones get folded into the summary...
const SUMMARIZE_AFTER = 40;
// ...keeping this many recent messages word for word.
const KEEP_RECENT = 20;
// Oldest automatic, unpinned memories are dropped past this many.
const MAX_AUTO_MEMORIES = 80;

const usable = (m) => m.content?.trim() && !m.error;

// Messages that still go to Claude word for word (the rest are covered by chat.summary).
export const liveMessages = (chat) => chat.messages.filter((m) => !m.summarized);

export async function addMemory(characterId, text, { pinned = false, source = 'user' } = {}) {
  const memory = { id: uid(), characterId, text: text.trim(), pinned, source, createdAt: Date.now() };
  await saveMemory(memory);
  return memory;
}

const running = new Set();

/**
 * Called after each reply. Runs in the background and never throws.
 * Mutates chat (marks messages, updates chat.summary) — the caller saves it.
 * Returns the number of memories added or changed.
 */
export async function updateMemory({ chat, character, settings }) {
  if (running.has(chat.id) || !settings.apiKey) return 0;
  running.add(chat.id);
  let changed = 0;
  try {
    changed = await rememberNewMessages(chat, character, settings);
    await summarizeIfLong(chat, character, settings);
  } catch (err) {
    console.warn('Memory update skipped:', err);
  } finally {
    running.delete(chat.id);
  }
  return changed;
}

async function rememberNewMessages(chat, character, settings) {
  const pending = chat.messages.filter((m) => usable(m) && !m.memorized);
  if (pending.length < EXTRACT_EVERY) return 0;

  const firstPending = chat.messages.indexOf(pending[0]);
  const context = chat.messages.slice(0, firstPending).filter(usable).slice(-6);
  const memories = await listMemories(character.id);

  const result = await extractMemories({ character, settings, memories, context, newMessages: pending });
  if (!result) {
    // Declined or unreadable: move on rather than retrying the same messages forever.
    for (const m of pending) m.memorized = true;
    return 0;
  }

  const byId = new Map(memories.map((m) => [m.id, m]));
  let changed = 0;

  for (const text of result.add) {
    if (!text.trim()) continue;
    await addMemory(character.id, text, { source: 'auto' });
    changed++;
  }
  for (const { id, text } of result.update) {
    const m = byId.get(id);
    if (m && !m.pinned && text.trim() && text.trim() !== m.text) {
      await saveMemory({ ...m, text: text.trim() });
      changed++;
    }
  }
  for (const id of result.remove) {
    const m = byId.get(id);
    if (m && !m.pinned) {
      await deleteMemory(id);
      changed++;
    }
  }

  const auto = (await listMemories(character.id)).filter((m) => m.source === 'auto' && !m.pinned);
  for (const m of auto.slice(0, Math.max(0, auto.length - MAX_AUTO_MEMORIES))) await deleteMemory(m.id);

  for (const m of pending) m.memorized = true;
  return changed;
}

async function summarizeIfLong(chat, character, settings) {
  const live = liveMessages(chat);
  if (live.length <= SUMMARIZE_AFTER) return;
  const older = live.slice(0, -KEEP_RECENT);
  const summary = await summarizeChat({ character, settings, previousSummary: chat.summary, messages: older });
  if (!summary) return;
  chat.summary = summary;
  for (const m of older) m.summarized = true;
}
