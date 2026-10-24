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

## Day-to-day

- **Moderation:** anyone can report a character. Reports appear in **Firestore → reports**. To
  remove a character, open **Firestore → characters**, find it, and delete the document.
- **Free plan limits:** Firestore's free plan allows 50,000 reads and 20,000 writes per day.
  Each feed refresh reads up to 40 characters, and the app remembers the feed for a minute.
  Photos are shrunk to about 70 KB so the feed stays quick.
- **Identity:** sharing uses an anonymous identity stored on each device. If someone clears the
  app's data or deletes it from their home screen, they can't edit or delete characters they
  shared earlier (the characters themselves stay up). Adding Google sign-in later would fix that.
- **Testing the rules:** in **Firestore → Rules**, the **Rules playground** lets you try
  requests before trusting them.
