// Discord Rich Presence (like HunterPie): "Hunting Rey Dau · HP 41%" with the quest start time.
// Reads snapshots from the bridge like the dashboard does, so it works with `npm run app` and `app:dev`.
// Needs a Discord Application ID (discord.com/developers → New Application), set in the dashboard settings.
// Discord not running / bad ID → stays quiet and retries; never affects the dashboard.
import rpc from '@xhayper/discord-rpc';
import WebSocket from 'ws';

const { Client } = rpc;
const UPDATE_MS = 15000; // Discord rate-limits presence updates
const RETRY_MS = 30000;

let cfg = { enabled: false, clientId: '', port: 8787 };
let client = null, ready = false, ws = null, latest = null, questStart = null, timer = null, retry = null;

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
    try { latest = JSON.parse(String(data)); } catch { /* ignore bad frame */ }
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

function activity() {
  const s = latest;
  if (!s?.connected) return null;
  if (!s.quest?.active) { questStart = null; return { details: 'อยู่ที่แคมป์', state: 'Hunt Dashboard' }; }
  questStart ??= Date.now() - (s.quest.elapsedSec ?? 0) * 1000;
  const all = Array.isArray(s.monsters) ? s.monsters : [];
  const alive = all.filter((m) => m.hp > 0);
  const m = alive.find((x) => x.id === s.targetId) ?? alive[0] ?? all[0];
  const hp = m && m.hpMax > 0 ? Math.round(Math.max(0, m.hp) / m.hpMax * 100) : null;
  return {
    details: m ? `ล่า ${m.name}` : 'อยู่ในเควส',
    state: hp != null ? `HP ${hp}%${all.length > 1 ? ` · ${all.length} ตัว` : ''}` : undefined,
    startTimestamp: questStart,
  };
}

function push() {
  if (!ready || !client?.user) return;
  const a = activity();
  (a ? client.user.setActivity(a) : client.user.clearActivity()).catch(() => {});
}

/** Called from the dashboard settings (via preload IPC). */
export function configureDiscord(next) {
  // values come from the page via IPC: accept only the expected shapes
  next = {
    enabled: next?.enabled === true,
    clientId: String(next?.clientId ?? '').trim(),
    port: Number.isInteger(next?.port) && next.port >= 1024 && next.port <= 65535 ? next.port : 8787,
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
