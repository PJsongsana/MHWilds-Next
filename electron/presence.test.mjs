import { expect, test } from 'vitest';
import { buildActivity, situation, track } from './presence.mjs';

const mon = (o = {}) => ({ id: 'm1', name: 'เรย์ ดาว', hp: 410, hpMax: 1000, ailments: [], ...o });
const snap = (o = {}) => ({
  connected: true, quest: { active: true, elapsedSec: 754 }, monsters: [mon()], targetId: 'm1',
  profile: { hr: 87, weapon: { type: 'LONG_SWORD', name: 'ดาบยาว' }, skills: [] }, ...o,
});

test('line 2 by situation, priority capture > ailment > enraged', () => {
  expect(situation(mon(), 1)).toEqual({ state: 'ล่า เรย์ ดาว · HP 41%', badge: null });
  expect(situation(mon(), 2).state).toBe('ล่า เรย์ ดาว · HP 41% · 2 ตัว');
  expect(situation(mon({ enraged: true }), 1).state).toBe('เรย์ ดาว โกรธอยู่ · HP 41%');
  const para = { id: 'paralysis', active: true };
  expect(situation(mon({ enraged: true, ailments: [para] }), 1).state).toBe('เรย์ ดาว ติดอัมพาต · HP 41%');
  const cap = situation(mon({ hp: 120, enraged: true, ailments: [para] }), 1);
  expect(cap.state).toBe('จับเรย์ ดาวได้แล้ว! · HP 12%');
  expect(cap.badge.smallImageText).toBe('จับได้แล้ว');
  expect(situation(mon({ hp: 120, captureThreshold: 0.1 }), 1).badge).toBeNull(); // per-monster threshold
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
  expect(a.largeImageKey).toMatch(/\/build\/icon\.png$/); // our own icon, from the repo
});

test('after the quest: success is remembered, abandon goes back to camp', () => {
  const ctx = { questStart: null, last: null };
  const camp = snap({ quest: { active: false, elapsedSec: 0 }, monsters: [] });
  expect(buildActivity(camp, ctx).state).toBe('อยู่ที่แคมป์');
  track(snap({ quest: { active: true, elapsedSec: 1452 }, monsters: [mon({ hp: 0 })] }), ctx, 0);
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
