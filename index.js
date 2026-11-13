import { appendFile, readFile, readdir, writeFile, stat, rm } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn, execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';


let voicePackCache = null;
let voiceWeightsLoaded = false;

async function loadVoicePack() {
  if (voicePackCache !== null) return voicePackCache;
  try {
    const raw = await readFile(new URL('./voicepack.json', import.meta.url), 'utf8');
    voicePackCache = JSON.parse(raw);
  } catch (error) {
    voicePackCache = null;
  }
  return voicePackCache;
}

async function ensureVoiceWeights(pack) {
  if (voiceWeightsLoaded) return;
  if (pack.gptWeights) {
    await fetch(pack.endpoint + '/set_gpt_weights?weights_path=' + encodeURIComponent(pack.gptWeights));
  }
  if (pack.sovitsWeights) {
    await fetch(pack.endpoint + '/set_sovits_weights?weights_path=' + encodeURIComponent(pack.sovitsWeights));
  }
  voiceWeightsLoaded = true;
}

function logEvent(event) {
  appendFile(join(tmpdir(), 'dshsk-chat.log'), JSON.stringify({ at: Date.now(), ...event }) + '\n').catch(() => {});
}

/**
 * Host half of the Shorekeeper startup animation bundle.
 *
 * 1. Contribute a pre-boot veil through the Web server's index-inject table so
 *    the workspace's first paint is covered before the Client entry runs.
 * 2. Serve a plain (non-agent) chat endpoint that streams the DSH model answer
 *    as NDJSON. It only calls the model — no tools, no session writes, no agent
 *    loop — and resolves the model route from the same places the GUI uses.
 */

const PREBOOT_CSS = `
#dshsk-preboot {
  position: fixed;
  inset: 0;
  z-index: 2147482000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #02040a;
  pointer-events: none;
  animation: dshsk-preboot-hide 1ms linear 15s forwards;
}
#dshsk-preboot::before {
  content: "";
  position: absolute;
  inset: 0;
  background: radial-gradient(62% 58% at 62% 44%, rgba(28, 88, 148, 0.22), rgba(2, 4, 10, 0) 72%);
}
#dshsk-preboot::after {
  content: "";
  position: absolute;
  width: 74px;
  height: 74px;
  border-radius: 50%;
  border: 1px solid rgba(127, 227, 255, 0.28);
  box-shadow: 0 0 34px rgba(80, 200, 255, 0.18), inset 0 0 22px rgba(80, 200, 255, 0.1);
  animation: dshsk-preboot-breathe 2.2s ease-in-out infinite;
}
#dshsk-preboot > i {
  position: relative;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #8fe9ff;
  box-shadow: 0 0 14px 2px rgba(143, 233, 255, 0.65);
}
#dshsk-preboot.is-out {
  opacity: 0;
  transition: opacity 420ms ease;
}
@keyframes dshsk-preboot-breathe {
  0%, 100% { transform: scale(0.94); opacity: 0.45; }
  50% { transform: scale(1.06); opacity: 1; }
}
@keyframes dshsk-preboot-hide {
  to { opacity: 0; visibility: hidden; }
}
@media (prefers-reduced-motion: reduce) {
  #dshsk-preboot::after { animation: none; }
  #dshsk-preboot { animation: dshsk-preboot-hide 1ms linear 15s forwards; }
}
`;

const PREBOOT_HTML = '<div id="dshsk-preboot" aria-hidden="true"><i></i></div>';

/** Read a request body with a hard size bound. */
async function readJson(req, limit = 512 * 1024) {
  let total = 0;
  const chunks = [];
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > limit) throw new Error('request too large');
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text.trim() === '' ? {} : JSON.parse(text);
}

/** Find a provider/model pair anywhere in a route-like object. */
function extractRoute(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 5) return null;
  if (typeof value.provider === 'string' && typeof value.model === 'string') {
    return { provider: value.provider, model: value.model };
  }
  for (const key of ['header', 'config', 'route', 'selection', 'modelConfig', 'llm']) {
    const found = extractRoute(value[key], depth + 1);
    if (found !== null) return found;
  }
  return null;
}

/**
 * Resolve the model route the GUI is currently using, in priority order:
 *   1. the saved default selection,
 *   2. the newest logged request header/context of any live session,
 *   3. the first available model of the configured provider adapters,
 *   4. the DeepSeek Account provider with a known model id.
 */
async function resolveSelection(ctx, llm) {
  try {
    const found = extractRoute(ctx.agentDefaultModel?.currentSelection?.());
    if (found !== null) return found;
  } catch (error) { /* not mounted */ }

  let sessionCount = -1;
  try {
    const sessions = ctx.sessions?.list?.();
    sessionCount = Array.isArray(sessions) ? sessions.length : -1;
    if (Array.isArray(sessions)) {
      for (const session of sessions) {
        for (const value of [session?.requestHeader?.(), session?.requestContext?.()]) {
          const found = extractRoute(value);
          if (found !== null) return found;
        }
        const log = Array.isArray(session?.log) ? session.log : [];
        for (let index = log.length - 1; index >= 0; index -= 1) {
          const event = log[index];
          if (event && (event.type === 'request/header' || event.type === 'request/context')) {
            const found = extractRoute(event.data);
            if (found !== null) return found;
          }
        }
      }
    }
  } catch (error) { /* sessions unavailable */ }

  try {
    const providers = Array.isArray(llm?.listProviders?.()) ? llm.listProviders() : [];
    const names = new Set();
    for (const provider of providers) if (typeof provider === 'string') names.add(provider);
    names.add('deepseek-account');
    let modelsSample = -1;
    const sampleIds = [];
    for (const name of names) {
      let models = [];
      try { models = (await llm.listModels?.(name)) ?? []; } catch (error) { models = []; }
      if (Array.isArray(models)) {
        modelsSample = models.length;
        for (const model of models.slice(0, 5)) if (model && (model.id || model.name)) sampleIds.push(String(model.id ?? model.name));
        const first = models.find((model) => model && (model.id || model.name));
        if (first) {
          const found = { provider: name, model: first.id ?? first.name };
          logEvent({ event: 'resolved-fallback', sessionCount, providers: [...names], models: modelsSample, sampleIds, selection: found });
          return found;
        }
      }
    }
    logEvent({ event: 'resolve-empty', sessionCount, providers: [...names], models: modelsSample, sampleIds });
  } catch (error) {
    logEvent({ event: 'resolve-error', message: error instanceof Error ? error.message : String(error), sessionCount });
  }

  logEvent({ event: 'resolve-hardcoded', sessionCount });
  return { provider: 'deepseek-account', model: 'deepseek-flash' };
}

/** Normalize a usage record from whichever provider vocabulary it uses. */
function normalizeUsage(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const pick = (...keys) => {
    for (const key of keys) {
      const value = raw[key];
      if (typeof value === 'number' && Number.isFinite(value)) return value;
    }
    return undefined;
  };
  const input = pick('promptTokens', 'inputTokens', 'prompt_tokens', 'input_tokens');
  const output = pick('completionTokens', 'outputTokens', 'completion_tokens', 'output_tokens');
  const total = pick('totalTokens', 'total_tokens') ?? (input !== undefined && output !== undefined ? input + output : undefined);
  if (input === undefined && output === undefined && total === undefined) return null;
  return { input, output, total };
}

/** Whole-log and current-turn token usage of the most recently active DSH session. */
function workspaceUsage(ctx) {
  try {
    const sessions = ctx.sessions?.list?.() ?? [];
    let best = null;
    for (const session of sessions) {
      const log = Array.isArray(session?.log) ? session.log : [];
      if (log.length === 0) continue;
      const last = log[log.length - 1];
      const at = Number(last?.time ?? last?.at ?? last?.seq ?? 0);
      if (best === null || at > best.at) best = { log, at };
    }
    if (best === null) return { ok: false };
    let input = 0;
    let output = 0;
    let total = 0;
    let lastUsage = null;
    let model = null;
    let maxTurn = null;
    const turns = new Map();
    for (const event of best.log) {
      if (event?.type === 'assistant/message' && event.data) {
        const usage = normalizeUsage(event.data.usage);
        if (usage !== null) {
          input += usage.input ?? 0;
          output += usage.output ?? 0;
          total += usage.total ?? ((usage.input ?? 0) + (usage.output ?? 0));
          lastUsage = usage;
          const turn = event.data.turn;
          if (turn !== undefined && turn !== null) {
            if (maxTurn === null || turn > maxTurn) maxTurn = turn;
            const current = turns.get(turn) ?? { input: 0, output: 0, total: 0 };
            current.input += usage.input ?? 0;
            current.output += usage.output ?? 0;
            current.total += usage.total ?? ((usage.input ?? 0) + (usage.output ?? 0));
            turns.set(turn, current);
          }
        }
      } else if (event?.type === 'request/header') {
        const route = extractRoute(event.data);
        if (route !== null) model = route.model;
      }
    }
    const turnUsage = maxTurn !== null && turns.has(maxTurn) ? turns.get(maxTurn) : lastUsage;
    let cumulativeInput = 0;
    let cumulativeOutput = 0;
    let cumulativeTotal = 0;
    for (const session of sessions) {
      const log = Array.isArray(session?.log) ? session.log : [];
      for (const event of log) {
        if (event?.type === 'assistant/message' && event.data) {
          const usage = normalizeUsage(event.data.usage);
          if (usage !== null) {
            cumulativeInput += usage.input ?? 0;
            cumulativeOutput += usage.output ?? 0;
            cumulativeTotal += usage.total ?? ((usage.input ?? 0) + (usage.output ?? 0));
          }
        }
      }
    }
    return { ok: true, input, output, total, cumulative: { input: cumulativeInput, output: cumulativeOutput, total: cumulativeTotal }, turn: turnUsage, last: lastUsage, model };
  } catch (error) {
    return { ok: false };
  }
}

/**
 * Stream a plain model answer as NDJSON:
 *   {"type":"meta","provider":...,"model":...}
 *   {"type":"delta","text":...}
 *   {"type":"usage","usage":...}
 *   {"type":"finish"}
 *   {"type":"error","message":...}
 */
async function chatRoute(ctx, web, req, res) {
  const pathname = (() => { try { return new URL(req.url ?? '/', 'http://x').pathname; } catch (error) { return '/shorekeeper'; } })();
  const origin = req.headers.origin;
  const allowedOrigin = typeof origin === 'string' && (origin === 'dsh-app://app' || origin === 'null' || /^http:\/\/127\.0\.0\.1(:\d+)?$/.test(origin));
  if (allowedOrigin) {
    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('access-control-allow-headers', 'content-type');
    res.setHeader('access-control-allow-methods', 'POST, OPTIONS');
    res.setHeader('vary', 'origin');
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(allowedOrigin ? 204 : 403);
    res.end();
    return;
  }
  if (pathname.endsWith('/workspace-usage')) {
    const data = workspaceUsage(web);
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(data));
    return;
  }
  if (pathname.endsWith('/uninstall') && req.method === 'POST') {
    try {
      const profileDir = join(process.env.USERPROFILE || '', '.dsh', 'profiles', 'desktop');
      const pkgPath = join(profileDir, 'package.json');
      const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
      if (pkg && pkg.dsh && pkg.dsh.profile && Array.isArray(pkg.dsh.profile.bundles)) {
        pkg.dsh.profile.bundles = pkg.dsh.profile.bundles.filter((id) => id !== '@local/dsh-shorekeeper-startup');
      }
      if (pkg && pkg.dependencies) delete pkg.dependencies['@local/dsh-shorekeeper-startup'];
      await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
      const linkPath = join(profileDir, 'node_modules', '@local', 'dsh-shorekeeper-startup');
      try { await rm(linkPath, { recursive: true, force: true }); } catch (error) { /* missing */ }
      const pluginDir = fileURLToPath(new URL('.', import.meta.url)).replace(/\\$/, '');
      let removedFiles = false;
      if (pluginDir.toLowerCase().includes('\\_installed\\')) {
        try { await rm(pluginDir, { recursive: true, force: true }); removedFiles = true; } catch (error) { removedFiles = false; }
      }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ ok: true, removedFiles, pluginDir }));
    } catch (error) {
      res.writeHead(500, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ ok: false, error: String((error && error.message) || error) }));
    }
    return;
  }
  if (pathname.endsWith('/voice-status')) {
    const endpoint = 'http://127.0.0.1:9880';
    let ok = false;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 800);
      await fetch(endpoint + '/', { signal: controller.signal });
      clearTimeout(timer);
      ok = true;
    } catch (error) { ok = false; }
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ ok, endpoint }));
    return;
  }
  if (pathname.endsWith('/default-track')) {
    const filePath = fileURLToPath(new URL('./assets/default_track.m4a', import.meta.url));
    res.setHeader('access-control-allow-origin', '*');
    try {
      const info = await stat(filePath);
      const range = req.headers.range;
      if (typeof range === 'string' && range !== '') {
        const match = /bytes=(\d*)-(\d*)/.exec(range);
        const start = match && match[1] ? parseInt(match[1], 10) : 0;
        const end = match && match[2] ? parseInt(match[2], 10) : info.size - 1;
        if (start >= info.size || start > end) {
          res.writeHead(416, { 'content-range': 'bytes */' + info.size });
          res.end();
          return;
        }
        const last = Math.min(end, info.size - 1);
        res.writeHead(206, {
          'content-type': 'audio/mp4',
          'content-length': last - start + 1,
          'content-range': 'bytes ' + start + '-' + last + '/' + info.size,
          'accept-ranges': 'bytes',
          'cache-control': 'no-store',
        });
        createReadStream(filePath, { start, end: last }).pipe(res);
      } else {
        res.writeHead(200, {
          'content-type': 'audio/mp4',
          'content-length': info.size,
          'accept-ranges': 'bytes',
          'cache-control': 'no-store',
        });
        createReadStream(filePath).pipe(res);
      }
    } catch (error) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'track-missing' }));
    }
    return;
  }
  if (pathname.endsWith('/voice-assets')) {
    const pack = await loadVoicePack();
    if (pack === null || !pack.installDir) {
      res.writeHead(503, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'install-dir-missing' }));
      return;
    }
    const list = async (dirName, pattern) => {
      try {
        const names = await readdir(join(pack.installDir, dirName));
        return names.filter((name) => pattern.test(name)).sort();
      } catch (error) { return []; }
    };
    const gpt = await list('GPT_weights_v2Pro', /\.ckpt$/i);
    const sovits = await list('SoVITS_weights_v2Pro', /\.pth$/i);
    const refs = await list('refs', /\.(wav|mp3)$/i);
    const selectedGpt = typeof pack.gptWeights === 'string' ? pack.gptWeights.split('/').pop() : '';
    const selectedSovits = typeof pack.sovitsWeights === 'string' ? pack.sovitsWeights.split('/').pop() : '';
    const selectedRef = typeof pack.refAudio === 'string' ? pack.refAudio.split(/[\\/]/).pop() : '';
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ ok: true, installDir: pack.installDir, gpt, sovits, refs, selected: { gpt: selectedGpt, sovits: selectedSovits, ref: selectedRef } }));
    return;
  }
  if (pathname.endsWith('/voice-config')) {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'method-not-allowed' }));
      return;
    }
    const pack = await loadVoicePack();
    if (pack === null || !pack.installDir) {
      res.writeHead(503, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'install-dir-missing' }));
      return;
    }
    let payload;
    try { payload = await readJson(req); } catch (error) { payload = {}; }
    if (typeof payload.gpt === 'string' && payload.gpt !== '') pack.gptWeights = 'GPT_weights_v2Pro/' + payload.gpt;
    if (typeof payload.sovits === 'string' && payload.sovits !== '') pack.sovitsWeights = 'SoVITS_weights_v2Pro/' + payload.sovits;
    if (typeof payload.ref === 'string' && payload.ref !== '') pack.refAudio = join(pack.installDir, 'refs', payload.ref).replace(/\\/g, '/');
    if (typeof payload.gptPath === 'string' && payload.gptPath !== '') pack.gptWeights = payload.gptPath.replace(/\\/g, '/');
    if (typeof payload.sovitsPath === 'string' && payload.sovitsPath !== '') pack.sovitsWeights = payload.sovitsPath.replace(/\\/g, '/');
    if (typeof payload.refPath === 'string' && payload.refPath !== '') pack.refAudio = payload.refPath.replace(/\\/g, '/');
    try {
      await writeFile(new URL('./voicepack.json', import.meta.url), JSON.stringify(pack, null, 2));
    } catch (error) { /* ignore */ }
    voicePackCache = pack;
    voiceWeightsLoaded = false;
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (pathname.endsWith('/open-folder')) {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'method-not-allowed' }));
      return;
    }
    let payload;
    try { payload = await readJson(req); } catch (error) { payload = {}; }
    const target = typeof payload.path === 'string' ? payload.path : '';
    if (target === '') {
      res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'empty-path' }));
      return;
    }
    try {
      const child = spawn('explorer.exe', ['/select,' + target], { detached: true, stdio: 'ignore' });
      child.unref();
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true }));
    } catch (error) {
      res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'open-failed' }));
    }
    return;
  }
  if (pathname.endsWith('/pick-file')) {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'method-not-allowed' }));
      return;
    }
    let payload = null;
    try { payload = await readJson(req); } catch (error) { payload = null; }
    const kind = payload && typeof payload.type === 'string' ? payload.type : 'script';
    const filters = {
      script: 'Scripts (*.bat;*.cmd;*.exe)|*.bat;*.cmd;*.exe',
      gpt: 'GPT weights (*.ckpt)|*.ckpt',
      sovits: 'SoVITS weights (*.pth)|*.pth',
      ref: 'Audio (*.wav;*.mp3)|*.wav;*.mp3',
    };
    const filter = (filters[kind] || filters.script) + '|All files (*.*)|*.*';
    const script = "Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.OpenFileDialog; $d.Filter='" + filter + "'; if($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK){[Console]::Out.Write($d.FileName)}";
    try {
      const picked = await new Promise((resolve, reject) => {
        execFile('powershell.exe', ['-NoProfile', '-STA', '-Command', script], { timeout: 120000, windowsHide: true }, (error, stdout) => {
          if (error) reject(error); else resolve(String(stdout || '').trim());
        });
      });
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(picked === '' ? { ok: false, canceled: true } : { ok: true, path: picked }));
    } catch (error) {
      res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'dialog-failed' }));
    }
    return;
  }
  if (pathname.endsWith('/voice-start')) {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'method-not-allowed' }));
      return;
    }
    let payload = null;
    try { payload = await readJson(req); } catch (error) { payload = null; }
    const pack = await loadVoicePack();
    const requested = payload && typeof payload.path === 'string' ? payload.path : '';
    const bat = requested !== '' ? requested : (pack && pack.startBat);
    if (!bat) {
      res.writeHead(503, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'start-script-missing' }));
      return;
    }
    if (!/\.(bat|cmd|exe)$/i.test(bat)) {
      res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'unsupported-script' }));
      return;
    }
    try {
      const child = spawn('cmd.exe', ['/c', 'start', '', bat], { detached: true, stdio: 'ignore', windowsHide: false });
      child.unref();
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true }));
    } catch (error) {
      res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'spawn-failed' }));
    }
    return;
  }
  if (pathname.endsWith('/tts')) {
  if (req.method !== 'POST') {
      res.writeHead(405, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'method-not-allowed' }));
      return;
    }
    let payload;
    try { payload = await readJson(req); } catch (error) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid-request' }));
      return;
    }
    const text = String(payload.text || '').slice(0, 800).trim();
    if (text === '') {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'empty-text' }));
      return;
    }
    const pack = await loadVoicePack();
    if (pack === null || !pack.endpoint) {
      res.writeHead(503, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'voice-pack-missing' }));
      return;
    }
    try {
      await ensureVoiceWeights(pack);
      const upstream = await fetch(pack.endpoint + '/tts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text,
          text_lang: 'zh',
          ref_audio_path: pack.refAudio,
          prompt_text: pack.promptText || '',
          prompt_lang: pack.promptLang || 'zh',
          text_split_method: 'cut5',
          media_type: 'wav',
          streaming_mode: false,
          speed_factor: Number(payload.speed) || Number(pack.speed) || 1,
        }),
      });
      if (!upstream.ok) {
        const detail = await upstream.text();
        res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'tts-failed', detail: detail.slice(0, 600) }));
        return;
      }
      const buffer = Buffer.from(await upstream.arrayBuffer());
      res.writeHead(200, { 'content-type': 'audio/wav', 'content-length': buffer.length, 'cache-control': 'no-store' });
      res.end(buffer);
    } catch (error) {
      res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'tts-unavailable' }));
    }
    return;
  }
  if (req.method !== 'POST') {
    res.writeHead(405, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'method-not-allowed' }));
    return;
  }

  let payload;
  try {
    payload = await readJson(req);
  } catch (error) {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'invalid-request' }));
    return;
  }

  const selection = await resolveSelection(web, web.llm);
  logEvent({ event: 'request', selection, origin });
  if (selection === null) {
    res.writeHead(409, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'model-unavailable' }));
    return;
  }

  const messages = [];
  const persona = typeof payload.persona === 'string' ? payload.persona.slice(0, 20000) : '';
  if (persona !== '') messages.push({ role: 'system', content: [{ type: 'text', text: persona }] });
  const history = Array.isArray(payload.messages) ? payload.messages.slice(-24) : [];
  const lines = [];
  for (const message of history) {
    if (!message || (message.role !== 'user' && message.role !== 'assistant')) continue;
    const text = typeof message.text === 'string' ? message.text : '';
    if (text.trim() === '') continue;
    lines.push((message.role === 'user' ? '漂泊者：' : '守岸人：') + text);
  }
  const transcript = lines.join('\n').slice(-12000);
  if (transcript.trim() === '') {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'empty-conversation' }));
    return;
  }
  messages.push({ role: 'user', content: [{ type: 'text', text: transcript }] });

  res.writeHead(200, {
    'content-type': 'application/x-ndjson; charset=utf-8',
    'cache-control': 'no-store',
    'x-accel-buffering': 'no',
  });
  const send = (event) => {
    try { res.write(JSON.stringify(event) + '\n'); } catch (error) { /* client gone */ }
  };
  send({ type: 'meta', provider: selection.provider, model: selection.model });

  try {
    for await (const chunk of web.llm.stream({
      provider: selection.provider,
      model: selection.model,
      messages,
    })) {
      if (!chunk || typeof chunk !== 'object') continue;
      if (chunk.type === 'text-delta' && typeof chunk.text === 'string' && chunk.text !== '') {
        send({ type: 'delta', text: chunk.text });
      } else if (chunk.type === 'usage') {
        send({ type: 'usage', usage: chunk.usage ?? null });
      } else if (chunk.type === 'finish') {
        send({ type: 'finish' });
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logEvent({ event: 'stream-error', selection, message });
    send({ type: 'error', message });
  }
  res.end();
  logEvent({ event: 'done' });
}

export function apply(ctx) {
  ctx.inject(['webServer', 'llm', 'sessions'], (webCtx) => {
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'prefix',
      path: '/shorekeeper',
      handler: (req, res) => chatRoute(ctx, webCtx, req, res),
    }), 'shorekeeper: companion chat route');
  });
}
