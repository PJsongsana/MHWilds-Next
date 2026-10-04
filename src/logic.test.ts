import { expect, test } from 'vitest';
import {
  buffViews, callouts, elementRank, hpState, linkState, mmss, normalize, partViews, partyViews, pct, physTypeFor, pickMonster,
  weakSpots, dpsSeries, questSummary, addUptime, uptimeViews, compactRecord, historyStats, type Hitzone, type Monster,
} from './logic';

const hz = (name: string, slash: number, blow: number, shot: number, fire = 0, ice = 0): Hitzone =>
  ({ id: name, name, kind: 'other', slash, blow, shot, fire, water: 0, thunder: 0, ice, dragon: 0 });

test('weapon → hitzone type (gunlance is slash, not shot)', () => {
  expect(physTypeFor('HAMMER')).toBe('blow');
  expect(physTypeFor('GUN_LANCE')).toBe('slash');
  expect(physTypeFor('LIGHT_BOWGUN')).toBe('shot');
  expect(physTypeFor('LONG_SWORD')).toBe('slash');
  expect(physTypeFor(null)).toBe(null);
});

test('weak spots: per weapon type, one per part name, best first', () => {
  const zones = [hz('หัว', 70, 75, 60), hz('ขา', 40, 50, 30), hz('ขา', 45, 35, 30), hz('หาง', 55, 30, 50)];
  expect(weakSpots(zones, 'slash').map((w) => [w.name, w.value])).toEqual([['หัว', 70], ['หาง', 55], ['ขา', 45]]);
  expect(weakSpots(zones, 'blow', 1)[0]).toMatchObject({ name: 'หัว', value: 75 });
  expect(weakSpots(zones, null, 2).map((w) => w.value)).toEqual([75, 55]); // unknown weapon → best of three
});

test('elements ranked by best hitzone, zeros dropped', () => {
  expect(elementRank([hz('a', 0, 0, 0, 20, 5), hz('b', 0, 0, 0, 10, 30)])).toEqual([{ el: 'ice', value: 30 }, { el: 'fire', value: 20 }]);
});

test('callouts: capture, active ailment by time, enrage, near part, warn buff, hot buildup — max 4', () => {
  const m: Monster = {
    id: 'm', name: 'x', hp: 10, hpMax: 100, enraged: true, enrageRemainSec: 40, hitzones: [], scars: [],
    parts: [{ id: 'h', name: 'หัว', kind: 'head', hp: 10, hpMax: 100, broken: false }],
    ailments: [
      { id: 'sleep', buildup: 1, procs: 1, active: true, remainSec: 20 },
      { id: 'paralysis', buildup: 1, procs: 1, active: true, remainSec: 5 },
      { id: 'poison', buildup: 0.9, procs: 0 },
    ],
  };
  const snap = (mon: Monster) => normalize({ v: 1, ts: 0, connected: true, monsters: [mon], player: { buffs: [{ id: 'b', name: 'Seed', remainSec: 10 }] } });
  expect(callouts(snap(m), m).map((c) => c.kind + ('id' in c ? ':' + c.id : ''))).toEqual(['capture', 'ailment:paralysis', 'ailment:sleep', 'enrage']);
  const calm = { ...m, hp: 90, enraged: false, ailments: [m.ailments[2]] };
  expect(callouts(snap(calm), calm).map((c) => c.kind)).toEqual(['part', 'buff', 'buildup']);
  expect(callouts(snap({ ...m, hp: 0 }), { ...m, hp: 0 }).map((c) => c.kind)).toEqual(['buff']); // finished monster: only our buffs
});

const part = (id: string, hp: number, broken = false) => ({ id, name: id, kind: 'head', hp, hpMax: 100, broken });

test('pct clamps bad numbers', () => {
  expect(pct(150, 100)).toBe(100);
  expect(pct(-5, 100)).toBe(0);
  expect(pct(5, 0)).toBe(0);
});

test('parts: unbroken by % left, broken last, near < 25%', () => {
  const v = partViews([part('a', 70), part('b', 0, true), part('c', 12), part('d', 46)]);
  expect(v.map((p) => p.id)).toEqual(['c', 'd', 'a', 'b']);
  expect(v.map((p) => p.variant)).toEqual(['near', 'normal', 'normal', 'broken']);
});

test('hp state uses threshold, default 0.20', () => {
  const m = { id: 'm', name: 'x', hp: 19, hpMax: 100, parts: [], ailments: [], hitzones: [], scars: [] };
  expect(hpState(m)).toBe('capture');
  expect(hpState({ ...m, hp: 21 })).toBe('normal');
  expect(hpState({ ...m, hp: 25, captureThreshold: 0.3 })).toBe('capture');
  expect(hpState({ ...m, hp: 0 })).toBe('done');
});

test('buffs: expired removed, ≤30s warn, null infinite', () => {
  const v = buffViews([
    { id: 'a', name: 'a', remainSec: 0 },
    { id: 'b', name: 'b', remainSec: 30 },
    { id: 'c', name: 'c', remainSec: null },
    { id: 'd', name: 'd', remainSec: 108 },
  ]);
  expect(v.map((b) => [b.id, b.variant])).toEqual([['b', 'warn'], ['c', 'infinite'], ['d', 'normal']]);
});

test('party: solo = 100%, self first, dps', () => {
  expect(partyViews([{ name: 'me', self: true, damage: 500 }], 10).members[0].pct).toBe(100);
  const p = partyViews([{ name: 'x', damage: 300 }, { name: 'me', self: true, damage: 100 }], 20);
  expect(p.members.map((m) => [m.name, m.pct])).toEqual([['me', 25], ['x', 75]]);
  expect(p.dps).toBe(20);
});

test('target falls back to first monster', () => {
  const m = (id: string) => ({ id, name: id, hp: 1, hpMax: 1, parts: [], ailments: [], hitzones: [], scars: [] });
  const s = normalize({ v: 1, ts: 0, connected: true, monsters: [m('a'), m('b')], targetId: 'zz' });
  expect(pickMonster(s)).toEqual({ monster: s.monsters[0], others: 1 });
  expect(pickMonster({ ...s, targetId: 'b' }).monster?.id).toBe('b');
});

test('normalize turns Lua empty tables {} into arrays', () => {
  const s = normalize({ v: 1, ts: 0, connected: true, monsters: {}, party: {}, player: { buffs: {} } });
  expect(s.monsters).toEqual([]);
  expect(s.player.buffs).toEqual([]);
});

test('link state + time format', () => {
  const s = normalize({ v: 1, ts: 1000, connected: true });
  expect(linkState(s, false, 1000)).toBe('connecting');
  expect(linkState(s, true, 2500)).toBe('live');
  expect(linkState(s, true, 3500)).toBe('stale');
  expect(linkState({ ...s, connected: false }, true, 1000)).toBe('offline');
  expect(mmss(754)).toBe('12:34');
});


test('callouts cover other monsters: their capture/enrage show with a name, after the big-card one', () => {
  const mk = (id: string, name: string, hp: number, enraged = false): Monster =>
    ({ id, name, hp, hpMax: 100, enraged, parts: [], ailments: [], hitzones: [], scars: [] });
  const a = mk('a', 'A', 90, true), b = mk('b', 'B', 10, true), dead = mk('c', 'C', 0, true);
  const s = normalize({ v: 1, ts: 0, connected: true, monsters: [a, b, dead] });
  expect(callouts(s, a).map((c) => [c.kind, c.who])).toEqual([['capture', 'B'], ['enrage', undefined], ['enrage', 'B']]);
});

test('rolling DPS uses only the last window of samples', () => {
  const s = [0, 5, 10, 15, 20].map((t) => ({ t, team: t * 100, self: t * 40 }));
  const d = dpsSeries(s, 10);
  expect(d[0]).toEqual({ t: 0, team: 0, self: 0 });
  expect(d.at(-1)).toEqual({ t: 20, team: 100, self: 40 });
});

test('party: crit and weak-hit rates, null without hit counts', () => {
  const p = partyViews([{ name: 'me', self: true, damage: 100, hits: 8, crits: 2, weakHits: 4 }, { name: 'x', damage: 50 }], 10);
  expect(p.members.map((m) => [m.critPct, m.weakPct])).toEqual([[25, 50], [null, null]]);
});

test('quest summary: monsters, summed ailment procs, party', () => {
  const m = (id: string, hp: number): Monster => ({
    id, name: id, hp, hpMax: 100, hitzones: [], scars: [],
    parts: [{ id: 'h', name: 'h', kind: 'head', hp: 0, hpMax: 1, broken: true }, { id: 't', name: 't', kind: 'tail', hp: 1, hpMax: 1, broken: false }],
    ailments: [{ id: 'paralysis', buildup: 0, procs: 2 }, { id: 'sleep', buildup: 0, procs: 0 }],
  });
  const s = normalize({ v: 1, ts: 0, connected: true, quest: { active: true, elapsedSec: 600, limitSec: 3000 },
    monsters: [m('a', 0), m('b', 30)], party: [{ name: 'me', self: true, damage: 6000 }] });
  const q = questSummary(s);
  expect(q.monsters.map((x) => [x.name, x.done, x.broken, x.parts])).toEqual([['a', true, 1, 2], ['b', false, 1, 2]]);
  expect(q.procs).toEqual([{ id: 'paralysis', n: 4 }]);
  expect(q.party.dps).toBe(10);
});

test('buff uptime: running buffs only, % of quest time', () => {
  const acc = {};
  addUptime(acc, [{ id: 'a', name: 'A', remainSec: 30 }, { id: 'm', name: 'M', remainSec: 40, cooldown: true }], 60);
  addUptime(acc, [{ id: 'a', name: 'A', remainSec: null }], 30);
  expect(uptimeViews(acc, 120)).toEqual([{ id: 'a', name: 'A', pct: 75 }]);
});

test('compact record keeps the summary data and ≤300 chart points', () => {
  const s = normalize({ v: 1, ts: 0, connected: true, quest: { active: true, elapsedSec: 900, limitSec: 3000 },
    monsters: [{ id: 'm', name: 'x', hp: 0, hpMax: 1, hitzones: [{}], scars: [{}], parts: [], ailments: [{ id: 'sleep', buildup: 0.4, procs: 2 }] }] });
  const samples = Array.from({ length: 901 }, (_, t) => ({ t, team: t * 10, self: t * 3 }));
  const r = compactRecord(s, samples, {}, 1000);
  expect(r.samples.length).toBeLessThanOrEqual(301);
  expect(r.samples.at(-1)).toEqual(samples.at(-1));
  expect(r.snap.monsters[0].hitzones).toEqual([]);
  expect(questSummary(r.snap).procs).toEqual([{ id: 'sleep', n: 2 }]);
});

test('history stats: totals, best DPS, monsters by count with fastest slay', () => {
  const rec = (sec: number, self: number, mons: [string, number][]) => compactRecord(normalize({ v: 1, ts: 0, connected: true,
    quest: { active: true, elapsedSec: sec, limitSec: 3000 }, party: [{ name: 'me', self: true, damage: self }, { name: 'b', damage: 999 }],
    monsters: mons.map(([name, hp]) => ({ id: name, name, hp, hpMax: 100 })),
    profile: { hr: 50, skills: [] } }), [], {}, sec);
  const st = historyStats([rec(600, 6000, [['A', 0]]), rec(300, 6000, [['A', 0], ['B', 10]]), rec(100, 0, [['A', 5]])]);
  expect(st).toMatchObject({ hunts: 3, totalSec: 1000, selfDamage: 12000, bestDps: 20, avgDps: 12 });
  expect(st.monsters).toEqual([{ name: 'A', count: 3, slain: 2, bestSec: 300 }, { name: 'B', count: 1, slain: 0, bestSec: null }]);
  expect(rec(1, 0, []).snap.profile).toBeNull(); // the stored hunt doesn't carry the profile
  expect(historyStats([])).toMatchObject({ hunts: 0, avgDps: 0, monsters: [] });
});

test('profile: missing → null, skills always an array', () => {
  expect(normalize({}).profile).toBeNull();
  expect(normalize({ profile: { hr: 7, skills: {} } }).profile).toEqual({ hr: 7, skills: [] });
});
