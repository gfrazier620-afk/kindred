// The real Firebase side of sign-in and sync. Only loaded when someone signs in (see sync.js).
import {
  GoogleAuthProvider, EmailAuthProvider,
  linkWithPopup, linkWithCredential, signInWithPopup, signInWithCredential,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import { collection, doc, getDocs, query, where, writeBatch } from 'firebase/firestore';
import { firebase } from './cloud-impl.js';

const describe = (user) => ({
  uid: user.uid,
  email: user.email ?? '',
  name: user.displayName ?? '',
  provider: user.providerData?.[0]?.providerId ?? 'password',
});

// Turns Firebase's error codes into sentences a person can act on. `method` says which sign-in
// was being tried, so "isn't turned on" can name the right switch. The code is kept at the end
// in brackets so a problem can be pinned down exactly.
function friendly(err, method = 'sign-in') {
  const google = method === 'google';
  const messages = {
    'auth/popup-blocked': 'Your browser blocked the sign-in window. Allow pop-ups for this site, or use email instead.',
    'auth/popup-closed-by-user': 'Sign-in was cancelled.',
    'auth/cancelled-popup-request': 'Sign-in was cancelled.',
    'auth/unauthorized-domain':
      "This website isn't allowed to sign in yet. In Firebase, open Authentication → Settings → Authorized domains and add gfrazier620-afk.github.io.",
    'auth/operation-not-allowed': google
      ? "Google sign-in isn't turned on for this project. In Firebase: Authentication → Sign-in method → Google → switch Enable on → Save."
      : "Email and password sign-in isn't turned on. In Firebase: Authentication → Sign-in method → Email/Password. Switch the FIRST Enable toggle on (not just 'Email link'), then Save.",
    'auth/admin-restricted-operation':
      "Creating accounts is switched off for this project. In Firebase: Authentication → Settings → User actions → turn on 'Enable create (sign-up)'.",
    'auth/invalid-credential': 'Wrong email or password. If you have not made an account yet, tap Create account.',
    'auth/wrong-password': 'Wrong email or password. If you have not made an account yet, tap Create account.',
    'auth/user-not-found': 'Wrong email or password. If you have not made an account yet, tap Create account.',
    'auth/email-already-in-use': 'That email already has an account. Choose Sign in instead.',
    'auth/weak-password': 'Choose a password with at least 6 characters.',
    'auth/invalid-email': "That email address doesn't look right.",
    'auth/missing-password': 'Enter your password.',
    'auth/network-request-failed': "Couldn't reach Google. Check your connection and try again.",
    'auth/too-many-requests': 'Too many attempts. Wait a few minutes and try again.',
    'auth/configuration-not-found': 'Sign-in isn\'t set up yet. In Firebase, open Authentication and click "Get started".',
    'auth/api-key-not-valid.-please-pass-a-valid-api-key.': "Firebase didn't accept this app's API key. Check src/firebase-config.js.",
    'auth/requests-from-referer-https://gfrazier620-afk.github.io-are-blocked.':
      "This website is blocked by the API key's restrictions. In Google Cloud → APIs & Services → Credentials, allow gfrazier620-afk.github.io for the browser key.",
  };
  const message = messages[err?.code];
  const out = new Error(message ? `${message} [${err.code}]` : `${err?.message ?? 'Sign-in failed.'}`);
  out.code = err?.code;
  return out;
}

async function ready() {
  const { auth } = firebase();
  await auth.authStateReady();
  return auth;
}

/** Google sign-in. If you were using the app anonymously, that identity is upgraded, not replaced. */
export async function signInGoogle() {
  const auth = await ready();
  const provider = new GoogleAuthProvider();
  const user = auth.currentUser;
  try {
    const result = user?.isAnonymous ? await linkWithPopup(user, provider) : await signInWithPopup(auth, provider);
    return describe(result.user);
  } catch (err) {
    // This Google account already has Kindred data: sign in to it instead.
    if (err.code === 'auth/credential-already-in-use') {
      const credential = GoogleAuthProvider.credentialFromError(err);
      if (credential) return describe((await signInWithCredential(auth, credential)).user);
    }
    throw friendly(err, 'google');
  }
}

export async function signInEmail({ email, password, create }) {
  const auth = await ready();
  const user = auth.currentUser;
  try {
    let result;
    if (create) {
      result = user?.isAnonymous
        ? await linkWithCredential(user, EmailAuthProvider.credential(email, password))
        : await createUserWithEmailAndPassword(auth, email, password);
    } else {
      result = await signInWithEmailAndPassword(auth, email, password);
    }
    return describe(result.user);
  } catch (err) {
    throw friendly(err, 'email');
  }
}

export async function resetPassword(email) {
  const auth = await ready();
  try {
    await sendPasswordResetEmail(auth, email);
  } catch (err) {
    throw friendly(err, 'email');
  }
}

export async function signOutNow() {
  const auth = await ready();
  await firebaseSignOut(auth);
}

// ---- The adapter the sync engine talks to ----

/** Documents in users/{uid}/{kind} changed after `since`. */
export async function list(uid, kind, since) {
  const { db } = firebase();
  const snap = await getDocs(query(collection(db, 'users', uid, kind), where('updatedAt', '>', since)));
  return snap.docs.map((d) => ({ id: d.id, data: d.data() }));
}

/** Writes many documents in one go. Each op is { kind, id, data }. */
export async function write(uid, ops) {
  const { db } = firebase();
  const batch = writeBatch(db);
  for (const { kind, id, data } of ops) batch.set(doc(db, 'users', uid, kind, id), data);
  await batch.commit();
}
