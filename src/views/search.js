import { listCharacters, getSettings } from '../db.js';
import { creatorOf } from '../stats.js';
import { cloudEnabled, getCommunity } from '../cloud.js';
import { mergeFeed, adoptCommunityCharacter } from '../share.js';
import { isMature, isAdult, canViewMature, confirmAdult, matureNotice } from '../age.js';
import { esc, avatarHtml, icon, $, $$, toast } from '../util.js';

export async function renderSearch(app) {
  const [local, settings] = await Promise.all([listCharacters(), getSettings()]);
  let remote = null;
  let gone = false;
  const visible = (c) => !isMature(c) || canViewMature(settings);
  let hiddenCount = 0;
  let items = mergeFeed(local, remote).filter(({ c }) => visible(c));
  let haystack = new Map();
  let tags = [];
  let activeTag = null;

  // Rebuilt whenever the community list arrives.
  const index = () => {
    const everyone = mergeFeed(local, remote);
    items = everyone.filter(({ c }) => visible(c));
    hiddenCount = everyone.length - items.length;
    haystack = new Map(
      items.map(({ c }) => [
        c.id,
        [c.name, c.tagline, c.bio, c.personality, creatorOf(c, settings), ...(c.tags ?? []), ...(c.traits ?? [])]
          .join(' ')
          .toLowerCase(),
      ]),
    );
    // Most-used tags first, so the chips reflect what's actually here.
    const counts = new Map();
    for (const { c } of items) for (const t of c.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
    tags = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t).slice(0, 14);
    $('#tags').innerHTML = tags.map((t) => `<button type="button" class="chip" data-tag="${esc(t)}">${esc(t)}</button>`).join('');
  };

  app.innerHTML = `
    <header class="topbar"><div class="topbar-title">Search</div></header>
    <main class="page narrow">
      <div class="search big-search">
        ${icon('search')}
        <input id="q" type="search" placeholder="Search by name, trait, tag or creator" autocomplete="off" enterkeyhint="search">
      </div>
      <div class="chips tag-row" id="tags"></div>
      <div id="mature-note"></div>
      <p class="muted small" id="count"></p>
      <div id="results" class="results"></div>
    </main>`;

  const draw = () => {
    if (gone) return;
    const tokens = $('#q').value.toLowerCase().split(/\s+/).filter(Boolean);
    const matches = items.filter(({ c }) => {
      if (activeTag && !(c.tags ?? []).some((t) => t.toLowerCase() === activeTag.toLowerCase())) return false;
      const text = haystack.get(c.id);
      return tokens.every((t) => text.includes(t));
    });

    $('#mature-note').innerHTML = matureNotice(hiddenCount, isAdult(settings));
    for (const chip of $$('[data-tag]')) chip.classList.toggle('accent', chip.dataset.tag === activeTag);
    $('#count').textContent = tokens.length || activeTag
      ? `${matches.length} ${matches.length === 1 ? 'result' : 'results'}`
      : `Everyone · ${items.length}`;

    $('#results').innerHTML = matches.length
      ? matches
          .map(({ c, remote: info, remoteOnly }) => {
            const open = remoteOnly
              ? `<button type="button" class="row-main plain" data-adopt="${esc(info.remoteId)}" data-go="profile">`
              : `<a class="row-main" href="#/c/${encodeURIComponent(c.id)}">`;
            const chat = remoteOnly
              ? `<button type="button" class="btn small-btn" data-adopt="${esc(info.remoteId)}" data-go="chat" aria-label="Chat with ${esc(c.name)}">${icon('chat')}</button>`
              : `<a class="btn small-btn" href="#/chat/${encodeURIComponent(c.id)}/new" aria-label="Chat with ${esc(c.name)}">${icon('chat')}</a>`;
            return `
        <div class="row">
          ${open}
            ${avatarHtml(c, 52)}
            <div class="row-text">
              <div class="row-name">${esc(c.name)}</div>
              <div class="muted small">by ${esc(creatorOf(c, settings))}${info ? ` · ♥ ${info.likeCount}` : ''}</div>
              <div class="row-sub">${esc(c.tagline ?? '')}</div>
            </div>
          ${remoteOnly ? '</button>' : '</a>'}
          ${chat}
        </div>`;
          })
          .join('')
      : `<div class="empty">${icon('search')}<p>No one matches that. Try a different word, or <a href="#/new">create them yourself</a>.</p></div>`;
  };

  index();
  draw();
  $('#q').addEventListener('input', draw);

  const onClick = async (e) => {
    if (e.target.closest('[data-confirm-adult]')) {
      await confirmAdult();
      window.dispatchEvent(new HashChangeEvent('hashchange'));
      return;
    }
    const chip = e.target.closest('[data-tag]');
    if (chip) {
      activeTag = activeTag === chip.dataset.tag ? null : chip.dataset.tag;
      draw();
      return;
    }
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
    }
  };
  app.addEventListener('click', onClick);

  // Community results join in as soon as they load.
  if (cloudEnabled()) {
    getCommunity()
      .then((list) => {
        if (gone) return;
        remote = list;
        index();
        draw();
      })
      .catch((err) => console.warn('Community failed to load', err));
  }

  // Don't pop the keyboard open on a phone just by visiting the tab.
  if (!matchMedia('(pointer: coarse)').matches) $('#q').focus();

  return () => {
    gone = true;
    app.removeEventListener('click', onClick);
  };
}
