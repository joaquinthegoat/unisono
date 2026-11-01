// Preload for the three music-service views (Spotify, Apple Music, YouTube Music).
//
// It installs a tiny "hook" into each site's own JavaScript world BEFORE the site's
// scripts run. The hook does two things:
//   1. Remembers the Media Session action handlers the site registers
//      (play, pause, nexttrack, previoustrack). These are the same handlers Windows
//      uses for its media overlay, so calling them is the most reliable way to
//      control each player without depending on fragile button selectors.
//   2. Keeps track of every <audio>/<video> element the site plays, so we can tell
//      whether music is actually playing, even when the element isn't in the page.
//
// The main process then reads state and sends commands through window.__unisono.

const { contextBridge, webFrame } = require('electron');

function installHook() {
  if (window.__unisono) return;

  const handlers = {};
  const mediaEls = new Set();

  // 1. Capture Media Session handlers.
  try {
    const ms = navigator.mediaSession;
    if (ms && typeof ms.setActionHandler === 'function') {
      const original = ms.setActionHandler.bind(ms);
      ms.setActionHandler = function (action, handler) {
        handlers[action] = handler || null;
        return original(action, handler);
      };
    }
  } catch (_) { /* ignore */ }

  // 2. Track media elements, including ones never attached to the DOM.
  try {
    const originalPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      mediaEls.add(this);
      return originalPlay.apply(this, arguments);
    };
  } catch (_) { /* ignore */ }

  function allMedia() {
    document.querySelectorAll('audio, video').forEach((el) => mediaEls.add(el));
    return Array.from(mediaEls);
  }

  function isPlaying() {
    const audible = allMedia().some((el) => !el.paused && !el.ended && el.readyState > 2);
    if (audible) return true;
    try {
      return navigator.mediaSession && navigator.mediaSession.playbackState === 'playing';
    } catch (_) {
      return false;
    }
  }

  function call(action) {
    const h = handlers[action];
    if (typeof h === 'function') {
      try { h({ action }); return true; } catch (_) { /* fall through */ }
    }
    return false;
  }

  // Last-resort button clicks, used only if a site never registered a handler.
  // Sites change their markup over time, so these may need updating.
  const FALLBACK_SELECTORS = {
    nexttrack: [
      '[data-testid="control-button-skip-forward"]', // Spotify
      'ytmusic-player-bar .next-button',             // YouTube Music
      'button[aria-label="Next"]',
      'button[aria-label="Siguiente"]'
    ],
    previoustrack: [
      '[data-testid="control-button-skip-back"]',
      'ytmusic-player-bar .previous-button',
      'button[aria-label="Previous"]',
      'button[aria-label="Anterior"]'
    ]
  };

  function clickFallback(action) {
    for (const sel of FALLBACK_SELECTORS[action] || []) {
      const btn = document.querySelector(sel);
      if (btn) { btn.click(); return true; }
    }
    return false;
  }

  window.__unisono = {
    state() {
      let meta = null;
      try { meta = navigator.mediaSession && navigator.mediaSession.metadata; } catch (_) {}
      const art = meta && meta.artwork && meta.artwork.length
        ? meta.artwork[meta.artwork.length - 1].src
        : '';
      return {
        playing: isPlaying(),
        title: (meta && meta.title) || '',
        artist: (meta && meta.artist) || '',
        album: (meta && meta.album) || '',
        artwork: art
      };
    },
    play() {
      if (call('play')) return;
      const el = allMedia().find((m) => m.src || m.srcObject);
      if (el) el.play();
    },
    pause() {
      if (call('pause')) return;
      allMedia().forEach((m) => { if (!m.paused) m.pause(); });
    },
    toggle() {
      if (isPlaying()) this.pause(); else this.play();
    },
    next() {
      if (!call('nexttrack')) clickFallback('nexttrack');
    },
    previous() {
      if (!call('previoustrack')) clickFallback('previoustrack');
    }
  };
}

// contextBridge.executeInMainWorld runs synchronously, before the page's own
// scripts, and is not blocked by the site's Content Security Policy.
if (contextBridge && typeof contextBridge.executeInMainWorld === 'function') {
  contextBridge.executeInMainWorld({ func: installHook });
} else {
  // Older Electron fallback (runs slightly later, so the first handlers may be missed).
  webFrame.executeJavaScript(`(${installHook.toString()})()`);
}
