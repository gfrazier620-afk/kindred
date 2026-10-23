# Kindred — create your own AI characters

A Character.AI / Chai–style app: make a character with a photo, bio, personality traits and stats, then chat with them. Replies come from Claude. Works in any browser and installs on your phone like a regular app.

## Features

- **Character creator** — upload a photo, write a bio and backstory, pick personality traits, set custom stats (0–100), a scenario, a first message and example dialogue.
- **Chat** — streaming replies, stop mid-reply, retry the last reply, delete messages, multiple chats per character.
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
src/ai.js               builds the character prompt, streams replies from Claude
src/db.js               on-device storage (IndexedDB)
src/views/              home, profile, editor, chat, settings screens
src/seeds.js            starter characters
public/                 manifest, service worker, icons
.github/workflows/      GitHub Pages deploy
```
