// Mock snapshots for every state in spec §7 (+ new realtime data). Open the UI with ?mock=<name>.
import type { Hitzone, Monster, Snapshot } from './logic';

const hz = (id: string, name: string, kind: string, slash: number, blow: number, shot: number, el: Partial<Hitzone> = {}): Hitzone =>
  ({ id, name, kind, slash, blow, shot, fire: 10, water: 15, thunder: 0, ice: 20, dragon: 5, ...el });

const reyDau: Monster = {
  id: 'm1', name: 'เรย์ ดาว', nameEn: 'Rey Dau', hp: 9800, hpMax: 24000, captureThreshold: 0.2,
  sizePct: 112, crown: 'gold', enraged: false, enrageRemainSec: null, wounds: 3,
  parts: [
    { id: 'head', name: 'หัว', kind: 'head', hp: 120, hpMax: 1000, broken: false },
    { id: 'wing_r', name: 'ปีกขวา', kind: 'wing', hp: 460, hpMax: 1000, broken: false },
    { id: 'leg_f', name: 'ขาหน้า', kind: 'leg', hp: 710, hpMax: 1000, broken: false },
    { id: 'wing_l', name: 'ปีกซ้าย', kind: 'wing', hp: 0, hpMax: 1000, broken: true },
    { id: 'tail', name: 'หาง', kind: 'tail', hp: 0, hpMax: 1000, broken: true },
  ],
  ailments: [
    { id: 'paralysis', buildup: 0.82, procs: 1 },
    { id: 'poison', buildup: 0.35, procs: 2 },
    { id: 'stun', buildup: 0.64, procs: 0 },
    { id: 'sleep', buildup: 0.1, procs: 0 },
    { id: 'exhaust', buildup: 0.4, procs: 0 },
  ],
  hitzones: [
    hz('head', 'หัว', 'head', 70, 75, 60, { ice: 30 }),
    hz('wing_r', 'ปีกขวา', 'wing', 45, 40, 50),
    hz('leg_f', 'ขาหน้า', 'leg', 40, 45, 30),
    hz('tail', 'หาง', 'tail', 55, 35, 45, { water: 25 }),
    hz('body', 'ลำตัว', 'other', 30, 30, 25),
  ],
  scars: [
    { part: 'หัว', partId: 'head', state: 'raw' },
    { part: 'ขาหน้า', partId: 'leg_f', state: 'tear' },
    { part: 'หาง', partId: 'tail', state: 'tear', legendary: true },
  ],
};

const base: Snapshot = {
  v: 1, ts: 0, connected: true,
  quest: { name: 'ราชาสายฟ้าแห่งที่ราบ', elapsedSec: 754, limitSec: 3000, remainSec: 2246, active: true },
  world: { clock: '18:20', phase: 'night' },
  targetId: 'm1',
  monsters: [reyDau],
  player: {
    weapon: 'LONG_SWORD',
    buffs: [
      { id: 'demondrug', name: 'Demondrug', remainSec: null },
      { id: 'might_seed', name: 'Might Seed', remainSec: 12 },
      { id: 'mantle', name: 'Mantle', remainSec: 108 },
      { id: 'hot_drink', name: 'Hot Drink', remainSec: 390 },
    ],
  },
  party: [
    { name: 'คุณ', self: true, damage: 9820 },
    { name: 'Player 2', damage: 6240 },
    { name: 'Player 3', damage: 4800 },
    { name: 'Player 4', damage: 3100 },
  ],
};

const withMonster = (m: Partial<Monster>): Snapshot => ({ ...base, monsters: [{ ...reyDau, ...m }] });

export const mocks: Record<string, Snapshot> = {
  normal: base,
  enraged: withMonster({ enraged: true, enrageRemainSec: 41 }),
  capture: withMonster({ hp: 4320, enraged: true, enrageRemainSec: 41 }),
  paralyzed: withMonster({
    hp: 4320,
    ailments: reyDau.ailments.map((a) => (a.id === 'paralysis' ? { ...a, buildup: 1, active: true, remainSec: 7, procs: 2 } : a)),
  }),
  exhausted: withMonster({
    ailments: [...reyDau.ailments.filter((a) => a.id !== 'exhaust'), { id: 'exhaust', buildup: 1, procs: 1, active: true, remainSec: 24 }, { id: 'pitfall', buildup: 1, procs: 1, active: true, remainSec: 9 }],
  }),
  multi: {
    ...base,
    targetId: 'm2',
    monsters: [{ ...reyDau, hp: 4320 }, { ...reyDau, id: 'm2', name: 'Rathalos', nameEn: 'Rathalos', hp: 21000, hpMax: 26000, enraged: true, enrageRemainSec: 35, crown: null, sizePct: null, wounds: 0, parts: [], ailments: [], scars: [] }],
  },
  oneDown: {
    ...base,
    monsters: [
      { ...reyDau, hp: 0, enraged: false },
      { ...reyDau, id: 'm2', name: 'Rathalos', nameEn: 'Rathalos', hp: 15000, hpMax: 26000, enraged: true, enrageRemainSec: 22 },
      { ...reyDau, id: 'm3', name: 'Uth Duna', nameEn: 'Uth Duna', hp: 20000, hpMax: 30000, crown: null, parts: [], scars: [], wounds: 0 },
    ],
    targetId: 'm2',
  },
  lastAlive: {
    ...base,
    monsters: [
      { ...reyDau, id: 'm2', name: 'Rathalos', nameEn: 'Rathalos', hp: 0, hpMax: 26000 },
      { ...reyDau, hp: 4320 },
    ],
    targetId: 'm2', // last hit the dead one → big card still follows the live one
  },
  done: withMonster({ hp: 0, enraged: false }),
  manyParts: withMonster({
    parts: Array.from({ length: 9 }, (_, i) => ({
      id: `p${i}`, name: `ส่วนที่ ${i + 1} ชื่อยาวมากเพื่อทดสอบการตัดข้อความ`, kind: ['head', 'wing', 'tail', 'leg', 'other'][i % 5],
      hp: (i * 137) % 1000, hpMax: 1000, broken: i % 4 === 3,
    })),
  }),
  solo: { ...base, party: [{ name: 'คุณ', self: true, damage: 12000 }] },
  unknowns: withMonster({ crown: null, sizePct: null, captureThreshold: null, wounds: null, enraged: true, enrageRemainSec: null, hitzones: [], scars: [] }),
  noQuest: { ...base, quest: { active: false, elapsedSec: 0, limitSec: 0 }, monsters: [], party: [] },
  offline: { v: 1, ts: 0, connected: false, error: 'เกมไม่ได้เปิด หรือ script หยุดทำงาน', monsters: [], player: { buffs: [] }, party: [] },
};
