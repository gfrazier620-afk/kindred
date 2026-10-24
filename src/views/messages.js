import { listCharacters, listAllChats, deleteChat, getSettings } from '../db.js';
import { isMature, isAdult } from '../age.js';
import { esc, avatarHtml, icon, timeAgo, toast } from '../util.js';

// Plain-text preview of a message: no *asterisks*, one line.
const clean = (text) => text.replace(/\*+/g, '').replace(/\s+/g, ' ').trim();

export async function renderMessages(app) {
  const [characters, chats, settings] = await Promise.all([listCharacters(), listAllChats(), getSettings()]);
  const byId = new Map(characters.map((c) => [c.id, c]));

  // Conversations you've actually joined in on, most recent first. A chat that only has the
  // character's opening line (you opened it and left) isn't a conversation yet.
  const convos = chats
    .filter((chat) => byId.has(chat.characterId) && chat.messages.some((m) => m.role === 'user'))
    .filter((chat) => !isMature(byId.get(chat.characterId)) || isAdult(settings))
    .sort((a, b) => b.updatedAt - a.updatedAt);

  const row = (chat) => {
    const c = byId.get(chat.characterId);
    const last = [...chat.messages].reverse().find((m) => m.content?.trim() && !m.error);
    const preview = last ? `${last.role === 'user' ? 'You: ' : ''}${clean(last.content)}` : '';
    return `
      <div class="row convo">
        <a class="row-main" href="#/chat/${encodeURIComponent(c.id)}/${encodeURIComponent(chat.id)}">
          ${avatarHtml(c, 56)}
          <div class="row-text">
            <div class="convo-top">
              <span class="row-name">${esc(c.name)}</span>
              <span class="muted small">${timeAgo(chat.updatedAt)}</span>
            </div>
            <div class="row-sub">${esc(preview)}</div>
          </div>
        </a>
        <button type="button" class="icon-btn small danger" data-del="${esc(chat.id)}" title="Delete conversation" aria-label="Delete conversation with ${esc(c.name)}">${icon('trash')}</button>
      </div>`;
  };

  app.innerHTML = `
    <header class="topbar"><div class="topbar-title">Messages</div></header>
    <main class="page narrow">
      ${
        convos.length
          ? `<div class="results">${convos.map(row).join('')}</div>`
          : `<div class="empty">
              ${icon('chat')}
              <p>No conversations yet. Find someone on Home or Search and say hi.</p>
              <a class="btn primary" href="#/">Browse characters</a>
            </div>`
      }
    </main>`;

  const onClick = async (e) => {
    const btn = e.target.closest('[data-del]');
    if (!btn) return;
    const chat = convos.find((x) => x.id === btn.dataset.del);
    const c = chat && byId.get(chat.characterId);
    if (!c || !confirm(`Delete this conversation with ${c.name}? This can't be undone.`)) return;
    await deleteChat(chat.id);
    toast('Conversation deleted');
    window.dispatchEvent(new HashChangeEvent('hashchange')); // redraw this screen
  };
  app.addEventListener('click', onClick);
  return () => app.removeEventListener('click', onClick);
}
