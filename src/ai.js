import Anthropic from '@anthropic-ai/sdk';

export const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 — best roleplay' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 — faster, cheaper' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 — fastest, cheapest' },
];

// Models that support server-side refusal fallbacks on the Claude API.
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5']);

export function buildSystemPrompt(character, settings) {
  const fill = (text) =>
    (text ?? '').replaceAll('{{char}}', character.name).replaceAll('{{user}}', settings.userName || 'User');

  const parts = [
    `You are ${character.name}, a character in an interactive roleplay chat. Stay fully in character for the whole conversation: speak, think, and react the way ${character.name} would, in first person. The person you're talking with is ${settings.userName || 'the user'}.`,
    `Write ${character.name}'s replies only — never write ${settings.userName || "the user"}'s words or decide their actions for them. Describe actions, expressions and surroundings in *asterisks* when it adds to the scene. Keep replies conversational in length unless the moment calls for more, and let the character's personality drive what they say.`,
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
 * Returns { text, refused } when finished. Call handle.abort() to stop early.
 */
export function streamReply({ character, settings, messages, onText }) {
  const client = new Anthropic({
    apiKey: settings.apiKey,
    // The key belongs to the person using the app and never leaves their device
    // except to go straight to api.anthropic.com.
    dangerouslyAllowBrowser: true,
  });

  const params = {
    model: settings.model,
    max_tokens: 64000,
    system: buildSystemPrompt(character, settings),
    messages: toApiMessages(messages),
    output_config: { effort: settings.effort || 'low' },
  };
  if (FALLBACK_MODELS.has(settings.model)) {
    params.betas = ['server-side-fallback-2026-07-01'];
    params.fallbacks = 'default';
  }

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
    return { text, refused: final.stop_reason === 'refusal' };
  })();

  return { done, abort: () => stream.abort() };
}
