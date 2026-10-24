import { getCharacter, getChat, listChats, saveChat, deleteChat, getSettings, listMemories, bumpStats, uid } from '../db.js';
import { streamReply, friendlyError, isAbortError } from '../ai.js';
import { updateMemory, liveMessages, addMemory } from '../memory.js';
import { esc, avatarHtml, icon, $, formatMessage, toast, copyText } from '../util.js';

const timeOf = (at) => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

// "Today", "Yesterday", or a date, for the dividers between days.
function dayLabel(at) {
  const day = new Date(at);
  const startOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((startOf(new Date()) - startOf(day)) / 864e5);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return day.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
}
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();

export async function renderChat(app, characterId, chatId) {
  const [character, settings] = await Promise.all([getCharacter(characterId), getSettings()]);
  if (!character) {
    location.hash = '#/';
    return;
  }

  // The character's opening line, with names filled in.
  const makeGreeting = () =>
    character.greeting
      ? {
          id: uid(),
          role: 'assistant',
          at: Date.now(),
          content: character.greeting.replaceAll('{{user}}', settings.userName).replaceAll('{{char}}', character.name),
        }
      : null;

  let chat = chatId && chatId !== 'new' ? await getChat(chatId) : null;
  if (!chat && chatId !== 'new') chat = (await listChats(characterId))[0];
  if (!chat) {
    chat = { id: uid(), characterId, messages: [], createdAt: Date.now() };
    const greeting = makeGreeting();
    if (greeting) chat.messages.push(greeting);
    await saveChat(chat);
    bumpStats({ chatsStarted: 1 });
  }
  // Keep the URL pointing at this exact chat without re-rendering.
  history.replaceState(null, '', `#/chat/${encodeURIComponent(characterId)}/${encodeURIComponent(chat.id)}`);

  const profileHref = `#/c/${encodeURIComponent(characterId)}`;

  app.innerHTML = `
    <div class="chat-screen">
      <header class="topbar chat-top">
        <a class="icon-btn" href="#/messages" id="back" title="Back">${icon('back')}</a>
        <a class="chat-who" href="${profileHref}">
          ${avatarHtml(character, 36)}
          <div><div class="chat-name">${esc(character.name)}</div><div class="muted small" id="status">${esc(character.tagline ?? '')}</div></div>
        </a>
        <a class="icon-btn" href="${profileHref}/memories" title="Memories">${icon('brain')}</a>
        <button type="button" class="icon-btn" id="menu-btn" title="More" aria-haspopup="menu" aria-expanded="false">${icon('more')}</button>
        <div class="menu" id="menu" role="menu" hidden>
          <a role="menuitem" href="#/chat/${encodeURIComponent(characterId)}/new">${icon('plus')} New chat</a>
          <button type="button" role="menuitem" data-menu="clear">${icon('refresh')} Clear chat</button>
          <button type="button" role="menuitem" class="danger-text" data-menu="delete">${icon('trash')} Delete conversation</button>
        </div>
      </header>
      ${
        settings.apiKey
          ? ''
          : `<div class="banner">Add your Claude API key in <a href="#/settings">Settings</a> so ${esc(character.name)} can reply.</div>`
      }
      <div class="messages-wrap">
        <div class="messages" id="messages"></div>
        <button type="button" class="to-bottom" id="to-bottom" aria-label="Jump to the latest message" hidden>${icon('down')}</button>
      </div>
      <form class="composer" id="composer">
        <textarea id="input" rows="1" placeholder="Message ${esc(character.name)}…" enterkeyhint="send"></textarea>
        <button class="send-btn" id="send" type="submit" title="Send">${icon('send')}</button>
      </form>
    </div>`;

  // Back goes to wherever you came from (Messages, Home, a profile...). If there's nowhere to go
  // back to, such as when the app was opened straight into this chat, it falls back to Messages.
  $('#back').addEventListener('click', (e) => {
    if (history.length > 1) {
      e.preventDefault();
      history.back();
    }
  });

  const list = $('#messages');
  const input = $('#input');
  const sendBtn = $('#send');
  const jump = $('#to-bottom');
  let active = null; // the streaming request, if any
  let editingId = null; // the message being edited, if any

  const bubble = (m, i) => {
    if (m.id === editingId) {
      return `
      <div class="msg ${m.role === 'user' ? 'msg-user' : 'msg-char'} msg-editing" data-id="${esc(m.id)}">
        <div class="msg-body">
          <textarea class="edit-box" rows="2" aria-label="Edit message">${esc(m.content)}</textarea>
          <div class="edit-actions">
            <button type="button" class="btn small-btn" data-action="cancel-edit">Cancel</button>
            <button type="button" class="btn primary small-btn" data-action="save-edit">Save</button>
          </div>
        </div>
      </div>`;
    }
    const isLastReply = m.role === 'assistant' && i === chat.messages.length - 1 && i > 0;
    const canAct = m.content && !m.error;
    const meta = [m.role === 'user' ? settings.userName : character.name, m.at ? timeOf(m.at) : '', m.edited ? 'edited' : ''].filter(Boolean).join(' · ');
    return `
      <div class="msg ${m.role === 'user' ? 'msg-user' : 'msg-char'}" data-id="${esc(m.id)}">
        ${m.role === 'assistant' ? `<div class="msg-avatar">${avatarHtml(character, 32)}</div>` : ''}
        <div class="msg-body">
          <div class="msg-author">${esc(meta)}</div>
          <div class="bubble ${m.error ? 'bubble-error' : ''}">${m.content ? formatMessage(m.content) : '<span class="typing"><i></i><i></i><i></i></span>'}</div>
          <div class="msg-tools">
            ${isLastReply ? `<button type="button" class="tool" data-action="regen">${icon('refresh')} Retry</button>` : ''}
            ${canAct ? `<button type="button" class="tool" data-action="copy" title="Copy" aria-label="Copy message">${icon('copy')}</button>` : ''}
            ${canAct ? `<button type="button" class="tool" data-action="edit" title="Edit" aria-label="Edit message">${icon('edit')}</button>` : ''}
            ${canAct ? `<button type="button" class="tool" data-action="remember" title="Add to ${esc(character.name)}'s memories">${icon('brain')} Remember</button>` : ''}
            <button type="button" class="tool" data-action="delete" title="Delete message" aria-label="Delete message">${icon('trash')}</button>
          </div>
        </div>
      </div>`;
  };

  // Day dividers only where messages carry a time (older messages saved before this don't).
  const timeline = () => {
    let html = '';
    let last = null;
    chat.messages.forEach((m, i) => {
      if (m.at && (last === null || !sameDay(last, m.at))) html += `<div class="day-sep"><span>${esc(dayLabel(m.at))}</span></div>`;
      if (m.at) last = m.at;
      html += bubble(m, i);
    });
    return html;
  };

  const updateJump = () => {
    jump.hidden = list.scrollHeight - list.scrollTop - list.clientHeight < 240;
  };

  // stick: jump to the newest message. Editing or deleting leaves your place alone.
  const render = ({ stick = true } = {}) => {
    const place = list.scrollTop;
    list.innerHTML = timeline();
    list.scrollTop = stick ? list.scrollHeight : place;
    if (editingId) {
      const box = list.querySelector('.edit-box');
      box?.focus();
      box?.setSelectionRange(box.value.length, box.value.length);
      growBox(box);
    }
    updateJump();
  };

  const growBox = (box) => {
    if (!box) return;
    box.style.height = 'auto';
    box.style.height = Math.min(box.scrollHeight, 260) + 'px';
  };

  const setBusy = (busy) => {
    sendBtn.innerHTML = icon(busy ? 'stop' : 'send');
    sendBtn.title = busy ? 'Stop' : 'Send';
    $('#status').textContent = busy ? 'typing…' : character.tagline ?? '';
  };

  async function reply() {
    if (!settings.apiKey) {
      toast('Add your API key in Settings first.', 'error');
      return;
    }
    // Older messages already folded into chat.summary aren't resent.
    const history = liveMessages(chat);
    const memories = await listMemories(characterId);
    const msg = { id: uid(), role: 'assistant', content: '', at: Date.now() };
    chat.messages.push(msg);
    render();
    setBusy(true);

    const bubbleEl = list.lastElementChild.querySelector('.bubble');
    active = streamReply({
      character,
      settings,
      messages: history,
      memories,
      summary: chat.summary,
      onText: (text) => {
        msg.content = text;
        bubbleEl.innerHTML = formatMessage(text);
        const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 120;
        if (nearBottom) list.scrollTop = list.scrollHeight;
      },
    });

    let ok = false;
    try {
      const { refused, stopReason } = await active.done;
      ok = !refused && !!msg.content.trim();
      if (refused && !msg.content.trim()) {
        msg.content = `*${character.name} doesn't respond to that.* (Claude declined this message — try rephrasing.)`;
        msg.error = true;
      } else if (!msg.content.trim()) {
        msg.content = `No reply came back (reason: ${stopReason || 'unknown'}). Tap Retry to try again.`;
        msg.error = true;
      }
    } catch (err) {
      if (isAbortError(err)) {
        // Stopped by the user: keep whatever arrived.
      } else {
        console.error('Reply failed', err);
        msg.content = friendlyError(err) || 'Something went wrong. Tap Retry to try again.';
        msg.error = true;
      }
    } finally {
      active = null;
      if (!msg.content.trim()) chat.messages.pop();
      setBusy(false);
      render();
      await saveChat(chat);
    }
    if (ok) {
      bumpStats({ repliesReceived: 1 });
      rememberInBackground();
    }
  }

  async function rememberInBackground() {
    const changed = await updateMemory({ chat, character, settings });
    await saveChat(chat);
    if (changed) toast(`${character.name} will remember that`);
  }

  $('#composer').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (active) {
      active.abort();
      return;
    }
    const text = input.value.trim();
    if (!text) return;
    editingId = null; // sending while editing drops the unsaved edit
    // Drop a failed reply so it isn't sent back to the model.
    if (chat.messages.at(-1)?.error) chat.messages.pop();
    chat.messages.push({ id: uid(), role: 'user', content: text, at: Date.now() });
    bumpStats({ messagesSent: 1 });
    input.value = '';
    autosize();
    render();
    await saveChat(chat);
    reply();
  });

  const isTouch = matchMedia('(pointer: coarse)').matches;
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !isTouch) {
      e.preventDefault();
      $('#composer').requestSubmit();
    }
  });
  const autosize = () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 160) + 'px';
  };
  input.addEventListener('input', autosize);

  // ---- Jump to latest ----
  list.addEventListener('scroll', updateJump, { passive: true });
  jump.addEventListener('click', () => list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' }));

  // ---- Message actions ----
  async function saveEdit(id) {
    const msg = chat.messages.find((m) => m.id === id);
    const text = list.querySelector('.edit-box')?.value.trim();
    if (!msg) return;
    if (!text) {
      toast("A message can't be empty. Delete it instead.", 'error');
      return;
    }
    if (text !== msg.content) {
      msg.content = text;
      msg.edited = true;
    }
    editingId = null;
    render({ stick: false });
    await saveChat(chat);
  }

  list.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn || active) return;
    const id = btn.closest('.msg').dataset.id;
    const index = chat.messages.findIndex((m) => m.id === id);
    const msg = chat.messages[index];
    const action = btn.dataset.action;

    if (action === 'copy') {
      await copyText(msg.content);
      toast('Copied');
    } else if (action === 'edit') {
      editingId = id;
      render({ stick: false });
    } else if (action === 'cancel-edit') {
      editingId = null;
      render({ stick: false });
    } else if (action === 'save-edit') {
      await saveEdit(id);
    } else if (action === 'remember') {
      const text = prompt(`What should ${character.name} remember?`, msg.content.replace(/\*/g, '').slice(0, 300));
      if (text?.trim()) {
        await addMemory(characterId, text, { pinned: true });
        toast('Saved to memories (pinned)');
      }
    } else if (action === 'delete') {
      chat.messages.splice(index, 1);
      render({ stick: false });
      await saveChat(chat);
    } else if (action === 'regen') {
      chat.messages.splice(index, 1);
      reply();
    }
  });

  // In the edit box: Esc cancels, Ctrl/Cmd+Enter saves.
  list.addEventListener('keydown', (e) => {
    if (!e.target.classList.contains('edit-box')) return;
    if (e.key === 'Escape') {
      editingId = null;
      render({ stick: false });
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      saveEdit(editingId);
    }
  });
  list.addEventListener('input', (e) => e.target.classList.contains('edit-box') && growBox(e.target));

  // ---- More menu: clear or delete this conversation ----
  const menu = $('#menu');
  const menuBtn = $('#menu-btn');
  const closeMenu = () => {
    menu.hidden = true;
    menuBtn.setAttribute('aria-expanded', 'false');
  };
  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
    menuBtn.setAttribute('aria-expanded', String(!menu.hidden));
  });
  const onDocClick = (e) => !menu.contains(e.target) && closeMenu();
  document.addEventListener('click', onDocClick);

  menu.addEventListener('click', async (e) => {
    const item = e.target.closest('[data-menu]');
    if (!item) return;
    closeMenu();
    if (active) {
      toast('Wait for the reply to finish first.', 'error');
      return;
    }
    if (item.dataset.menu === 'clear') {
      if (!confirm(`Clear this chat? ${character.name} keeps what they remember about you, but the messages are removed.`)) return;
      editingId = null;
      const greeting = makeGreeting();
      chat.messages = greeting ? [greeting] : [];
      delete chat.summary;
      render();
      await saveChat(chat);
      toast('Chat cleared');
    } else if (item.dataset.menu === 'delete') {
      if (!confirm(`Delete this whole conversation with ${character.name}? This can't be undone.`)) return;
      await deleteChat(chat.id);
      toast('Conversation deleted');
      location.hash = '#/messages';
    }
  });

  render();
  if (!isTouch) input.focus();

  return () => {
    active?.abort();
    document.removeEventListener('click', onDocClick);
  };
}
