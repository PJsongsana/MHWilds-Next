// Discord Rich Presence (like HunterPie). What it shows is built in presence.mjs.
// Reads snapshots from the bridge like the dashboard does, so it works with `npm run app` and `app:dev`.
// Needs a Discord Application ID (discord.com/developers → New Application), set in the dashboard settings.
// Discord not running / bad ID → stays quiet and retries; never affects the dashboard.
import rpc from '@xhayper/discord-rpc';
import WebSocket from 'ws';
import { buildActivity, DEFAULT_TEXT, track } from './presence.mjs';

const { Client } = rpc;
const UPDATE_MS = 15000; // regular refresh (HP); Discord rate-limits presence updates
const SOON_MS = 5000;    // a changed situation (enraged, capturable, slain…) goes out after at least this gap
const RETRY_MS = 30000;

let cfg = { enabled: false, clientId: '', port: 8787 };
let client = null, ready = false, ws = null, latest = null, timer = null, retry = null, soon = null;
let lastSent = 0, lastKey = '';
const ctx = { questStart: null, last: null, lastActive: null }; // quest bookkeeping for presence.mjs

// What the page shows about Discord: off | connecting | live (+ the two lines last sent) | error
let status = { state: 'off' };
let notify = () => {};
const setStatus = (next) => { status = next; notify(status); };
export const discordStatus = () => status;
export const onDiscordStatus = (fn) => { notify = fn; };

function stop() {
  clearInterval(timer); clearTimeout(retry); clearTimeout(soon);
  timer = retry = soon = null;
  const old = ws; ws = null; old?.close();
  client?.destroy().catch(() => {}); client = null; ready = false;
}

function connectBridge() {
  const sock = new WebSocket(`ws://127.0.0.1:${cfg.port}`);
  ws = sock;
  sock.on('message', (data) => {
    try { latest = JSON.parse(String(data)); } catch { return; /* ignore bad frame */ }
    track(latest, ctx, Date.now()); // every frame, so a quest end between updates isn't missed
    pushIfChanged();
  });
  sock.on('error', () => {});
  sock.on('close', () => { if (ws === sock) setTimeout(() => { if (ws === sock) connectBridge(); }, 2000); });
}

function connectDiscord() {
  client = new Client({ clientId: cfg.clientId });
  client.on('ready', () => { ready = true; push(); });
  client.on('disconnected', () => { ready = false; setStatus({ state: 'connecting' }); });
  client.login().catch(() => {
    ready = false;
    setStatus({ state: 'error' }); // Discord not running, or a wrong Application ID
    retry = setTimeout(() => { if (cfg.enabled) { client?.destroy().catch(() => {}); connectDiscord(); } }, RETRY_MS);
  });
}

// what the situation is, without the HP number (that one changes all the time and waits for the regular refresh)
const keyOf = (a) => (a ? `${a.details}|${a.state.replace(/HP \d+%/, '')}|${a.smallImageKey ?? ''}` : '');

function pushIfChanged() {
  if (!ready || soon) return;
  if (keyOf(buildActivity(latest, ctx)) === lastKey) return;
  soon = setTimeout(() => { soon = null; push(); }, Math.max(0, lastSent + SOON_MS - Date.now()));
}

function push() {
  if (!ready || !client?.user) return;
  const a = buildActivity(latest, ctx);
  lastSent = Date.now();
  lastKey = keyOf(a);
  (a ? client.user.setActivity(a) : client.user.clearActivity())
    .then(() => setStatus({ state: 'live', details: a?.details ?? null, line2: a?.state ?? null }))
    .catch(() => {});
}

/** Called from the dashboard settings (via preload IPC). */
export function configureDiscord(raw) {
  // values come from the page via IPC: accept only the expected shapes
  const next = {
    enabled: raw?.enabled === true,
    clientId: String(raw?.clientId ?? '').trim(),
    port: Number.isInteger(raw?.port) && raw.port >= 1024 && raw.port <= 65535 ? raw.port : 8787,
  };
  // the user's wording for line 2: known keys only, one line, short (Discord cuts at 128 anyway)
  ctx.text = Object.fromEntries(Object.keys(DEFAULT_TEXT)
    .map((k) => [k, String(raw?.text?.[k] ?? '').replace(/\s+/g, ' ').trim().slice(0, 100)])
    .filter(([, v]) => v));
  const changed = next.enabled !== cfg.enabled || next.clientId !== cfg.clientId || next.port !== cfg.port;
  cfg = next;
  if (!changed) { pushIfChanged(); return; } // only the wording changed: show it soon
  stop();
  if (!cfg.enabled || !/^\d{15,22}$/.test(cfg.clientId ?? '')) { setStatus({ state: 'off' }); return; }
  setStatus({ state: 'connecting' });
  connectBridge();
  connectDiscord();
  timer = setInterval(push, UPDATE_MS);
}

export const shutdownDiscord = stop;
