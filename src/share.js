import { getCharacter, saveCharacter, getSettings } from './db.js';
import { isAdult } from './age.js';
import { publish, unpublish } from './cloud.js';

// The name that goes on a public character.
export function publicName(settings) {
  const real = settings.userName && settings.userName !== 'You' ? settings.userName : '';
  return settings.nickname || real || 'Anonymous';
}

/** Shares a character with everyone (or updates the shared copy). Saves the link locally. */
export async function shareCharacter(character) {
  const settings = await getSettings();
  const publishedId = await publish(character, publicName(settings));
  const updated = { ...character, publishedId };
  await saveCharacter(updated);
  return updated;
}

/** Takes a character off the community. The copy on this device stays. */
export async function unshareCharacter(character) {
  if (character.publishedId) await unpublish(character.publishedId);
  const { publishedId, ...rest } = character;
  await saveCharacter(rest);
  return rest;
}

/** Turns a community post into a character that can be chatted with on this device. */
export async function adoptCommunityCharacter(remote) {
  if (remote.rating === 'mature' && !isAdult(await getSettings())) {
    throw new Error('This character is rated 18+. Confirm your age first.');
  }
  const id = `pub-${remote.remoteId}`;
  const existing = await getCharacter(id);
  if (existing) return existing;
  const { creatorUid, likeCount, ...fields } = remote;
  const character = { ...fields, id, imported: true };
  await saveCharacter(character);
  return character;
}

// How a community post looks as a character, before anyone has added it.
export const remoteToCharacter = (remote) => ({
  ...remote,
  id: `pub-${remote.remoteId}`,
  imported: true,
});

/**
 * One list for Home and Search: everything on this device, plus community posts that aren't
 * on this device yet. Each item is { c: character, remote: community info or null, remoteOnly }.
 */
export function mergeFeed(local, remote) {
  const byRemoteId = new Map();
  for (const c of local) {
    if (c.publishedId) byRemoteId.set(c.publishedId, c);
    if (c.remoteId) byRemoteId.set(c.remoteId, c);
  }
  const items = local.map((c) => ({ c, remote: null, remoteOnly: false }));
  const itemFor = new Map(items.map((item) => [item.c, item]));

  for (const r of remote ?? []) {
    const match = byRemoteId.get(r.remoteId);
    if (match) itemFor.get(match).remote = r;
    else items.push({ c: remoteToCharacter(r), remote: r, remoteOnly: true });
  }
  return items;
}
