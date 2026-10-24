import { listCharacters, getSettings } from '../db.js';
import { creatorOf } from '../stats.js';
import { esc, avatarHtml, icon, $, $$ } from '../util.js';

export async function renderSearch(app) {
  const [characters, settings] = await Promise.all([listCharacters(), getSettings()]);

  // Everything a search can match, lower-cased once.
  const haystack = new Map(
    characters.map((c) => [
      c.id,
      [c.name, c.tagline, c.bio, c.personality, creatorOf(c, settings), ...(c.tags ?? []), ...(c.traits ?? [])]
        .join(' ')
        .toLowerCase(),
    ]),
  );

  // Most-used tags first, so the chips reflect what's actually here.
  const tagCounts = new Map();
  for (const c of characters) for (const t of c.tags ?? []) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
  const tags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t).slice(0, 14);

  let activeTag = null;

  app.innerHTML = `
    <header class="topbar"><div class="topbar-title">Search</div></header>
    <main class="page narrow">
      <div class="search big-search">
        ${icon('search')}
        <input id="q" type="search" placeholder="Search by name, trait, tag or creator" autocomplete="off" enterkeyhint="search">
      </div>
      ${tags.length ? `<div class="chips tag-row" id="tags">${tags.map((t) => `<button type="button" class="chip" data-tag="${esc(t)}">${esc(t)}</button>`).join('')}</div>` : ''}
      <p class="muted small" id="count"></p>
      <div id="results" class="results"></div>
    </main>`;

  const draw = () => {
    const tokens = $('#q').value.toLowerCase().split(/\s+/).filter(Boolean);
    const matches = characters.filter((c) => {
      if (activeTag && !(c.tags ?? []).some((t) => t.toLowerCase() === activeTag.toLowerCase())) return false;
      const text = haystack.get(c.id);
      return tokens.every((t) => text.includes(t));
    });

    for (const chip of $$('[data-tag]')) chip.classList.toggle('accent', chip.dataset.tag === activeTag);
    $('#count').textContent = tokens.length || activeTag
      ? `${matches.length} ${matches.length === 1 ? 'result' : 'results'}`
      : `Everyone · ${characters.length}`;

    $('#results').innerHTML = matches.length
      ? matches
          .map(
            (c) => `
        <div class="row">
          <a class="row-main" href="#/c/${encodeURIComponent(c.id)}">
            ${avatarHtml(c, 52)}
            <div class="row-text">
              <div class="row-name">${esc(c.name)}</div>
              <div class="muted small">by ${esc(creatorOf(c, settings))}</div>
              <div class="row-sub">${esc(c.tagline ?? '')}</div>
            </div>
          </a>
          <a class="btn small-btn" href="#/chat/${encodeURIComponent(c.id)}/new" aria-label="Chat with ${esc(c.name)}">${icon('chat')}</a>
        </div>`,
          )
          .join('')
      : `<div class="empty">${icon('search')}<p>No one matches that. Try a different word, or <a href="#/new">create them yourself</a>.</p></div>`;
  };

  $('#q').addEventListener('input', draw);
  const tagRow = $('#tags');
  tagRow?.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-tag]');
    if (!chip) return;
    activeTag = activeTag === chip.dataset.tag ? null : chip.dataset.tag;
    draw();
  });

  draw();
  // Don't pop the keyboard open on a phone just by visiting the tab.
  if (!matchMedia('(pointer: coarse)').matches) $('#q').focus();
}
