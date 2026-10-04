import { useEffect, useRef, useState } from 'react';
import { linkState, normalize, type DamageSample, type Link, type Snapshot } from './logic';
import { mocks } from './mocks';
import { useSettings } from './settings';

const RECONNECT_MS = 2000;
const SAMPLE_EVERY_SEC = 1;
const MAX_SAMPLES = 3600; // one hour at 1/s
const params = new URLSearchParams(location.search);
export const mockName = params.get('mock');
const portOverride = params.get('port');

export interface HuntState {
  snap: Snapshot | null;
  link: Link;
  samples: DamageSample[];                               // cumulative damage over the current quest (DPS chart)
  summary: { snap: Snapshot; samples: DamageSample[] } | null; // last finished quest, until the next one starts
}

const partyTotals = (s: Snapshot) => ({
  team: s.party.reduce((n, m) => n + m.damage, 0),
  self: s.party.find((m) => m.self)?.damage ?? 0,
});

/** Live snapshot from the bridge (reconnects every 2s), or a mock with ?mock=<name>. */
export function useHunt(): HuntState {
  const { port: settingsPort } = useSettings();
  const port = portOverride ?? String(settingsPort);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [summary, setSummary] = useState<HuntState['summary']>(null);
  const samples = useRef<DamageSample[]>([]);
  const lastActive = useRef<Snapshot | null>(null);

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
        let s: Snapshot;
        try { s = normalize(JSON.parse(e.data)); } catch { return; }
        track(s);
        setSnap(s);
      };
      ws.onclose = () => {
        setOpen(false);
        if (!closed) retry = setTimeout(connect, RECONNECT_MS);
      };
    };
    connect();
    return () => { closed = true; clearTimeout(retry); ws.close(); };
  }, [port]);

  // Damage history for the chart + remembering the finished quest for the summary screen.
  function track(s: Snapshot) {
    if (!s.connected) return;
    const active = !!s.quest?.active;
    if (active) {
      const t = s.quest!.elapsedSec;
      const last = samples.current.at(-1);
      if (!lastActive.current || (last && t < last.t - 1)) { // a new quest started
        samples.current = [];
        setSummary(null);
      }
      const prev = samples.current.at(-1);
      if (!prev || t - prev.t >= SAMPLE_EVERY_SEC) {
        samples.current = [...samples.current.slice(-MAX_SAMPLES + 1), { t, ...partyTotals(s) }];
      }
      lastActive.current = s;
    } else if (lastActive.current) {
      setSummary({ snap: lastActive.current, samples: samples.current });
      lastActive.current = null;
    }
  }

  if (mockName) {
    if (mockName === 'connecting') return { snap: null, link: 'connecting', samples: [], summary: null };
    const base = mockName === 'summary' ? mocks.normal : mocks[mockName] ?? mocks.normal;
    const s = { ...base, ts: mockName === 'stale' ? now - 5000 : now };
    const fake = mockSamples(s);
    if (mockName === 'summary') {
      const idle = { ...s, quest: { active: false, elapsedSec: 0, limitSec: 0 }, monsters: [] };
      return { snap: idle, link: 'live', samples: [], summary: { snap: s, samples: fake } };
    }
    return { snap: s, link: linkState(s, true, now), samples: fake, summary: null };
  }
  return { snap, link: linkState(snap, open, now), samples: samples.current, summary };
}

// Plausible cumulative damage curve ending at the mock's party totals, for the chart in mock mode.
function mockSamples(s: Snapshot): DamageSample[] {
  const end = s.quest?.elapsedSec ?? 0;
  if (end <= 0) return [];
  const { team, self } = partyTotals(s);
  const out: DamageSample[] = [];
  for (let t = 0; t <= end; t += 5) {
    const k = Math.min(1, Math.max(0, (t / end) ** 1.1 + Math.sin(t / 40) * 0.02));
    out.push({ t, team: team * k, self: self * k });
  }
  return out;
}
