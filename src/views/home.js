import { listCharacters, listAllChats, getSettings, getLikes, toggleLike } from '../db.js';
import { creatorOf } from '../stats.js';
import { cloudEnabled, getCommunity, setLike, report } from '../cloud.js';
import { mergeFeed, adoptCommunityCharacter } from '../share.js';
import { esc, avatarHtml, icon, $, $$, formatMessage, timeAgo, fillNames, toast } from '../util.js';
import { logoSvg } from '../logo.js';

const FILTERS = [
  ['foryou', 'For you'],
  ['new', 'Newest'],
  ['popular', 'Popular'],
  ['liked', 'Liked'],
];
let filter = 'foryou'; // remembered while the app is open

const excerpt = (text, max = 190) => (text.length > max ? `${text.slice(0, max).trimEnd()}…` : text);

export async function renderHome(app) {
  const [local, chats, settings, likedIds] = await Promise.all([
    listCharacters(),
    listAllChats(),
    getSettings(),
    getLikes(),
  ]);
  const liked = new Set(likedIds);
  let remote = null; // community posts, once they arrive
  let gone = false; // set when you leave this screen

  // The latest chat per character, newest first: powers "Continue" and the stories row.
  const lastChat = new Map();
  for (const chat of chats) {
    const seen = lastChat.get(chat.characterId);
    if (!seen || chat.updatedAt > seen.updatedAt) lastChat.set(chat.characterId, chat);
  }
  const byId = new Map(local.map((c) => [c.id, c]));
  const recent = [...lastChat.values()]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .filter((chat) => byId.has(chat.characterId))
    .slice(0, 14);

  const stamp = (item) => item.c.createdAt ?? 0;
  const likes = (item) => item.remote?.likeCount ?? 0;
  let items = mergeFeed(local, remote);

  const feed = () => {
    let list = items.slice();
    if (filter === 'liked') list = list.filter((i) => liked.has(i.c.id));
    if (filter === 'new') list.sort((a, b) => stamp(b) - stamp(a));
    if (filter === 'popular') list.sort((a, b) => likes(b) - likes(a) || stamp(b) - stamp(a));
    // For you: people you haven't talked to yet come first.
    if (filter === 'foryou') {
      list.sort((a, b) => Number(lastChat.has(a.c.id)) - Number(lastChat.has(b.c.id)) || stamp(b) - stamp(a));
    }
    return list;
  };

  const post = (item) => {
    const { c, remote: info, remoteOnly } = item;
    const chat = lastChat.get(c.id);
    const age = timeAgo(c.createdAt);
    const sample = excerpt(fillNames(c.greeting || c.bio || '', c, settings));
    const stats = (c.stats ?? []).slice(0, 3);
    const chips = [...(c.traits ?? []).slice(0, 3), ...(c.tags ?? []).slice(0, 2)];
    const isLiked = liked.has(c.id);
    const profileHref = `#/c/${encodeURIComponent(c.id)}`;
    const chatHref = `#/chat/${encodeURIComponent(c.id)}/${chat ? encodeURIComponent(chat.id) : 'new'}`;
    // Posts nobody has added to this device yet get added the moment you open or chat with them.
    const link = (cls, href, go, label) =>
      remoteOnly
        ? `<button type="button" class="${cls}" data-adopt="${esc(info.remoteId)}" data-go="${go}">${label}</button>`
        : `<a class="${cls}" href="${href}">${label}</a>`;
    // You can't report your own character.
    const reportable = info && !c.publishedId;

    return `
      <article class="post" data-id="${esc(c.id)}">
        <header class="post-head">
          ${
            remoteOnly
              ? `<button type="button" class="post-who plain" data-adopt="${esc(info.remoteId)}" data-go="profile">`
              : `<a class="post-who" href="${profileHref}">`
          }
            ${avatarHtml(c, 44)}
            <div>
              <div class="post-name">${esc(c.name)}</div>
              <div class="muted small">by ${esc(creatorOf(c, settings))}${age ? ` · ${age}` : c.id.startsWith('starter-') ? ' · Featured' : ''}</div>
            </div>
          ${remoteOnly ? '</button>' : '</a>'}
          ${reportable ? `<button type="button" class="link-btn" data-report="${esc(info.remoteId)}">Report</button>` : ''}
        </header>
        ${c.photo ? `<img class="post-photo" src="${c.photo}" alt="${esc(c.name)}" loading="lazy">` : ''}
        ${c.tagline ? `<p class="post-tagline">${esc(c.tagline)}</p>` : ''}
        ${sample ? `<blockquote class="post-quote">${formatMessage(sample)}</blockquote>` : ''}
        ${stats.length ? `<div class="pills">${stats.map((s) => `<span class="pill">${esc(s.name)} <b>${Number(s.value)}</b></span>`).join('')}</div>` : ''}
        ${chips.length ? `<div class="chips small">${chips.map((t) => `<span class="chip">${esc(t)}</span>`).join('')}</div>` : ''}
        <footer class="post-actions">
          <button type="button" class="act ${isLiked ? 'liked' : ''}" data-like="${esc(c.id)}" aria-pressed="${isLiked}" aria-label="Like ${esc(c.name)}">
            ${icon(isLiked ? 'heart-fill' : 'heart')}${info ? `<span class="like-n">${info.likeCount}</span>` : ''}
          </button>
          ${link('act', profileHref, 'profile', `${icon('user')} Profile`)}
          ${link('btn primary post-chat', chatHref, 'chat', `${icon('chat')} ${chat ? 'Continue' : 'Chat'}`)}
        </footer>
      </article>`;
  };

  const empty = () =>
    filter === 'liked'
      ? `<div class="empty">${icon('heart')}<p>Characters you like show up here. Tap the heart on a post.</p></div>`
      : `<div class="empty"><p>Nobody here yet. <a href="#/create">Create the first character.</a></p></div>`;

  const draw = () => {
    if (gone) return;
    items = mergeFeed(local, remote);
    const list = feed();
    $('#feed').innerHTML = list.length ? list.map(post).join('') : empty();
    for (const btn of $$('[data-filter]')) btn.classList.toggle('on', btn.dataset.filter === filter);
  };

  const setNote = (text) => {
    const note = $('#note');
    if (note) note.textContent = text;
  };

  async function loadCommunity(force = false) {
    if (!cloudEnabled()) return;
    setNote('Loading the community…');
    try {
      remote = await getCommunity({ force });
      setNote('');
    } catch (err) {
      console.warn('Community failed to load', err);
      setNote("Couldn't load the community right now. Showing what's on this device.");
    }
    draw();
  }

  app.innerHTML = `
    <header class="topbar">
      <div class="brand">${logoSvg(30)}Kindred</div>
      ${cloudEnabled() ? `<button type="button" class="icon-btn" id="refresh" title="Refresh">${icon('refresh')}</button>` : ''}
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
      <p class="muted small feed-note" id="note"></p>
      <div id="feed" class="feed"></div>
    </main>`;

  draw();
  loadCommunity();

  const onClick = async (e) => {
    const tab = e.target.closest('[data-filter]');
    if (tab) {
      filter = tab.dataset.filter;
      draw();
      return;
    }

    if (e.target.closest('#refresh')) {
      loadCommunity(true);
      return;
    }

    // Open or chat with a community post: add it to this device first.
    const adopt = e.target.closest('[data-adopt]');
    if (adopt) {
      const info = remote?.find((r) => r.remoteId === adopt.dataset.adopt);
      if (!info) return;
      adopt.disabled = true;
      try {
        const character = await adoptCommunityCharacter(info);
        location.hash = adopt.dataset.go === 'chat' ? `#/chat/${encodeURIComponent(character.id)}/new` : `#/c/${encodeURIComponent(character.id)}`;
      } catch (err) {
        adopt.disabled = false;
        toast(`Couldn't add that character: ${err.message}`, 'error');
      }
      return;
    }

    const flag = e.target.closest('[data-report]');
    if (flag) {
      const reason = prompt('What\'s wrong with this character? (e.g. inappropriate, spam, hateful)');
      if (!reason?.trim()) return;
      try {
        await report(flag.dataset.report, reason);
        toast('Thanks, reported. It will be reviewed.');
      } catch (err) {
        toast(`Couldn't send the report: ${err.message}`, 'error');
      }
      return;
    }

    const like = e.target.closest('[data-like]');
    if (like) {
      const id = like.dataset.like;
      const item = items.find((i) => i.c.id === id);
      const nowLiked = await toggleLike(id);
      if (nowLiked) liked.add(id);
      else liked.delete(id);

      // Update the shared count too (and put things back if that fails).
      if (item?.remote && cloudEnabled()) {
        item.remote.likeCount += nowLiked ? 1 : -1;
        setLike(item.remote.remoteId, nowLiked).catch(async (err) => {
          item.remote.likeCount += nowLiked ? -1 : 1;
          if (await toggleLike(id)) liked.add(id);
          else liked.delete(id);
          draw();
          toast(`Couldn't save your like: ${err.message}`, 'error');
        });
      }

      // On the Liked tab an unliked post should leave the list; elsewhere just flip the heart.
      if (filter === 'liked') draw();
      else {
        like.classList.toggle('liked', nowLiked);
        like.setAttribute('aria-pressed', String(nowLiked));
        like.innerHTML = `${icon(nowLiked ? 'heart-fill' : 'heart')}${item?.remote ? `<span class="like-n">${item.remote.likeCount}</span>` : ''}`;
      }
    }
  };
  app.addEventListener('click', onClick);

  return () => {
    gone = true;
    app.removeEventListener('click', onClick);
  };
}
