// Data contract (HANDOFF §3) + every value the UI derives itself (§3 last line, §7). Pure, tested in logic.test.ts.

export type Crown = 'gold' | 'silver' | 'mini' | null;
export type Phase = 'day' | 'night' | 'dusk' | 'dawn';

export interface Part { id: string; name: string; kind: string; hp: number; hpMax: number; broken: boolean }
export interface Ailment { id: string; buildup: number; procs: number; active?: boolean; remainSec?: number | null }
export const ELEMENTS = ['fire', 'water', 'thunder', 'ice', 'dragon'] as const;
export type Element = (typeof ELEMENTS)[number];
export type PhysType = 'slash' | 'blow' | 'shot';
/** Live hitzone values of one damage part (change when the part breaks / is wounded). */
export type Hitzone = { id: string; name: string; kind: string } & Record<PhysType | Element, number>;
export interface Scar { part?: string | null; partId?: string; state: 'tear' | 'raw'; legendary?: boolean; ride?: boolean }
export interface Monster {
  id: string; name: string; hp: number; hpMax: number;
  captureThreshold?: number | null; sizePct?: number | null; crown?: Crown;
  enraged?: boolean; enrageRemainSec?: number | null; wounds?: number | null; captured?: boolean;
  parts: Part[]; ailments: Ailment[]; hitzones: Hitzone[]; scars: Scar[];
}
export interface Buff { id: string; name: string; remainSec: number | null; kind?: 'mantle' | 'song'; cooldown?: boolean }
export interface Member { id?: string; name: string; self?: boolean; npc?: boolean; palico?: boolean; owner?: string; damage: number; hits?: number; crits?: number; weakHits?: number }
export interface Vitals { hp?: number; hpMax?: number; hpRed?: number; stamina?: number; staminaMax?: number }
/** The นักล่า tab: read by the Lua every ~2s. Gear/stats/save fields come later (phase 2, after the probe). */
export interface Skill { id: string; name: string; lv: number; max?: number | null }
export interface Profile { name?: string | null; hr?: number | null; weapon?: { type?: string | null; name?: string | null } | null; skills: Skill[] }
export interface Snapshot {
  v: number; ts: number; connected: boolean; error?: string;
  quest?: { name?: string | null; elapsedSec: number; limitSec: number; remainSec?: number | null; active: boolean };
  world?: { clock: string; phase: Phase } | null;
  targetId?: string | null;
  monsters: Monster[];
  player: { buffs: Buff[]; weapon?: string | null; vitals?: Vitals | null };
  party: Member[];
  profile?: Profile | null;
}

// Lua's json encodes an empty table as {} (or drops it) — make every list a real array.
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

export function normalize(raw: any): Snapshot {
  return {
    ...raw,
    monsters: arr<any>(raw?.monsters).map((m) => ({
      ...m, parts: arr(m.parts), ailments: arr(m.ailments), hitzones: arr(m.hitzones), scars: arr(m.scars),
    })),
    player: { buffs: arr(raw?.player?.buffs), weapon: raw?.player?.weapon ?? null, vitals: raw?.player?.vitals ?? null },
    party: arr(raw?.party),
    profile: raw?.profile ? { ...raw.profile, skills: arr(raw.profile.skills) } : null,
  };
}

/** 0..1, clamped (spec §9: hp > hpMax or negatives) */
export const ratio = (v: number, max: number) => (max > 0 ? Math.min(1, Math.max(0, v / max)) : 0);
export const pct = (v: number, max: number) => Math.round(ratio(v, max) * 100);

export const DEFAULT_CAPTURE = 0.2;
export const NEAR_PCT = 25;
export const BUFF_WARN_SEC = 30;
export const STALE_MS = 2000;

export function pickMonster(s: Snapshot): { monster: Monster | null; others: number } {
  const monster = s.monsters.find((m) => m.id === s.targetId) ?? s.monsters[0] ?? null;
  return { monster, others: Math.max(0, s.monsters.length - 1) };
}

export type HpState = 'normal' | 'capture' | 'done';
export function hpState(m: Monster): HpState {
  if (m.hp <= 0 || m.captured) return 'done';
  return ratio(m.hp, m.hpMax) <= (m.captureThreshold ?? DEFAULT_CAPTURE) ? 'capture' : 'normal';
}

export type PartVariant = 'normal' | 'near' | 'broken';
export interface PartView extends Part { remain: number; variant: PartVariant }
/** Not broken first, lowest % remaining first; broken last. */
export function partViews(parts: Part[]): PartView[] {
  return parts
    .map((p) => {
      const remain = pct(p.hp, p.hpMax);
      const variant: PartVariant = p.broken ? 'broken' : remain < NEAR_PCT ? 'near' : 'normal';
      return { ...p, remain, variant };
    })
    .sort((a, b) => Number(a.broken) - Number(b.broken) || (a.broken ? 0 : a.remain - b.remain));
}

export type BuffVariant = 'normal' | 'warn' | 'infinite' | 'cooldown';
/** Expired buffs disappear; null remainSec = no expiry. */
export function buffViews(buffs: Buff[]): (Buff & { variant: BuffVariant })[] {
  return buffs
    .filter((b) => b.remainSec == null || b.remainSec > 0)
    .map((b) => ({ ...b, variant: b.cooldown ? 'cooldown' : b.remainSec == null ? 'infinite' : b.remainSec <= BUFF_WARN_SEC ? 'warn' : 'normal' }));
}

export function partyViews(party: Member[], elapsedSec: number) {
  const total = party.reduce((s, m) => s + Math.max(0, m.damage), 0);
  // hunters: us first, then by damage; each palico right after its owner. Palico damage counts toward the team.
  const hunters = party.filter((m) => !m.palico).sort((a, b) => Number(!!b.self) - Number(!!a.self) || b.damage - a.damage);
  const palicos = party.filter((m) => m.palico);
  const ordered = hunters.flatMap((h) => [h, ...palicos.filter((p) => p.owner === h.name)]);
  ordered.push(...palicos.filter((p) => !ordered.includes(p)));
  const members = ordered
    .slice(0, 10)
    .map((m) => ({
      ...m,
      pct: party.length === 1 ? 100 : pct(m.damage, total),
      dps: elapsedSec > 0 ? m.damage / elapsedSec : 0,
      critPct: m.hits ? pct(m.crits ?? 0, m.hits) : null, // null = old reader without hit counts
      weakPct: m.hits ? pct(m.weakHits ?? 0, m.hits) : null,
    }));
  return { members, total, dps: elapsedSec > 0 ? total / elapsedSec : 0 };
}

/* ------------------------------ DPS over time ------------------------------ */

// t = quest elapsed sec; cumulative damage for the team, us, and (newer recordings) each member by memberKey
export interface DamageSample { t: number; team: number; self: number; by?: Record<string, number> }

/** Stable key for a party row: the game id when the reader sends one, else palico flag + name. */
export const memberKey = (m: Member) => m.id ?? `${m.palico ? 'p:' : ''}${m.name}`;

/** Rolling DPS of any one series over the last `window` seconds, one point per sample. */
export function rollingDps(samples: DamageSample[], get: (s: DamageSample) => number, window = 15) {
  const out: { t: number; v: number }[] = [];
  let j = 0;
  for (let i = 0; i < samples.length; i++) {
    while (samples[i].t - samples[j].t > window) j++;
    const dt = samples[i].t - samples[j].t;
    out.push({ t: samples[i].t, v: dt > 0 ? Math.max(0, (get(samples[i]) - get(samples[j])) / dt) : 0 });
  }
  return out;
}

/** Rolling DPS (team and self) over the last `window` seconds, one point per sample. */
export function dpsSeries(samples: DamageSample[], window = 15) {
  const out: { t: number; team: number; self: number }[] = [];
  let j = 0;
  for (let i = 0; i < samples.length; i++) {
    while (samples[i].t - samples[j].t > window) j++;
    const dt = samples[i].t - samples[j].t;
    out.push(dt > 0
      ? { t: samples[i].t, team: (samples[i].team - samples[j].team) / dt, self: (samples[i].self - samples[j].self) / dt }
      : { t: samples[i].t, team: 0, self: 0 });
  }
  return out;
}

/* ------------------------------ post-quest summary ------------------------------ */

/** Everything the summary screen shows, from the last snapshot taken while the quest was active. */
export function questSummary(s: Snapshot) {
  const elapsed = s.quest?.elapsedSec ?? 0;
  const procs = new Map<string, number>();
  for (const m of s.monsters) for (const a of m.ailments) if (a.procs > 0) procs.set(a.id, (procs.get(a.id) ?? 0) + a.procs);
  return {
    elapsed,
    monsters: s.monsters.map((m) => ({
      name: m.name, done: hpState(m) === 'done', hpPct: pct(m.hp, m.hpMax),
      broken: m.parts.filter((p) => p.broken).length, parts: m.parts.length,
    })),
    procs: [...procs].map(([id, n]) => ({ id, n })).sort((a, b) => b.n - a.n),
    party: partyViews(s.party, elapsed),
  };
}

/* ------------------------------ hitzones / weak spots ------------------------------ */

export const WEAK_HITZONE = 45; // MH convention: physical hitzone ≥ 45 = weak spot

/** Which physical hitzone matters for the player's weapon (app.WeaponDef.TYPE enum name); null = unknown. */
export function physTypeFor(weapon?: string | null): PhysType | null {
  if (!weapon) return null;
  const w = weapon.toUpperCase();
  if (/HAMMER|HORN|WHISTLE/.test(w)) return 'blow';
  if (/LANCE/.test(w)) return 'slash'; // before GUN: gunlance is a slash weapon
  if (/BOW|GUN/.test(w)) return 'shot';
  return 'slash';
}

export const physValue = (h: Hitzone, type: PhysType | null) => (type ? h[type] : Math.max(h.slash, h.blow, h.shot));

/** Best parts to hit right now, one entry per part name. */
export function weakSpots(hitzones: Hitzone[], type: PhysType | null, n = 3) {
  const best = new Map<string, { name: string; kind: string; value: number }>();
  for (const h of hitzones) {
    const value = physValue(h, type);
    if ((best.get(h.name)?.value ?? -1) < value) best.set(h.name, { name: h.name, kind: h.kind, value });
  }
  return [...best.values()].sort((a, b) => b.value - a.value).slice(0, n);
}

/** Elements ranked by their best current hitzone on any part. */
export function elementRank(hitzones: Hitzone[]) {
  return ELEMENTS.map((el) => ({ el, value: Math.max(0, ...hitzones.map((h) => h[el] ?? 0)) }))
    .filter((e) => e.value > 0)
    .sort((a, b) => b.value - a.value);
}

/* ------------------------------ "do this now" callouts ------------------------------ */

/** `who` = name of a monster other than the one on the big card (multi-monster hunts). */
export type Callout = (
  | { kind: 'capture' }
  | { kind: 'ailment'; id: string; remainSec?: number | null }
  | { kind: 'enrage'; remainSec?: number | null }
  | { kind: 'part'; name: string; remain: number }
  | { kind: 'buff'; name: string; remainSec: number }
  | { kind: 'buildup'; id: string; pct: number }
) & { who?: string };

export const MAX_CALLOUTS = 4;
const BUILDUP_HOT = 0.75;

/**
 * Most urgent first: capture → monster disabled → enrage → parts about to break → buffs running out → buildup.
 * Capture / disabled / enrage are checked on every monster; within the same urgency the big-card monster comes first.
 */
export function callouts(s: Snapshot, m: Monster | null): Callout[] {
  const ranked: { rank: number; other: boolean; t: number; c: Callout }[] = [];
  const add = (rank: number, c: Callout, other = false, t = 0) => ranked.push({ rank, other, t, c });

  for (const mon of s.monsters) {
    if (hpState(mon) === 'done') continue;
    const other = mon.id !== m?.id;
    const who = other ? mon.name : undefined;
    if (hpState(mon) === 'capture') add(0, { kind: 'capture', who }, other);
    mon.ailments.filter((a) => a.active)
      .forEach((a) => add(1, { kind: 'ailment', id: a.id, remainSec: a.remainSec, who }, other, a.remainSec ?? Infinity));
    if (mon.enraged) add(2, { kind: 'enrage', remainSec: mon.enrageRemainSec, who }, other);
  }
  if (m && hpState(m) !== 'done') {
    partViews(m.parts).filter((p) => p.variant === 'near').forEach((p) => add(3, { kind: 'part', name: p.name, remain: p.remain }, false, p.remain));
    m.ailments.filter((a) => !a.active && a.buildup >= BUILDUP_HOT)
      .forEach((a) => add(5, { kind: 'buildup', id: a.id, pct: pct(a.buildup, 1) }));
  }
  buffViews(s.player.buffs).filter((b) => b.variant === 'warn')
    .forEach((b) => add(4, { kind: 'buff', name: b.name, remainSec: b.remainSec! }, false, b.remainSec!));

  return ranked
    .sort((a, b) => a.rank - b.rank || Number(a.other) - Number(b.other) || a.t - b.t)
    .slice(0, MAX_CALLOUTS)
    .map((r) => r.c);
}

/** 754 → "12:34" */
export function mmss(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');

export type Link = 'connecting' | 'offline' | 'stale' | 'live';
export function linkState(s: Snapshot | null, wsOpen: boolean, now: number): Link {
  if (!wsOpen || !s) return 'connecting';
  if (!s.connected) return 'offline';
  return now - s.ts > STALE_MS ? 'stale' : 'live';
}

/* ------------------------------ buff uptime + hunt history ------------------------------ */

/** Add `dt` seconds to every buff that is running (not recharging) in this snapshot. */
export function addUptime(acc: Record<string, { name: string; sec: number }>, buffs: Buff[], dt: number) {
  for (const b of buffs) {
    if (b.cooldown || (b.remainSec != null && b.remainSec <= 0)) continue;
    const e = (acc[b.id] ??= { name: b.name, sec: 0 });
    e.sec += dt;
  }
  return acc;
}

/** Uptime % per buff over the quest, highest first. */
export const uptimeViews = (acc: Record<string, { name: string; sec: number }>, elapsedSec: number) =>
  Object.entries(acc).map(([id, e]) => ({ id, name: e.name, pct: pct(e.sec, elapsedSec) })).sort((a, b) => b.pct - a.pct);

/** Near a quest's end (reward countdown) the game's monster list is already empty while the quest is still
 *  active: keep the last list that had monsters, so the summary/history show what was hunted. */
export const keepMonsters = (prev: Snapshot | null, s: Snapshot): Snapshot =>
  s.monsters.length || !prev?.monsters.length ? s : { ...s, monsters: prev.monsters };

export interface HuntRecord {
  id: string;
  endedAt: number;
  snap: Snapshot; // trimmed to what the summary screen needs
  samples: DamageSample[];
  uptime: Record<string, { name: string; sec: number }>;
}

/** Shrink a finished quest for storage: drop hitzones/scars, keep ≤300 chart points. */
export function compactRecord(snap: Snapshot, samples: DamageSample[], uptime: HuntRecord['uptime'], endedAt: number): HuntRecord {
  const step = Math.max(1, Math.ceil(samples.length / 300));
  return {
    id: String(endedAt),
    endedAt,
    snap: {
      ...snap,
      monsters: snap.monsters.map((m) => ({
        ...m, hitzones: [], scars: [],
        parts: m.parts.map((p) => ({ ...p })),
        ailments: m.ailments.map((a) => ({ id: a.id, buildup: 0, procs: a.procs })),
      })),
      player: { buffs: [] },
      profile: null,
    },
    samples: samples.filter((_, i) => i % step === 0 || i === samples.length - 1),
    uptime,
  };
}

/* ------------------------------ account stats (from our own hunt history) ------------------------------ */

export interface HistoryStats {
  hunts: number; totalSec: number; selfDamage: number;
  avgDps: number; bestDps: number;
  monsters: { name: string; count: number; slain: number; bestSec: number | null }[]; // most hunted first
}

/** Totals over the saved hunts (newest 50). A monster counts as slain when its HP reached 0 or it was captured. */
export function historyStats(records: HuntRecord[]): HistoryStats {
  let totalSec = 0, selfDamage = 0, bestDps = 0;
  const mons = new Map<string, HistoryStats['monsters'][number]>();
  for (const r of records) {
    const sec = r.snap.quest?.elapsedSec ?? 0;
    const dmg = r.snap.party.find((m) => m.self)?.damage ?? 0;
    totalSec += sec;
    selfDamage += dmg;
    if (sec > 0) bestDps = Math.max(bestDps, dmg / sec);
    for (const m of r.snap.monsters) {
      const e = mons.get(m.name) ?? { name: m.name, count: 0, slain: 0, bestSec: null };
      e.count++;
      if (hpState(m) === 'done') {
        e.slain++;
        if (sec > 0 && (e.bestSec == null || sec < e.bestSec)) e.bestSec = sec;
      }
      mons.set(m.name, e);
    }
  }
  return {
    hunts: records.length, totalSec, selfDamage,
    avgDps: totalSec > 0 ? selfDamage / totalSec : 0, bestDps,
    monsters: [...mons.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
  };
}
