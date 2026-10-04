// What Discord shows (styles 4 + 5 + 7 from the presence proposal):
//   line 1  = who we are: "HR 87 · ดาบยาว"
//   line 2  = what's happening, by priority: captureable > ailment > enraged > hunting
//   member list shows line 2 instead of the app name; a small colored badge marks the event.
// Pure, tested in presence.test.mjs.

const REPO = 'https://github.com/PJsongsana/MHWilds-Next';
// Discord accepts an https URL as an image key: our own drawings, served from the public repo (build/*.png)
const IMG = (name) => `https://raw.githubusercontent.com/PJsongsana/MHWilds-Next/main/build/${name}.png`;
const STATUS_SHOWS_STATE = 1; // statusDisplayType: 0 app name, 1 state, 2 details
const DEFAULT_CAPTURE = 0.2;  // same fallback as src/logic.ts

// active-ailment wording after the monster name ("เรย์ ดาว ติดอัมพาต")
const AILMENT = {
  paralysis: 'ติดอัมพาต', sleep: 'หลับอยู่', stun: 'สตันอยู่', poison: 'ติดพิษ', blast: 'โดนระเบิด',
  exhaust: 'เหนื่อยอยู่', ride: 'โดนขี่อยู่', flash: 'ติดแฟลช', pitfall: 'ติดกับดัก',
};
const BADGE = {
  capture: { smallImageKey: IMG('status-capture'), smallImageText: 'จับได้แล้ว' },
  ailment: { smallImageKey: IMG('status-ailment'), smallImageText: 'ติดสถานะ' },
  rage: { smallImageKey: IMG('status-rage'), smallImageText: 'มอนโกรธ' },
};

const mmss = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
const cut = (s) => (s.length > 128 ? `${s.slice(0, 127)}…` : s); // Discord's limit per field

function hunterLine(s) {
  const p = s.profile;
  const weapon = p?.weapon?.name || p?.weapon?.type;
  return [p?.hr != null && `HR ${p.hr}`, weapon].filter(Boolean).join(' · ') || 'Monster Hunter Wilds';
}

/** Line 2 + optional badge for one monster. */
export function situation(m, count) {
  const hp = m.hpMax > 0 ? Math.round(Math.max(0, m.hp) / m.hpMax * 100) : null;
  const hpText = hp != null ? ` · HP ${hp}%` : '';
  const ail = (Array.isArray(m.ailments) ? m.ailments : []).find((a) => a.active);
  if (m.hp > 0 && m.hpMax > 0 && m.hp / m.hpMax <= (m.captureThreshold ?? DEFAULT_CAPTURE)) {
    return { state: `จับ${m.name}ได้แล้ว!${hpText}`, badge: BADGE.capture };
  }
  if (ail) return { state: `${m.name} ${AILMENT[ail.id] ?? 'ติดสถานะ'}${hpText}`, badge: BADGE.ailment };
  if (m.enraged) return { state: `${m.name} โกรธอยู่${hpText}`, badge: BADGE.rage };
  return { state: `ล่า ${m.name}${hpText}${count > 1 ? ` · ${count} ตัว` : ''}`, badge: null };
}

/**
 * @param s latest snapshot from the bridge
 * @param ctx kept by the caller between snapshots, updated by track()
 * @returns the activity, or null when the game isn't connected
 */
export function buildActivity(s, ctx) {
  if (!s?.connected) return null;
  const common = {
    details: cut(hunterLine(s)),
    largeImageKey: IMG('icon'),
    largeImageText: 'Hunt Dashboard',
    buttons: [{ label: 'ดู Hunt Dashboard', url: REPO }],
    statusDisplayType: STATUS_SHOWS_STATE,
  };
  if (!s.quest?.active) {
    return { ...common, state: cut(ctx.last ? `เพิ่งล่า ${ctx.last.name} สำเร็จ · ${mmss(ctx.last.sec)}` : 'อยู่ที่แคมป์') };
  }
  const all = Array.isArray(s.monsters) ? s.monsters : [];
  const alive = all.filter((m) => m.hp > 0);
  const m = alive.find((x) => x.id === s.targetId) ?? alive[0];
  const { state, badge } = m ? situation(m, alive.length) : { state: 'อยู่ในเควส', badge: null };
  return { ...common, ...badge, state: cut(state), startTimestamp: ctx.questStart ?? undefined };
}

/** Quest bookkeeping between snapshots: start time while hunting, the finished hunt after. Mutates ctx. */
export function track(s, ctx, now) {
  if (!s?.connected) return;
  if (s.quest?.active) {
    ctx.questStart ??= now - (s.quest.elapsedSec ?? 0) * 1000;
    ctx.lastActive = s;
    return;
  }
  if (ctx.lastActive) {
    const done = (ctx.lastActive.monsters ?? []).filter((m) => m.hp <= 0);
    // only remember a success; an abandoned quest just goes back to "at camp"
    ctx.last = done.length ? { name: done.map((m) => m.name).join(', '), sec: ctx.lastActive.quest.elapsedSec ?? 0 } : null;
  }
  ctx.questStart = null;
  ctx.lastActive = null;
}
