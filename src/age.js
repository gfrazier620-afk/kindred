// The 18+ gate. People confirm they are 18 or older once; mature characters stay hidden until then.
//
// This is a self-declaration ("I'm 18 or older"), the same simple check most apps use. It keeps
// mature characters out of sight for people who say they're under 18, but it is not identity
// verification.
import { getSettings, saveSettings } from './db.js';
import { openModal, esc } from './util.js';

/** A character rated for adults. Anything else (including older characters with no rating) is general. */
export const isMature = (character) => character?.rating === 'mature';

/** Whether this person has confirmed they're 18 or older. */
export const isAdult = (settings) => !!settings.adultConfirmedAt;

/** Whether mature characters should appear in Home and Search: confirmed 18+ and not turned off. */
export const canViewMature = (settings) => isAdult(settings) && settings.showMature !== false;

/**
 * Asks the person to confirm they're 18+. Resolves true if they do (and remembers it),
 * false if they decline or close the box.
 */
export function confirmAdult({ name } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    const answer = (value) => {
      if (answered) return;
      answered = true;
      resolve(value);
    };
    const { el, close } = openModal(
      `<h2>18+ content</h2>
       <p>${name ? `<strong>${esc(name)}</strong> is rated 18+.` : 'Some characters on Kindred are rated 18+.'}
          They can include violence, dark or disturbing themes, strong language and mature romance.</p>
       <p class="field-hint">Please confirm you're 18 or older to see and chat with them. You can hide mature characters again at any time in Settings.</p>
       <div class="form-actions">
         <button type="button" class="btn ghost" data-no>Not now</button>
         <button type="button" class="btn primary" data-yes>I'm 18 or older</button>
       </div>`,
      { label: 'Confirm your age', onClose: () => answer(false) },
    );
    el.querySelector('[data-no]').addEventListener('click', close);
    el.querySelector('[data-yes]').addEventListener('click', async () => {
      await saveSettings({ ...(await getSettings()), adultConfirmedAt: Date.now(), showMature: true });
      answer(true);
      close();
    });
    el.querySelector('[data-yes]').focus();
  });
}

/** A small notice for lists that are hiding mature characters. */
export const matureNotice = (hidden, adult = false) =>
  hidden
    ? `<div class="mature-note"><span class="badge adult">18+</span>
        <span>${hidden} ${hidden === 1 ? 'character is' : 'characters are'} rated 18+ and hidden.</span>
        ${
          adult
            ? '<a class="link-btn" href="#/settings">Show them in Settings</a>'
            : '<button type="button" class="link-btn" data-confirm-adult>Confirm I\'m 18+</button>'
        }</div>`
    : '';
