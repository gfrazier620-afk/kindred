import { getSettings, saveSettings } from '../db.js';
import { MODELS } from '../ai.js';
import { esc, icon, $, toast } from '../util.js';

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
            Kindred talks to Claude using your own key. Get one at
            <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com</a>.
            It's stored only on this device and sent only to Anthropic.
          </p>
          <label class="field">
            <span class="field-label">API key</span>
            <input name="apiKey" type="password" value="${esc(s.apiKey)}" placeholder="sk-ant-…" spellcheck="false">
          </label>
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
      </form>
    </main>`;

  $('#settings').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    await saveSettings({
      ...s,
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
