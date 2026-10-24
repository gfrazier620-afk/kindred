import Anthropic from '@anthropic-ai/sdk';
import { betaJSONSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/beta/json-schema';

export const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 — best roleplay' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 — faster, cheaper' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 — fastest, cheapest' },
];

// Models that support server-side refusal fallbacks on the Claude API.
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5']);

function makeClient(settings) {
  return new Anthropic({
    apiKey: settings.apiKey,
    // The key belongs to the person using the app and never leaves their device
    // except to go straight to api.anthropic.com.
    dangerouslyAllowBrowser: true,
  });
}

function withFallbacks(params) {
  if (FALLBACK_MODELS.has(params.model)) {
    params.betas = ['server-side-fallback-2026-07-01'];
    params.fallbacks = 'default';
  }
  return params;
}

// Memories and the running summary change over time, so they live in their own
// system block after the character card. That keeps the character card cacheable.
export function buildMemoryBlock({ memories = [], summary = '' }, character, settings) {
  const parts = [];
  if (memories.length) {
    parts.push(
      `<memories>\nThings ${character.name} remembers from earlier conversations with ${settings.userName || 'the user'}. Treat them as true and bring them up naturally when relevant.\n${memories.map((m) => `- ${m.text}`).join('\n')}\n</memories>`,
    );
  }
  if (summary) {
    parts.push(`<story_so_far>\nSummary of the earlier part of this conversation:\n${summary}\n</story_so_far>`);
  }
  return parts.join('\n\n');
}

const transcript = (messages, character, settings) =>
  messages
    .filter((m) => m.content?.trim() && !m.error)
    .map((m) => `${m.role === 'user' ? settings.userName || 'User' : character.name}: ${m.content}`)
    .join('\n\n');

export const REPLY_LENGTHS = {
  short:
    'Length: keep it quick, like texting — usually one to three sentences, with at most one short line of action. Leave room for the other person to respond rather than covering a lot of ground at once.',
  medium: 'Length: a short paragraph or two — enough to set the scene and respond, without monologuing.',
  long: 'Length: rich, detailed replies are welcome — several paragraphs of description, thoughts and dialogue when the moment calls for it.',
};

export function buildSystemPrompt(character, settings) {
  const fill = (text) =>
    (text ?? '').replaceAll('{{char}}', character.name).replaceAll('{{user}}', settings.userName || 'User');

  const user = settings.userName || 'the user';
  const parts = [
    `You are ${character.name}, a character in an interactive roleplay chat. Stay fully in character for the whole conversation: speak, think, and react the way ${character.name} would. The person you're talking with is ${user}.`,
    `Write ${character.name}'s replies only — never write ${user}'s words or decide their actions for them. Let the character's personality drive what they say.`,
    `Formatting: write like a story told in quick texts. Actions, expressions and surroundings are plain narration in present tense — no asterisks or other markup. Everything ${character.name} says out loud goes in "double quotes". For example:
${character.name} leans against the doorframe, arms crossed. "Took you long enough."
${user} writes the same way — plain text is what they do, quoted text is what they say.`,
    REPLY_LENGTHS[settings.replyLength] ?? REPLY_LENGTHS.short,
  ];

  if (character.tagline) parts.push(`<tagline>\n${fill(character.tagline)}\n</tagline>`);
  if (character.bio) parts.push(`<bio>\n${fill(character.bio)}\n</bio>`);
  if (character.traits?.length) parts.push(`<personality_traits>\n${character.traits.join(', ')}\n</personality_traits>`);
  if (character.personality) parts.push(`<personality>\n${fill(character.personality)}\n</personality>`);
  if (character.stats?.length) {
    const lines = character.stats.map((s) => `${s.name}: ${s.value}/100`).join('\n');
    parts.push(
      `<stats>\nThese ratings describe ${character.name} (0 = none, 100 = extreme). Let them shape how the character behaves.\n${lines}\n</stats>`,
    );
  }
  if (character.scenario) parts.push(`<scenario>\n${fill(character.scenario)}\n</scenario>`);
  if (character.examples) {
    parts.push(
      `<example_dialogue>\nThis shows ${character.name}'s voice and style. Don't repeat it verbatim.\n${fill(character.examples)}\n</example_dialogue>`,
    );
  }
  if (settings.userPersona) {
    parts.push(`<about_user>\n${fill(settings.userPersona)}\n</about_user>`);
  }
  return parts.join('\n\n');
}

// The API expects alternating turns that start with the user, so a chat that
// opens with the character's greeting gets a short opener in front of it.
function toApiMessages(messages) {
  const out = [];
  for (const m of messages) {
    if (!m.content?.trim()) continue;
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content += `\n\n${m.content}`;
    else out.push({ role: m.role, content: m.content });
  }
  if (out[0]?.role === 'assistant') out.unshift({ role: 'user', content: '(The conversation begins.)' });
  return out;
}

export const isAbortError = (err) => err instanceof Anthropic.APIUserAbortError;

export function friendlyError(err) {
  if (err instanceof Anthropic.AuthenticationError) return 'Your API key was rejected. Check it in Settings.';
  if (err instanceof Anthropic.PermissionDeniedError) return "Your API key doesn't have access to this model.";
  if (err instanceof Anthropic.NotFoundError) return 'That model was not found. Pick another one in Settings.';
  if (err instanceof Anthropic.RateLimitError) return 'Rate limited — wait a moment and try again.';
  if (err instanceof Anthropic.InternalServerError) return 'Claude is having trouble right now. Try again shortly.';
  if (err instanceof Anthropic.APIConnectionError) return "Couldn't reach the API. Check your internet connection.";
  if (err instanceof Anthropic.APIError) return err.message;
  return err?.message ?? String(err);
}

/**
 * Streams the character's next reply.
 * onText(fullTextSoFar) is called as text arrives.
 * Returns { text, refused, stopReason } when finished. Call handle.abort() to stop early.
 */
export function streamReply({ character, settings, messages, memories, summary, onText }) {
  const client = makeClient(settings);

  const system = [
    { type: 'text', text: buildSystemPrompt(character, settings), cache_control: { type: 'ephemeral' } },
  ];
  const memoryBlock = buildMemoryBlock({ memories, summary }, character, settings);
  if (memoryBlock) system.push({ type: 'text', text: memoryBlock });

  const params = withFallbacks({
    model: settings.model,
    max_tokens: 64000,
    system,
    messages: toApiMessages(messages),
    output_config: { effort: settings.effort || 'low' },
    // Caches the conversation so far, so each new message only pays full price for what's new.
    cache_control: { type: 'ephemeral' },
  });

  const stream = client.beta.messages.stream(params);

  const done = (async () => {
    let text = '';
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        text += event.delta.text;
        onText?.(text);
      }
    }
    const final = await stream.finalMessage();
    // Fall back to the finished message in case no text arrived as deltas.
    if (!text.trim()) {
      text = final.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
      if (text) onText?.(text);
    }
    if (!text.trim()) {
      console.warn('Empty reply from Claude', { stop_reason: final.stop_reason, stop_details: final.stop_details, content: final.content.map((b) => b.type) });
    }
    return { text, refused: final.stop_reason === 'refusal', stopReason: final.stop_reason };
  })();

  return { done, abort: () => stream.abort() };
}

const MEMORY_SCHEMA = {
  type: 'object',
  properties: {
    add: { type: 'array', items: { type: 'string' } },
    update: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, text: { type: 'string' } },
        required: ['id', 'text'],
        additionalProperties: false,
      },
    },
    remove: { type: 'array', items: { type: 'string' } },
  },
  required: ['add', 'update', 'remove'],
  additionalProperties: false,
};

/**
 * Reads the newest part of a chat and decides what the character should remember long-term.
 * Returns { add: string[], update: {id, text}[], remove: string[] }, or null if nothing could be read.
 */
export async function extractMemories({ character, settings, memories, context, newMessages }) {
  const user = settings.userName || 'the user';
  const existing = memories.length
    ? memories.map((m) => `[${m.id}]${m.pinned ? ' (pinned)' : ''} ${m.text}`).join('\n')
    : '(none yet)';

  const prompt = `You maintain the long-term memory of ${character.name}, an AI roleplay character, about their conversations with ${user}. These memories carry over into every future chat, so they should capture what a real friend would remember.

<current_memories>
${existing}
</current_memories>

<earlier_context>
${transcript(context, character, settings) || '(start of chat)'}
</earlier_context>

<new_messages>
${transcript(newMessages, character, settings)}
</new_messages>

Update the memories based on the new messages only:
- add: new lasting facts — things ${user} shares about themselves (name, likes, life events, feelings), how the relationship is developing, important story events, promises or plans, and anything ${character.name} learns or decides that should stay true later.
- update: rewrite an existing memory (by id) when the new messages change or add detail to it.
- remove: ids of memories that are now clearly wrong or obsolete.

Write each memory as one short, specific sentence in third person, using names (e.g. "${user} has a dog named Biscuit."). Skip small talk, anything already covered, and details that only matter for this moment. Never update or remove pinned memories. Empty lists are a perfectly good answer when nothing new is worth remembering.`;

  const client = makeClient(settings);
  const response = await client.beta.messages.parse(
    withFallbacks({
      model: settings.model,
      max_tokens: 16000,
      messages: [{ role: 'user', content: prompt }],
      output_config: { effort: 'low', format: betaJSONSchemaOutputFormat(MEMORY_SCHEMA) },
    }),
  );
  if (response.stop_reason === 'refusal' || !response.parsed_output) return null;
  return response.parsed_output;
}

/**
 * Folds older messages into a running summary so long chats stay coherent
 * without resending every word.
 */
export async function summarizeChat({ character, settings, previousSummary, messages }) {
  const prompt = `Summarize this roleplay conversation between ${character.name} and ${settings.userName || 'the user'} so it can continue seamlessly later. Keep the key events in order, where things stand now, how the characters feel about each other, and any unresolved threads, names, places or promises. Write in past tense as compact prose, at most about 400 words.

${previousSummary ? `<summary_so_far>\n${previousSummary}\n</summary_so_far>\n\nThe messages below come after that summary; merge them into one updated summary.\n\n` : ''}<messages>
${transcript(messages, character, settings)}
</messages>

Reply with only the summary.`;

  const client = makeClient(settings);
  const response = await client.beta.messages.create(
    withFallbacks({
      model: settings.model,
      max_tokens: 16000,
      messages: [{ role: 'user', content: prompt }],
      output_config: { effort: 'low' },
    }),
  );
  if (response.stop_reason === 'refusal') return null;
  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
  return text || null;
}
