// Front door to the community features. Everything here quietly does nothing until a Firebase
// project is configured in firebase-config.js, so the app works the same without one.
import { firebaseConfig } from './firebase-config.js';

let impl = null;
let fakeOn = false;

/** True when a Firebase project is configured. */
export const cloudEnabled = () => fakeOn || !!firebaseConfig?.projectId;

// The Firebase code is only downloaded when it's actually needed.
const load = async () => impl ?? (impl = await import('./cloud-impl.js'));

/** For testing the screens without a real project. */
export function __useFake(fake) {
  impl = fake;
  fakeOn = true;
  clearCommunityCache();
}

const PAGE = 40;
let cache = { at: 0, list: null, more: false };
export const clearCommunityCache = () => (cache = { at: 0, list: null, more: false });

/** Public characters, newest first. Cached for a minute so switching tabs doesn't refetch. */
let pending = null; // a fetch already under way, so quick tab switches don't ask twice
export async function getCommunity({ force = false } = {}) {
  if (!cloudEnabled()) return null;
  if (!force && cache.list && Date.now() - cache.at < 60000) return cache.list;
  if (pending) return pending;
  pending = (async () => {
    try {
      const list = await (await load()).fetchCommunity({ max: PAGE });
      cache = { at: Date.now(), list, more: list.length >= PAGE };
      return list;
    } finally {
      pending = null;
    }
  })();
  return pending;
}

/** True when the last page was full, so there are probably older characters to load. */
export const hasMoreCommunity = () => !!cache.more;

/** Loads the next page of older characters and adds it to the list. */
export async function loadMoreCommunity() {
  if (!cache.list?.length) return cache.list;
  const oldest = cache.list[cache.list.length - 1].createdAt;
  const page = await (await load()).fetchCommunity({ max: PAGE, beforeMs: oldest });
  const have = new Set(cache.list.map((c) => c.remoteId));
  cache.list = [...cache.list, ...page.filter((c) => !have.has(c.remoteId))];
  cache.more = page.length >= PAGE;
  return cache.list;
}

export async function publish(character, creatorName) {
  const id = await (await load()).publishCharacter(character, creatorName);
  clearCommunityCache();
  return id;
}

export async function unpublish(publishedId) {
  await (await load()).unpublishCharacter(publishedId);
  clearCommunityCache();
}

export async function setLike(remoteId, liked) {
  await (await load()).setRemoteLike(remoteId, liked);
}

export async function report(remoteId, reason) {
  await (await load()).reportCharacter(remoteId, reason);
}

export async function myPublished() {
  return (await load()).myPublished();
}
