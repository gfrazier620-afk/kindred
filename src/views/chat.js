import { getCharacter, getChat, listChats, saveChat, getSettings, listMemories, uid } from '../db.js';
import { streamReply, friendlyError, isAbortError } from '../ai.js';
import { updateMemory, liveMessages, addMemory } from '../memory.js';
import { esc, avatarHtml, icon, $, formatMessage, toast } from '../util.js';

export async function renderChat(app, characterId, chatId) {
  const [character, settings] = await Promise.all([getCharacter(characterId), getSettings()]);
  if (!character) {
    location.hash = '#/';
    return;
  }

  let chat = chatId && chatId !== 'new' ? await getChat(chatId) : null;
  if (!chat && chatId !== 'new') chat = (await listChats(characterId))[0];
  if (!chat) {
    chat = { id: uid(), characterId, messages: [], createdAt: Date.now() };
    if (character.greeting) {
      const greeting = character.greeting.replaceAll('{{user}}', settings.userName).replaceAll('{{char}}', character.name);
      chat.messages.push({ id: uid(), role: 'assistant', content: greeting });
    }
    await saveChat(chat);
  }
  // Keep the URL pointing at this exact chat without re-rendering.
  history.replaceState(null, '', `#/chat/${encodeURIComponent(characterId)}/${encodeURIComponent(chat.id)}`);

  const profileHref = `#/c/${encodeURIComponent(characterId)}`;

  app.innerHTML = `
    <div class="chat-screen">
      <header class="topbar chat-top">
        <a class="icon-btn" href="${profileHref}" title="Back">${icon('back')}</a>
        <a class="chat-who" href="${profileHref}">
          ${avatarHtml(character, 36)}
          <div><div class="chat-name">${esc(character.name)}</div><div class="muted small" id="status">${esc(character.tagline ?? '')}</div></div>
        </a>
        <a class="icon-btn" href="${profileHref}/memories" title="Memories">${icon('brain')}</a>
        <a class="icon-btn" href="#/chat/${encodeURIComponent(characterId)}/new" title="New chat">${icon('plus')}</a>
      </header>
      ${
        settings.apiKey
          ? ''
          : `<div class="banner">Add your Claude API key in <a href="#/settings">Settings</a> so ${esc(character.name)} can reply.</div>`
      }
      <div class="messages" id="messages"></div>
      <form class="composer" id="composer">
        <textarea id="input" rows="1" placeholder="Message ${esc(character.name)}…" enterkeyhint="send"></textarea>
        <button class="send-btn" id="send" type="submit" title="Send">${icon('send')}</button>
      </form>
    </div>`;

  const list = $('#messages');
  const input = $('#input');
  const sendBtn = $('#send');
  let active = null; // the streaming request, if any

  const bubble = (m, i) => {
    const isLastReply = m.role === 'assistant' && i === chat.messages.length - 1 && i > 0;
    return `
      <div class="msg ${m.role === 'user' ? 'msg-user' : 'msg-char'}" data-id="${esc(m.id)}">
        ${m.role === 'assistant' ? `<div class="msg-avatar">${avatarHtml(character, 32)}</div>` : ''}
        <div class="msg-body">
          <div class="msg-author">${esc(m.role === 'user' ? settings.userName : character.name)}</div>
          <div class="bubble ${m.error ? 'bubble-error' : ''}">${m.content ? formatMessage(m.content) : '<span class="typing"><i></i><i></i><i></i></span>'}</div>
          <div class="msg-tools">
            ${isLastReply ? `<button type="button" class="tool" data-action="regen">${icon('refresh')} Retry</button>` : ''}
            ${m.content && !m.error ? `<button type="button" class="tool" data-action="remember" title="Add to ${esc(character.name)}'s memories">${icon('brain')} Remember</button>` : ''}
            <button type="button" class="tool" data-action="delete" title="Delete message">${icon('trash')}</button>
          </div>
        </div>
      </div>`;
  };

  const render = () => {
    list.innerHTML = chat.messages.map(bubble).join('');
    list.scrollTop = list.scrollHeight;
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
    const msg = { id: uid(), role: 'assistant', content: '' };
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
    if (ok) rememberInBackground();
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
    // Drop a failed reply so it isn't sent back to the model.
    if (chat.messages.at(-1)?.error) chat.messages.pop();
    chat.messages.push({ id: uid(), role: 'user', content: text });
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

  list.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn || active) return;
    const id = btn.closest('.msg').dataset.id;
    const index = chat.messages.findIndex((m) => m.id === id);
    if (btn.dataset.action === 'remember') {
      const msg = chat.messages[index];
      const text = prompt(`What should ${character.name} remember?`, msg.content.replace(/\*/g, '').slice(0, 300));
      if (text?.trim()) {
        await addMemory(characterId, text, { pinned: true });
        toast('Saved to memories (pinned)');
      }
    } else if (btn.dataset.action === 'delete') {
      chat.messages.splice(index, 1);
      render();
      await saveChat(chat);
    } else if (btn.dataset.action === 'regen') {
      chat.messages.splice(index, 1);
      reply();
    }
  });

  render();
  if (!isTouch) input.focus();

  return () => active?.abort();
}
