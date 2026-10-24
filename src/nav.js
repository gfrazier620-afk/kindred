import { icon } from './util.js';

const TABS = [
  ['home', 'Home', '#/', 'home'],
  ['search', 'Search', '#/search', 'search'],
  ['create', 'Create', '#/create', 'plus'],
  ['messages', 'Messages', '#/messages', 'chat'],
  ['me', 'Profile', '#/me', 'user'],
];

/** Builds the bottom tab bar once. Returns setNav(activeTab | null); null hides it (e.g. in a chat). */
export function mountNav() {
  const nav = document.createElement('nav');
  nav.className = 'tabbar';
  nav.setAttribute('aria-label', 'Main');
  nav.hidden = true;
  nav.innerHTML = TABS.map(
    ([key, label, href, glyph]) => `<a class="tab" data-tab="${key}" href="${href}">${icon(glyph)}<span>${label}</span></a>`,
  ).join('');
  document.body.appendChild(nav);

  return (active) => {
    nav.hidden = !active;
    document.body.classList.toggle('has-nav', !!active);
    for (const tab of nav.querySelectorAll('.tab')) {
      const on = tab.dataset.tab === active;
      tab.classList.toggle('active', on);
      if (on) tab.setAttribute('aria-current', 'page');
      else tab.removeAttribute('aria-current');
    }
  };
}
