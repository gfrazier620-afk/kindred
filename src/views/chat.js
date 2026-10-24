import { getCharacter, getChat, listChats, saveChat, deleteChat, getSettings, listMemories, bumpStats, uid } from '../db.js';
import { streamReply, friendlyError, isAbortError } from '../ai.js';
import { updateMemory, liveMessages, addMemory } from '../memory.js';
import { isMature, isAdult, confirmAdult } from '../age.js';
import { allPersonas, resolvePersona, asPersona } from '../personas.js';
import { canSpeak, canDictate, speak, stopSpeaking, unlockSpeech, listen } from '../voice.js';
import { esc, avatarHtml, icon, $, formatMessage, toast, copyText, openModal } from '../util.js';

const MAX_VARIANTS = 8;

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

  // Mature (18+) characters need the age confirmation, even when opened from a link or an old chat.
  if (isMature(character) && !isAdult(settings)) {
    if (!(await confirmAdult({ name: character.name }))) {
      if (history.length > 1) history.back();
      else location.hash = '#/';
      return;
    }
    Object.assign(settings, await getSettings());
  }

  let chat = chatId && chatId !== 'new' ? await getChat(chatId) : null;
  if (!chat && chatId !== 'new') chat = (await listChats(characterId))[0];

  // Who you are in this chat: a persona chosen for it, or your default.
  const persona = () => resolvePersona(settings, chat?.personaId);
  // Settings as the AI should see them for this chat (your name and description swapped in).
  const me = () => asPersona(settings, persona());

  // The character's opening line, with names filled in.
  const makeGreeting = () =>
    character.greeting
      ? {
          id: uid(),
          role: 'assistant',
          at: Date.now(),
          content: character.greeting.replaceAll('{{user}}', persona().name).replaceAll('{{char}}', character.name),
        }
      : null;

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
          <button type="button" role="menuitem" data-menu="persona">${icon('user')} <span>Playing as <strong id="persona-name"></strong></span></button>
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
        ${canDictate() ? `<button type="button" class="mic-btn" id="mic" title="Dictate" aria-label="Dictate a message" aria-pressed="false">${icon('mic')}</button>` : ''}
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
  let speakingId = null; // the message being read aloud, if any
  let dictation = null; // the microphone session, if any

  const showPersona = () => ($('#persona-name').textContent = persona().name);
  showPersona();

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
    const name = m.role === 'user' ? persona().name : character.name;
    const meta = [name, m.at ? timeOf(m.at) : '', m.edited ? 'edited' : ''].filter(Boolean).join(' · ');
    const count = m.variants?.length ?? 1;
    const at = (m.vi ?? count - 1) + 1;
    return `
      <div class="msg ${m.role === 'user' ? 'msg-user' : 'msg-char'}" data-id="${esc(m.id)}">
        ${m.role === 'assistant' ? `<div class="msg-avatar">${avatarHtml(character, 32)}</div>` : ''}
        <div class="msg-body">
          <div class="msg-author">${esc(meta)}</div>
          <div class="bubble ${m.error ? 'bubble-error' : ''}">${m.content ? formatMessage(m.content) : '<span class="typing"><i></i><i></i><i></i></span>'}</div>
          <div class="msg-tools">
            ${
              isLastReply && count > 1
                ? `<span class="swipe" role="group" aria-label="Other versions of this reply">
                    <button type="button" class="tool" data-action="prev" ${at <= 1 ? 'disabled' : ''} aria-label="Previous version">‹</button>
                    <span class="swipe-n">${at}/${count}</span>
                    <button type="button" class="tool" data-action="next" aria-label="${at >= count ? 'Write a new version' : 'Next version'}">›</button>
                  </span>`
                : ''
            }
            ${isLastReply ? `<button type="button" class="tool" data-action="regen" title="Retry: write a new version" aria-label="Retry: write a new version of this reply">${icon('refresh')}</button>` : ''}
            ${canAct && m.role === 'assistant' && canSpeak() ? `<button type="button" class="tool ${speakingId === m.id ? 'on' : ''}" data-action="speak" title="Read aloud" aria-label="Read this message aloud">${icon('speaker')}</button>` : ''}
            ${canAct ? `<button type="button" class="tool" data-action="copy" title="Copy" aria-label="Copy message">${icon('copy')}</button>` : ''}
            ${canAct ? `<button type="button" class="tool" data-action="edit" title="Edit" aria-label="Edit message">${icon('edit')}</button>` : ''}
            ${canAct ? `<button type="button" class="tool" data-action="remember" title="Add to ${esc(character.name)}'s memories" aria-label="Add to ${esc(character.name)}'s memories">${icon('brain')}</button>` : ''}
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

  // ---- Reading aloud ----
  const markSpeaking = () => {
    for (const btn of list.querySelectorAll('[data-action="speak"]')) {
      btn.classList.toggle('on', btn.closest('.msg').dataset.id === speakingId);
    }
  };
  const readAloud = async (msg) => {
    speakingId = msg.id;
    markSpeaking();
    const started = await speak(msg.content, {
      voiceURI: settings.voiceURI,
      rate: settings.voiceRate,
      mode: settings.voiceMode,
      onEnd: () => {
        if (speakingId === msg.id) speakingId = null;
        markSpeaking();
      },
    });
    if (!started) {
      speakingId = null;
      markSpeaking();
    }
  };
  const silence = () => {
    stopSpeaking();
    speakingId = null;
    markSpeaking();
  };

  /**
   * Gets the character's next reply. With a target message, this writes a NEW VERSION of that
   * reply (keeping the old ones to flip back to) instead of adding another message.
   */
  async function reply(target = null) {
    if (!settings.apiKey) {
      toast('Add your API key in Settings first.', 'error');
      return;
    }
    silence();
    const memories = await listMemories(characterId);
    let msg;
    let history;
    if (target) {
      // Only what came before this reply goes to the model; older versions are kept aside.
      history = chat.messages.slice(0, chat.messages.indexOf(target)).filter((m) => !m.summarized);
      target.variants ??= [target.content];
      target.vi ??= target.variants.length - 1;
      msg = target;
      msg.content = '';
      msg.error = false;
    } else {
      // Older messages already folded into chat.summary aren't resent.
      history = liveMessages(chat);
      msg = { id: uid(), role: 'assistant', content: '', at: Date.now() };
      chat.messages.push(msg);
    }
    render();
    setBusy(true);

    const bubbleEl = list.querySelector(`.msg[data-id="${msg.id}"] .bubble`);
    active = streamReply({
      character,
      settings: me(),
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

    let failure = ''; // what to tell the person if this reply didn't work
    try {
      const { refused, stopReason } = await active.done;
      if (refused && !msg.content.trim()) {
        failure = `*${character.name} doesn't respond to that.* (Claude declined this message — try rephrasing.)`;
      } else if (!msg.content.trim()) {
        failure = `No reply came back (reason: ${stopReason || 'unknown'}). Tap Retry to try again.`;
      }
    } catch (err) {
      // Stopping it yourself isn't a failure: whatever arrived is kept.
      if (!isAbortError(err)) {
        console.error('Reply failed', err);
        failure = friendlyError(err) || 'Something went wrong. Tap Retry to try again.';
      }
    } finally {
      active = null;
      setBusy(false);
    }

    const worked = !failure && !!msg.content.trim();
    if (target) {
      const previous = target.variants[target.vi];
      if (worked) {
        target.variants.push(msg.content);
        if (target.variants.length > MAX_VARIANTS) target.variants.shift();
        target.vi = target.variants.length - 1;
        delete target.memorized; // new wording: let memory take another look
      } else {
        target.content = previous; // nothing to swap in: keep the version you had
        if (failure) toast(failure.replaceAll('*', ''), 'error');
      }
    } else {
      if (failure) {
        msg.content = failure;
        msg.error = true;
      }
      if (!msg.content.trim()) chat.messages.pop();
    }
    render();
    await saveChat(chat);

    if (worked) {
      bumpStats({ repliesReceived: 1 });
      if (settings.autoRead) readAloud(msg);
      rememberInBackground();
    }
  }

  async function rememberInBackground() {
    const changed = await updateMemory({ chat, character, settings: me() });
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
    dictation?.stop();
    if (settings.autoRead) unlockSpeech(); // lets the next reply be read aloud on iPhones
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

  // ---- Dictation ----
  const mic = $('#mic');
  mic?.addEventListener('click', () => {
    if (dictation) {
      dictation.stop();
      return;
    }
    const before = input.value ? `${input.value.trim()} ` : '';
    const done = () => {
      dictation = null;
      mic.classList.remove('listening');
      mic.setAttribute('aria-pressed', 'false');
    };
    dictation = listen({
      onText: (text) => {
        input.value = before + text;
        autosize();
      },
      onEnd: done,
      onError: (code) => {
        if (code === 'not-allowed' || code === 'service-not-allowed') toast('Microphone access is blocked for this site.', 'error');
        else if (code !== 'no-speech' && code !== 'aborted') toast(`Dictation stopped (${code}).`, 'error');
        done();
      },
    });
    if (dictation) {
      mic.classList.add('listening');
      mic.setAttribute('aria-pressed', 'true');
    }
  });

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
      if (msg.variants) msg.variants[msg.vi ?? msg.variants.length - 1] = text; // edit the version you're looking at
    }
    editingId = null;
    render({ stick: false });
    await saveChat(chat);
  }

  // Flip to another version of the last reply. Going past the newest one writes a fresh version.
  async function showVersion(msg, step) {
    const at = msg.vi ?? msg.variants.length - 1;
    if (step > 0 && at >= msg.variants.length - 1) {
      reply(msg);
      return;
    }
    msg.vi = Math.max(0, Math.min(msg.variants.length - 1, at + step));
    msg.content = msg.variants[msg.vi];
    delete msg.edited;
    silence();
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

    if (action === 'speak') {
      if (speakingId === id) silence();
      else readAloud(msg);
    } else if (action === 'copy') {
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
      if (speakingId === id) silence();
      chat.messages.splice(index, 1);
      render({ stick: false });
      await saveChat(chat);
    } else if (action === 'prev') {
      showVersion(msg, -1);
    } else if (action === 'next') {
      showVersion(msg, 1);
    } else if (action === 'regen') {
      reply(msg);
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

  // ---- Choose who you are in this chat ----
  function choosePersona() {
    const personas = allPersonas(settings);
    const current = persona().id;
    const { el, close } = openModal(
      `<h2>Who are you in this chat?</h2>
       ${personas
         .map(
           (p) => `<label class="persona-option">
             <input type="radio" name="persona" value="${esc(p.id)}" ${p.id === current ? 'checked' : ''}>
             <span><strong>${esc(p.name)}</strong><span class="muted">${esc(p.description || 'No description')}</span></span>
           </label>`,
         )
         .join('')}
       <p class="field-hint">${character.name} will call you by this name and know this about you. Add more in <a href="#/settings">Settings</a>.</p>`,
      { label: 'Choose a persona' },
    );
    el.addEventListener('change', async (e) => {
      chat.personaId = e.target.value;
      close();
      showPersona();
      render({ stick: false });
      await saveChat(chat);
      toast(`You're ${persona().name} in this chat`);
    });
  }

  // ---- More menu ----
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
    if (item.dataset.menu === 'persona') {
      choosePersona();
      return;
    }
    if (active) {
      toast('Wait for the reply to finish first.', 'error');
      return;
    }
    if (item.dataset.menu === 'clear') {
      if (!confirm(`Clear this chat? ${character.name} keeps what they remember about you, but the messages are removed.`)) return;
      editingId = null;
      silence();
      const greeting = makeGreeting();
      chat.messages = greeting ? [greeting] : [];
      delete chat.summary;
      render();
      await saveChat(chat);
      toast('Chat cleared');
    } else if (item.dataset.menu === 'delete') {
      if (!confirm(`Delete this whole conversation with ${character.name}? This can't be undone.`)) return;
      silence();
      await deleteChat(chat.id);
      toast('Conversation deleted');
      location.hash = '#/messages';
    }
  });

  render();
  if (!isTouch) input.focus();

  return () => {
    active?.abort();
    dictation?.stop();
    stopSpeaking();
    document.removeEventListener('click', onDocClick);
  };
}
