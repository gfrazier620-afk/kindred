import { getAccount, getStatus, onStatus, signInWithGoogle, signInWithEmail, sendPasswordReset, signOutAccount, syncNow, syncAvailable } from '../sync.js';
import { esc, icon, openModal, toast, timeAgo } from '../util.js';

const stateLine = (s) => {
  if (s.state === 'syncing') return 'Syncing…';
  if (s.state === 'offline') return "Offline. Changes will sync when you're back online.";
  if (s.state === 'error') return s.error || 'Sync hit a problem.';
  const waiting = s.pending ? ` · ${s.pending} ${s.pending === 1 ? 'change' : 'changes'} waiting` : '';
  return s.at ? `Up to date · synced ${timeAgo(s.at)}${waiting}` : `Ready${waiting}`;
};

/**
 * Draws the Account & sync card into `box` and keeps its status line live.
 * Returns a function that stops listening.
 */
export function mountAccount(box) {
  if (!syncAvailable()) {
    box.hidden = true;
    return () => {};
  }

  const draw = () => {
    const account = getAccount();
    if (!account) {
      box.innerHTML = `
        <h2>Account &amp; sync</h2>
        <p class="field-hint">
          Sign in to keep your characters, chats and memories safe and the same on every device. Without an account, everything stays
          on this device only.
        </p>
        <div class="account-actions">
          <button type="button" class="btn primary" data-act="google">Continue with Google</button>
          <button type="button" class="btn" data-act="email">Use email instead</button>
        </div>
        <p class="field-hint" id="account-error" role="alert"></p>`;
      return;
    }
    const s = getStatus();
    box.innerHTML = `
      <h2>Account &amp; sync</h2>
      <div class="account-row">
        <span class="account-dot ${s.state === 'error' ? 'bad' : ''}"></span>
        <div>
          <strong>${esc(account.email || account.name || 'Signed in')}</strong>
          <div class="muted small" id="sync-line">${esc(stateLine(s))}</div>
        </div>
      </div>
      ${s.skipped?.length ? `<p class="field-hint">${s.skipped.length} very long ${s.skipped.length === 1 ? 'chat is' : 'chats are'} too big to sync. Clear or delete some old messages to include ${s.skipped.length === 1 ? 'it' : 'them'}.</p>` : ''}
      <div class="account-actions">
        <button type="button" class="btn" data-act="sync" ${s.state === 'syncing' ? 'disabled' : ''}>${icon('refresh')} Sync now</button>
        <button type="button" class="btn ghost" data-act="out">Sign out</button>
      </div>`;
  };

  const showError = (message) => {
    const el = box.querySelector('#account-error');
    if (el) el.textContent = message;
    else toast(message, 'error');
  };

  const busy = (button, on, label) => {
    if (!button) return;
    button.disabled = on;
    if (label !== undefined) button.textContent = label;
  };

  function emailDialog() {
    const { el, close } = openModal(
      `<h2>Sign in with email</h2>
       <form class="editor" id="email-form" autocomplete="on">
         <label class="field"><span class="field-label">Email</span>
           <input name="email" type="email" required autocomplete="email" placeholder="you@example.com"></label>
         <label class="field"><span class="field-label">Password</span>
           <input name="password" type="password" required minlength="6" autocomplete="current-password" placeholder="At least 6 characters"></label>
         <p class="field-hint" id="email-msg" role="alert"></p>
         <div class="account-actions">
           <button class="btn primary" data-mode="in">Sign in</button>
           <button type="button" class="btn" data-mode="create">Create account</button>
         </div>
         <button type="button" class="link-btn" id="forgot">Forgot password?</button>
       </form>`,
      { label: 'Sign in with email' },
    );
    const form = el.querySelector('#email-form');
    const msg = el.querySelector('#email-msg');
    form.email.focus();

    const go = async (create) => {
      msg.textContent = '';
      if (!form.reportValidity()) return;
      const buttons = [...form.querySelectorAll('[data-mode]')];
      buttons.forEach((b) => (b.disabled = true));
      try {
        await signInWithEmail(form.email.value.trim(), form.password.value, { create });
        close();
        toast(create ? 'Account created. Syncing…' : 'Signed in. Syncing…');
        draw();
      } catch (err) {
        msg.textContent = err.message;
        buttons.forEach((b) => (b.disabled = false));
      }
    };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      go(false);
    });
    form.querySelector('[data-mode="create"]').addEventListener('click', () => go(true));
    el.querySelector('#forgot').addEventListener('click', async () => {
      const email = form.email.value.trim();
      if (!email) {
        msg.textContent = 'Type your email above first.';
        return;
      }
      try {
        await sendPasswordReset(email);
        msg.textContent = `If ${email} has an account, a reset link is on its way.`;
      } catch (err) {
        msg.textContent = err.message;
      }
    });
  }

  box.addEventListener('click', async (e) => {
    const button = e.target.closest('[data-act]');
    if (!button) return;
    const act = button.dataset.act;

    if (act === 'google') {
      busy(button, true, 'Opening Google…');
      try {
        await signInWithGoogle();
        toast('Signed in. Syncing…');
        draw();
      } catch (err) {
        draw();
        showError(err.message);
      }
    } else if (act === 'email') {
      emailDialog();
    } else if (act === 'sync') {
      syncNow();
    } else if (act === 'out') {
      if (!confirm('Sign out? Your characters and chats stay on this device, and your account keeps its copy.')) return;
      busy(button, true, 'Signing out…');
      await signOutAccount();
      toast('Signed out');
      draw();
    }
  });

  draw();
  const stop = onStatus(() => {
    if (!box.isConnected) {
      stop(); // this screen was replaced
      return;
    }
    // Update just the status text while the card is showing, so buttons don't flicker.
    const account = getAccount();
    const line = box.querySelector('#sync-line');
    if (account && line) {
      const s = getStatus();
      line.textContent = stateLine(s);
      box.querySelector('.account-dot')?.classList.toggle('bad', s.state === 'error');
      const syncBtn = box.querySelector('[data-act="sync"]');
      if (syncBtn) syncBtn.disabled = s.state === 'syncing';
    }
  });
  return stop;
}
