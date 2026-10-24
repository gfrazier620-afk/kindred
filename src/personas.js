// Who you are in a chat. "default" is the name and description from Settings → About you;
// extra personas are added in Settings and can be picked per chat.

export const allPersonas = (settings) => [
  { id: 'default', name: settings.userName || 'You', description: settings.userPersona || '' },
  ...(settings.personas ?? []),
];

export function resolvePersona(settings, personaId) {
  const list = allPersonas(settings);
  return list.find((p) => p.id === personaId) ?? list.find((p) => p.id === settings.defaultPersonaId) ?? list[0];
}

/** The settings as the AI should see them: your name and description swapped for the persona's. */
export const asPersona = (settings, persona) => ({ ...settings, userName: persona.name, userPersona: persona.description });
