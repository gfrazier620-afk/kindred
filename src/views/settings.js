import { getSettings, saveSettings, exportAll, importAll, uid } from '../db.js';
import { allPersonas } from '../personas.js';
import { canSpeak, getVoices, speak, stopSpeaking } from '../voice.js';
import { MODELS, testKey, friendlyError } from '../ai.js';
import { esc, icon, $, toast, downloadJson, openModal } from '../util.js';

const EFFORTS = [
  ['low', 'Quick — fastest replies'],
  ['medium', 'Balanced'],
  ['high', 'Thoughtful — slower, more considered'],
];

const LENGTHS = [
  ['short', 'Short — quick texts, 1–3 sentences'],
  ['medium', 'Medium — a paragraph or two'],
  ['long', 'Long — detailed, story-like replies'],
];

export async function renderSettings(app) {
  const s = await getSettings();

  app.innerHTML = `
    <header class="topbar">
      <a class="icon-btn" href="#/me" title="Back">${icon('back')}</a>
      <div class="topbar-title">Settings</div>
      <button class="btn primary" form="settings">Save</button>
    </header>
    <main class="page narrow">
      <form id="settings" class="editor" autocomplete="off">
        <section class="panel">
          <h2>Claude API key</h2>
          <p class="field-hint">
            Kindred talks to Claude using your own key. It's stored only on this device and sent only to Anthropic.
          </p>
          <details class="howto" ${s.apiKey ? '' : 'open'}>
            <summary>How do I get a key?</summary>
            <ol>
              <li>Go to <a href="https://console.anthropic.com" target="_blank" rel="noopener">console.anthropic.com</a> and sign in.</li>
              <li>Add credit under <strong>Settings → Billing</strong>. Chatting costs fractions of a cent per message, so a few dollars lasts a long time.</li>
              <li>Open <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">API Keys</a>, tap <strong>Create Key</strong>, and copy it. It starts with <code>sk-ant-</code> and is only shown once.</li>
              <li>Paste it below and tap <strong>Test key</strong>.</li>
            </ol>
          </details>
          <label class="field">
            <span class="field-label">API key</span>
            <span class="key-row">
              <input name="apiKey" type="password" value="${esc(s.apiKey)}" placeholder="sk-ant-…" spellcheck="false" autocapitalize="off" autocorrect="off">
              <button type="button" class="btn" id="toggle-key">Show</button>
            </span>
          </label>
          <div class="test-row">
            <button type="button" class="btn" id="test-key">${icon('check')} Test key</button>
            <span class="test-result small" id="test-result" role="status"></span>
          </div>
          <label class="field">
            <span class="field-label">Model</span>
            <select name="model">
              ${MODELS.map((m) => `<option value="${m.id}" ${m.id === s.model ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}
            </select>
          </label>
          <label class="field">
            <span class="field-label">Reply length</span>
            <select name="replyLength">
              ${LENGTHS.map(([v, label]) => `<option value="${v}" ${v === s.replyLength ? 'selected' : ''}>${label}</option>`).join('')}
            </select>
          </label>
          <label class="field">
            <span class="field-label">Thinking</span>
            <span class="field-hint">How much the character thinks before replying. Quick is fastest.</span>
            <select name="effort">
              ${EFFORTS.map(([v, label]) => `<option value="${v}" ${v === s.effort ? 'selected' : ''}>${label}</option>`).join('')}
            </select>
          </label>
        </section>

        <section class="panel">
          <h2>About you</h2>
          <label class="field">
            <span class="field-label">Your name</span>
            <span class="field-hint">What characters call you.</span>
            <input name="userName" value="${esc(s.userName)}" placeholder="You">
          </label>
          <label class="field">
            <span class="field-label">Your persona (optional)</span>
            <span class="field-hint">Anything characters should know about you.</span>
            <textarea name="userPersona" rows="3" placeholder="I'm a traveling bard who…">${esc(s.userPersona)}</textarea>
          </label>
        </section>

        <section class="panel">
          <h2>Personas</h2>
          <p class="field-hint">
            Play as different people in different chats. Pick one from a chat's ⋯ menu. The name and description above are your default.
          </p>
          <div id="persona-list" class="persona-list"></div>
          <button type="button" class="btn ghost" id="add-persona">${icon('plus')} Add persona</button>
        </section>

        ${
          canSpeak()
            ? `<section class="panel">
          <h2>Voice</h2>
          <p class="field-hint">Tap the speaker under a reply to hear it. Voices come from your device.</p>
          <label class="field">
            <span class="field-label">Voice</span>
            <select name="voiceURI" id="voice-select"><option value="">Device default</option></select>
          </label>
          <label class="field">
            <span class="field-label">Speed <output id="rate-out">${Number(s.voiceRate).toFixed(2)}×</output></span>
            <input type="range" name="voiceRate" min="0.7" max="1.4" step="0.05" value="${Number(s.voiceRate)}">
          </label>
          <label class="field">
            <span class="field-label">What to read</span>
            <select name="voiceMode">
              <option value="speech" ${s.voiceMode === 'speech' ? 'selected' : ''}>Just what they say (in quotes)</option>
              <option value="all" ${s.voiceMode === 'all' ? 'selected' : ''}>Everything, including actions</option>
            </select>
          </label>
          <label class="check">
            <input type="checkbox" name="autoRead" ${s.autoRead ? 'checked' : ''}>
            <span><strong>Read new replies aloud automatically</strong><span class="field-hint">Some phones only allow this after you tap send. If nothing plays, use the speaker button.</span></span>
          </label>
          <div class="test-row">
            <button type="button" class="btn" id="test-voice">${icon('speaker')} Test voice</button>
          </div>
        </section>`
            : ''
        }

        <section class="panel">
          <h2>Your data</h2>
          <p class="field-hint">
            Everything lives on this device. A backup is one file with your characters, chats, memories and profile, handy before
            switching phones or removing the app from your home screen. It never includes your API key.
          </p>
          <div class="data-actions">
            <button type="button" class="btn" id="backup">${icon('download')} Download backup</button>
            <label class="btn">${icon('upload')} Restore from backup
              <input type="file" accept="application/json,.json" id="restore" hidden>
            </label>
          </div>
          <p class="field-hint" id="data-note">Restoring adds to what's already here. Nothing is deleted.</p>
        </section>
      </form>
    </main>`;

  const form = $('#settings');

  // ---- API key helpers ----
  $('#toggle-key').addEventListener('click', (e) => {
    const showing = form.apiKey.type === 'text';
    form.apiKey.type = showing ? 'password' : 'text';
    e.currentTarget.textContent = showing ? 'Show' : 'Hide';
  });

  $('#test-key').addEventListener('click', async (e) => {
    const button = e.currentTarget;
    const result = $('#test-result');
    const apiKey = form.apiKey.value.trim();
    result.className = 'test-result small';
    if (!apiKey) {
      result.textContent = 'Paste your key first.';
      result.classList.add('bad');
      return;
    }
    button.disabled = true;
    result.textContent = 'Checking…';
    try {
      await testKey({ settings: { ...s, apiKey, model: form.model.value } });
      result.textContent = 'Works! Tap Save to keep it.';
      result.classList.add('good');
    } catch (err) {
      result.textContent = friendlyError(err);
      result.classList.add('bad');
    } finally {
      button.disabled = false;
    }
  });

  // ---- Backup & restore ----
  $('#backup').addEventListener('click', async () => {
    try {
      const data = await exportAll();
      downloadJson(`kindred-backup-${new Date().toISOString().slice(0, 10)}.json`, data);
      toast(`Backed up ${data.characters.length} characters and ${data.chats.length} chats`);
    } catch (err) {
      toast(`Couldn't make the backup: ${err.message}`, 'error');
    }
  });

  $('#restore').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (data?.kindredBackup !== 1) throw new Error("That file isn't a Kindred backup.");
      const counts = `${data.characters?.length ?? 0} characters, ${data.chats?.length ?? 0} chats and ${data.memories?.length ?? 0} memories`;
      if (!confirm(`Add ${counts} from this backup?\n\nAnything with the same ID is replaced by the backup's version. Nothing else is deleted, and your API key stays as it is.`)) return;
      const done = await importAll(data);
      toast(`Restored ${done.characters} characters, ${done.chats} chats and ${done.memories} memories`);
      setTimeout(() => location.reload(), 900);
    } catch (err) {
      toast(err instanceof SyntaxError ? "That file isn't a Kindred backup." : err.message, 'error');
    }
  });

  // ---- Personas ----
  let personas = [...(s.personas ?? [])];
  let defaultId = s.defaultPersonaId ?? 'default';
  const persistPersonas = async () => saveSettings({ ...(await getSettings()), personas, defaultPersonaId: defaultId });

  const drawPersonas = () => {
    const list = allPersonas({ ...s, personas });
    $('#persona-list').innerHTML = list
      .map(
        (p) => `<div class="persona-row" data-id="${esc(p.id)}">
          <div class="persona-text">
            <strong>${esc(p.name)}</strong>${p.id === defaultId ? ' <span class="badge">Default</span>' : ''}
            <div class="muted small">${esc(p.id === 'default' ? 'Your name and description above' : p.description || 'No description')}</div>
          </div>
          ${p.id !== defaultId ? `<button type="button" class="link-btn" data-persona="default-this">Make default</button>` : ''}
          ${p.id !== 'default' ? `<button type="button" class="icon-btn small" data-persona="edit" aria-label="Edit ${esc(p.name)}">${icon('edit')}</button>
          <button type="button" class="icon-btn small danger" data-persona="delete" aria-label="Delete ${esc(p.name)}">${icon('trash')}</button>` : ''}
        </div>`,
      )
      .join('');
  };

  function personaDialog(existing) {
    const { el, close } = openModal(
      `<h2>${existing ? 'Edit persona' : 'Add a persona'}</h2>
       <form class="editor" id="persona-form" autocomplete="off">
         <label class="field"><span class="field-label">Name</span>
           <input name="name" maxlength="30" required value="${esc(existing?.name ?? '')}" placeholder="e.g. Sam the knight"></label>
         <label class="field"><span class="field-label">About this persona</span>
           <span class="field-hint">What characters should know about you when you play this one.</span>
           <textarea name="description" rows="4" maxlength="400" placeholder="A weary knight sworn to protect the northern road…">${esc(existing?.description ?? '')}</textarea></label>
         <div class="form-actions"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary">Save</button></div>
       </form>`,
      { label: existing ? 'Edit persona' : 'Add persona' },
    );
    el.querySelector('[data-close]').addEventListener('click', close);
    el.querySelector('input').focus();
    el.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = e.target.name.value.trim();
      if (!name) return;
      const description = e.target.description.value.trim();
      if (existing) personas = personas.map((p) => (p.id === existing.id ? { ...p, name, description } : p));
      else personas.push({ id: uid(), name, description });
      await persistPersonas();
      close();
      drawPersonas();
      toast(existing ? 'Persona updated' : 'Persona added');
    });
  }

  $('#add-persona').addEventListener('click', () => personaDialog(null));
  $('#persona-list').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-persona]');
    if (!btn) return;
    const id = btn.closest('.persona-row').dataset.id;
    const persona = personas.find((p) => p.id === id);
    if (btn.dataset.persona === 'edit') personaDialog(persona);
    if (btn.dataset.persona === 'default-this') {
      defaultId = id;
      await persistPersonas();
      drawPersonas();
    }
    if (btn.dataset.persona === 'delete' && confirm(`Delete the persona "${persona.name}"? Chats using it switch to your default.`)) {
      personas = personas.filter((p) => p.id !== id);
      if (defaultId === id) defaultId = 'default';
      await persistPersonas();
      drawPersonas();
    }
  });
  drawPersonas();

  // ---- Voice ----
  if (canSpeak()) {
    getVoices().then((voices) => {
      const select = $('#voice-select');
      if (!select) return;
      const mine = navigator.language?.split('-')[0];
      const sorted = [...voices].sort((a, b) => Number(b.lang.startsWith(mine)) - Number(a.lang.startsWith(mine)) || a.name.localeCompare(b.name));
      for (const v of sorted) {
        const option = document.createElement('option');
        option.value = v.voiceURI;
        option.textContent = `${v.name} (${v.lang})`;
        select.appendChild(option);
      }
      select.value = s.voiceURI;
    });
    form.voiceRate.addEventListener('input', () => ($('#rate-out').textContent = `${Number(form.voiceRate.value).toFixed(2)}×`));
    $('#test-voice').addEventListener('click', () => {
      speak('Hi there. This is how I will sound when I read my replies to you.', {
        voiceURI: form.voiceURI.value,
        rate: Number(form.voiceRate.value),
        mode: 'all',
      });
    });
  }

  // ---- Save ----
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    await saveSettings({
      ...(await getSettings()),
      apiKey: f.apiKey.value.trim(),
      model: f.model.value,
      effort: f.effort.value,
      replyLength: f.replyLength.value,
      userName: f.userName.value.trim() || 'You',
      userPersona: f.userPersona.value.trim(),
      ...(canSpeak()
        ? { voiceURI: f.voiceURI.value, voiceRate: Number(f.voiceRate.value), voiceMode: f.voiceMode.value, autoRead: f.autoRead.checked }
        : {}),
    });
    stopSpeaking();
    toast('Settings saved');
    history.length > 1 ? history.back() : (location.hash = '#/');
  });
}
