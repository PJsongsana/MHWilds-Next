import monsterData from './data/monsters.json';

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
  nameEn?: string | null; // English name (any game language) — key into data/monsters.json
  captureThreshold?: number | null; sizePct?: number | null; crown?: Crown;
  enraged?: boolean; enrageRemainSec?: number | null; wounds?: number | null;
  parts: Part[]; ailments: Ailment[]; hitzones: Hitzone[]; scars: Scar[];
}
export interface Buff { id: string; name: string; remainSec: number | null }
export interface Member { name: string; self?: boolean; damage: number }
export interface Snapshot {
  v: number; ts: number; connected: boolean; error?: string;
  quest?: { name?: string | null; elapsedSec: number; limitSec: number; remainSec?: number | null; active: boolean };
  world?: { clock: string; phase: Phase } | null;
  targetId?: string | null;
  monsters: Monster[];
  player: { buffs: Buff[]; weapon?: string | null };
  party: Member[];
}

// Lua's json encodes an empty table as {} (or drops it) — make every list a real array.
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

export function normalize(raw: any): Snapshot {
  return {
    ...raw,
    monsters: arr<any>(raw?.monsters).map((m) => ({
      ...m, parts: arr(m.parts), ailments: arr(m.ailments), hitzones: arr(m.hitzones), scars: arr(m.scars),
    })),
    player: { buffs: arr(raw?.player?.buffs), weapon: raw?.player?.weapon ?? null },
    party: arr(raw?.party),
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
  if (m.hp <= 0) return 'done';
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

export type BuffVariant = 'normal' | 'warn' | 'infinite';
/** Expired buffs disappear; null remainSec = no expiry. */
export function buffViews(buffs: Buff[]): (Buff & { variant: BuffVariant })[] {
  return buffs
    .filter((b) => b.remainSec == null || b.remainSec > 0)
    .map((b) => ({ ...b, variant: b.remainSec == null ? 'infinite' : b.remainSec <= BUFF_WARN_SEC ? 'warn' : 'normal' }));
}

export function partyViews(party: Member[], elapsedSec: number) {
  const total = party.reduce((s, m) => s + Math.max(0, m.damage), 0);
  const members = [...party]
    .sort((a, b) => Number(!!b.self) - Number(!!a.self) || b.damage - a.damage)
    .slice(0, 4)
    .map((m) => ({ ...m, pct: party.length === 1 ? 100 : pct(m.damage, total) }));
  return { members, total, dps: elapsedSec > 0 ? total / elapsedSec : 0 };
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

/* ------------------------------ static monster info (mh-wilds.kerlos.in.th) ------------------------------ */

export interface MonsterInfo { name: string; type: string | null; habitat: string[]; chapter: string | null; weakness: Record<Element, number> }

const key = (s?: string | null) => (s ?? '').trim().toLowerCase();
const INFO = new Map((monsterData.monsters as MonsterInfo[]).map((m) => [key(m.name), m]));

/** Site data for this monster, matched by English name first (game may run in Thai), then display name. */
export function monsterInfo(m: Pick<Monster, 'name' | 'nameEn'>, table = INFO): MonsterInfo | null {
  return table.get(key(m.nameEn)) ?? table.get(key(m.name)) ?? null;
}

/** Element stars 0–3 from the site, best first — used when live hitzones aren't available. */
export const elementStars = (info: MonsterInfo | null) =>
  info ? ELEMENTS.map((el) => ({ el, stars: info.weakness[el] ?? 0 })).filter((e) => e.stars > 0).sort((a, b) => b.stars - a.stars) : [];

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
