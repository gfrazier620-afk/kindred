import { getSettings, saveSettings } from '../db.js';
import { loadStats } from '../stats.js';
import { cloudEnabled, myPublished } from '../cloud.js';
import { mountAccount } from './account.js';
import { esc, avatarHtml, icon, $, toast, resizeImage } from '../util.js';

const fmt = (n) => Number(n ?? 0).toLocaleString();

export async function renderMe(app, editing = false) {
  const [settings, stats] = await Promise.all([getSettings(), loadStats()]);
  const name = settings.nickname || settings.userName || 'You';
  const me = { name, photo: settings.photo };
  const joined = new Date(stats.joinedAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  const tiles = [
    ['Messages sent', stats.messagesSent],
    ['Replies received', stats.repliesReceived],
    ['Chats started', stats.chatsStarted],
    ['Characters created', stats.charactersCreated],
    ['Characters chatted with', stats.charactersChatted],
    ['Memories saved', stats.memories],
    ['Characters liked', stats.liked],
    ['Days on Kindred', stats.days],
  ];

  app.innerHTML = `
    <header class="topbar">
      <div class="topbar-title">Profile</div>
      <a class="icon-btn" href="#/settings" title="Settings">${icon('gear')}</a>
    </header>
    <main class="page narrow">
      <section class="me-head">
        <div id="me-avatar">${avatarHtml(me, 104)}</div>
        ${
          editing
            ? ''
            : `<h1>${esc(name)}</h1>
               ${settings.bio ? `<p class="me-bio">${esc(settings.bio)}</p>` : '<p class="muted me-bio">Add a nickname and bio so people know who made them.</p>'}
               <p class="muted small">Joined ${esc(joined)}</p>
               <button type="button" class="btn" id="edit">${icon('edit')} Edit profile</button>`
        }
      </section>

      ${
        editing
          ? `<form class="panel editor" id="form" autocomplete="off">
          <div class="photo-actions center">
            <label class="btn">${icon('camera')} ${settings.photo ? 'Change photo' : 'Add photo'}
              <input type="file" accept="image/*" id="photo" hidden>
            </label>
            <button type="button" class="btn ghost" id="remove-photo" ${settings.photo ? '' : 'hidden'}>Remove</button>
          </div>
          <label class="field">
            <span class="field-label">Nickname</span>
            <span class="field-hint">Shown as the creator on characters you make.</span>
            <input name="nickname" maxlength="24" value="${esc(settings.nickname)}" placeholder="${esc(settings.userName)}">
          </label>
          <label class="field">
            <span class="field-label">Bio</span>
            <textarea name="bio" rows="3" maxlength="160" placeholder="A line about you">${esc(settings.bio)}</textarea>
          </label>
          <div class="form-actions">
            <button type="button" class="btn ghost" id="cancel">Cancel</button>
            <button class="btn primary">Save</button>
          </div>
        </form>`
          : ''
      }

      <section class="panel" id="account"></section>

      <section class="panel">
        <h2>Your stats</h2>
        <div class="tiles">
          ${tiles.map(([label, value]) => `<div class="tile"><div class="tile-num">${fmt(value)}</div><div class="tile-label">${label}</div></div>`).join('')}
        </div>
      </section>

      ${
        stats.favorite?.character
          ? `<a class="panel fav" href="#/c/${encodeURIComponent(stats.favorite.character.id)}">
          ${avatarHtml(stats.favorite.character, 52)}
          <div>
            <h2>Most talked to</h2>
            <div class="row-name">${esc(stats.favorite.character.name)}</div>
            <div class="muted small">${fmt(stats.favorite.messages)} messages from you</div>
          </div>
        </a>`
          : ''
      }

      <a class="panel link-row" href="#/settings">${icon('gear')}<span>Settings<br><span class="muted small">API key, model, reply length</span></span></a>
    </main>`;

  const stopAccount = mountAccount($('#account'));

  // Community numbers fill in when they arrive; the rest of the page doesn't wait for them.
  if (cloudEnabled() && !editing) {
    myPublished()
      .then((list) => {
        const tilesEl = $('.tiles');
        if (!tilesEl) return;
        const likes = list.reduce((n, c) => n + c.likeCount, 0);
        for (const [label, value] of [['Characters shared', list.length], ['Likes received', likes]]) {
          tilesEl.insertAdjacentHTML('beforeend', `<div class="tile"><div class="tile-num">${fmt(value)}</div><div class="tile-label">${label}</div></div>`);
        }
      })
      .catch((err) => console.warn('Community stats failed to load', err));
  }

  if (!editing) {
    $('#edit').addEventListener('click', () => renderMe(app, true));
    return stopAccount;
  }

  // ---- Editing ----
  const form = $('#form');
  let photo = settings.photo;
  const refresh = () => {
    $('#me-avatar').innerHTML = avatarHtml({ name: form.nickname.value || name, photo }, 104);
    $('#remove-photo').hidden = !photo;
  };
  $('#photo').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      photo = await resizeImage(file, 320);
      refresh();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  $('#remove-photo').addEventListener('click', () => {
    photo = '';
    refresh();
  });
  form.nickname.addEventListener('input', () => !photo && refresh());
  $('#cancel').addEventListener('click', () => renderMe(app));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveSettings({
      ...(await getSettings()),
      nickname: form.nickname.value.trim(),
      bio: form.bio.value.trim(),
      photo,
    });
    toast('Profile saved');
    renderMe(app);
  });
}
