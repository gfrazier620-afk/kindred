import './style.css';
import { listCharacters, getCharacter, saveCharacter, getSettings, saveSettings } from './db.js';
import { STARTER_CHARACTERS } from './seeds.js';
import { ICON_SPRITE } from './util.js';
import { showIntro } from './intro.js';
import { initSync } from './sync.js';
import { renderHome } from './views/home.js';
import { renderProfile } from './views/profile.js';
import { renderEditor } from './views/editor.js';
import { renderChat } from './views/chat.js';
import { renderSettings } from './views/settings.js';
import { renderMemories } from './views/memories.js';
import { renderSearch } from './views/search.js';
import { renderCreate } from './views/create.js';
import { renderMe } from './views/me.js';
import { renderMessages } from './views/messages.js';
import { mountNav } from './nav.js';

const app = document.getElementById('app');
document.body.insertAdjacentHTML('afterbegin', ICON_SPRITE);

// Each view may return a cleanup function (e.g. to stop a reply that is streaming).
let cleanup = null;

const setNav = mountNav();

// [pattern, view, tab]. Screens with a tab show the bottom bar; the rest (chat, editor...) don't.
const routes = [
  [/^#?\/?$/, () => renderHome(app), 'home'],
  [/^#\/search$/, () => renderSearch(app), 'search'],
  [/^#\/create$/, () => renderCreate(app), 'create'],
  [/^#\/messages$/, () => renderMessages(app), 'messages'],
  [/^#\/me$/, () => renderMe(app), 'me'],
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
  for (const [pattern, view, tab] of routes) {
    const match = hash.match(pattern);
    if (match) {
      setNav(tab ?? null);
      window.scrollTo(0, 0);
      cleanup = (await view(...match.slice(1).map(decodeURIComponent))) ?? null;
      return;
    }
  }
  location.hash = '#/';
}

// Bump when the starter characters' opening lines change, so existing installs get them.
const STARTER_VERSION = 3;

async function seedOnce() {
  const settings = await getSettings();
  if (!settings.seeded) {
    const existing = await listCharacters();
    if (existing.length === 0) {
      for (const c of STARTER_CHARACTERS) await saveCharacter(c);
    }
  } else if ((settings.starterVersion ?? 1) < STARTER_VERSION) {
    const from = settings.starterVersion ?? 1;
    if (from < 2) {
      // v2: openings switched from *asterisk actions* to plain narration + "quoted speech".
      // Only touch starters whose opening still uses the old asterisk style.
      for (const starter of STARTER_CHARACTERS) {
        const c = await getCharacter(starter.id);
        if (c?.greeting?.includes('*')) {
          await saveCharacter({ ...c, greeting: starter.greeting, examples: starter.examples });
        }
      }
    }
    if (from < 3) {
      // v3: new built-in characters. Add the ones this device doesn't have; never overwrite anything.
      for (const starter of STARTER_CHARACTERS.filter((s) => s.since === 3)) {
        if (!(await getCharacter(starter.id))) await saveCharacter(starter);
      }
    }
  }
  await saveSettings({ ...settings, seeded: true, starterVersion: STARTER_VERSION });
}

window.addEventListener('hashchange', route);
// If you're signed in, this brings in changes from your other devices.
initSync();
// The app loads behind the intro, so it's ready the moment someone taps to enter.
showIntro();
seedOnce().then(route);

// Keeps the installed app up to date. Home-screen apps (especially on iPhone) stay suspended in
// the background and would otherwise keep showing the version they loaded last.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  const hadController = !!navigator.serviceWorker.controller;
  let reloadWhenHidden = false;
  let reloaded = false;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded) return; // first install, nothing old to replace
    if (document.querySelector('.intro')) {
      reloaded = true;
      location.reload(); // still on the intro: nothing to lose
    } else {
      reloadWhenHidden = true; // wait until the app is backgrounded so a chat isn't interrupted
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && reloadWhenHidden && !reloaded) {
      reloaded = true;
      location.reload();
    }
  });

  navigator.serviceWorker
    .register('./sw.js')
    .then((reg) => {
      // Check for a new version whenever the app is opened or brought back to the front.
      const check = () => reg.update().catch(() => {});
      document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && check());
      check();
    })
    .catch(() => {});
}
