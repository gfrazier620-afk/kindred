import './style.css';
import { listCharacters, saveCharacter, getSettings, saveSettings } from './db.js';
import { STARTER_CHARACTERS } from './seeds.js';
import { ICON_SPRITE } from './util.js';
import { renderHome } from './views/home.js';
import { renderProfile } from './views/profile.js';
import { renderEditor } from './views/editor.js';
import { renderChat } from './views/chat.js';
import { renderSettings } from './views/settings.js';

const app = document.getElementById('app');
document.body.insertAdjacentHTML('afterbegin', ICON_SPRITE);

// Each view may return a cleanup function (e.g. to stop a reply that is streaming).
let cleanup = null;

const routes = [
  [/^#?\/?$/, () => renderHome(app)],
  [/^#\/new$/, () => renderEditor(app, null)],
  [/^#\/c\/([^/]+)$/, (id) => renderProfile(app, id)],
  [/^#\/c\/([^/]+)\/edit$/, (id) => renderEditor(app, id)],
  [/^#\/chat\/([^/]+)(?:\/([^/]+))?$/, (id, chatId) => renderChat(app, id, chatId)],
  [/^#\/settings$/, () => renderSettings(app)],
];

async function route() {
  cleanup?.();
  cleanup = null;
  const hash = location.hash || '#/';
  for (const [pattern, view] of routes) {
    const match = hash.match(pattern);
    if (match) {
      window.scrollTo(0, 0);
      cleanup = (await view(...match.slice(1).map(decodeURIComponent))) ?? null;
      return;
    }
  }
  location.hash = '#/';
}

async function seedOnce() {
  const settings = await getSettings();
  if (settings.seeded) return;
  const existing = await listCharacters();
  if (existing.length === 0) {
    for (const c of STARTER_CHARACTERS) await saveCharacter(c);
  }
  await saveSettings({ ...settings, seeded: true });
}

window.addEventListener('hashchange', route);
seedOnce().then(route);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
