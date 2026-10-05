import { expect, test } from 'vitest';
import { buildActivity, outcome, situation, track } from './presence.mjs';

const mon = (o = {}) => ({ id: 'm1', name: 'เรย์ ดาว', hp: 410, hpMax: 1000, ailments: [], ...o });
const snap = (o = {}) => ({
  connected: true, quest: { active: true, elapsedSec: 754 }, monsters: [mon()], targetId: 'm1',
  profile: { hr: 87, weapon: { type: 'LONG_SWORD', name: 'ดาบยาว' }, skills: [] }, ...o,
});

test('line 2 by situation, priority ailment > enraged, no "capturable" state', () => {
  expect(situation(mon(), 1)).toEqual({ state: 'ล่า เรย์ ดาว · HP 41%', badge: null });
  expect(situation(mon(), 2).state).toBe('ล่า เรย์ ดาว · HP 41% · 2 ตัว');
  expect(situation(mon({ enraged: true }), 1).state).toBe('เรย์ ดาว โกรธอยู่ · HP 41%');
  const para = { id: 'paralysis', active: true };
  expect(situation(mon({ enraged: true, ailments: [para] }), 1).state).toBe('เรย์ ดาว ติดอัมพาต · HP 41%');
  expect(situation(mon({ hp: 120 }), 1)).toEqual({ state: 'ล่า เรย์ ดาว · HP 12%', badge: null }); // low HP: still just hunting
});

test('custom wording from settings: placeholders filled, HP still added, missing keys keep the default', () => {
  const ctx = { questStart: null, last: null, text: { hunt: 'กระแทกหน้า {monster}', dead: '{monster} ไปสวรรค์แล้ว', camp: 'นั่งกินข้าว' } };
  expect(buildActivity(snap(), ctx).state).toBe('กระแทกหน้า เรย์ ดาว · HP 41%');
  expect(buildActivity(snap({ monsters: [mon({ enraged: true })] }), ctx).state).toBe('เรย์ ดาว โกรธอยู่ · HP 41%');
  expect(buildActivity(snap({ monsters: [mon({ hp: 0 })] }), ctx).state).toBe('เรย์ ดาว ไปสวรรค์แล้ว');
  expect(buildActivity(snap({ quest: { active: false }, monsters: [] }), ctx).state).toBe('นั่งกินข้าว');
  expect(buildActivity(snap({ monsters: [] }), { ...ctx, text: { quest: 'เดินหลงป่า' } }).state).toBe('เดินหลงป่า');
  expect(buildActivity(snap(), { ...ctx, text: { hunt: 'ตี {who}' } }).state).toBe('ตี {who} · HP 41%'); // unknown placeholder left as typed
});

test('how the hunt ended: dead / captured', () => {
  expect(outcome([mon({ hp: 0 })])).toBe('เรย์ ดาว ตายแล้ว');
  expect(outcome([mon({ captured: true })])).toBe('จับ เรย์ ดาว แล้ว');
  expect(outcome([mon({ hp: 0 }), mon({ name: 'Rathalos', captured: true })])).toBe('เรย์ ดาว ตายแล้ว · จับ Rathalos แล้ว');
  expect(outcome([mon()])).toBe('');
});

test('activity: hunter line, member list shows line 2, badge only on events', () => {
  const ctx = { questStart: null, last: null };
  track(snap(), ctx, 1_000_000);
  const a = buildActivity(snap(), ctx);
  expect(a).toMatchObject({ details: 'HR 87 · ดาบยาว', state: 'ล่า เรย์ ดาว · HP 41%', statusDisplayType: 1, startTimestamp: 1_000_000 - 754_000 });
  expect(a.smallImageKey).toBeUndefined();
  expect(buildActivity(snap({ monsters: [mon({ enraged: true })] }), ctx).smallImageKey).toMatch(/status-rage\.png$/);
  expect(buildActivity(snap({ profile: null }), ctx).details).toBe('Monster Hunter Wilds');
  expect(buildActivity({ connected: false }, ctx)).toBeNull();
  // dead: said right away, also once the game has emptied the monster list
  const dead = snap({ monsters: [mon({ hp: 0 })] });
  track(dead, ctx, 0);
  expect(buildActivity(dead, ctx)).toMatchObject({ state: 'เรย์ ดาว ตายแล้ว', smallImageText: 'ล่าสำเร็จ' });
  const emptied = snap({ monsters: [] });
  track(emptied, ctx, 0);
  expect(buildActivity(emptied, ctx).state).toBe('เรย์ ดาว ตายแล้ว');
  // captured: by the game's flag, or still alive when the list emptied (monsters only vanish on success)
  expect(buildActivity(snap({ monsters: [mon({ hp: 90, captured: true })] }), ctx).state).toBe('จับ เรย์ ดาว แล้ว');
  const ctx2 = { questStart: null, last: null };
  track(snap({ monsters: [mon({ hp: 90 })] }), ctx2, 0);
  track(emptied, ctx2, 0);
  expect(buildActivity(emptied, ctx2).state).toBe('จับ เรย์ ดาว แล้ว');
  // failed / abandoned: the list empties too, but the monster had plenty of HP → not a capture, not a success
  const ctx3 = { questStart: null, last: null };
  track(snap({ monsters: [mon({ hp: 410 })] }), ctx3, 0);
  track(emptied, ctx3, 0);
  expect(buildActivity(emptied, ctx3).state).toBe('อยู่ในเควส');
  const camp = snap({ quest: { active: false }, monsters: [] });
  track(camp, ctx3, 0);
  expect(buildActivity(camp, ctx3).state).toBe('อยู่ที่แคมป์');
  expect(a.largeImageKey).toMatch(/\/build\/icon\.png$/); // our own icon, from the repo
});

test('after the quest: success is remembered, abandon goes back to camp', () => {
  const ctx = { questStart: null, last: null };
  const camp = snap({ quest: { active: false, elapsedSec: 0 }, monsters: [] });
  expect(buildActivity(camp, ctx).state).toBe('อยู่ที่แคมป์');
  track(snap({ quest: { active: true, elapsedSec: 1452 }, monsters: [mon({ hp: 0 })] }), ctx, 0);
  track(snap({ quest: { active: true, elapsedSec: 1452 }, monsters: [] }), ctx, 0); // reward countdown
  track(camp, ctx, 0);
  expect(buildActivity(camp, ctx).state).toBe('เพิ่งล่า เรย์ ดาว สำเร็จ · 24:12');
  expect(ctx.questStart).toBeNull();
  track(snap(), ctx, 0); // next quest, monster left alive, then quit
  track(camp, ctx, 0);
  expect(buildActivity(camp, ctx).state).toBe('อยู่ที่แคมป์');
});

test('fields stay within Discord limits', () => {
  const long = 'ก'.repeat(200);
  const a = buildActivity(snap({ monsters: [mon({ name: long })], profile: { hr: 1, weapon: { name: long }, skills: [] } }), {});
  expect(a.details.length).toBeLessThanOrEqual(128);
  expect(a.state.length).toBeLessThanOrEqual(128);
});
