import { listCharacters, listAllChats, saveCharacter, uid } from '../db.js';
import { isMine } from '../stats.js';
import { cloudEnabled } from '../cloud.js';
import { shareCharacter, unshareCharacter } from '../share.js';
import { esc, avatarHtml, icon, $, toast } from '../util.js';

export async function renderCreate(app) {
  const [characters, chats] = await Promise.all([listCharacters(), listAllChats()]);
  const mine = characters.filter(isMine);

  const chatCount = new Map();
  for (const chat of chats) chatCount.set(chat.characterId, (chatCount.get(chat.characterId) ?? 0) + 1);

  app.innerHTML = `
    <header class="topbar">
      <div class="topbar-title">Create</div>
      <label class="icon-btn" title="Import a character file">
        ${icon('upload')}<input type="file" accept="application/json,.json" id="import" hidden>
      </label>
    </header>
    <main class="page narrow">
      <a class="create-hero" href="#/new">
        <span class="create-plus">${icon('plus')}</span>
        <span>
          <strong>Create a new character</strong>
          <span class="muted small">Photo, backstory, personality, stats</span>
        </span>
      </a>

      <h2 class="section-title">Your characters${mine.length ? ` · ${mine.length}` : ''}</h2>
      ${
        mine.length
          ? `<div class="results">${mine
              .map(
                (c) => `
            <div class="row">
              <a class="row-main" href="#/c/${encodeURIComponent(c.id)}">
                ${avatarHtml(c, 52)}
                <div class="row-text">
                  <div class="row-name">${esc(c.name)}</div>
                  <div class="row-sub">${esc(c.tagline ?? '')}</div>
                  <div class="muted small">${chatCount.get(c.id) ?? 0} ${(chatCount.get(c.id) ?? 0) === 1 ? 'chat' : 'chats'}</div>
                  ${
                    cloudEnabled()
                      ? `<div class="share-row">${c.publishedId ? '<span class="badge">Shared</span>' : ''}<button type="button" class="link-btn" data-share="${esc(c.id)}">${c.publishedId ? 'Unshare' : 'Share with everyone'}</button></div>`
                      : ''
                  }
                </div>
              </a>
              <a class="icon-btn" href="#/c/${encodeURIComponent(c.id)}/edit" title="Edit" aria-label="Edit ${esc(c.name)}">${icon('edit')}</a>
              <a class="btn small-btn" href="#/chat/${encodeURIComponent(c.id)}/new" aria-label="Chat with ${esc(c.name)}">${icon('chat')}</a>
            </div>`,
              )
              .join('')}</div>`
          : `<div class="empty">
              ${icon('plus')}
              <p>You haven't made anyone yet. Characters you create show up here.</p>
              <a class="btn primary" href="#/new">Create your first character</a>
            </div>`
      }
    </main>`;

  const onClick = async (e) => {
    const btn = e.target.closest('[data-share]');
    if (!btn) return;
    e.preventDefault(); // the button sits inside the row's link; don't also open the character
    const c = mine.find((x) => x.id === btn.dataset.share);
    if (!c) return;
    btn.disabled = true;
    try {
      if (c.publishedId) {
        await unshareCharacter(c);
        toast(`${c.name} is no longer shared`);
      } else {
        const ok = confirm(`Share ${c.name} with everyone on Kindred?

The character's profile, photo and your nickname become public. Your chats and memories stay private.`);
        if (!ok) {
          btn.disabled = false;
          return;
        }
        await shareCharacter(c);
        toast(`${c.name} is now in the community`);
      }
      window.dispatchEvent(new HashChangeEvent('hashchange')); // redraw this screen
    } catch (err) {
      btn.disabled = false;
      toast(`Couldn't update sharing: ${err.message}`, 'error');
    }
  };
  app.addEventListener('click', onClick);

  $('#import').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data.name) throw new Error('missing name');
      const { publishedId, remoteId, ...clean } = data; // never inherit someone else's shared link
      const character = { ...clean, id: uid(), createdAt: Date.now(), imported: true };
      await saveCharacter(character);
      toast(`Imported ${character.name}`);
      location.hash = `#/c/${character.id}`;
    } catch {
      toast("That file isn't a valid character.", 'error');
    }
  });

  return () => app.removeEventListener('click', onClick);
}
