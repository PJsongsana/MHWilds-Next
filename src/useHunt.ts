import { useEffect, useState } from 'react';
import { linkState, normalize, type Link, type Snapshot } from './logic';
import { mocks } from './mocks';

const RECONNECT_MS = 2000;
const params = new URLSearchParams(location.search);
export const mockName = params.get('mock');
const port = params.get('port') ?? '8787';

/** Live snapshot from the bridge (reconnects every 2s), or a mock with ?mock=<name>. */
export function useHunt(): { snap: Snapshot | null; link: Link } {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500); // drives stale detection
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (mockName) return;
    let ws: WebSocket;
    let retry: ReturnType<typeof setTimeout>;
    let closed = false;
    const connect = () => {
      ws = new WebSocket(`ws://127.0.0.1:${port}`);
      ws.onopen = () => setOpen(true);
      ws.onmessage = (e) => {
        try { setSnap(normalize(JSON.parse(e.data))); } catch { /* ignore bad frame */ }
      };
      ws.onclose = () => {
        setOpen(false);
        if (!closed) retry = setTimeout(connect, RECONNECT_MS);
      };
    };
    connect();
    return () => { closed = true; clearTimeout(retry); ws.close(); };
  }, []);

  if (mockName) {
    if (mockName === 'connecting') return { snap: null, link: 'connecting' };
    const s = { ...(mocks[mockName] ?? mocks.normal), ts: mockName === 'stale' ? now - 5000 : now };
    return { snap: s, link: linkState(s, true, now) };
  }
  return { snap, link: linkState(snap, open, now) };
}
