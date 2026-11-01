// Unisono — main process.
// One window, three official web players, one set of controls.

const {
  app,
  components,
  BrowserWindow,
  WebContentsView,
  Menu,
  Tray,
  globalShortcut,
  ipcMain,
  nativeImage,
  session,
  shell
} = require('electron');
const fs = require('fs');
const path = require('path');

const isDev = process.argv.includes('--dev');
const BAR_HEIGHT = 56; // height of the control bar at the top (px)
const ASSETS = path.join(__dirname, '..', 'assets');
const PARTITION = 'persist:unisono'; // one shared, persistent session (keeps you logged in)

const SERVICES = [
  { id: 'spotify', name: 'Spotify', url: 'https://open.spotify.com/', color: '#1DB954' },
  { id: 'apple', name: 'Apple Music', url: 'https://music.apple.com/', color: '#FA2D48' },
  { id: 'youtube', name: 'YouTube Music', url: 'https://music.youtube.com/', color: '#FF0033' }
];

// Pages allowed to open as pop-up windows (sign-in flows). Everything else opens in your browser.
const POPUP_HOSTS = [
  'accounts.google.com',
  'accounts.youtube.com',
  'accounts.spotify.com',
  'appleid.apple.com',
  'idmsa.apple.com',
  'authorize.music.apple.com',
  'www.facebook.com',
  'm.facebook.com'
];

// ---------------------------------------------------------------------------
// Chromium flags — must be set before the app is ready.
// We handle the keyboard media keys ourselves (see registerMediaKeys), so turn
// off Chromium's built-in handling to avoid every player reacting at once.
app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// A plain Chrome user agent: some sites refuse to load in "unsupported" browsers.
const CHROME_VERSION = process.versions.chrome;
const CHROME_MAJOR = CHROME_VERSION.split('.')[0];
const USER_AGENT =
  `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ` +
  `Chrome/${CHROME_VERSION} Safari/537.36`;
app.userAgentFallback = USER_AGENT;

// ---------------------------------------------------------------------------
// Settings (window size, last tab, preferences), stored as JSON in the user data folder.
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const DEFAULT_SETTINGS = {
  bounds: { width: 1280, height: 820 },
  maximized: false,
  activeTab: 'spotify',
  autoPauseOthers: true,
  closeToTray: true
};
let settings = { ...DEFAULT_SETTINGS };

function loadSettings() {
  try {
    settings = { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) };
  } catch (_) {
    settings = { ...DEFAULT_SETTINGS };
  }
}

let saveTimer = null;
function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2)); } catch (_) {}
  }, 300);
}

// ---------------------------------------------------------------------------
let win = null;
let tray = null;
let quitting = false;
const views = {};       // id -> WebContentsView
const state = {};       // id -> { playing, title, artist, album, artwork }
let nowPlayingId = null; // the service that most recently played audio

function serviceById(id) {
  return SERVICES.find((s) => s.id === id);
}

function createWindow() {
  win = new BrowserWindow({
    ...settings.bounds,
    minWidth: 820,
    minHeight: 520,
    show: false,
    backgroundColor: '#0e0f13',
    title: 'Unisono',
    icon: path.join(ASSETS, 'icon.png'),
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0e0f13', symbolColor: '#e8e8ee', height: BAR_HEIGHT },
    webPreferences: {
      preload: path.join(__dirname, 'preload-ui.js'),
      contextIsolation: true,
      sandbox: true
    }
  });

  if (settings.maximized) win.maximize();
  win.loadFile(path.join(__dirname, 'ui', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.webContents.on('before-input-event', (event, input) => handleAppShortcut(event, input));

  for (const svc of SERVICES) createServiceView(svc);
  showTab(settings.activeTab);

  win.on('resize', () => { layoutViews(); rememberBounds(); });
  win.on('move', rememberBounds);
  win.on('maximize', () => { settings.maximized = true; saveSettings(); layoutViews(); });
  win.on('unmaximize', () => { settings.maximized = false; saveSettings(); layoutViews(); });

  // Closing the window hides it to the tray so the music keeps playing.
  win.on('close', (e) => {
    if (!quitting && settings.closeToTray) {
      e.preventDefault();
      win.hide();
    }
  });
}

function rememberBounds() {
  if (!win || win.isMaximized() || win.isMinimized()) return;
  settings.bounds = win.getBounds();
  saveSettings();
}

function createServiceView(svc) {
  const view = new WebContentsView({
    webPreferences: {
      partition: PARTITION,
      preload: path.join(__dirname, 'preload-service.js'),
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false // keep playing smoothly while hidden
    }
  });
  view.setBackgroundColor('#0e0f13');
  view.setVisible(false);
  win.contentView.addChildView(view);
  views[svc.id] = view;
  state[svc.id] = { playing: false, title: '', artist: '', album: '', artwork: '' };

  const wc = view.webContents;
  wc.setUserAgent(USER_AGENT);
  wc.loadURL(svc.url);

  // Sign-in pop-ups stay inside the app (same session); other links open in your browser.
  wc.setWindowOpenHandler(({ url }) => {
    let host = '';
    try { host = new URL(url).hostname; } catch (_) {}
    if (POPUP_HOSTS.includes(host)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 520,
          height: 720,
          parent: win,
          autoHideMenuBar: true,
          webPreferences: { partition: PARTITION }
        }
      };
    }
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });

  wc.on('page-title-updated', () => sendState());
  wc.on('did-finish-load', () => sendState());
  wc.on('before-input-event', (event, input) => handleAppShortcut(event, input));
}

function layoutViews() {
  if (!win) return;
  const [width, height] = win.getContentSize();
  const bounds = { x: 0, y: BAR_HEIGHT, width, height: Math.max(0, height - BAR_HEIGHT) };
  for (const id of Object.keys(views)) views[id].setBounds(bounds);
}

function showTab(id) {
  if (!views[id]) id = SERVICES[0].id;
  settings.activeTab = id;
  saveSettings();
  for (const [vid, view] of Object.entries(views)) view.setVisible(vid === id);
  layoutViews();
  views[id].webContents.focus();
  sendState();
}

function cycleTab(step) {
  const i = SERVICES.findIndex((s) => s.id === settings.activeTab);
  showTab(SERVICES[(i + step + SERVICES.length) % SERVICES.length].id);
}

// Ctrl+1/2/3 switch services, Ctrl+Tab cycles, Ctrl+R reloads — even when focus is inside a player.
function handleAppShortcut(event, input) {
  if (input.type !== 'keyDown' || !input.control) return;
  const n = Number(input.key);
  if (n >= 1 && n <= SERVICES.length) {
    event.preventDefault();
    showTab(SERVICES[n - 1].id);
  } else if (input.key === 'Tab') {
    event.preventDefault();
    cycleTab(input.shift ? -1 : 1);
  } else if (input.key.toLowerCase() === 'r' && !input.shift) {
    event.preventDefault();
    views[settings.activeTab].webContents.reload();
  }
}

// ---------------------------------------------------------------------------
// Playback control.

function runInService(id, code) {
  const view = views[id];
  if (!view || view.webContents.isDestroyed()) return Promise.resolve(null);
  return view.webContents
    .executeJavaScript(`window.__unisono ? (${code}) : null`, true)
    .catch(() => null);
}

// Which service should a play/pause/next command go to?
function controlTarget() {
  return nowPlayingId || settings.activeTab;
}

function control(action, target = controlTarget()) {
  const fn = { toggle: 'toggle', play: 'play', pause: 'pause', next: 'next', previous: 'previous' }[action];
  if (!fn) return;
  if (action === 'toggle' || action === 'play') nowPlayingId = target;
  runInService(target, `window.__unisono.${fn}()`).then(() => setTimeout(pollState, 250));
}

async function pollState() {
  const results = await Promise.all(
    SERVICES.map((s) => runInService(s.id, 'window.__unisono.state()'))
  );

  SERVICES.forEach((svc, i) => {
    const next = results[i];
    if (!next) return;
    const prev = state[svc.id];
    const startedPlaying = next.playing && !prev.playing;
    state[svc.id] = next;

    if (startedPlaying) {
      nowPlayingId = svc.id;
      // Only one player at a time: pause the others.
      if (settings.autoPauseOthers) {
        for (const other of SERVICES) {
          if (other.id !== svc.id && state[other.id].playing) control('pause', other.id);
        }
      }
    }
  });

  sendState();
}

function sendState() {
  if (!win || win.isDestroyed()) return;
  const playing = nowPlayingId ? state[nowPlayingId] : null;
  const payload = {
    services: SERVICES.map((s) => ({ ...s, ...state[s.id] })),
    activeTab: settings.activeTab,
    nowPlayingId,
    nowPlaying: playing ? { ...playing, service: serviceById(nowPlayingId).name } : null,
    settings: { autoPauseOthers: settings.autoPauseOthers, closeToTray: settings.closeToTray }
  };
  win.webContents.send('state', payload);
  updateTaskbar(payload);
  updateTray(payload);
}

// ---------------------------------------------------------------------------
// Windows taskbar thumbnail buttons, tray icon and keyboard media keys.

const icon = (name) => nativeImage.createFromPath(path.join(ASSETS, name));
let lastThumbarPlaying = null;

function updateTaskbar(payload) {
  if (process.platform !== 'win32' || !win) return;
  const playing = Boolean(payload.nowPlaying && payload.nowPlaying.playing);
  const np = payload.nowPlaying;
  win.setTitle(np && np.title ? `${np.title} — ${np.artist} · Unisono` : 'Unisono');
  if (playing === lastThumbarPlaying) return;
  lastThumbarPlaying = playing;
  win.setThumbarButtons([
    { tooltip: 'Previous', icon: icon('thumb-prev.png'), click: () => control('previous') },
    {
      tooltip: playing ? 'Pause' : 'Play',
      icon: icon(playing ? 'thumb-pause.png' : 'thumb-play.png'),
      click: () => control('toggle')
    },
    { tooltip: 'Next', icon: icon('thumb-next.png'), click: () => control('next') }
  ]);
}

let lastTrayKey = '';
function updateTray(payload) {
  if (!tray) return;
  const np = payload.nowPlaying;
  const playing = Boolean(np && np.playing);
  const label = np && np.title ? `${np.title} — ${np.artist}` : 'Nothing playing';
  const key = `${label}|${playing}`;
  if (key === lastTrayKey) return;
  lastTrayKey = key;
  tray.setToolTip(np && np.title ? `Unisono · ${label}` : 'Unisono');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: label.length > 60 ? label.slice(0, 57) + '…' : label, enabled: false },
    { type: 'separator' },
    { label: playing ? 'Pause' : 'Play', click: () => control('toggle') },
    { label: 'Next', click: () => control('next') },
    { label: 'Previous', click: () => control('previous') },
    { type: 'separator' },
    { label: 'Show Unisono', click: showWindow },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } }
  ]));
}

function createTray() {
  tray = new Tray(icon('tray.png'));
  tray.on('click', showWindow);
  lastTrayKey = '';
  updateTray({ nowPlaying: null });
}

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function registerMediaKeys() {
  const keys = {
    MediaPlayPause: () => control('toggle'),
    MediaNextTrack: () => control('next'),
    MediaPreviousTrack: () => control('previous'),
    MediaStop: () => control('pause')
  };
  for (const [accelerator, fn] of Object.entries(keys)) {
    try {
      if (!globalShortcut.register(accelerator, fn)) {
        console.warn(`Could not register ${accelerator} (another app may be using it).`);
      }
    } catch (err) {
      console.warn(`Could not register ${accelerator}:`, err.message);
    }
  }
}

// Hidden menu (press Alt to show). Its shortcuts work everywhere in the window.
function buildMenu() {
  const template = [
    {
      label: 'Unisono',
      submenu: [
        { label: 'Show in tray when closed', type: 'checkbox', checked: settings.closeToTray,
          click: (item) => { settings.closeToTray = item.checked; saveSettings(); sendState(); } },
        { label: 'Pause other services when one plays', type: 'checkbox', checked: settings.autoPauseOthers,
          click: (item) => { settings.autoPauseOthers = item.checked; saveSettings(); sendState(); } },
        { type: 'separator' },
        { label: 'Quit', accelerator: 'Ctrl+Q', click: () => { quitting = true; app.quit(); } }
      ]
    },
    {
      label: 'View',
      submenu: [
        ...SERVICES.map((s, i) => ({
          label: s.name, accelerator: `Ctrl+${i + 1}`, click: () => showTab(s.id)
        })),
        { type: 'separator' },
        { label: 'Back', accelerator: 'Alt+Left', click: () => goBack() },
        { label: 'Reload current service', click: () => views[settings.activeTab].webContents.reload() },
        { label: 'Developer tools (current service)', accelerator: 'Ctrl+Shift+I',
          click: () => views[settings.activeTab].webContents.openDevTools({ mode: 'detach' }) }
      ]
    },
    {
      label: 'Playback',
      submenu: [
        { label: 'Play / Pause', click: () => control('toggle') },
        { label: 'Next', click: () => control('next') },
        { label: 'Previous', click: () => control('previous') }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function goBack() {
  const nav = views[settings.activeTab].webContents.navigationHistory;
  if (nav && nav.canGoBack()) nav.goBack();
}

// Make Google's sign-in page see a regular Chrome browser (it blocks "embedded" browsers).
function patchClientHints() {
  const brands =
    `"Chromium";v="${CHROME_MAJOR}", "Google Chrome";v="${CHROME_MAJOR}", "Not.A/Brand";v="99"`;
  session.fromPartition(PARTITION).webRequest.onBeforeSendHeaders(
    { urls: ['https://*.google.com/*', 'https://*.youtube.com/*'] },
    (details, callback) => {
      const headers = details.requestHeaders;
      for (const key of Object.keys(headers)) {
        if (key.toLowerCase() === 'sec-ch-ua') headers[key] = brands;
      }
      callback({ requestHeaders: headers });
    }
  );
}

// ---------------------------------------------------------------------------
// IPC from the control bar.

ipcMain.on('select-tab', (_e, id) => showTab(id));
ipcMain.on('control', (_e, action) => control(action));
ipcMain.on('go-back', () => goBack());
ipcMain.on('reload', () => views[settings.activeTab].webContents.reload());
ipcMain.on('ready', () => sendState());

// ---------------------------------------------------------------------------
// Startup.

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);

  app.whenReady().then(async () => {
    loadSettings();

    // Castlabs Electron: wait until the Widevine DRM module is installed,
    // otherwise Spotify and Apple Music cannot play anything.
    if (components && typeof components.whenReady === 'function') {
      try {
        await components.whenReady();
        if (isDev) console.log('Widevine components:', components.status());
      } catch (err) {
        console.error('Widevine failed to install:', err);
      }
    } else {
      console.warn('This is not Castlabs Electron — DRM playback will not work.');
    }

    session.fromPartition(PARTITION).setUserAgent(USER_AGENT);
    patchClientHints();
    buildMenu();
    createWindow();
    createTray();
    registerMediaKeys();
    setInterval(pollState, 1000);
  });

  app.on('before-quit', () => { quitting = true; });
  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.on('window-all-closed', () => app.quit());
}
