import { getCharacter, deleteCharacter, listChats, deleteChat } from '../db.js';
import { esc, avatarHtml, icon, $, toast, downloadJson, formatMessage } from '../util.js';

export async function renderProfile(app, id) {
  const c = await getCharacter(id);
  if (!c) {
    location.hash = '#/';
    return;
  }
  const chats = await listChats(id);

  const section = (title, body) =>
    body ? `<section class="panel"><h2>${title}</h2><div class="prose">${formatMessage(body)}</div></section>` : '';

  app.innerHTML = `
    <header class="topbar">
      <a class="icon-btn" href="#/" title="Back">${icon('back')}</a>
      <div class="topbar-actions">
        <button class="icon-btn" id="export" title="Export character">${icon('download')}</button>
        <a class="icon-btn" href="#/c/${encodeURIComponent(id)}/edit" title="Edit">${icon('edit')}</a>
        <button class="icon-btn danger" id="delete" title="Delete character">${icon('trash')}</button>
      </div>
    </header>
    <main class="page narrow">
      <div class="profile-head">
        ${avatarHtml(c, 132)}
        <h1>${esc(c.name)}</h1>
        ${c.tagline ? `<p class="muted">${esc(c.tagline)}</p>` : ''}
        ${c.tags?.length ? `<div class="chips">${c.tags.map((t) => `<span class="chip">${esc(t)}</span>`).join('')}</div>` : ''}
        <a class="btn primary big" href="#/chat/${encodeURIComponent(id)}/new">${icon('chat')} Start a new chat</a>
      </div>

      ${
        chats.length
          ? `<section class="panel"><h2>Your chats</h2><ul class="chat-list">
          ${chats
            .map((ch) => {
              const last = ch.messages[ch.messages.length - 1];
              return `<li>
                <a href="#/chat/${encodeURIComponent(id)}/${encodeURIComponent(ch.id)}">
                  <span class="chat-preview">${esc((last?.content ?? '').slice(0, 90))}</span>
                  <span class="muted small">${ch.messages.length} messages · ${new Date(ch.updatedAt).toLocaleDateString()}</span>
                </a>
                <button class="icon-btn small danger" data-del-chat="${esc(ch.id)}" title="Delete chat">${icon('trash')}</button>
              </li>`;
            })
            .join('')}
        </ul></section>`
          : ''
      }

      ${section('Bio', c.bio)}

      ${
        c.traits?.length || c.personality
          ? `<section class="panel"><h2>Personality</h2>
          ${c.traits?.length ? `<div class="chips">${c.traits.map((t) => `<span class="chip accent">${esc(t)}</span>`).join('')}</div>` : ''}
          ${c.personality ? `<div class="prose">${formatMessage(c.personality)}</div>` : ''}
        </section>`
          : ''
      }

      ${
        c.stats?.length
          ? `<section class="panel"><h2>Stats</h2><div class="stats">
          ${c.stats
            .map(
              (s) => `<div class="stat">
              <div class="stat-label"><span>${esc(s.name)}</span><span>${Number(s.value)}</span></div>
              <div class="stat-bar"><div style="width:${Math.max(0, Math.min(100, Number(s.value)))}%"></div></div>
            </div>`,
            )
            .join('')}
        </div></section>`
          : ''
      }

      ${section('Scenario', c.scenario)}
      ${section('First message', c.greeting)}
    </main>`;

  $('#export').addEventListener('click', () => {
    const { id: _id, updatedAt, createdAt, ...data } = c;
    downloadJson(`${c.name.replace(/[^\w-]+/g, '_')}.kindred.json`, data);
  });

  $('#delete').addEventListener('click', async () => {
    if (!confirm(`Delete ${c.name} and all chats with them? This can't be undone.`)) return;
    await deleteCharacter(id);
    toast(`${c.name} deleted`);
    location.hash = '#/';
  });

  app.querySelectorAll('[data-del-chat]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this chat?')) return;
      await deleteChat(btn.dataset.delChat);
      renderProfile(app, id);
    }),
  );
}
