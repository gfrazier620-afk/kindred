import { listCharacters, listAllChats, getSettings, getLikes, toggleLike } from '../db.js';
import { creatorOf } from '../stats.js';
import { esc, avatarHtml, icon, $, $$, formatMessage, timeAgo, fillNames } from '../util.js';
import { logoSvg } from '../logo.js';

const FILTERS = [
  ['foryou', 'For you'],
  ['new', 'Newest'],
  ['liked', 'Liked'],
];
let filter = 'foryou'; // remembered while the app is open

const excerpt = (text, max = 190) => (text.length > max ? `${text.slice(0, max).trimEnd()}…` : text);

export async function renderHome(app) {
  const [characters, chats, settings, likedIds] = await Promise.all([
    listCharacters(),
    listAllChats(),
    getSettings(),
    getLikes(),
  ]);
  const liked = new Set(likedIds);

  // The latest chat per character, newest first: powers "Continue" and the stories row.
  const lastChat = new Map();
  for (const chat of chats) {
    const seen = lastChat.get(chat.characterId);
    if (!seen || chat.updatedAt > seen.updatedAt) lastChat.set(chat.characterId, chat);
  }
  const byId = new Map(characters.map((c) => [c.id, c]));
  const recent = [...lastChat.values()]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .filter((chat) => byId.has(chat.characterId))
    .slice(0, 14);

  const stamp = (c) => c.createdAt ?? 0;
  const feed = () => {
    let list = characters.slice();
    if (filter === 'liked') list = list.filter((c) => liked.has(c.id));
    if (filter === 'new') list.sort((a, b) => stamp(b) - stamp(a));
    // For you: people you haven't talked to yet come first.
    if (filter === 'foryou') {
      list.sort((a, b) => Number(lastChat.has(a.id)) - Number(lastChat.has(b.id)) || stamp(b) - stamp(a));
    }
    return list;
  };

  const post = (c) => {
    const chat = lastChat.get(c.id);
    const age = timeAgo(c.createdAt);
    const sample = excerpt(fillNames(c.greeting || c.bio || '', c, settings));
    const stats = (c.stats ?? []).slice(0, 3);
    const chips = [...(c.traits ?? []).slice(0, 3), ...(c.tags ?? []).slice(0, 2)];
    return `
      <article class="post" data-id="${esc(c.id)}">
        <header class="post-head">
          <a class="post-who" href="#/c/${encodeURIComponent(c.id)}">
            ${avatarHtml(c, 44)}
            <div>
              <div class="post-name">${esc(c.name)}</div>
              <div class="muted small">by ${esc(creatorOf(c, settings))}${age ? ` · ${age}` : c.id.startsWith('starter-') ? ' · Featured' : ''}</div>
            </div>
          </a>
        </header>
        ${c.photo ? `<a href="#/c/${encodeURIComponent(c.id)}"><img class="post-photo" src="${c.photo}" alt="${esc(c.name)}" loading="lazy"></a>` : ''}
        ${c.tagline ? `<p class="post-tagline">${esc(c.tagline)}</p>` : ''}
        ${sample ? `<blockquote class="post-quote">${formatMessage(sample)}</blockquote>` : ''}
        ${stats.length ? `<div class="pills">${stats.map((s) => `<span class="pill">${esc(s.name)} <b>${Number(s.value)}</b></span>`).join('')}</div>` : ''}
        ${chips.length ? `<div class="chips small">${chips.map((t) => `<span class="chip">${esc(t)}</span>`).join('')}</div>` : ''}
        <footer class="post-actions">
          <button type="button" class="act ${liked.has(c.id) ? 'liked' : ''}" data-like="${esc(c.id)}" aria-pressed="${liked.has(c.id)}" aria-label="Like ${esc(c.name)}">
            ${icon(liked.has(c.id) ? 'heart-fill' : 'heart')}
          </button>
          <a class="act" href="#/c/${encodeURIComponent(c.id)}">${icon('user')} Profile</a>
          <a class="btn primary post-chat" href="#/chat/${encodeURIComponent(c.id)}/${chat ? encodeURIComponent(chat.id) : 'new'}">${icon('chat')} ${chat ? 'Continue' : 'Chat'}</a>
        </footer>
      </article>`;
  };

  const empty = () =>
    filter === 'liked'
      ? `<div class="empty">${icon('heart')}<p>Characters you like show up here. Tap the heart on a post.</p></div>`
      : `<div class="empty"><p>Nobody here yet. <a href="#/create">Create the first character.</a></p></div>`;

  const draw = () => {
    const list = feed();
    $('#feed').innerHTML = list.length ? list.map(post).join('') : empty();
    for (const btn of $$('[data-filter]')) btn.classList.toggle('on', btn.dataset.filter === filter);
  };

  app.innerHTML = `
    <header class="topbar">
      <div class="brand">${logoSvg(30)}Kindred</div>
    </header>
    <main class="page narrow">
      ${
        recent.length
          ? `<section class="stories" aria-label="Continue chatting">
          ${recent
            .map((chat) => {
              const c = byId.get(chat.characterId);
              return `<a class="story" href="#/chat/${encodeURIComponent(c.id)}/${encodeURIComponent(chat.id)}">
                <span class="story-ring">${avatarHtml(c, 58)}</span>
                <span class="story-name">${esc(c.name.split(' ')[0])}</span>
              </a>`;
            })
            .join('')}
        </section>`
          : ''
      }
      <div class="seg" role="tablist">
        ${FILTERS.map(([key, label]) => `<button type="button" role="tab" data-filter="${key}">${label}</button>`).join('')}
      </div>
      <div id="feed" class="feed"></div>
    </main>`;

  draw();

  app.addEventListener('click', onClick);
  async function onClick(e) {
    const tab = e.target.closest('[data-filter]');
    if (tab) {
      filter = tab.dataset.filter;
      draw();
      return;
    }
    const like = e.target.closest('[data-like]');
    if (like) {
      const id = like.dataset.like;
      const nowLiked = await toggleLike(id);
      if (nowLiked) liked.add(id);
      else liked.delete(id);
      // On the Liked tab an unliked post should leave the list; elsewhere just flip the heart.
      if (filter === 'liked') draw();
      else {
        like.classList.toggle('liked', nowLiked);
        like.setAttribute('aria-pressed', String(nowLiked));
        like.innerHTML = icon(nowLiked ? 'heart-fill' : 'heart');
      }
    }
  }

  return () => app.removeEventListener('click', onClick);
}
