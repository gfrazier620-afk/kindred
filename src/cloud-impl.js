// The real Firebase connection. Only loaded when a Firebase project is configured (see cloud.js).
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import {
  getFirestore, collection, doc, query, orderBy, limit, where,
  getDocs, getDoc, setDoc, updateDoc, addDoc, deleteDoc, writeBatch, increment, serverTimestamp,
  startAfter, Timestamp,
} from 'firebase/firestore';
import { firebaseConfig } from './firebase-config.js';

let auth;
let db;

function boot() {
  if (db) return;
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
}

/** The shared Firebase connection (used by sync too). */
export function firebase() {
  boot();
  return { auth, db };
}

/** Signs in quietly (no account needed) and returns the user. Each device gets its own identity. */
export async function ensureUser() {
  boot();
  await auth.authStateReady();
  if (auth.currentUser) return auth.currentUser;
  try {
    return (await signInAnonymously(auth)).user;
  } catch (err) {
    if (err.code === 'auth/configuration-not-found') {
      throw new Error('Sign-in isn\'t set up yet. In Firebase, open Authentication and click "Get started", then enable Anonymous under Sign-in method.');
    }
    if (err.code === 'auth/operation-not-allowed' || err.code === 'auth/admin-restricted-operation') {
      throw new Error(`Anonymous sign-in is turned off. In Firebase, open Authentication → Sign-in method → Anonymous, switch Enable on, and Save. [${err.code}]`);
    }
    throw err;
  }
}

// ---- Converting between a local character and a public one ----

const clip = (value, max) => String(value ?? '').trim().slice(0, max);

function toPublic(c, creatorName) {
  return {
    name: clip(c.name, 60),
    tagline: clip(c.tagline, 160),
    bio: clip(c.bio, 3000),
    personality: clip(c.personality, 2000),
    scenario: clip(c.scenario, 1500),
    greeting: clip(c.greeting, 1500),
    examples: clip(c.examples, 2000),
    traits: (c.traits ?? []).slice(0, 12).map((t) => clip(t, 30)),
    tags: (c.tags ?? []).slice(0, 8).map((t) => clip(t, 30)),
    stats: (c.stats ?? []).slice(0, 12).map((s) => ({
      name: clip(s.name, 30),
      value: Math.max(0, Math.min(100, Math.round(Number(s.value) || 0))),
    })),
    creatorName: clip(creatorName, 40),
  };
}

// Photos are stored inside the character itself (Firebase's file storage needs a paid plan),
// so shrink them until they fit comfortably under the 80 KB the rules allow. Small photos keep the feed fast and inside the free plan.
async function shrinkPhoto(dataUrl) {
  if (!dataUrl) return '';
  const LIMIT = 70000;
  if (dataUrl.length <= LIMIT) return dataUrl;
  const img = await new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("Couldn't read the photo."));
    el.src = dataUrl;
  });
  for (const [max, quality] of [[400, 0.72], [340, 0.66], [280, 0.6], [220, 0.55], [160, 0.5]]) {
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const out = canvas.toDataURL('image/jpeg', quality);
    if (out.length <= LIMIT) return out;
  }
  return '';
}

function fromDoc(snapshot) {
  const d = snapshot.data();
  return {
    remoteId: snapshot.id,
    name: d.name,
    tagline: d.tagline ?? '',
    bio: d.bio ?? '',
    personality: d.personality ?? '',
    scenario: d.scenario ?? '',
    greeting: d.greeting ?? '',
    examples: d.examples ?? '',
    traits: d.traits ?? [],
    tags: d.tags ?? [],
    stats: d.stats ?? [],
    photo: d.photo ?? '',
    creator: d.creatorName || 'Someone',
    creatorUid: d.creatorUid,
    likeCount: d.likeCount ?? 0,
    createdAt: d.createdAt?.toMillis?.() ?? Date.now(),
  };
}

// ---- Public API (called through cloud.js) ----

export async function fetchCommunity({ max = 40, beforeMs } = {}) {
  boot(); // reading is public, so no sign-in is needed just to browse
  // beforeMs continues from where the last page ended ("load more").
  const cursor = beforeMs ? [startAfter(Timestamp.fromMillis(beforeMs))] : [];
  const snap = await getDocs(query(collection(db, 'characters'), orderBy('createdAt', 'desc'), ...cursor, limit(max)));
  return snap.docs.map(fromDoc);
}

/** Shares a character (or updates it if it's already shared). Returns the public id. */
export async function publishCharacter(c, creatorName) {
  const user = await ensureUser();
  const data = { ...toPublic(c, creatorName), photo: await shrinkPhoto(c.photo) };

  if (c.publishedId) {
    try {
      await updateDoc(doc(db, 'characters', c.publishedId), { ...data, updatedAt: serverTimestamp() });
      return c.publishedId;
    } catch (err) {
      // Deleted elsewhere? Fall through and share it again. Anything else is a real error.
      if (err.code !== 'not-found') throw err;
    }
  }

  const ref = doc(collection(db, 'characters'));
  await setDoc(ref, {
    ...data,
    creatorUid: user.uid,
    likeCount: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function unpublishCharacter(publishedId) {
  await ensureUser();
  await deleteDoc(doc(db, 'characters', publishedId));
}

/** Adds or removes your like, and keeps the character's count in step, in one write. */
export async function setRemoteLike(remoteId, liked) {
  const user = await ensureUser();
  const characterRef = doc(db, 'characters', remoteId);
  const likeRef = doc(db, 'characters', remoteId, 'likes', user.uid);
  const already = (await getDoc(likeRef)).exists();
  if (liked === already) return; // nothing to change

  const batch = writeBatch(db);
  if (liked) batch.set(likeRef, { at: serverTimestamp() });
  else batch.delete(likeRef);
  batch.update(characterRef, { likeCount: increment(liked ? 1 : -1) });
  await batch.commit();
}

export async function reportCharacter(remoteId, reason) {
  const user = await ensureUser();
  await addDoc(collection(db, 'reports'), {
    characterId: remoteId,
    reason: clip(reason, 300),
    by: user.uid,
    at: serverTimestamp(),
  });
}

export async function myPublished() {
  const user = await ensureUser();
  const snap = await getDocs(query(collection(db, 'characters'), where('creatorUid', '==', user.uid)));
  return snap.docs.map(fromDoc);
}
