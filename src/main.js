import './style.css';
import { listCharacters, getCharacter, saveCharacter, getSettings, saveSettings } from './db.js';
import { STARTER_CHARACTERS } from './seeds.js';
import { ICON_SPRITE } from './util.js';
import { showIntro } from './intro.js';
import { renderHome } from './views/home.js';
import { renderProfile } from './views/profile.js';
import { renderEditor } from './views/editor.js';
import { renderChat } from './views/chat.js';
import { renderSettings } from './views/settings.js';
import { renderMemories } from './views/memories.js';

const app = document.getElementById('app');
document.body.insertAdjacentHTML('afterbegin', ICON_SPRITE);

// Each view may return a cleanup function (e.g. to stop a reply that is streaming).
let cleanup = null;

const routes = [
  [/^#?\/?$/, () => renderHome(app)],
  [/^#\/new$/, () => renderEditor(app, null)],
  [/^#\/c\/([^/]+)$/, (id) => renderProfile(app, id)],
  [/^#\/c\/([^/]+)\/edit$/, (id) => renderEditor(app, id)],
  [/^#\/c\/([^/]+)\/memories$/, (id) => renderMemories(app, id)],
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

// Bump when the starter characters' opening lines change, so existing installs get them.
const STARTER_VERSION = 2;

async function seedOnce() {
  const settings = await getSettings();
  if (!settings.seeded) {
    const existing = await listCharacters();
    if (existing.length === 0) {
      for (const c of STARTER_CHARACTERS) await saveCharacter(c);
    }
  } else if ((settings.starterVersion ?? 1) < STARTER_VERSION) {
    // v2: openings switched from *asterisk actions* to plain narration + "quoted speech".
    // Only touch starters whose opening still uses the old asterisk style.
    for (const starter of STARTER_CHARACTERS) {
      const c = await getCharacter(starter.id);
      if (c?.greeting?.includes('*')) {
        await saveCharacter({ ...c, greeting: starter.greeting, examples: starter.examples });
      }
    }
  }
  await saveSettings({ ...settings, seeded: true, starterVersion: STARTER_VERSION });
}

window.addEventListener('hashchange', route);
// The app loads behind the intro, so it's ready the moment someone taps to enter.
showIntro();
seedOnce().then(route);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
