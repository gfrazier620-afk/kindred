import { getCharacter, saveCharacter, uid } from '../db.js';
import { cloudEnabled } from '../cloud.js';
import { shareCharacter, unshareCharacter } from '../share.js';
import { esc, avatarHtml, icon, $, toast, resizeImage } from '../util.js';

const DEFAULT_STATS = [
  { name: 'Kindness', value: 50 },
  { name: 'Humor', value: 50 },
  { name: 'Confidence', value: 50 },
];

const TRAIT_SUGGESTIONS = ['Funny', 'Shy', 'Flirty', 'Grumpy', 'Brave', 'Caring', 'Mysterious', 'Sarcastic', 'Energetic', 'Wise', 'Chaotic', 'Loyal'];

export async function renderEditor(app, id) {
  const existing = id ? await getCharacter(id) : null;
  if (id && !existing) {
    location.hash = '#/';
    return;
  }
  const c = existing
    ? structuredClone(existing)
    : { id: uid(), name: '', tagline: '', bio: '', personality: '', traits: [], stats: structuredClone(DEFAULT_STATS), scenario: '', greeting: '', examples: '', tags: [], photo: '', createdAt: Date.now() };

  const field = (key, label, hint, rows = 0, placeholder = '') => `
    <label class="field">
      <span class="field-label">${label}</span>
      ${hint ? `<span class="field-hint">${hint}</span>` : ''}
      ${
        rows
          ? `<textarea name="${key}" rows="${rows}" placeholder="${esc(placeholder)}">${esc(c[key])}</textarea>`
          : `<input name="${key}" value="${esc(c[key])}" placeholder="${esc(placeholder)}">`
      }
    </label>`;

  app.innerHTML = `
    <header class="topbar">
      <a class="icon-btn" href="${existing ? `#/c/${encodeURIComponent(c.id)}` : '#/create'}" title="Cancel">${icon('back')}</a>
      <div class="topbar-title">${existing ? 'Edit character' : 'New character'}</div>
      <button class="btn primary" id="save" form="editor">Save</button>
    </header>
    <main class="page narrow">
      <form id="editor" class="editor" autocomplete="off">
        <div class="photo-picker">
          <div id="photo-preview">${avatarHtml(c, 132)}</div>
          <div class="photo-actions">
            <label class="btn">${icon('camera')} ${c.photo ? 'Change photo' : 'Upload photo'}
              <input type="file" accept="image/*" id="photo" hidden>
            </label>
            <button type="button" class="btn ghost" id="remove-photo" ${c.photo ? '' : 'hidden'}>Remove</button>
          </div>
        </div>

        <section class="panel">
          <h2>Basics</h2>
          ${field('name', 'Name', '', 0, 'e.g. Captain Mira Vale')}
          ${field('tagline', 'Tagline', 'One line shown on their card.', 0, 'e.g. Smuggler captain with a heart of gold')}
          <label class="field">
            <span class="field-label">Tags</span>
            <span class="field-hint">Comma separated — helps with search.</span>
            <input name="tags" value="${esc((c.tags ?? []).join(', '))}" placeholder="Fantasy, Romance, Comedy">
          </label>
        </section>

        <section class="panel">
          <h2>Bio</h2>
          ${field('bio', 'Backstory', 'Who are they? Where do they come from? What do they want?', 6, 'Write their story…')}
        </section>

        <section class="panel">
          <h2>Personality</h2>
          <div class="field">
            <span class="field-label">Traits</span>
            <div class="chips" id="traits"></div>
            <input id="trait-input" placeholder="Type a trait and press Enter">
            <div class="chips small suggestions">
              ${TRAIT_SUGGESTIONS.map((t) => `<button type="button" class="chip" data-suggest="${esc(t)}">+ ${esc(t)}</button>`).join('')}
            </div>
          </div>
          ${field('personality', 'How they act', 'How do they talk? Quirks, habits, likes and dislikes.', 4, 'Talks fast, laughs at their own jokes, hates mornings…')}
        </section>

        <section class="panel">
          <h2>Stats</h2>
          <p class="field-hint">Rate anything from 0 to 100. The AI uses these to shape how they behave.</p>
          <div id="stats" class="stats-editor"></div>
          <button type="button" class="btn ghost" id="add-stat">${icon('plus')} Add stat</button>
        </section>

        <section class="panel">
          <h2>Conversation</h2>
          ${field('greeting', 'First message', 'What they say when a new chat starts.', 3, 'She waves from across the room. "Oh, hey! I was hoping you’d show up."')}
          ${field('scenario', 'Scenario', 'Where and when the chat takes place. Use {{user}} for you and {{char}} for them.', 3, '{{user}} and {{char}} meet at…')}
          ${field('examples', 'Example dialogue (optional)', 'A few sample lines that show their voice.', 4, '{{user}}: "Hi!"\n{{char}}: He grins. "Took you long enough."')}
        </section>

        ${
          cloudEnabled()
            ? `<section class="panel">
          <h2>Community</h2>
          <label class="check">
            <input type="checkbox" name="share" ${c.publishedId ? 'checked' : ''}>
            <span>
              <strong>Share with everyone on Kindred</strong>
              <span class="field-hint">Your character appears in the Home feed with its photo, profile and your nickname. Your chats and memories always stay private. You can unshare any time.</span>
            </span>
          </label>
        </section>`
            : ''
        }
      </form>
    </main>`;

  const form = $('#editor');

  // ---- Photo ----
  const refreshPhoto = () => {
    $('#photo-preview').innerHTML = avatarHtml({ ...c, name: form.name.value || '?' }, 132);
    $('#remove-photo').hidden = !c.photo;
  };
  $('#photo').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      c.photo = await resizeImage(file);
      refreshPhoto();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  $('#remove-photo').addEventListener('click', () => {
    c.photo = '';
    refreshPhoto();
  });
  form.name.addEventListener('input', () => !c.photo && refreshPhoto());

  // ---- Traits ----
  const renderTraits = () => {
    $('#traits').innerHTML = c.traits
      .map((t, i) => `<span class="chip accent">${esc(t)}<button type="button" data-remove-trait="${i}" aria-label="Remove ${esc(t)}">×</button></span>`)
      .join('');
  };
  const addTrait = (t) => {
    t = t.trim();
    if (t && !c.traits.some((x) => x.toLowerCase() === t.toLowerCase())) c.traits.push(t);
    renderTraits();
  };
  $('#trait-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTrait(e.target.value);
      e.target.value = '';
    }
  });
  $('#traits').addEventListener('click', (e) => {
    const i = e.target.dataset.removeTrait;
    if (i !== undefined) {
      c.traits.splice(Number(i), 1);
      renderTraits();
    }
  });
  app.querySelector('.suggestions').addEventListener('click', (e) => {
    if (e.target.dataset.suggest) addTrait(e.target.dataset.suggest);
  });
  renderTraits();

  // ---- Stats ----
  const renderStats = () => {
    $('#stats').innerHTML = c.stats
      .map(
        (s, i) => `
      <div class="stat-row" data-i="${i}">
        <input class="stat-name" value="${esc(s.name)}" placeholder="Stat name" aria-label="Stat name">
        <input class="stat-range" type="range" min="0" max="100" value="${Number(s.value)}" aria-label="${esc(s.name)} value">
        <output>${Number(s.value)}</output>
        <button type="button" class="icon-btn small danger" data-remove-stat aria-label="Remove stat">${icon('trash')}</button>
      </div>`,
      )
      .join('');
  };
  $('#stats').addEventListener('input', (e) => {
    const row = e.target.closest('.stat-row');
    if (!row) return;
    const s = c.stats[Number(row.dataset.i)];
    if (e.target.classList.contains('stat-name')) s.name = e.target.value;
    if (e.target.classList.contains('stat-range')) {
      s.value = Number(e.target.value);
      row.querySelector('output').textContent = s.value;
    }
  });
  $('#stats').addEventListener('click', (e) => {
    if (!e.target.closest('[data-remove-stat]')) return;
    c.stats.splice(Number(e.target.closest('.stat-row').dataset.i), 1);
    renderStats();
  });
  $('#add-stat').addEventListener('click', () => {
    c.stats.push({ name: '', value: 50 });
    renderStats();
    $('#stats .stat-row:last-child .stat-name').focus();
  });
  renderStats();

  // ---- Save ----
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pending = $('#trait-input').value;
    if (pending.trim()) addTrait(pending);
    for (const key of ['name', 'tagline', 'bio', 'personality', 'greeting', 'scenario', 'examples']) {
      c[key] = form[key].value.trim();
    }
    c.tags = form.tags.value.split(',').map((t) => t.trim()).filter(Boolean);
    c.stats = c.stats.filter((s) => s.name.trim());
    if (!c.name) {
      toast('Give your character a name first.', 'error');
      form.name.focus();
      return;
    }
    try {
      await saveCharacter(c);
    } catch (err) {
      toast(`Couldn't save: ${err.message}`, 'error');
      return;
    }

    // Saved on this device. Now keep the community copy in step, if there is one.
    let note = `${c.name} saved`;
    if (cloudEnabled()) {
      try {
        if (form.share?.checked) {
          await shareCharacter(c);
          note = `${c.name} saved and shared`;
        } else if (c.publishedId) {
          await unshareCharacter(c);
          note = `${c.name} saved and unshared`;
        }
      } catch (err) {
        toast(`Saved on this device, but couldn't update the community: ${err.message}`, 'error');
        location.hash = `#/c/${encodeURIComponent(c.id)}`;
        return;
      }
    }
    toast(note);
    location.hash = `#/c/${encodeURIComponent(c.id)}`;
  });
}
