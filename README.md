# Kindred — create your own AI characters

A Character.AI / Chai–style app: make a character with a photo, bio, personality traits and stats, then chat with them. Replies come from Claude. Works in any browser and installs on your phone like a regular app.

## Features

- **18+ ratings** — creators can rate a character Mature (18+). Mature characters stay hidden, and need a one-time "I'm 18 or older" confirmation, until someone confirms (and can be hidden again in Settings).
- **Accounts and sync** — sign in with Google or email to keep characters, chats and memories the same on every device. See [FIREBASE_SETUP.md](FIREBASE_SETUP.md).
- **Swipe replies** — Retry keeps the old reply; flip between versions with the ‹ › arrows and the chat uses the one you pick.
- **Personas** — add different versions of yourself in Settings and choose who you are per chat from the chat menu.
- **Voice** — read replies aloud (dialogue only or everything, with voice and speed options) and dictate messages where the browser supports it.

- **Build with AI** — describe a character in a sentence and Claude drafts the name, backstory, personality, stats and opening line for you to tweak.
- **Backup & restore** — Settings → Your data downloads one file with your characters, chats, memories and profile (never your API key) and restores it on any device.
- **Chat tools** — edit or copy any message, message times and day dividers, a jump-to-latest button, and Clear chat / Delete conversation in the chat menu.
- **Smoother feed** — loading placeholders, pull to refresh, and Load more.

- **Community (optional)** — share your characters with everyone and browse what others made, with likes and reporting. Needs a free Firebase project: see [FIREBASE_SETUP.md](FIREBASE_SETUP.md). Without one, Kindred works exactly as before.

- **Five tabs** — **Home** is a social-style feed of characters (with a "continue chatting" row on top), **Search** finds anyone by name, trait, tag or creator, **Create** holds the character creator and everything you have made, **Messages** lists your conversations, and **Profile** shows your nickname, bio and stats (messages sent, chats, characters created and more).

- **Character creator** — upload a photo, write a bio and backstory, pick personality traits, set custom stats (0–100), a scenario, a first message and example dialogue.
- **Chat** — streaming replies, stop mid-reply, retry the last reply, delete messages, multiple chats per character.
- **Memory** — characters remember what matters across every chat with you (your name, your dog, promises, story events). Memories are picked up automatically every few messages, and you can view, edit, pin, add or delete them on the character's **Memories** page, or tap **Remember** on any message. Long chats are summarized in the background so the story stays coherent, and prompt caching keeps long chats cheap.
- **Your persona** — set your name and a description characters will know about you.
- **Share characters** — export any character as a `.json` file and import it on another device.
- **Phone app** — installable (PWA) on Android and iPhone, with offline startup.
- **Private** — characters, photos and chats are stored only on your device. Your API key goes straight to Anthropic, nowhere else.

## Run it on your computer

Needs [Node.js](https://nodejs.org) 20+.

```bash
npm install
```

```bash
npm run dev
```

Open the link it prints (usually http://localhost:5173), go to **Settings**, and paste a Claude API key from [console.anthropic.com](https://console.anthropic.com/settings/keys).

## Put it on GitHub and launch it

1. Create a new **empty** repository on GitHub (for example `kindred`).
2. Push this folder to it:
   ```bash
   git remote add origin https://github.com/<your-username>/kindred.git
   ```
   ```bash
   git push -u origin main
   ```
3. On GitHub open the repo's **Settings → Pages**, and under **Build and deployment → Source** choose **GitHub Actions**.
4. Open the **Actions** tab — the "Deploy to GitHub Pages" run builds the site. When it finishes, your app is live at `https://<your-username>.github.io/kindred/`.

Every push to `main` redeploys automatically.

## Install it on your phone

Open your GitHub Pages link on your phone, then:

- **Android (Chrome):** tap the ⋮ menu → **Install app** (or **Add to Home screen**).
- **iPhone (Safari):** tap **Share** → **Add to Home Screen**.

It opens full-screen with its own icon, like any other app.

> Want it in the Google Play / App Store later? The app can be wrapped with [Capacitor](https://capacitorjs.com) without rewriting it.

## About the API key

Kindred uses each person's own Claude API key, entered in Settings. That keeps the site free to host on GitHub Pages with no server. Usage is billed to whoever's key it is, so don't share your key — anyone who opens your site enters their own.

Pick the model in Settings: **Opus 5.5** (best quality, default), **Sonnet 5.5** (faster/cheaper) or **Haiku 5.5** (fastest/cheapest). "Reply style" trades speed for more thoughtful replies.

## Project layout

```
index.html              app entry
src/main.js             router + startup
src/ai.js               builds the character prompt, streams replies, extracts memories, summarizes
src/memory.js           decides when to save memories and summarize long chats
src/db.js               on-device storage (IndexedDB)
src/views/              home, profile, editor, chat, settings screens
src/seeds.js            starter characters
public/                 manifest, service worker, icons
.github/workflows/      GitHub Pages deploy
```
