import { getSettings, saveSettings, exportAll, importAll } from '../db.js';
import { MODELS, testKey, friendlyError } from '../ai.js';
import { esc, icon, $, toast, downloadJson } from '../util.js';

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
    });
    toast('Settings saved');
    history.length > 1 ? history.back() : (location.hash = '#/');
  });
}
