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

let cache = { at: 0, list: null };
export const clearCommunityCache = () => (cache = { at: 0, list: null });

/** Public characters, newest first. Cached for a minute so switching tabs doesn't refetch. */
export async function getCommunity({ force = false } = {}) {
  if (!cloudEnabled()) return null;
  if (!force && cache.list && Date.now() - cache.at < 60000) return cache.list;
  const list = await (await load()).fetchCommunity({ max: 40 });
  cache = { at: Date.now(), list };
  return list;
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
