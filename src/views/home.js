import { listCharacters, saveCharacter, uid } from '../db.js';
import { esc, avatarHtml, icon, $, $$, toast } from '../util.js';
import { logoSvg } from '../logo.js';

export async function renderHome(app) {
  const characters = await listCharacters();

  app.innerHTML = `
    <header class="topbar">
      <div class="brand">${logoSvg(30)}Kindred</div>
      <div class="topbar-actions">
        <label class="icon-btn" title="Import a character file">
          ${icon('upload')}<input type="file" accept="application/json,.json" id="import" hidden>
        </label>
        <a class="icon-btn" href="#/settings" title="Settings">${icon('gear')}</a>
      </div>
    </header>
    <main class="page">
      <section class="hero">
        <h1>Who do you want to talk to?</h1>
        <p>Pick a character or bring your own to life.</p>
        <div class="search">${icon('search')}<input id="search" type="search" placeholder="Search characters" autocomplete="off"></div>
      </section>
      <div class="grid" id="grid">
        <a class="card card-create" href="#/new">
          <div class="create-plus">${icon('plus')}</div>
          <div class="card-name">Create a character</div>
          <div class="card-tagline">Photo, bio, personality, stats</div>
        </a>
        ${characters
          .map(
            (c) => `
          <a class="card" href="#/c/${encodeURIComponent(c.id)}" data-search="${esc(
            [c.name, c.tagline, ...(c.tags ?? []), ...(c.traits ?? [])].join(' ').toLowerCase(),
          )}">
            <div class="card-photo">${avatarHtml(c, 96)}</div>
            <div class="card-name">${esc(c.name)}</div>
            <div class="card-tagline">${esc(c.tagline)}</div>
            ${c.tags?.length ? `<div class="chips small">${c.tags.slice(0, 3).map((t) => `<span class="chip">${esc(t)}</span>`).join('')}</div>` : ''}
          </a>`,
          )
          .join('')}
      </div>
    </main>`;

  $('#search').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    for (const card of $$('.card[data-search]')) {
      card.hidden = q && !card.dataset.search.includes(q);
    }
  });

  $('#import').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data.name) throw new Error('missing name');
      const character = { ...data, id: uid(), createdAt: Date.now() };
      await saveCharacter(character);
      toast(`Imported ${character.name}`);
      location.hash = `#/c/${character.id}`;
    } catch {
      toast("That file isn't a valid character.", 'error');
    }
  });
}
