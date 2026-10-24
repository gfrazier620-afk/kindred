# Turning on the Kindred community

The community feed (other people's characters, likes, sharing) runs on Firebase, Google's free
backend. Until a Firebase project is connected, Kindred works fully on its own, just without the
shared feed. Setup takes about 10 minutes and the free plan is plenty to start.

## 1. Create the project

1. Go to <https://console.firebase.google.com> and sign in with a Google account.
2. **Create a project** (or **Add project**). Name it `kindred`.
3. Google Analytics is not needed: switch it off, then **Create project**.

## 2. Turn on anonymous sign-in

People get shared characters under their nickname without needing to make an account.

1. In the left menu: **Build → Authentication → Get started**.
2. Open the **Sign-in method** tab, choose **Anonymous**, switch **Enable** on, and **Save**.

## 3. Create the database

1. **Build → Firestore Database → Create database**.
2. Pick a location close to most of your users (this can't be changed later).
3. Choose **Start in production mode**, then **Enable**.

## 4. Paste in the security rules

The rules decide who can read and write what. They are what keep people from editing each
other's characters.

1. In Firestore, open the **Rules** tab.
2. Delete what's there and paste in the entire contents of `firestore.rules` from this repo.
3. Click **Publish**.

## 5. Connect the app

1. Click the gear icon next to **Project Overview** → **Project settings**.
2. Under **Your apps**, click the web icon (`</>`). Nickname it `Kindred`. Leave "Firebase
   Hosting" unticked, then **Register app**.
3. Copy the `firebaseConfig` object it shows you.
4. Paste it into `src/firebase-config.js`, replacing `null` with the object, and commit and push.
   The site rebuilds itself within a couple of minutes.

The config values are safe to publish. They only say which project to talk to; the rules above
control access.

## Turning on sign-in and sync

Signing in lets people keep their characters, chats and memories on every device, and survive
removing the app from a home screen. It needs four changes in the Firebase console:

1. **Google sign-in:** **Build → Authentication → Sign-in method → Google**. Switch **Enable** on,
   pick a support email, and **Save**.
2. **Email sign-in:** on the same page choose **Email/Password**, switch the first **Enable**
   toggle on (not "Email link"), and **Save**. This is the reliable option on iPhone home-screen
   apps, where Google's pop-up window can be blocked.
3. **Allow your website:** open the **Settings** tab → **Authorized domains** → **Add domain** and
   enter `gfrazier620-afk.github.io`. Google sign-in won't work without this.
4. **Update the rules:** **Firestore Database → Rules**, replace everything with the current
   `firestore.rules` from this repo, and **Publish**. The new rules add a private area for each
   signed-in person's synced data.

Then in Kindred open **Profile → Account & sync**.

How sync behaves:

- The app always works from the copy on the device. Changes upload a few seconds after you make
  them, and new changes from other devices arrive when you open the app or tap **Sync now**.
- If two devices change the same thing, the most recent change wins.
- Built-in starter characters, your API key and device-only settings are never uploaded.
- Very long chats (over about 900 KB) are too big for one cloud document and are skipped; the
  Profile screen says so.
- Signing out keeps everything on the device. Signing in on a device that already has characters
  adds them to the account.
- Each person's synced data lives under `users/{their id}` in Firestore, so you can see (and
  delete) it from the console.

## Day-to-day

- **Moderation:** anyone can report a character. Reports appear in **Firestore → reports**. To
  remove a character, open **Firestore → characters**, find it, and delete the document.
- **Free plan limits:** Firestore's free plan allows 50,000 reads and 20,000 writes per day.
  Each feed refresh reads up to 40 characters, and the app remembers the feed for a minute.
  Photos are shrunk to about 70 KB so the feed stays quick.
- **Identity:** until someone signs in, sharing uses an anonymous identity stored on that device.
  If they clear the app's data or delete it from their home screen, they can't edit or delete
  characters they shared earlier (the characters themselves stay up). Signing in (Profile →
  Account & sync) fixes that: shared characters then belong to the account, on every device.
- **Testing the rules:** in **Firestore → Rules**, the **Rules playground** lets you try
  requests before trusting them.
