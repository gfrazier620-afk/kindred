import { getCharacter, listMemories, saveMemory, deleteMemory, listChats, saveChat } from '../db.js';
import { addMemory } from '../memory.js';
import { esc, icon, $, toast, avatarHtml } from '../util.js';

export async function renderMemories(app, characterId) {
  const character = await getCharacter(characterId);
  if (!character) {
    location.hash = '#/';
    return;
  }
  const memories = await listMemories(characterId);
  const profileHref = `#/c/${encodeURIComponent(characterId)}`;

  const item = (m) => `
    <li class="memory ${m.pinned ? 'pinned' : ''}" data-id="${esc(m.id)}">
      <div class="memory-text" contenteditable="plaintext-only" spellcheck="true" aria-label="Memory">${esc(m.text)}</div>
      <div class="memory-meta">
        <span class="muted small">${m.source === 'auto' ? 'Learned in chat' : 'Added by you'}</span>
        <button type="button" class="tool ${m.pinned ? 'on' : ''}" data-action="pin" title="${m.pinned ? 'Unpin' : 'Pin — never changed or forgotten automatically'}">${icon('pin')} ${m.pinned ? 'Pinned' : 'Pin'}</button>
        <button type="button" class="tool" data-action="delete" title="Forget this">${icon('trash')}</button>
      </div>
    </li>`;

  app.innerHTML = `
    <header class="topbar">
      <a class="icon-btn" href="${profileHref}" title="Back">${icon('back')}</a>
      <div class="topbar-title">Memories</div>
      <a class="icon-btn" href="#/chat/${encodeURIComponent(characterId)}" title="Back to chat">${icon('chat')}</a>
    </header>
    <main class="page narrow">
      <div class="memories-head">
        ${avatarHtml(character, 56)}
        <p class="muted">What <strong>${esc(character.name)}</strong> remembers about you. These carry into every chat with them. ${esc(character.name)} adds memories automatically as you talk — tap any memory to edit it, pin the ones that should never change.</p>
      </div>

      <form class="memory-add" id="add">
        <input id="new-memory" placeholder="Add something ${esc(character.name)} should remember…" autocomplete="off">
        <button class="btn primary">${icon('plus')} Add</button>
      </form>

      ${
        memories.length
          ? `<ul class="memory-list" id="list">${memories.map(item).join('')}</ul>`
          : `<div class="empty">${icon('brain')}<p>No memories yet. Chat for a bit and ${esc(character.name)} will start remembering things, or add one above.</p></div>`
      }

      ${memories.length ? `<button type="button" class="btn ghost danger-text" id="forget-all">${icon('trash')} Forget everything</button>` : ''}
    </main>`;

  const byId = new Map(memories.map((m) => [m.id, m]));
  const rerender = () => renderMemories(app, characterId);

  $('#add').addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = $('#new-memory').value.trim();
    if (!text) return;
    await addMemory(characterId, text);
    rerender();
  });

  const list = $('#list');
  if (list) {
    list.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const m = byId.get(btn.closest('.memory').dataset.id);
      if (btn.dataset.action === 'pin') await saveMemory({ ...m, pinned: !m.pinned });
      if (btn.dataset.action === 'delete') await deleteMemory(m.id);
      rerender();
    });

    // Edits save when you leave the memory; Enter finishes editing.
    list.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.classList.contains('memory-text')) {
        e.preventDefault();
        e.target.blur();
      }
    });
    list.addEventListener('focusout', async (e) => {
      if (!e.target.classList.contains('memory-text')) return;
      const m = byId.get(e.target.closest('.memory').dataset.id);
      const text = e.target.textContent.trim();
      if (!text) {
        await deleteMemory(m.id);
        rerender();
      } else if (text !== m.text) {
        m.text = text;
        // Editing a memory by hand means you want it kept as written.
        await saveMemory({ ...m, source: 'user' });
        toast('Memory updated');
      }
    });
  }

  $('#forget-all')?.addEventListener('click', async () => {
    if (!confirm(`Make ${character.name} forget everything about you? Pinned memories are removed too. Your chats are kept.`)) return;
    for (const m of memories) await deleteMemory(m.id);
    // Let memory re-learn from existing chats only from here on.
    for (const chat of await listChats(characterId)) {
      chat.messages.forEach((msg) => (msg.memorized = true));
      await saveChat(chat);
    }
    toast(`${character.name}'s memories cleared`);
    rerender();
  });
}
