// Discord Rich Presence (like HunterPie). What it shows is built in presence.mjs.
// Reads snapshots from the bridge like the dashboard does, so it works with `npm run app` and `app:dev`.
// Needs a Discord Application ID (discord.com/developers → New Application), set in the dashboard settings.
// Discord not running / bad ID → stays quiet and retries; never affects the dashboard.
import rpc from '@xhayper/discord-rpc';
import WebSocket from 'ws';
import { buildActivity, track } from './presence.mjs';

const { Client } = rpc;
const UPDATE_MS = 15000; // Discord rate-limits presence updates
const RETRY_MS = 30000;

let cfg = { enabled: false, clientId: '', port: 8787 };
let client = null, ready = false, ws = null, latest = null, timer = null, retry = null;
const ctx = { questStart: null, last: null, lastActive: null }; // quest bookkeeping for presence.mjs

function stop() {
  clearInterval(timer); clearTimeout(retry);
  timer = retry = null;
  const old = ws; ws = null; old?.close();
  client?.destroy().catch(() => {}); client = null; ready = false;
}

function connectBridge() {
  const sock = new WebSocket(`ws://127.0.0.1:${cfg.port}`);
  ws = sock;
  sock.on('message', (data) => {
    try { latest = JSON.parse(String(data)); } catch { return; /* ignore bad frame */ }
    track(latest, ctx, Date.now()); // every frame, so a quest end between updates isn't missed
  });
  sock.on('error', () => {});
  sock.on('close', () => { if (ws === sock) setTimeout(() => { if (ws === sock) connectBridge(); }, 2000); });
}

function connectDiscord() {
  client = new Client({ clientId: cfg.clientId });
  client.on('ready', () => { ready = true; push(); });
  client.on('disconnected', () => { ready = false; });
  client.login().catch(() => {
    ready = false;
    retry = setTimeout(() => { if (cfg.enabled) { client?.destroy().catch(() => {}); connectDiscord(); } }, RETRY_MS);
  });
}

function push() {
  if (!ready || !client?.user) return;
  const a = buildActivity(latest, ctx);
  (a ? client.user.setActivity(a) : client.user.clearActivity()).catch(() => {});
}

/** Called from the dashboard settings (via preload IPC). */
export function configureDiscord(raw) {
  // values come from the page via IPC: accept only the expected shapes
  const next = {
    enabled: raw?.enabled === true,
    clientId: String(raw?.clientId ?? '').trim(),
    port: Number.isInteger(raw?.port) && raw.port >= 1024 && raw.port <= 65535 ? raw.port : 8787,
  };
  const changed = next.enabled !== cfg.enabled || next.clientId !== cfg.clientId || next.port !== cfg.port;
  cfg = next;
  if (!changed) return;
  stop();
  if (!cfg.enabled || !/^\d{15,22}$/.test(cfg.clientId ?? '')) return;
  connectBridge();
  connectDiscord();
  timer = setInterval(push, UPDATE_MS);
}

export const shutdownDiscord = stop;
