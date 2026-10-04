// Bridge: game JSON file (written by the Lua script) → WebSocket on 127.0.0.1 only.
//   node bridge/server.js                     live game
//   node bridge/server.js --record hunt.jsonl live game + record every snapshot
//   node bridge/server.js --replay hunt.jsonl replay a recording (no game needed)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { findGameDir } from './gamedir.js';

export const DEFAULT_PORT = 8787;
const POLL_MS = 100;
const OFFLINE_AFTER_MS = 3000; // file not updated this long → game/script not running
const REPLAY_MS = 200;

const offline = (error) => ({ v: 1, ts: Date.now(), connected: false, error });

// Browsers may only connect from local pages (blocks random websites reading ws://127.0.0.1).
function isLocalOrigin(origin) {
  if (!origin) return true; // non-browser client
  try {
    const u = new URL(origin);
    // file: = the Electron app loading dist/index.html. Origin "null" (sandboxed iframes on any site) stays rejected.
    return u.protocol === 'tauri:' || u.protocol === 'file:' || ['localhost', '127.0.0.1', '[::1]', 'tauri.localhost'].includes(u.hostname);
  } catch {
    return false;
  }
}

export function startBridge({ port = DEFAULT_PORT, replay, record } = {}) {
  const wss = new WebSocketServer({ host: '127.0.0.1', port, verifyClient: ({ origin }) => isLocalOrigin(origin) });
  let latest = offline('starting');
  const broadcast = (snap) => {
    latest = snap;
    const msg = JSON.stringify(snap);
    for (const c of wss.clients) if (c.readyState === 1) c.send(msg);
  };
  wss.on('connection', (ws) => ws.send(JSON.stringify(latest)));
  wss.on('error', (e) => console.error(`[bridge] ${e.code === 'EADDRINUSE' ? `port ${port} already in use (bridge already running?)` : e.message}`));
  wss.on('listening', () => console.log(`[bridge] ws://127.0.0.1:${port}`));

  let timer;
  if (replay) {
    const lines = fs.readFileSync(replay, 'utf8').split('\n').filter(Boolean);
    let i = 0;
    console.log(`[bridge] replaying ${lines.length} snapshots from ${replay}`);
    timer = setInterval(() => broadcast({ ...JSON.parse(lines[i++ % lines.length]), ts: Date.now() }), REPLAY_MS);
  } else {
    const gameDir = findGameDir();
    const file = gameDir && path.join(gameDir, 'reframework/data/hunt_dashboard.json');
    console.log(`[bridge] watching ${file ?? '(game not found — set MHW_GAME_DIR)'}`);
    let lastMtime = 0;
    let sentOffline = false;
    timer = setInterval(() => {
      let stat = null;
      try { stat = file && fs.statSync(file); } catch { /* not written yet */ }
      if (!stat || Date.now() - stat.mtimeMs > OFFLINE_AFTER_MS) {
        if (!sentOffline) broadcast(offline(
          !file ? 'ไม่พบโฟลเดอร์เกม (ตั้งค่า MHW_GAME_DIR)'
          : stat ? 'เกมไม่ได้เปิด หรือ script หยุดทำงาน'
          : 'ยังไม่มีข้อมูลจาก script (รัน npm run install-lua แล้วหรือยัง?)'));
        sentOffline = true;
        return;
      }
      if (stat.mtimeMs === lastMtime) return;
      lastMtime = stat.mtimeMs;
      let snap;
      try { snap = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return; } // caught mid-write; next poll
      snap.ts = Math.round(stat.mtimeMs); // Lua only has second precision
      sentOffline = false;
      broadcast(snap);
      if (record) fs.appendFileSync(record, JSON.stringify(snap) + '\n');
    }, POLL_MS);
  }

  return { close: () => { clearInterval(timer); wss.close(); } };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
  startBridge({ port: Number(process.env.PORT) || DEFAULT_PORT, replay: arg('--replay'), record: arg('--record') });
}
