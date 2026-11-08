window.__ModuleLoader__.load({
  id: '@local/dsh-shorekeeper-startup',
  factory(require) {
    const React = require('react');
    const ReactDOM = require('react-dom');
    const h = React.createElement;
    const { useCallback, useEffect, useRef, useState } = React;

    /** The startup film: the Shorekeeper opening her eyes, base64-embedded. */
    const VIDEO_URI = '__DSHSK_VIDEO__';
    /** A seamless 3.3 s background loop built from the same film. */
    const LOOP_URI = '__DSHSK_LOOP__';
    /** Line-art polylines traced from the pre-eye-open frame, with draw timing. */
    const SKETCH_PATHS = __DSHSK_PATHS__;
    /** Black Shores crest pieces, ordered right to left for assembly. */
    const LOGO_PARTS = __DSHSK_LOGO_PARTS__;
    const LOGO_VIEWBOX = '0 0 996.38452 822';

    /** Playback speed of the source clip. */
    const RATE = 1.25;
    /** Video time of the hard cut from closed eyes to the awakened close-up. */
    const CUT_AT = 3.83;
    /** Video time where the outro fade begins. */
    const OUT_AT = 9.2;

    const NS = 'shorekeeper';
    const SETTINGS_KEY = 'dsh-shorekeeper.theme.v2';
    const DB_NAME = 'dsh-shorekeeper';
    const DOC_CLASS = 'dshsk-theme-on';

    const DEFAULT_SETTINGS = {
      enabled: true,
      source: 'default',
      mediaName: '',
      dim: 0.38,
      blur: 14,
      uiAlpha: 0.3,
      splash: true,
    };

    // ---------------------------------------------------------------- settings

    function readSettings() {
      try {
        const raw = window.localStorage.getItem(SETTINGS_KEY);
        if (!raw) return { ...DEFAULT_SETTINGS };
        const parsed = JSON.parse(raw);
        return { ...DEFAULT_SETTINGS, ...(parsed && typeof parsed === 'object' ? parsed : {}) };
      } catch (error) {
        return { ...DEFAULT_SETTINGS };
      }
    }

    let settings = readSettings();
    const listeners = new Set();

    function getSettings() { return settings; }
    function subscribeSettings(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
    function persist() {
      try { window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (error) { /* private mode */ }
    }
    function updateSettings(patch) {
      settings = { ...settings, ...patch };
      persist();
      syncVisuals();
      for (const listener of [...listeners]) {
        try { listener(); } catch (error) { /* a broken subscriber must not block others */ }
      }
    }

    // -------------------------------------------------------------- media (IDB)

    let mediaUrl = '';

    function openDb() {
      return new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return; }
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains('media')) request.result.createObjectStore('media');
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }

    async function readMedia() {
      const db = await openDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('media', 'readonly');
        const req = tx.objectStore('media').get('current');
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    }

    async function writeMedia(record) {
      const db = await openDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('media', 'readwrite');
        tx.objectStore('media').put(record, 'current');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }

    async function clearMedia() {
      const db = await openDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('media', 'readwrite');
        tx.objectStore('media').delete('current');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }

    function releaseMediaUrl() {
      if (mediaUrl) {
        try { URL.revokeObjectURL(mediaUrl); } catch (error) { /* ignore */ }
        mediaUrl = '';
      }
    }

    /** Validate and adopt a user file as the theme background. */
    async function adoptMedia(file) {
      if (!file) return null;
      const isImage = String(file.type || '').indexOf('image/') === 0;
      const isVideo = String(file.type || '').indexOf('video/') === 0;
      if (!isImage && !isVideo) return '只支持图片或视频文件。';
      if (file.size > 120 * 1024 * 1024) return '文件太大，请选择 120 MB 以内的素材。';
      try {
        await writeMedia({ blob: file, type: file.type, name: file.name });
      } catch (error) {
        return '无法保存这个文件（浏览器存储不可用）。';
      }
      releaseMediaUrl();
      try { mediaUrl = URL.createObjectURL(file); } catch (error) { return '无法读取这个文件。'; }
      updateSettings({ source: isImage ? 'image' : 'video', mediaName: file.name });
      return null;
    }

    async function useDefaultBackground() {
      releaseMediaUrl();
      updateSettings({ source: 'default', mediaName: '' });
      try { await clearMedia(); } catch (error) { /* ignore */ }
    }

    async function restoreStoredMedia() {
      if (settings.source === 'default') return;
      try {
        const record = await readMedia();
        if (!record || !record.blob) { updateSettings({ source: 'default', mediaName: '' }); return; }
        releaseMediaUrl();
        mediaUrl = URL.createObjectURL(record.blob);
        const isImage = String(record.type || '').indexOf('image/') === 0;
        updateSettings({ source: isImage ? 'image' : 'video', mediaName: record.name || '' });
      } catch (error) {
        updateSettings({ source: 'default', mediaName: '' });
      }
    }

    // --------------------------------------------------------------- backdrop

    let backdropHost = null;
    let backdropFrame = null;
    let backdropScrim = null;
    let backdropKey = '';

    function ensureBackdrop() {
      if (backdropHost && backdropHost.isConnected) return backdropHost;
      /* Mount outside #root: the shell hydrates its boot page from #root's
         single boot child, so a plugin-owned node there breaks the handoff. */
      const parent = document.body;
      if (!parent) return null;
      const host = document.createElement('div');
      host.className = 'dshsk-bg';
      host.setAttribute('aria-hidden', 'true');
      const frame = document.createElement('div');
      frame.className = 'dshsk-bg-frame';
      const scrim = document.createElement('div');
      scrim.className = 'dshsk-bg-scrim';
      const vignette = document.createElement('div');
      vignette.className = 'dshsk-bg-vignette';
      host.appendChild(frame);
      host.appendChild(scrim);
      host.appendChild(vignette);
      parent.insertBefore(host, parent.firstChild);
      backdropHost = host;
      backdropFrame = frame;
      backdropScrim = scrim;
      return host;
    }

    function playVideo(video) {
      const attempt = video.play();
      if (attempt && typeof attempt.catch === 'function') attempt.catch(() => { /* autoplay blocked */ });
    }

    function buildDefaultMedia(frame) {
      const video = document.createElement('video');
      video.className = 'dshsk-bg-media';
      video.src = LOOP_URI;
      video.muted = true;
      video.autoplay = true;
      video.loop = true;
      video.playsInline = true;
      video.setAttribute('aria-hidden', 'true');
      frame.appendChild(video);
      playVideo(video);
    }

    function renderBackdrop() {      if (!settings.enabled) {
        if (backdropHost) backdropHost.style.display = 'none';
        return;
      }
      const host = ensureBackdrop();
      if (!host) return;
      host.style.display = '';
      const key = settings.source + '|' + mediaUrl;
      if (key !== backdropKey) {
        backdropKey = key;
        backdropFrame.textContent = '';
        if (settings.source === 'image' && mediaUrl) {
          const image = document.createElement('img');
          image.className = 'dshsk-bg-media';
          image.src = mediaUrl;
          image.alt = '';
          backdropFrame.appendChild(image);
        } else if (settings.source === 'video' && mediaUrl) {
          const video = document.createElement('video');
          video.className = 'dshsk-bg-media';
          video.src = mediaUrl;
          video.muted = true;
          video.loop = true;
          video.autoplay = true;
          video.playsInline = true;
          backdropFrame.appendChild(video);
          playVideo(video);
        } else {
          buildDefaultMedia(backdropFrame);
        }
      }
      const blur = Math.max(0, Math.min(30, Number(settings.blur) || 0));
      const dim = Math.max(0, Math.min(0.9, Number(settings.dim) || 0));
      backdropFrame.style.filter = 'blur(' + blur + 'px) saturate(1.05) brightness(.92)';
      backdropScrim.style.opacity = String(dim);
    }

    // -------------------------------------------------------------- boot veil

    /* The app paints before the splash slot can mount; this veil covers that
       gap (and the shell's boot card) so no chat frame flashes through. */
    let bootVeil = null;
    let bootVeilTimer = 0;

    function showBootVeil() {
      if (bootVeil || !document.body) return;
      const veil = document.createElement('div');
      veil.className = 'dshsk-boot-veil';
      veil.setAttribute('aria-hidden', 'true');
      document.body.appendChild(veil);
      bootVeil = veil;
      bootVeilTimer = window.setTimeout(hideBootVeil, 15000);
    }

    function hideBootVeil() {
      if (bootVeilTimer) { window.clearTimeout(bootVeilTimer); bootVeilTimer = 0; }
      if (!bootVeil) return;
      const node = bootVeil;
      bootVeil = null;
      node.classList.add('is-out');
      window.setTimeout(() => { if (node.parentNode) node.parentNode.removeChild(node); }, 480);
    }

    // ---------------------------------------------------------- theme tokens

    let themeService = null;
    let tokenDispose = null;

    function applyTokens() {
      if (!themeService) return;
      if (tokenDispose) { tokenDispose(); tokenDispose = null; }
      if (!settings.enabled) return;
      const a = Math.max(0.05, Math.min(0.95, Number(settings.uiAlpha) || 0.55));
      const dark = (value) => 'rgba(8,12,20,' + Math.min(1, value).toFixed(3) + ')';
      const light = (value) => 'rgba(248,251,255,' + Math.min(1, value).toFixed(3) + ')';
      tokenDispose = themeService.overrideTokens('dsh-shorekeeper-theme', {
        '--dsw-alias-bg-base': { light: light(a + 0.06), dark: dark(a) },
        '--dsw-specific-sidebar-fill': { light: light(a + 0.08), dark: dark(a + 0.05) },
        '--dsw-specific-input-major': { light: light(a + 0.12), dark: dark(a + 0.08) },
        '--dsw-alias-bg-layer-1': { light: light(a + 0.2), dark: dark(a + 0.15) },
      });
    }

    function syncDocument() {
      const html = document.documentElement;
      if (settings.enabled) html.classList.add(DOC_CLASS);
      else html.classList.remove(DOC_CLASS);
    }

    function syncVisuals() {
      syncDocument();
      applyTokens();
      renderBackdrop();
    }

    // ---------------------------------------------------------------- splash

    let splashNonce = 0;
    const splashListeners = new Set();

    function getSplashNonce() { return splashNonce; }
    function subscribeSplash(listener) {
      splashListeners.add(listener);
      return () => splashListeners.delete(listener);
    }
    function replaySplash() {
      splashNonce += 1;
      for (const listener of [...splashListeners]) {
        try { listener(); } catch (error) { /* ignore */ }
      }
    }

    const SPLASH_CSS = `.dshsk-root {
  position: fixed;
  inset: 0;
  overflow: hidden;
  background: #02040a;
  color: #eaf6ff;
  font-family: Montserrat, "Segoe UI Variable Display", "Segoe UI", "PingFang SC", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif;
  user-select: none;
  cursor: default;
  z-index: 2147483000;
  animation: dshsk-root-in 700ms ease both;
}
.dshsk-inner { position: absolute; inset: 0; transition: opacity 380ms ease; }
.dshsk-root[data-closing="true"] .dshsk-inner { opacity: 0; }
.dshsk-root[data-closing="true"] { pointer-events: none; }
.dshsk-root[data-closing="true"]:not([data-outro="true"]) {
  opacity: 0;
  transition: opacity 620ms ease;
}
.dshsk-dissolve { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; opacity: 0; }
.dshsk-root[data-outro="true"] .dshsk-dissolve { opacity: 1; }
.dshsk-root[data-outro="true"] { background: transparent; }
.dshsk-root[data-outro="true"] .dshsk-media,
.dshsk-root[data-outro="true"] .dshsk-sketch-wrap,
.dshsk-root[data-outro="true"] .dshsk-tint,
.dshsk-root[data-outro="true"] .dshsk-flash,
.dshsk-root[data-outro="true"] .dshsk-scan,
.dshsk-root[data-outro="true"] .dshsk-particles,
.dshsk-root[data-outro="true"] .dshsk-brackets { opacity: 0; transition: opacity 180ms ease; }

.dshsk-media { position: absolute; inset: 0; overflow: hidden; background: #02040a; }
.dshsk-video {
  position: absolute;
  inset: -2%;
  width: 104%;
  height: 104%;
  object-fit: cover;
  object-position: 62% 48%;
  filter: contrast(1.15) saturate(1.06) brightness(.98);
  transition: filter 1500ms ease;
  animation: dshsk-drift 11s cubic-bezier(.2,.4,.3,1) both;
  will-change: transform, filter;
}
.dshsk-root[data-phase="awake"] .dshsk-video { filter: contrast(1.12) saturate(1.08) brightness(1); }

.dshsk-sketch-wrap {
  position: absolute;
  inset: 0;
  opacity: 1;
  transform: scale(1);
  transition: opacity 620ms ease, transform 900ms ease;
}
.dshsk-root[data-phase="awake"] .dshsk-sketch-wrap { opacity: 0; transform: scale(1.025); pointer-events: none; }
.dshsk-sketch-bg {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(58% 62% at 63% 43%, rgba(26,74,124,.30), rgba(2,4,10,0) 72%),
    radial-gradient(120% 100% at 50% 110%, rgba(10,28,52,.46), rgba(2,4,10,0) 60%),
    #02040a;
}
.dshsk-sketch-bg::after {
  content: "";
  position: absolute;
  inset: 0;
  opacity: .45;
  background-image:
    radial-gradient(1px 1px at 12% 18%, rgba(190,235,255,.7), transparent 100%),
    radial-gradient(1px 1px at 73% 12%, rgba(190,235,255,.55), transparent 100%),
    radial-gradient(1px 1px at 38% 76%, rgba(190,235,255,.45), transparent 100%),
    radial-gradient(1.4px 1.4px at 86% 62%, rgba(190,235,255,.5), transparent 100%),
    radial-gradient(1px 1px at 58% 34%, rgba(190,235,255,.4), transparent 100%),
    radial-gradient(1px 1px at 22% 54%, rgba(190,235,255,.35), transparent 100%);
}
.dshsk-sketch {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  filter: drop-shadow(0 0 6px rgba(110,225,255,.55));
}
.dshsk-stroke {
  fill: none;
  stroke: url(#dshsk-stroke-grad);
  stroke-width: 1.15;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-dasharray: var(--len);
  stroke-dashoffset: var(--len);
  animation: dshsk-stroke var(--dur) linear var(--delay) both;
}
.dshsk-root[data-reduced="true"] .dshsk-stroke { animation: none; stroke-dashoffset: 0; }

.dshsk-tint {
  position: absolute;
  inset: 0;
  background:
    linear-gradient(90deg, rgba(1,3,8,.94) 0%, rgba(1,3,8,.86) 18%, rgba(1,3,8,.56) 42%, rgba(1,3,8,.12) 66%, rgba(1,3,8,0) 84%),
    radial-gradient(125% 100% at 72% 42%, rgba(1,3,8,0) 42%, rgba(1,3,8,.5) 100%),
    linear-gradient(0deg, rgba(1,3,8,.9) 0%, rgba(1,3,8,0) 30%);
}
.dshsk-tint::after {
  content: "";
  position: absolute;
  inset: 0;
  background: radial-gradient(70% 60% at 62% 46%, rgba(64,190,255,.10), transparent 70%);
  opacity: 0;
  transition: opacity 1800ms ease;
}
.dshsk-root[data-phase="awake"] .dshsk-tint::after { opacity: 1; }

.dshsk-flash {
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: 0;
  background: radial-gradient(80% 70% at 58% 46%, rgba(226,250,255,.96), rgba(120,220,255,.38) 42%, rgba(30,80,140,0) 74%);
  mix-blend-mode: screen;
}
.dshsk-root[data-phase="awake"] .dshsk-flash { animation: dshsk-flash 900ms cubic-bezier(.1,.6,.2,1) both; }

.dshsk-scan {
  position: absolute;
  left: 0;
  right: 0;
  top: -6%;
  height: 1px;
  pointer-events: none;
  opacity: 0;
  background: linear-gradient(90deg, rgba(120,225,255,0) 0%, rgba(180,242,255,.95) 35%, rgba(120,225,255,.9) 62%, rgba(120,225,255,0) 100%);
  box-shadow: 0 0 18px 3px rgba(90,210,255,.55);
}
.dshsk-root[data-phase="awake"] .dshsk-scan { animation: dshsk-scan 1900ms cubic-bezier(.25,.7,.25,1) 80ms both; }

.dshsk-particles { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; opacity: .9; }

.dshsk-brackets { position: absolute; inset: 26px; pointer-events: none; }
.dshsk-brackets i {
  position: absolute;
  width: 18px;
  height: 18px;
  border: 0 solid rgba(150,228,255,.32);
  opacity: 0;
  animation: dshsk-bracket-in 900ms ease 700ms both;
}
.dshsk-brackets i:nth-child(1) { top: 0; left: 0; border-top-width: 1px; border-left-width: 1px; }
.dshsk-brackets i:nth-child(2) { top: 0; right: 0; border-top-width: 1px; border-right-width: 1px; }
.dshsk-brackets i:nth-child(3) { bottom: 0; left: 0; border-bottom-width: 1px; border-left-width: 1px; }
.dshsk-brackets i:nth-child(4) { bottom: 0; right: 0; border-bottom-width: 1px; border-right-width: 1px; }

.dshsk-head {
  display: flex;
  align-items: center;
  gap: 18px;
  margin-bottom: 74px;
}
.dshsk-emblem { width: 96px; height: 80px; display: block; filter: drop-shadow(0 0 16px rgba(90,205,255,.45)); }
.dshsk-emblem svg { width: 100%; height: 100%; display: block; }
.dshsk-logo-part { opacity: 0; transform: translateX(110px) scale(.82); }
.dshsk-root[data-phase="awake"] .dshsk-logo-part {
  animation: dshsk-part-in 700ms cubic-bezier(.16,1,.3,1) both;
  animation-delay: calc(1450ms + var(--i) * 42ms);
}
.dshsk-faction {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.dshsk-faction-cn {
  display: flex;
  font-family: "PingFang SC", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif;
  font-size: 34px;
  letter-spacing: .26em;
  color: rgba(234,248,255,.96);
  text-shadow: 0 0 20px rgba(90,200,255,.4);
}
.dshsk-faction-char {
  display: inline-block;
  opacity: 0;
  transform: translateX(96px);
  filter: blur(4px);
}
.dshsk-root[data-phase="awake"] .dshsk-faction-char {
  animation: dshsk-push-in 340ms cubic-bezier(.18,.9,.32,1) both;
  animation-delay: calc(2780ms + var(--i) * 110ms);
}
.dshsk-faction-en { font-size: 11.5px; letter-spacing: .34em; color: rgba(150,215,245,.6); opacity: 0; }
.dshsk-root[data-phase="awake"] .dshsk-faction-en {
  animation: dshsk-fade-in 620ms ease 3120ms both;
}
.dshsk-copy {
  position: absolute;
  left: clamp(30px, 7vw, 132px);
  right: 6vw;
  bottom: clamp(110px, 21vh, 200px);
  max-width: 820px;
}
.dshsk-brand {
  margin: 0;
  font-size: clamp(58px, 7.4vw, 110px);
  font-weight: 500;
  line-height: .94;
  letter-spacing: -.03em;
  background-image: linear-gradient(270deg, #eafcff 0%, #9fe8ff 34%, #4f8cff 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  filter: drop-shadow(0 0 34px rgba(90,200,255,.3));
  opacity: 0;
  animation: dshsk-rise-in 1200ms cubic-bezier(.16,1,.3,1) 780ms both;
}
.dshsk-lines { position: relative; margin-top: clamp(22px, 3.4vh, 34px); height: 92px; }
.dshsk-awake {
  position: absolute;
  left: 0;
  top: 0;
  font-family: "PingFang SC", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif;
  font-size: clamp(22px, 2vw, 30px);
  letter-spacing: .16em;
  background-image: linear-gradient(270deg, #dff7ff 0%, #8fe9ff 40%, #5a8dff 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  opacity: 0;
  animation: dshsk-rise-in 1000ms cubic-bezier(.16,1,.3,1) 1080ms both;
  filter: drop-shadow(0 0 22px rgba(90,200,255,.28));
}
.dshsk-root[data-phase="awake"] .dshsk-awake {
  animation: dshsk-sink-out 640ms cubic-bezier(.4,0,.7,1) 120ms both;
}
.dshsk-welcome {
  position: absolute;
  left: 0;
  top: 0;
  white-space: nowrap;
  font-family: "PingFang SC", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif;
  font-size: clamp(24px, 2.2vw, 34px);
  letter-spacing: .1em;
  opacity: 0;
  filter: drop-shadow(0 0 24px rgba(90,200,255,.32));
}
.dshsk-root[data-phase="awake"] .dshsk-welcome { opacity: 1; }
.dshsk-char {
  display: inline-block;
  opacity: 0;
  transform: translateX(70px);
  filter: blur(4px);
  will-change: transform, opacity;
}
.dshsk-root[data-phase="awake"] .dshsk-char {
  animation: dshsk-push-in 300ms cubic-bezier(.18,.9,.32,1) both;
  animation-delay: calc(300ms + var(--i) * 62ms);
}
.dshsk-sub {
  position: absolute;
  left: 0;
  top: 58px;
  font-size: 9.5px;
  letter-spacing: .4em;
  color: rgba(155,216,244,.55);
  opacity: 0;
}
.dshsk-root[data-phase="awake"] .dshsk-sub {
  animation: dshsk-fade-in 700ms ease 1180ms both;
}

.dshsk-foot {
  position: absolute;
  left: clamp(30px, 4.6vw, 68px);
  right: clamp(30px, 4.6vw, 68px);
  bottom: clamp(22px, 3.4vh, 36px);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  font-size: 9.5px;
  letter-spacing: .28em;
  color: rgba(154,204,230,.52);
  opacity: 0;
  animation: dshsk-fade-in 1100ms ease 1250ms both;
}
.dshsk-meta b { font-weight: 500; color: rgba(196,232,250,.78); letter-spacing: .22em; }
.dshsk-skip {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  padding: 7px 4px;
  border: 0;
  background: none;
  font: inherit;
  letter-spacing: .22em;
  color: rgba(176,224,248,.66);
  cursor: pointer;
  pointer-events: auto;
  transition: color 220ms ease;
}
.dshsk-skip:hover, .dshsk-skip:focus-visible { color: #eafaff; }
.dshsk-skip:focus-visible { outline: 1px solid rgba(140,225,255,.6); outline-offset: 3px; }
.dshsk-key {
  display: inline-block;
  padding: 3px 7px;
  font-size: 9px;
  letter-spacing: .16em;
  color: rgba(214,244,255,.9);
  border: 1px solid rgba(150,225,255,.32);
  border-radius: 4px;
  background: rgba(110,205,255,.08);
}
.dshsk-skip:hover .dshsk-key { border-color: rgba(170,235,255,.62); background: rgba(110,205,255,.16); }
.dshsk-foot-right { display: flex; align-items: center; gap: 8px; }
.dshsk-dot {
  width: 5px; height: 5px; border-radius: 50%;
  background: #7fe3ff;
  box-shadow: 0 0 10px 1px rgba(127,227,255,.7);
  animation: dshsk-pulse 2.4s ease-in-out infinite;
}

.dshsk-progress {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 1px;
  background: rgba(120,205,255,.12);
  overflow: hidden;
}
.dshsk-progress i {
  display: block;
  height: 100%;
  width: 100%;
  transform: scaleX(0);
  transform-origin: 0 50%;
  background: linear-gradient(90deg, rgba(70,190,255,.35) 0%, #8fe9ff 78%, #eafcff 100%);
  box-shadow: 0 0 10px 1px rgba(110,220,255,.55);
}

@media (max-width: 900px) {
  .dshsk-copy { bottom: 23vh; }
  .dshsk-brand { font-size: clamp(44px, 9vw, 68px); }
  .dshsk-head { top: 24px; left: 24px; }
  .dshsk-foot { left: 24px; right: 24px; }
  .dshsk-faction-en, .dshsk-meta { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .dshsk-video, .dshsk-sketch, .dshsk-stroke, .dshsk-flash, .dshsk-scan, .dshsk-brackets i,
  .dshsk-brand, .dshsk-awake, .dshsk-welcome, .dshsk-char, .dshsk-sub, .dshsk-foot,
  .dshsk-logo-part, .dshsk-sketch-wrap, .dshsk-root,
  .dshsk-brand, .dshsk-awake, .dshsk-welcome, .dshsk-char, .dshsk-sub, .dshsk-foot { opacity: 1; transform: none; filter: none; }
  .dshsk-logo-part { opacity: 1; transform: none; }
  .dshsk-faction { opacity: 1; transform: none; }
  .dshsk-stroke { stroke-dashoffset: 0; }
}

@keyframes dshsk-root-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes dshsk-drift {
  from { transform: scale(1.055) translate3d(0, 0, 0); }
  to { transform: scale(1) translate3d(0, -1.1%, 0); }
}
@keyframes dshsk-stroke { from { stroke-dashoffset: var(--len); } to { stroke-dashoffset: 0; } }
@keyframes dshsk-flash {
  0% { opacity: 0; }
  10% { opacity: .92; }
  34% { opacity: .28; }
  60% { opacity: .10; }
  100% { opacity: 0; }
}
@keyframes dshsk-scan {
  0% { top: -6%; opacity: 0; }
  8% { opacity: .85; }
  86% { opacity: .5; }
  100% { top: 104%; opacity: 0; }
}
@keyframes dshsk-bracket-in { from { opacity: 0; transform: scale(1.12); } to { opacity: 1; transform: scale(1); } }
@keyframes dshsk-rise-in { from { opacity: 0; transform: translateY(34px); } to { opacity: 1; transform: none; } }
@keyframes dshsk-sink-out { from { opacity: 1; } to { opacity: 0; transform: translateY(26px); } }
@keyframes dshsk-fly-in { from { opacity: 0; transform: translateX(64px); } to { opacity: 1; transform: none; } }
@keyframes dshsk-push-in {
  0% { opacity: 0; transform: translateX(70px); filter: blur(4px); }
  45% { opacity: 1; }
  100% { opacity: 1; transform: translateX(0); filter: blur(0); }
}
@keyframes dshsk-fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes dshsk-part-in { from { opacity: 0; transform: translateX(110px) scale(.82); } to { opacity: 1; transform: none; } }
@keyframes dshsk-pulse { 0%, 100% { opacity: .45; } 50% { opacity: 1; } }
`;

    const PAGE_CSS = `
html.${DOC_CLASS}, html.${DOC_CLASS} body { background: #05080f !important; }
html.${DOC_CLASS} #root { position: relative; z-index: 1; background: transparent !important; }
.dshsk-bg { position: fixed; inset: 0; z-index: 0; overflow: hidden; pointer-events: none; background: #05080f; }
.dshsk-bg-frame { position: absolute; inset: -3%; width: 106%; height: 106%; will-change: filter; }
.dshsk-bg-media { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: 60% 42%; }
.dshsk-bg-scrim { position: absolute; inset: 0; background: #04070d; opacity: .45; }
.dshsk-bg-vignette {
  position: absolute; inset: 0;
  background:
    radial-gradient(120% 100% at 50% 40%, rgba(3,6,11,0) 40%, rgba(3,6,11,.55) 100%),
    linear-gradient(180deg, rgba(3,6,11,.45), rgba(3,6,11,0) 26%, rgba(3,6,11,0) 72%, rgba(3,6,11,.5));
}
.dshsk-boot-veil {
  position: fixed;
  inset: 0;
  z-index: 2147483001;
  background: #02040a;
  opacity: 1;
  transition: opacity 420ms ease;
}
.dshsk-boot-veil.is-out { opacity: 0; pointer-events: none; }

.dshsk-page {
  height: 100%;
  overflow: auto;
  padding: calc(var(--dsh-frame-top-clearance, 0px) + 30px) clamp(24px, 4vw, 56px) 80px;
  color: var(--dsw-alias-label-primary, #e9f2f8);
  font-family: Montserrat, "Segoe UI Variable Display", "Segoe UI", "PingFang SC", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif;
}
.dshsk-page-inner { max-width: 880px; margin: 0 auto; animation: dshsk-page-in 620ms cubic-bezier(.16,1,.3,1) both; }
.dshsk-hero { display: flex; align-items: center; gap: 18px; padding: 6px 0 26px; }
.dshsk-hero-mark { width: 56px; height: 46px; flex: none; color: #9fe8ff; filter: drop-shadow(0 0 18px rgba(90,200,255,.42)); }
.dshsk-hero-copy { flex: 1; min-width: 0; }
.dshsk-hero h1 { margin: 0; font-size: 22px; font-weight: 600; letter-spacing: .02em; }
.dshsk-hero p { margin: 7px 0 0; font-size: 10px; letter-spacing: .34em; color: var(--dsw-alias-label-secondary, #90a8b8); }
.dshsk-hero-actions { display: flex; align-items: center; gap: 10px; }

.dshsk-card {
  background: var(--dsw-alias-bg-layer-1, rgba(255,255,255,.05));
  border: 1px solid var(--dsw-alias-border-l1, rgba(255,255,255,.09));
  border-radius: 16px;
  padding: 20px 22px 18px;
  margin-bottom: 14px;
  box-shadow: 0 18px 46px rgba(0,0,0,.18);
}
.dshsk-card-head { margin-bottom: 14px; }
.dshsk-card h2 { margin: 0; font-size: 14px; font-weight: 600; letter-spacing: .04em; }
.dshsk-card p { margin: 6px 0 0; font-size: 11.5px; line-height: 1.6; color: var(--dsw-alias-label-tertiary, #8fa3b3); }

.dshsk-seg { display: inline-flex; padding: 3px; gap: 2px; border-radius: 10px; background: var(--dsw-alias-bg-layer-2, rgba(255,255,255,.06)); margin-bottom: 14px; }
.dshsk-seg button {
  appearance: none; border: 0; background: transparent; color: var(--dsw-alias-label-secondary, #a9bccb);
  font: inherit; font-size: 12px; letter-spacing: .06em; padding: 7px 15px; border-radius: 8px; cursor: pointer;
  transition: background 180ms ease, color 180ms ease;
}
.dshsk-seg button:hover { color: var(--dsw-alias-label-primary, #eef6fb); }
.dshsk-seg button[data-active="true"] { background: rgba(110,205,255,.16); color: #eafcff; box-shadow: inset 0 0 0 1px rgba(130,220,255,.28); }

.dshsk-drop {
  display: flex; align-items: center; gap: 16px; padding: 18px 20px;
  border: 1px dashed rgba(140,210,245,.35); border-radius: 12px; cursor: pointer;
  background: linear-gradient(120deg, rgba(90,190,255,.06), rgba(90,190,255,0) 60%);
  transition: border-color 180ms ease, background 180ms ease, box-shadow 180ms ease;
}
.dshsk-drop:hover, .dshsk-drop:focus-visible, .dshsk-drop.is-drag {
  border-color: rgba(160,230,255,.75);
  background: linear-gradient(120deg, rgba(90,190,255,.14), rgba(90,190,255,.02) 60%);
  box-shadow: 0 0 0 1px rgba(120,220,255,.12), 0 0 28px rgba(70,190,255,.12) inset;
  outline: none;
}
.dshsk-drop-mark { width: 34px; height: 34px; color: #8fe3ff; opacity: .85; flex: none; }
.dshsk-drop-copy { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.dshsk-drop-copy strong { font-size: 13px; font-weight: 500; color: var(--dsw-alias-label-primary, #e9f2f8); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshsk-drop-copy span { font-size: 11px; color: var(--dsw-alias-label-tertiary, #8fa3b3); }

.dshsk-row { display: flex; align-items: center; justify-content: space-between; gap: 22px; padding: 14px 0; border-top: 1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.06)); }
.dshsk-row:first-of-type { border-top: 0; padding-top: 2px; }
.dshsk-row-label { display: flex; flex-direction: column; gap: 4px; }
.dshsk-row-label strong { font-size: 12.5px; font-weight: 500; }
.dshsk-row-label span { font-size: 11px; color: var(--dsw-alias-label-tertiary, #8fa3b3); }
.dshsk-row-control { display: flex; align-items: center; gap: 14px; width: min(380px, 46%); }
.dshsk-range { flex: 1; accent-color: #7fe3ff; height: 4px; cursor: pointer; }
.dshsk-value { font-size: 11px; letter-spacing: .08em; color: rgba(180,226,246,.9); min-width: 42px; text-align: right; font-variant-numeric: tabular-nums; }

.dshsk-switch {
  position: relative; width: 42px; height: 24px; border-radius: 999px; border: 1px solid rgba(150,225,255,.25);
  background: rgba(120,160,190,.2); cursor: pointer; padding: 0; transition: background 200ms ease, border-color 200ms ease;
}
.dshsk-switch i {
  position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 50%;
  background: #cfe6f4; transition: transform 220ms cubic-bezier(.2,.8,.3,1), background 200ms ease;
}
.dshsk-switch.is-on { background: rgba(90,200,255,.55); border-color: rgba(150,235,255,.6); }
.dshsk-switch.is-on i { transform: translateX(18px); background: #f2feff; }

.dshsk-btn {
  appearance: none; cursor: pointer; font: inherit; font-size: 12px; letter-spacing: .04em;
  padding: 8px 14px; border-radius: 9px; border: 1px solid rgba(140,215,250,.28);
  background: rgba(90,190,255,.12); color: #e9fbff;
  transition: background 180ms ease, border-color 180ms ease, color 180ms ease;
}
.dshsk-btn:hover { background: rgba(90,190,255,.24); border-color: rgba(160,230,255,.55); }
.dshsk-btn.ghost { background: transparent; color: var(--dsw-alias-label-secondary, #a9bccb); border-color: rgba(140,190,220,.2); }
.dshsk-btn.ghost:hover { color: #eafaff; border-color: rgba(160,225,255,.5); }

.dshsk-note { min-height: 18px; margin-top: 10px; font-size: 11.5px; color: #ffc9a3; }
.dshsk-foot-note { margin-top: 18px; font-size: 10.5px; letter-spacing: .06em; color: var(--dsw-alias-label-tertiary, #8fa3b3); display: flex; justify-content: space-between; gap: 16px; }

@keyframes dshsk-page-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
@media (max-width: 720px) {
  .dshsk-row { flex-direction: column; align-items: flex-start; }
  .dshsk-row-control { width: 100%; }
  .dshsk-hero { flex-wrap: wrap; }
}
`;

    const LOGO_GRADIENT = h('defs', null,
      h('linearGradient', { id: 'dshsk-logo-gradient', x1: '0', y1: '0', x2: '1', y2: '1' },
        h('stop', { offset: '0', stopColor: '#ecfdff' }),
        h('stop', { offset: '0.55', stopColor: '#93eaff' }),
        h('stop', { offset: '1', stopColor: '#5d8fff' })));

    function Logo({ size, className }) {
      return h('svg', {
        className: className,
        width: size,
        height: size * (822 / 996.38452),
        viewBox: LOGO_VIEWBOX,
        'aria-hidden': true,
        focusable: false,
      },
        LOGO_GRADIENT,
        LOGO_PARTS.map((part, index) => h('path', { key: index, d: part.d, fill: 'url(#dshsk-logo-gradient)' })));
    }

    function ThemeIcon({ size }) {
      const edge = size || 18;
      return h('svg', {
        width: edge,
        height: edge,
        viewBox: LOGO_VIEWBOX,
        'aria-hidden': true,
        focusable: false,
        style: { display: 'block' },
      }, LOGO_PARTS.map((part, index) => h('path', { key: index, d: part.d, fill: 'currentColor' })));
    }

    function LogoAssemble() {
      return h('svg', { viewBox: LOGO_VIEWBOX, 'aria-hidden': true, focusable: false },
        LOGO_GRADIENT,
        LOGO_PARTS.map((part, index) => h('path', {
          key: index,
          className: 'dshsk-logo-part',
          d: part.d,
          fill: 'url(#dshsk-logo-gradient)',
          style: { '--i': index },
        })));
    }

    const WELCOME_TEXT = '欢迎回来，漂泊者';

    function charColor(index, count) {
      const t = count <= 1 ? 0 : index / (count - 1);
      const from = [79, 140, 255];
      const to = [234, 252, 255];
      const rgb = from.map((value, channel) => Math.round(value + (to[channel] - value) * t));
      return 'rgb(' + rgb.join(',') + ')';
    }

    function drawParticles(canvas, host) {
      const ctx = canvas.getContext('2d');
      let raf = 0;
      let width = 0;
      let height = 0;
      let dpr = 1;
      const motes = [];
      const now = () => performance.now();

      const size = () => {
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        width = host.clientWidth || window.innerWidth;
        height = host.clientHeight || window.innerHeight;
        canvas.width = Math.max(1, Math.round(width * dpr));
        canvas.height = Math.max(1, Math.round(height * dpr));
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      };

      const spawn = (count, burst) => {
        for (let i = 0; i < count; i += 1) {
          const golden = Math.random() < 0.16;
          const angle = Math.random() * Math.PI * 2;
          const speed = burst ? 40 + Math.random() * 190 : 4 + Math.random() * 12;
          motes.push({
            x: burst ? width * 0.6 + (Math.random() - 0.5) * width * 0.16 : Math.random() * width,
            y: burst ? height * 0.44 + (Math.random() - 0.5) * height * 0.2 : Math.random() * height,
            r: burst ? 0.7 + Math.random() * 1.7 : 0.5 + Math.random() * 1.4,
            vx: burst ? Math.cos(angle) * speed : 3 + Math.random() * 9,
            vy: burst ? Math.sin(angle) * speed : -3 - Math.random() * 8,
            life: burst ? 1 : 0,
            decay: burst ? 0.55 + Math.random() * 0.5 : 0,
            twinkle: 0.6 + Math.random() * 1.8,
            phase: Math.random() * Math.PI * 2,
            color: golden ? '255,214,158' : (Math.random() < 0.42 ? '127,227,255' : '224,246,255'),
          });
        }
      };

      const step = () => {
        const t = now();
        ctx.clearRect(0, 0, width, height);
        ctx.globalCompositeOperation = 'lighter';
        for (let i = motes.length - 1; i >= 0; i -= 1) {
          const p = motes[i];
          const dt = 1 / 60;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          if (p.life > 0) {
            p.life -= p.decay * dt;
            p.vx *= 0.985;
            p.vy = p.vy * 0.985 + 6 * dt;
          } else {
            p.vy -= 0.9 * dt;
            if (p.y < -12) { p.y = height + 10; p.x = Math.random() * width; }
            if (p.x < -12) p.x = width + 10;
            if (p.x > width + 12) p.x = -10;
          }
          if (p.life < 0) { motes.splice(i, 1); continue; }
          const flicker = 0.55 + 0.45 * Math.sin(t * 0.001 * p.twinkle + p.phase);
          const alpha = (p.life > 0 ? Math.max(0, p.life) : 0.5) * flicker;
          if (alpha <= 0.01) continue;
          ctx.beginPath();
          ctx.fillStyle = 'rgba(' + p.color + ',' + (alpha * 0.10) + ')';
          ctx.arc(p.x, p.y, p.r * 4.4, 0, 6.2832);
          ctx.fill();
          ctx.beginPath();
          ctx.fillStyle = 'rgba(' + p.color + ',' + (alpha * 0.8) + ')';
          ctx.arc(p.x, p.y, p.r, 0, 6.2832);
          ctx.fill();
        }
        raf = requestAnimationFrame(step);
      };

      size();
      spawn(64, false);
      step();
      const onResize = () => size();
      window.addEventListener('resize', onResize);
      return {
        burst() { spawn(46, true); },
        dispose() {
          cancelAnimationFrame(raf);
          window.removeEventListener('resize', onResize);
          motes.length = 0;
        },
      };
    }

    function Splash({ onDone }) {
      const [phase, setPhase] = useState('intro');
      const [closing, setClosing] = useState(false);
      const [outro, setOutro] = useState(false);
      const [reduced, setReduced] = useState(false);
      const videoRef = useRef(null);
      const barRef = useRef(null);
      const canvasRef = useRef(null);
      const dissolveRef = useRef(null);
      const rootRef = useRef(null);
      const particlesRef = useRef(null);
      const timerRef = useRef(0);
      const phaseRef = useRef('intro');
      const closingRef = useRef(false);
      const startedRef = useRef(0);
      const doneRef = useRef(onDone);
      const chars = Array.from(WELCOME_TEXT);

      useEffect(() => { doneRef.current = onDone; }, [onDone]);

      const end = useCallback((immediate) => {
        if (closingRef.current) return;
        closingRef.current = true;
        if (!immediate) {
          setOutro(true);
        }
        setClosing(true);
        const video = videoRef.current;
        if (video) { try { video.pause(); } catch (error) { /* detached */ } }
        timerRef.current = window.setTimeout(() => {
          if (doneRef.current) doneRef.current();
        }, immediate ? 380 : 1750);
      }, []);

      useEffect(() => {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        const root = rootRef.current;
        if (root) startedRef.current = performance.now();
        hideBootVeil();

        let prefersReduced = false;
        try { prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (error) { prefersReduced = false; }
        setReduced(prefersReduced);
        if (canvas && root && !prefersReduced) particlesRef.current = drawParticles(canvas, root);

        const play = () => {
          if (!video) return;
          video.muted = true;
          video.playbackRate = RATE;
          const promise = video.play();
          if (promise && typeof promise.catch === 'function') promise.catch(() => { /* virtual clock */ });
        };
        play();

        const onKey = (event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            end(true);
          }
        };
        window.addEventListener('keydown', onKey, true);

        let raf = 0;
        const tick = () => {
          const viaVideo = video && video.readyState >= 2 && !video.paused && video.currentTime > 0.02;
          const elapsed = (performance.now() - startedRef.current) / 1000;
          const time = viaVideo ? video.currentTime : elapsed * RATE;
          if (phaseRef.current === 'intro' && time >= CUT_AT) {
            phaseRef.current = 'awake';
            setPhase('awake');
            if (particlesRef.current) particlesRef.current.burst();
          }
          if (time >= OUT_AT) end(false);
          const bar = barRef.current;
          if (bar) {
            const value = Math.max(0, Math.min(1, time / OUT_AT));
            bar.style.transform = 'scaleX(' + value.toFixed(4) + ')';
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);

        return () => {
          cancelAnimationFrame(raf);
          window.clearTimeout(timerRef.current);
          window.removeEventListener('keydown', onKey, true);
          if (particlesRef.current) { particlesRef.current.dispose(); particlesRef.current = null; }
        };
      }, [end]);


      useEffect(() => {
        if (!outro) return undefined;
        const canvas = dissolveRef.current;
        const video = videoRef.current;
        if (!canvas) return undefined;
        const ctx = canvas.getContext('2d');
        const W = Math.round(canvas.clientWidth || window.innerWidth);
        const H = Math.round(canvas.clientHeight || window.innerHeight);
        canvas.width = W;
        canvas.height = H;
        const sw = 300;
        const sh = Math.max(2, Math.round(300 * H / W));
        const off = document.createElement('canvas');
        off.width = sw;
        off.height = sh;
        const octx = off.getContext('2d');
        const particles = [];
        try {
          if (video && video.videoWidth > 0) {
            const vw = video.videoWidth;
            const vh = video.videoHeight;
            const scale = Math.max(sw / vw, sh / vh);
            const dw = vw * scale;
            const dh = vh * scale;
            octx.drawImage(video, (sw - dw) / 2, (sh - dh) / 2, dw, dh);
            const data = octx.getImageData(0, 0, sw, sh).data;
            for (let y = 0; y < sh; y += 3) {
              for (let x = 0; x < sw; x += 3) {
                if (Math.random() < 0.28) continue;
                const i = (y * sw + x) * 4;
                const r = data[i], g = data[i + 1], b = data[i + 2];
                if (r + g + b < 26) continue;
                particles.push({
                  sx: x / sw * W,
                  sy: y / sh * H,
                  size: 1 + Math.random() * 2.2,
                  col: r + ',' + g + ',' + b,
                  delay: Math.random() * 0.16,
                  wobble: Math.random() * 6.283,
                  vx: 0,
                  vy: 0,
                });
              }
            }
          }
        } catch (error) { /* canvas unavailable: fall back to the fade */ }
        const cx = W * 0.6;
        const cy = H * 0.46;
        for (const particle of particles) {
          const dx = particle.sx - cx;
          const dy = particle.sy - cy;
          const len = Math.hypot(dx, dy) || 1;
          const speed = 40 + Math.random() * 170;
          particle.vx = (dx / len) * speed;
          particle.vy = (dy / len) * speed - 14;
        }
        const started = performance.now();
        let raf = 0;
        const easeOut = (value) => 1 - Math.pow(1 - value, 3);
        const frame = () => {
          const t = (performance.now() - started) / 1000;
          ctx.clearRect(0, 0, W, H);
          ctx.globalCompositeOperation = 'lighter';
          for (const particle of particles) {
            const local = t - particle.delay;
            if (local <= 0) continue;
            const scatter = easeOut(Math.min(1, local / 0.55));
            let x = particle.sx + particle.vx * scatter * 0.8 + Math.sin(local * 3.4 + particle.wobble) * 16 * scatter;
            let y = particle.sy + particle.vy * scatter * 0.8 + 30 * scatter * scatter;
            let alpha = 0.92;
            if (local > 0.62) {
              const k = Math.min(1, (local - 0.62) / 0.72);
              const ease = k * k;
              x += (cx + (particle.sx - cx) * 0.1 - x) * ease;
              y += (cy + (particle.sy - cy) * 0.1 - y) * ease;
              alpha = 1 - k;
            } else {
              alpha = 0.92 * (1 - Math.max(0, local - 0.42) * 0.5);
            }
            if (alpha <= 0.01) continue;
            ctx.fillStyle = 'rgba(' + particle.col + ',' + alpha.toFixed(3) + ')';
            ctx.beginPath();
            ctx.arc(x, y, particle.size * (1 - 0.25 * Math.min(1, t / 1.4)), 0, 6.2832);
            ctx.fill();
          }
          if (t < 1.6) raf = requestAnimationFrame(frame);
          else ctx.clearRect(0, 0, W, H);
        };
        frame();
        return () => cancelAnimationFrame(raf);
      }, [outro]);

      return h('div', {
        ref: rootRef,
        className: 'dshsk-root',
        'data-phase': phase,
        'data-closing': closing ? 'true' : 'false',
        'data-outro': outro ? 'true' : 'false',
        'data-reduced': reduced ? 'true' : 'false',
        role: 'dialog',
        'aria-label': '守岸人启动动画',
        onClick: () => end(true),
      },
        h('style', null, SPLASH_CSS),
        h('div', { className: 'dshsk-media' },
          h('video', {
            ref: videoRef,
            className: 'dshsk-video',
            src: VIDEO_URI,
            autoPlay: true,
            muted: true,
            playsInline: true,
            preload: 'auto',
            tabIndex: -1,
            'aria-hidden': true,
            onLoadedMetadata: (event) => { event.currentTarget.playbackRate = RATE; },
          })),
        h('div', { className: 'dshsk-sketch-wrap', 'aria-hidden': true },
          h('div', { className: 'dshsk-sketch-bg' }),
          h('svg', {
            className: 'dshsk-sketch',
            viewBox: '0 0 1600 900',
            preserveAspectRatio: 'xMidYMid slice',
            'aria-hidden': true,
            focusable: false,
          },
            h('defs', null,
              h('linearGradient', {
                id: 'dshsk-stroke-grad',
                gradientUnits: 'userSpaceOnUse',
                x1: '0', y1: '0', x2: '1600', y2: '900',
              },
                h('stop', { offset: '0', stopColor: '#eafcff' }),
                h('stop', { offset: '0.45', stopColor: '#8fe9ff' }),
                h('stop', { offset: '1', stopColor: '#4f8cff' }))),
            SKETCH_PATHS.paths.map((path, index) => h('path', {
              key: index,
              className: 'dshsk-stroke',
              d: path.d,
              style: {
                '--len': path.len,
                '--dur': path.dur + 's',
                '--delay': path.delay + 's',
              },
            })))),
        h('div', { className: 'dshsk-tint' }),
        h('div', { className: 'dshsk-flash' }),
        h('div', { className: 'dshsk-scan' }),
        h('canvas', { ref: dissolveRef, className: 'dshsk-dissolve', 'aria-hidden': true }),
        h('canvas', { ref: canvasRef, className: 'dshsk-particles', 'aria-hidden': true }),
        h('div', { className: 'dshsk-brackets', 'aria-hidden': true },
          h('i'), h('i'), h('i'), h('i')),
        h('div', { className: 'dshsk-inner' },
          h('div', { className: 'dshsk-copy' },
            h('header', { className: 'dshsk-head' },
              h('div', { className: 'dshsk-emblem' }, h(LogoAssemble)),
              h('div', { className: 'dshsk-faction' },
                h('div', { className: 'dshsk-faction-cn' },
                  Array.from('黑海岸').map((char, index) => h('span', {
                    key: index,
                    className: 'dshsk-faction-char',
                    style: { '--i': index },
                  }, char))),
                h('div', { className: 'dshsk-faction-en' }, 'BLACK SHORES'))),
            h('h1', { className: 'dshsk-brand' }, 'DeepSeek'),
            h('div', { className: 'dshsk-lines' },
              h('div', { className: 'dshsk-awake' }, '守岸人正在苏醒'),
              h('div', { className: 'dshsk-welcome' },
                chars.map((char, index) => h('span', {
                  key: index,
                  className: 'dshsk-char',
                  style: { '--i': index, color: charColor(index, chars.length) },
                }, char))),
              h('div', { className: 'dshsk-sub' }, 'WELCOME BACK, ROVER'))),
          h('footer', { className: 'dshsk-foot' },
            h('div', { className: 'dshsk-meta' }, 'DSH × 鸣潮 · ', h('b', null, 'WUTHERING WAVES')),
            h('button', {
              type: 'button',
              className: 'dshsk-skip',
              onClick: (event) => { event.stopPropagation(); end(true); },
            },
              h('span', { className: 'dshsk-key' }, 'ESC'),
              h('span', null, '跳过')),
            h('div', { className: 'dshsk-foot-right' },
              h('i', { className: 'dshsk-dot' }),
              h('span', null, 'BLACK SHORES'))),
          h('div', { className: 'dshsk-progress' }, h('i', { ref: barRef }))));
    }

    function SplashHost() {
      const [nonce, setNonce] = useState(getSplashNonce());
      const [visible, setVisible] = useState(getSplashNonce() > 0);
      useEffect(() => subscribeSplash(() => {
        setNonce(getSplashNonce());
        setVisible(true);
      }), []);
      if (!visible) return null;
      /* The frame's overlay layer sits at z-index 20; the desktop menu strip
         lives at 1100 on <body>. A portal puts the film above both. */
      return ReactDOM.createPortal(h(Splash, { key: nonce, onDone: () => setVisible(false) }), document.body);
    }

    function Row({ label, hint, children }) {
      return h('div', { className: 'dshsk-row' },
        h('div', { className: 'dshsk-row-label' },
          h('strong', null, label),
          hint ? h('span', null, hint) : null),
        h('div', { className: 'dshsk-row-control' }, children));
    }

    function Slider({ label, hint, value, min, max, display, onChange }) {
      return h(Row, { label, hint },
        h('input', {
          type: 'range',
          className: 'dshsk-range',
          min: min,
          max: max,
          step: 1,
          value: value,
          onChange: (event) => onChange(Number(event.target.value)),
        }),
        h('span', { className: 'dshsk-value' }, display));
    }

    function ThemePage() {
      const [state, setState] = useState(getSettings());
      const [drag, setDrag] = useState(false);
      const [note, setNote] = useState('');
      const inputRef = useRef(null);

      useEffect(() => subscribeSettings(() => setState({ ...getSettings() })), []);

      const openPicker = () => { if (inputRef.current) inputRef.current.click(); };
      const takeFile = async (file) => {
        setNote('正在保存…');
        const error = await adoptMedia(file);
        setNote(error || '已应用新的背景。');
      };
      const onDrop = (event) => {
        event.preventDefault();
        setDrag(false);
        const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
        if (file) takeFile(file);
      };
      const transparency = Math.round((1 - state.uiAlpha) * 100);

      return h('div', { className: 'dshsk-page' },
        h('div', { className: 'dshsk-page-inner' },
          h('header', { className: 'dshsk-hero' },
            h(Logo, { size: 58, className: 'dshsk-hero-mark' }),
            h('div', { className: 'dshsk-hero-copy' },
              h('h1', null, '守岸人主题'),
              h('p', null, 'BLACK SHORES · SHOREKEEPER THEME')),
            h('div', { className: 'dshsk-hero-actions' },
              h('button', { className: 'dshsk-btn', type: 'button', onClick: () => replaySplash() }, '重播启动动画'),
              h('button', {
                className: 'dshsk-switch' + (state.enabled ? ' is-on' : ''),
                type: 'button',
                role: 'switch',
                'aria-checked': state.enabled ? 'true' : 'false',
                'aria-label': '启用主题背景',
                onClick: () => updateSettings({ enabled: !state.enabled }),
              }, h('i')))),
          h('section', { className: 'dshsk-card' },
            h('div', { className: 'dshsk-card-head' },
              h('h2', null, '背景'),
              h('p', null, '默认循环启动动画中的睁眼片段；也可以换成自己的图片或视频，文件只保存在本机。')),
            h('div', { className: 'dshsk-seg' },
              h('button', {
                type: 'button',
                'data-active': state.source === 'default' ? 'true' : 'false',
                onClick: () => { setNote(''); useDefaultBackground(); },
              }, '启动动画'),
              h('button', {
                type: 'button',
                'data-active': state.source === 'image' ? 'true' : 'false',
                onClick: openPicker,
              }, '图片'),
              h('button', {
                type: 'button',
                'data-active': state.source === 'video' ? 'true' : 'false',
                onClick: openPicker,
              }, '视频')),
            h('div', {
              className: 'dshsk-drop' + (drag ? ' is-drag' : ''),
              role: 'button',
              tabIndex: 0,
              onClick: openPicker,
              onKeyDown: (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openPicker(); } },
              onDragOver: (event) => { event.preventDefault(); setDrag(true); },
              onDragLeave: () => setDrag(false),
              onDrop: onDrop,
            },
              h(Logo, { size: 34, className: 'dshsk-drop-mark' }),
              h('div', { className: 'dshsk-drop-copy' },
                h('strong', null, state.source === 'default'
                  ? '正在使用启动动画'
                  : (state.mediaName || (state.source === 'image' ? '自定义图片' : '自定义视频'))),
                h('span', null, '拖入图片或视频，或点击选择 · 支持 PNG / JPG / WebP / MP4 / WebM · 上限 120 MB'))),
            h('input', {
              ref: inputRef,
              type: 'file',
              accept: 'image/*,video/*',
              style: { display: 'none' },
              onChange: (event) => {
                const file = event.target.files && event.target.files[0];
                event.target.value = '';
                if (file) takeFile(file);
              },
            }),
            h('div', { className: 'dshsk-note' }, note)),
          h('section', { className: 'dshsk-card' },
            h('div', { className: 'dshsk-card-head' },
              h('h2', null, '显示'),
              h('p', null, '界面越透明，背景越清晰；压暗与模糊用来保证文字可读性。')),
            h(Slider, {
              label: '界面透明度',
              hint: '侧边栏、对话区与输入框的透出程度',
              value: transparency,
              min: 5,
              max: 85,
              display: transparency + '%',
              onChange: (value) => updateSettings({ uiAlpha: 1 - value / 100 }),
            }),
            h(Slider, {
              label: '背景压暗',
              hint: '在背景上覆盖一层深色遮罩',
              value: Math.round(state.dim * 100),
              min: 0,
              max: 85,
              display: Math.round(state.dim * 100) + '%',
              onChange: (value) => updateSettings({ dim: value / 100 }),
            }),
            h(Slider, {
              label: '背景模糊',
              hint: '大范围虚化，适合细节较多的视频',
              value: Math.round(state.blur),
              min: 0,
              max: 30,
              display: Math.round(state.blur) + 'px',
              onChange: (value) => updateSettings({ blur: value }),
            })),
          h('section', { className: 'dshsk-card' },
            h('div', { className: 'dshsk-card-head' },
              h('h2', null, '启动动画'),
              h('p', null, '线稿睁眼 → 完整画面 → 标题与黑海岸标识，约 7 秒，可随时按 ESC 跳过。')),
            h(Row, { label: '每次启动时播放', hint: '关闭后仍可从上面的按钮手动重播' },
              h('button', {
                className: 'dshsk-switch' + (state.splash ? ' is-on' : ''),
                type: 'button',
                role: 'switch',
                'aria-checked': state.splash ? 'true' : 'false',
                'aria-label': '每次启动时播放启动动画',
                onClick: () => updateSettings({ splash: !state.splash }),
              }, h('i')))),
          h('div', { className: 'dshsk-foot-note' },
            h('span', null, '设置自动保存在本机，刷新或重启后继续生效。'),
            h('button', {
              className: 'dshsk-btn ghost',
              type: 'button',
              onClick: async () => {
                await useDefaultBackground();
                updateSettings({ ...DEFAULT_SETTINGS });
                setNote('已恢复默认设置。');
              },
            }, '恢复默认'))));
    }

    // ------------------------------------------------------------------ apply

    return {
      inject: ['slots', 'theme', 'locale', 'layout'],
      apply(ctx) {
        themeService = ctx.theme;
        /* Drop the development diagnostic left by earlier builds. */
        try { window.localStorage.removeItem('dshsk.diag2'); } catch (error) { /* ignore */ }

        const css = document.createElement('style');
        css.setAttribute('data-dsh-shorekeeper', 'theme');
        css.textContent = PAGE_CSS;
        document.head.appendChild(css);

        if (settings.splash) showBootVeil();
        syncVisuals();
        restoreStoredMedia();

        ctx.effect(() => ctx.locale.register(NS, {
          zh: { panel: '守岸人主题' },
          en: { panel: 'Shorekeeper Theme' },
        }), 'shorekeeper: dictionaries');
        const t = ctx.locale.bind(NS);

        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'shorekeeper.splash',
          order: 40,
        }, SplashHost));

        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: 'shorekeeper',
          locale: NS,
        }, ThemePage));

        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: 'shorekeeper',
          order: 6,
          label: () => t('panel'),
          locale: NS,
        }, ThemeIcon));

        if (settings.splash) replaySplash();


        ctx.effect(() => () => {
          releaseMediaUrl();
          if (backdropHost && backdropHost.parentNode) backdropHost.parentNode.removeChild(backdropHost);
          backdropHost = null;
          backdropFrame = null;
          backdropScrim = null;
          backdropKey = '';
          if (tokenDispose) { tokenDispose(); tokenDispose = null; }
          document.documentElement.classList.remove(DOC_CLASS);
          if (css.parentNode) css.parentNode.removeChild(css);
        }, 'shorekeeper: theme resources');
      },
    };
  },
});
