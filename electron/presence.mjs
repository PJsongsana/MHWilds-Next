// What Discord shows (styles 4 + 5 + 7 from the presence proposal):
//   line 1  = who we are: "HR 87 · ดาบยาว"
//   line 2  = what's happening: ailment > enraged > hunting; when none is left: "X ตายแล้ว" / "จับ X แล้ว"
//   member list shows line 2 instead of the app name; a small colored badge marks the event.
// Line 2 wording is the user's (settings → Discord), defaults in presence-text.json (shared with the settings page).
// Pure, tested in presence.test.mjs.
import DEFAULT_TEXT from './presence-text.json' with { type: 'json' };

export { DEFAULT_TEXT };

const REPO = 'https://github.com/PJsongsana/MHWilds-Next';
// Discord accepts an https URL as an image key: our own drawings, served from the public repo (build/*.png)
const IMG = (name) => `https://raw.githubusercontent.com/PJsongsana/MHWilds-Next/main/build/${name}.png`;
const STATUS_SHOWS_STATE = 1; // statusDisplayType: 0 app name, 1 state, 2 details

// active-ailment wording after the monster name ("เรย์ ดาว ติดอัมพาต")
const AILMENT = {
  paralysis: 'ติดอัมพาต', sleep: 'หลับอยู่', stun: 'สตันอยู่', poison: 'ติดพิษ', blast: 'โดนระเบิด',
  exhaust: 'เหนื่อยอยู่', ride: 'โดนขี่อยู่', flash: 'ติดแฟลช', pitfall: 'ติดกับดัก',
};
const BADGE = {
  done: { smallImageKey: IMG('status-capture'), smallImageText: 'ล่าสำเร็จ' },
  ailment: { smallImageKey: IMG('status-ailment'), smallImageText: 'ติดสถานะ' },
  rage: { smallImageKey: IMG('status-rage'), smallImageText: 'มอนโกรธ' },
};

const mmss = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
// "กระแทกหน้า {monster}" → "กระแทกหน้า Rathalos"; unknown {names} stay as typed
const fill = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (all, k) => vars[k] ?? all);
const cut = (s) => (s.length > 128 ? `${s.slice(0, 127)}…` : s); // Discord's limit per field

function hunterLine(s) {
  const p = s.profile;
  const weapon = p?.weapon?.name || p?.weapon?.type;
  return [p?.hr != null && `HR ${p.hr}`, weapon].filter(Boolean).join(' · ') || 'Monster Hunter Wilds';
}

/** Line 2 + optional badge for one monster. */
export function situation(m, count, text = DEFAULT_TEXT) {
  const hp = m.hpMax > 0 ? Math.round(Math.max(0, m.hp) / m.hpMax * 100) : null;
  const hpText = hp != null ? ` · HP ${hp}%` : '';
  const ail = (Array.isArray(m.ailments) ? m.ailments : []).find((a) => a.active);
  const vars = { monster: m.name, ailment: ail ? AILMENT[ail.id] ?? 'ติดสถานะ' : '' };
  // the user's phrase, then HP (and the count) added by us
  if (ail) return { state: `${fill(text.ailment, vars)}${hpText}`, badge: BADGE.ailment };
  if (m.enraged) return { state: `${fill(text.enraged, vars)}${hpText}`, badge: BADGE.rage };
  return { state: `${fill(text.hunt, vars)}${hpText}${count > 1 ? ` · ${count} ตัว` : ''}`, badge: null };
}

/** "Rathalos ตายแล้ว", "จับ Rathalos แล้ว", or both for a multi-monster quest; '' if none ended. */
export function outcome(monsters, text = DEFAULT_TEXT) {
  const dead = monsters.filter((m) => m.hp <= 0 && !m.captured).map((m) => m.name);
  const caught = monsters.filter((m) => m.captured).map((m) => m.name);
  return [dead.length && fill(text.dead, { monster: dead.join(', ') }), caught.length && fill(text.captured, { monster: caught.join(', ') })]
    .filter(Boolean).join(' · ');
}

/**
 * @param s latest snapshot from the bridge
 * @param ctx kept by the caller between snapshots, updated by track(); ctx.text = the user's wording (else defaults)
 * @returns the activity, or null when the game isn't connected
 */
export function buildActivity(s, ctx) {
  if (!s?.connected) return null;
  const text = { ...DEFAULT_TEXT, ...ctx.text };
  const common = {
    details: cut(hunterLine(s)),
    largeImageKey: IMG('icon'),
    largeImageText: 'Hunt Dashboard',
    buttons: [{ label: 'ดู Hunt Dashboard', url: REPO }],
    statusDisplayType: STATUS_SHOWS_STATE,
  };
  if (!s.quest?.active) {
    return { ...common, state: cut(ctx.last ? fill(text.recent, { monster: ctx.last.name, time: mmss(ctx.last.sec) }) : text.camp) };
  }
  const all = Array.isArray(s.monsters) ? s.monsters : [];
  const alive = all.filter((m) => m.hp > 0 && !m.captured);
  const m = alive.find((x) => x.id === s.targetId) ?? alive[0];
  // nothing left to hunt: say how it ended (the list may already be empty, track() kept the last one)
  const ended = m ? null : outcome(all.length ? all : ctx.lastActive?.monsters ?? [], text);
  const { state, badge } = m ? situation(m, alive.length, text) : { state: ended || text.quest, badge: ended ? BADGE.done : null };
  return { ...common, ...badge, state: cut(state), startTimestamp: ctx.questStart ?? undefined };
}

const DEFAULT_CAPTURE = 0.2; // same fallback as src/logic.ts
const capturable = (m) => m.hp > 0 && m.hpMax > 0 && m.hp / m.hpMax <= (m.captureThreshold ?? DEFAULT_CAPTURE);

/** Quest bookkeeping between snapshots: start time while hunting, the finished hunt after. Mutates ctx. */
export function track(s, ctx, now) {
  if (!s?.connected) return;
  if (s.quest?.active) {
    ctx.questStart ??= now - (s.quest.elapsedSec ?? 0) * 1000;
    // the monster list empties at the end of a quest (won, failed or abandoned): keep the last one that had monsters.
    // In case the game's capture flag wasn't seen in time, a monster that vanished below its capture line counts
    // as captured; one with more HP left means the quest was failed/abandoned (not a success).
    // ponytail: abandoning while a monster is already capturable still reads as a capture
    const keep = !s.monsters?.length && ctx.lastActive?.monsters?.length;
    ctx.lastActive = keep
      ? { ...s, monsters: ctx.lastActive.monsters.map((m) => (capturable(m) ? { ...m, captured: true } : m)) }
      : s;
    return;
  }
  if (ctx.lastActive) {
    const done = (ctx.lastActive.monsters ?? []).filter((m) => m.hp <= 0 || m.captured);
    // only remember a success; an abandoned quest just goes back to "at camp"
    ctx.last = done.length ? { name: done.map((m) => m.name).join(', '), sec: ctx.lastActive.quest.elapsedSec ?? 0 } : null;
  }
  ctx.questStart = null;
  ctx.lastActive = null;
}
