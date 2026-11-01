# Unisono

**Spotify, Apple Music and YouTube Music in one Windows app.**

Unisono puts the three official web players side by side as tabs in a single window and gives
them one shared set of controls:

- One control bar with **play/pause, next, previous** and **now playing** (title, artist, artwork, which service).
- Your keyboard's **media keys** work no matter which tab is open.
- **Only one service plays at a time**: start a song in one and the others pause.
- **Taskbar buttons** (hover the taskbar icon) and a **tray icon**: close the window and the music keeps going.
- You stay **logged in** to all three between launches.
- Shortcuts: `Ctrl+1/2/3` switch services, `Ctrl+Tab` cycles, `Ctrl+R` reloads, `Alt+Left` goes back, `Alt` shows the menu.

> **Personal use only.** Unisono shows each service's own website, so you need your own accounts and
> each service's terms still apply. Don't publish or sell builds of it.

---

## Contents

1. [Install the tools](#1-install-the-tools)
2. [Create the GitHub repository](#2-create-the-github-repository)
3. [Put the code in the repository](#3-put-the-code-in-the-repository)
4. [Run the app in development](#4-run-the-app-in-development)
5. [Set up DRM signing (castLabs EVS)](#5-set-up-drm-signing-castlabs-evs)
6. [Build the installer on your PC](#6-build-the-installer-on-your-pc)
7. [Automatic releases with GitHub Actions](#7-automatic-releases-with-github-actions)
8. [Download and install your app](#8-download-and-install-your-app)
9. [Troubleshooting](#9-troubleshooting)
10. [How it works](#10-how-it-works)
11. [Ideas for later](#11-ideas-for-later)

---

## 1. Install the tools

Open **PowerShell** and install these with `winget` (built into Windows 10/11):

```powershell
winget install OpenJS.NodeJS.LTS     # Node.js + npm: runs and builds the app
winget install Git.Git               # Git: version control, talks to GitHub
winget install Python.Python.3.12    # Python: needed only for the DRM signing tool
winget install Microsoft.VisualStudioCode   # optional, a good editor
```

**Close and reopen PowerShell**, then check everything is there:

```powershell
node -v     # v22 or newer
npm -v
git --version
python --version
```

Tell Git who you are (once per PC):

```powershell
git config --global user.name  "Your Name"
git config --global user.email "you@example.com"
```

---

## 2. Create the GitHub repository

1. Go to **github.com → + (top right) → New repository**.
2. **Repository name:** `unisono`.
3. Choose **Private** (recommended, see the personal-use note above).
4. Leave **"Add a README"**, **.gitignore** and **license** all **unchecked**. The project already has them,
   and an empty repo makes the first push simpler.
5. Click **Create repository**. Keep the page open; you'll need the URL, which looks like
   `https://github.com/YOUR-USERNAME/unisono.git`.

---

## 3. Put the code in the repository

Unzip `unisono.zip` somewhere easy, for example `C:\dev\unisono`, then in PowerShell:

```powershell
cd C:\dev\unisono
git init -b main
git add .
git commit -m "First version of Unisono"
git remote add origin https://github.com/YOUR-USERNAME/unisono.git
git push -u origin main
```

The first push opens a browser window asking you to sign in to GitHub. Afterwards, refresh the
repository page and you'll see your files. The **Actions** tab will show a green "Check" run.

---

## 4. Run the app in development

```powershell
npm install     # downloads Electron (castLabs build with DRM support) and the build tools (~150 MB)
npm run dev
```

On first launch:

- It may take ~10–30 seconds before the window appears. It's downloading **Widevine**, the DRM
  module Spotify and Apple Music require. This only happens once.
- Log in to each service in its tab (`Ctrl+1` Spotify, `Ctrl+2` Apple Music, `Ctrl+3` YouTube Music).
  Logins are remembered.
- `Ctrl+Shift+I` opens developer tools for the current service if you want to poke around.

Code changes: stop the app (`Ctrl+Q`) and run `npm run dev` again.

> If Spotify or Apple Music won't play in development, do step 5 first; DRM-protected music may
> require the VMP signature.

---

## 5. Set up DRM signing (castLabs EVS)

Spotify and Apple Music protect their audio with **Widevine DRM**. Normal Electron can't play it,
so Unisono uses **castLabs Electron**, a drop-in version with Widevine built in. For Widevine to
fully trust the app, the packaged app needs a **VMP signature**. castLabs signs it for free through
their **EVS** service. You just need an account.

```powershell
python -m pip install --upgrade castlabs-evs
python -m castlabs_evs.account signup        # follow the prompts, then confirm via the email code
python -m castlabs_evs.account reauth        # logs this PC in
```

From now on, every build (`npm run dist`) is signed automatically by `build/vmp-sign.js`.

To sign your **development** copy too (helps if Spotify/Apple refuse to play in `npm run dev`):

```powershell
python -m castlabs_evs.vmp sign-pkg node_modules\electron\dist
```

Repeat that after every `npm install` that updates Electron.

---

## 6. Build the installer on your PC

```powershell
npm run dist
```

When it finishes, the installer is at:

```
dist\Unisono Setup 0.1.0.exe
```

Double-click it to install. The build log should show `VMP signature OK`. If it shows a warning
instead, go back to step 5.

---

## 7. Automatic releases with GitHub Actions

Instead of building on your PC, GitHub can build the installer on a Windows machine in the cloud and
publish it on your repository's **Releases** page. The recipe is `.github/workflows/release.yml`.

### 7.1 Add your EVS login as secrets (once)

On GitHub: **your repo → Settings → Secrets and variables → Actions → New repository secret**, and
add both:

| Name               | Value                         |
| ------------------ | ----------------------------- |
| `EVS_ACCOUNT_NAME` | the EVS account name from step 5 |
| `EVS_PASSWD`       | your EVS password             |

Secrets are encrypted; nobody (including you) can read them back, and they never appear in logs.

### 7.2 Publish a version

Each release needs a new version number. This command bumps the version in `package.json`, commits
it and creates a matching Git tag (e.g. `v0.1.1`):

```powershell
npm version patch        # 0.1.0 → 0.1.1   (use "minor" for 0.2.0, "major" for 1.0.0)
git push --follow-tags
```

Pushing the tag starts the **Release** workflow. Watch it in the **Actions** tab; it takes about
5–10 minutes. It will:

1. Set up Node.js and Python on a Windows runner.
2. Install dependencies and run a syntax check.
3. Build the app, **VMP-sign** it with your EVS account, and package the installer.
4. Create a **GitHub Release** named after the version and attach the installer.

If it fails, click the failed run to read the log. The usual cause is a missing or misspelled secret.

> Your very first release: the version in `package.json` is already `0.1.0`, so you can publish it
> without bumping: `git tag v0.1.0` then `git push origin v0.1.0`.

---

## 8. Download and install your app

1. Open your repository on GitHub → **Releases** (right sidebar) → the newest release.
2. Under **Assets**, download **`Unisono-Setup-0.1.x.exe`**.
3. Run it. Windows **SmartScreen** will warn you because the app isn't code-signed with a paid
   certificate: click **More info → Run anyway**. That's expected for personal apps.
4. Pick an install folder; it adds Start menu and desktop shortcuts.
5. Open **Unisono**, log in to each service once, and you're done.

To update later: publish a new version (step 7.2), download the new installer, and run it over the old
one. Your logins and settings are kept.

---

## 9. Troubleshooting

**"Playback of protected content is not enabled" / Spotify or Apple Music won't play**
Widevine isn't ready or the VMP signature is missing. Wait a minute after the first launch and press
`Ctrl+R`. If it still fails, check that the build log says `VMP signature OK` (step 5).

**Google says "This browser or app may not be secure" when logging into YouTube Music**
Google sometimes blocks sign-in from embedded browsers. Unisono already presents itself as regular
Chrome, which usually works. If it doesn't: try again later, or sign in using the
**"Sign in"** button on the YouTube Music page itself rather than a pop-up.

**Media keys don't work**
Another app (Spotify desktop, a game launcher, etc.) may have claimed them. Close it and restart
Unisono.

**Next/previous does nothing on one service**
Unisono uses each site's standard media controls (the same ones Windows uses). If a site changes,
update the fallback button selectors in `src/preload-service.js` (`FALLBACK_SELECTORS`).

**Where are my settings and logins stored?**
`%APPDATA%\Unisono`. Delete that folder to fully reset the app (you'll need to log in again).

**`npm install` fails downloading Electron**
It downloads from `github.com/castlabs/electron-releases`. Check your connection or firewall and run it
again.

---

## 10. How it works

```
┌──────────────────────── Unisono window ────────────────────────┐
│  Control bar (src/ui)  tabs · now playing · ⏮ ⏯ ⏭               │
├────────────────────────────────────────────────────────────────┤
│  Spotify view │ Apple Music view │ YouTube Music view           │
│  (only the selected one is visible; all three keep running)    │
└────────────────────────────────────────────────────────────────┘
        ▲ state every second            │ commands
        │                               ▼
             src/main.js (main process)
   media keys · tray · taskbar buttons · settings · "one at a time"
```

| File | What it does |
| --- | --- |
| `src/main.js` | Creates the window, the three service views and the tray; handles media keys and shortcuts; polls each service's state every second and pauses the others when one starts playing. |
| `src/preload-service.js` | Runs inside each music site before the site's own code. It records the site's media-control handlers and tracks its audio elements, then exposes `window.__unisono` (`state`, `toggle`, `next`, …) to the main process. |
| `src/preload-ui.js` | Safe bridge between the control bar and the main process. |
| `src/ui/` | The control bar: `index.html`, `styles.css`, `renderer.js`. |
| `build/vmp-sign.js` | After packaging, VMP-signs the app with castLabs EVS. |
| `.github/workflows/release.yml` | Builds, signs and publishes the installer when you push a `v*` tag. |
| `.github/workflows/check.yml` | Quick syntax check on every push. |
| `assets/` | App icon, tray icon, taskbar button icons. |

Key choices:

- **castLabs Electron** (`package.json → devDependencies.electron`) instead of normal Electron, because
  it can play DRM-protected audio. Update it by changing the version tag there; see
  [their releases](https://github.com/castlabs/electron-releases/releases). If you update it, update
  `build.electronVersion` too.
- **One shared, persistent session** (`persist:unisono`) so Google, Apple and Spotify logins survive restarts.
- **Media Session handlers** are used for control instead of clicking buttons, because every service
  registers them for Windows' own media overlay. They change far less often than page layouts.

---

## 11. Ideas for later

- **Mini-player**: a small always-on-top window with just the control bar.
- **Global shortcuts** beyond media keys (e.g. `Ctrl+Alt+Space` for play/pause).
- **Volume per service** and a shared volume slider.
- **Auto-update** using `electron-updater` and your GitHub Releases.
- **Unified search**: a search box that opens the same query in all three services. Each service's
  search page has a predictable URL, so this is doable without any APIs.
- **Discord Rich Presence** showing what's playing.
