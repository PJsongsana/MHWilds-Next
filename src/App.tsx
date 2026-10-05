import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Icon, iconFor, type IconName } from './icons';
import {
  buffViews, callouts, dpsSeries, historyStats, elementRank, fmtInt, hpState, mmss, partViews, partyViews, pct, physTypeFor, physValue,
  pickMonster, questSummary, ratio, uptimeViews, weakSpots, WEAK_HITZONE,
  type Ailment, type Callout, type DamageSample, type Hitzone, type Link, type Monster, type PartView, type PhysType, type Scar,
  type HuntRecord, type Profile, type Snapshot, type Vitals,
} from './logic';
import { mocks } from './mocks';
import DISCORD_TEXT from '../electron/presence-text.json'; // the default wording, shared with the desktop app
import CHANGELOG from '../CHANGELOG.md?raw';
import { version as APP_VERSION } from '../package.json';
import { useHistory } from './history';
import { DEFAULT_SETTINGS, setSettings, useSettings, type PanelKey, type Tab } from './settings';
import { t } from './strings';
import { mockName, useHunt } from './useHunt';

// Responsive canvas: a minimum logical size per orientation, then stretched to the window's aspect ratio so no
// screen area is wasted. Text scales with the window via CSS zoom.
//   portrait  (window w/h < 0.9): everything stacked in one column, min 880×1200
//   landscape (canvas w/h < 1.5): monsters side by side, player info as a bottom row, min 1280×860
//   wide      (canvas w/h ≥ 1.5): same, but player info in a right column
type Layout = 'portrait' | 'landscape' | 'wide';
const PORTRAIT_BELOW = 0.9;
const WIDE_FROM = 1.5;

// [text, tile background] per ailment. Orange = "act now" and red = enrage only (spec §5), so none of these use them.
const AIL_COLORS: Record<string, [string, string]> = {
  paralysis: ['#E6C84A', '#2E2810'],
  poison: ['#B48BE8', '#251C33'],
  stun: ['#E8E6E1', '#262B33'],
  sleep: ['#8FB4F2', '#17233A'],
  blast: ['#E8A87C', '#33221A'],
  exhaust: ['#9FB8C9', '#1C2630'],
  ride: ['#C9A27A', '#2B2219'],
  flash: ['#F2EDC4', '#2B2A1C'],
  pitfall: ['#A9C27A', '#212A17'],
};
const ailColors = (id: string) => AIL_COLORS[id] ?? ['#B8C0CA', '#262B33'];
const ELEMENT_COLORS: Record<string, string> = { fire: '#F0835F', water: '#5AA9E6', thunder: '#E6C84A', ice: '#9FD8F0', dragon: '#B48BE8' };
const PARTY_COLORS = ['#5AA9E6', '#8FD3A8', '#B48BE8'];

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

// Present only inside the desktop app (electron/preload.cjs).
// SetupStatus = bridge/setup.js ensureSetup(): checks REFramework/_CatLib, installs our Lua.
// What the Discord presence currently shows (electron/discord.mjs)
interface DiscordStatus { state: 'off' | 'connecting' | 'live' | 'error'; details?: string | null; line2?: string | null }
interface SetupStatus { gameDir: string | null; reframework: boolean; catlib: boolean; lua: 'current' | 'updated' | 'skipped' | 'error'; error?: string }
declare global {
  interface Window {
    huntApp?: {
      setDiscord(cfg: { enabled: boolean; clientId: string; text: Record<string, string>; port: number }): void;
      getSetup(): Promise<SetupStatus>;
      getDiscordStatus(): Promise<DiscordStatus>;
      onDiscordStatus(cb: (st: DiscordStatus) => void): () => void;
    };
  }
}
const REFRAMEWORK_URL = 'https://github.com/praydog/REFramework-nightly/releases';
const CATLIB_URL = 'https://www.nexusmods.com/games/monsterhunterwilds/mods?keyword=CatLib';

function useCanvas(scale: number) {
  const calc = () => {
    const portrait = innerWidth / innerHeight < PORTRAIT_BELOW;
    const [minW, minH] = portrait ? [880, 1200] : [1280, 860];
    const zoom = Math.min(innerWidth / minW, innerHeight / minH) * scale;
    const w = innerWidth / zoom, h = innerHeight / zoom;
    const layout: Layout = portrait ? 'portrait' : w / h >= WIDE_FROM ? 'wide' : 'landscape';
    return { zoom, w, h, layout };
  };
  const [c, setC] = useState(calc);
  useEffect(() => {
    const fit = () => setC(calc());
    fit();
    addEventListener('resize', fit);
    return () => removeEventListener('resize', fit);
  }, [scale]);
  return c;
}

export default function App() {
  const { snap, link, samples, summary } = useHunt();
  const settings = useSettings();
  const { zoom, w, h, layout } = useCanvas(settings.scale);
  const [showSettings, setShowSettings] = useState(false);
  const setup = useSetup();
  const discord = useDiscordStatus();
  const inQuest = !!snap?.connected && !!snap.quest?.active;
  const { monster } = snap ? pickMonster(snap) : { monster: null };
  useAlertSound(inQuest && snap ? callouts(snap, monster) : [], settings.sound);
  useEffect(() => { window.huntApp?.setDiscord({ ...settings.discord, port: settings.port }); }, [settings.discord, settings.port]);

  // S opens settings, Esc closes, 1/2 switch tabs (spec §10: keyboard usable, nothing needed while playing)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowSettings(false);
      if (e.target instanceof HTMLInputElement) return;
      if (e.key.toLowerCase() === 's') setShowSettings((v) => !v);
      else if (e.key === '1' || e.key === '2') setSettings({ tab: e.key === '1' ? 'hunt' : 'hunter' });
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="h-full overflow-hidden">
      <div style={{ zoom, width: w, height: h }} className="flex flex-col gap-4 px-6 py-5 tabular-nums">
        <Header snap={snap} link={link} tab={settings.tab} discord={discord} onSettings={() => setShowSettings(true)} />
        <SetupNotice {...setup} />
        {settings.tab === 'hunter' ? (
          <HunterView profile={snap?.connected ? snap.profile ?? null : null} layout={layout} />
        ) : link === 'connecting' ? (
          <Center icon="clock" title={t.waitingBridge} sub={t.waitingBridgeHint} />
        ) : link === 'offline' ? (
          <Center icon="clock" title={t.waitingGame} sub={snap?.error} />
        ) : !inQuest ? (
          <HistoryView latest={summary} />
        ) : (
          <div className={cx('flex min-h-0 flex-1 flex-col gap-4 transition-opacity', link === 'stale' && 'opacity-50')}>
            <Dashboard snap={snap!} layout={layout} samples={samples} />
          </div>
        )}
      </div>
      {showSettings && <SettingsDialog onClose={() => setShowSettings(false)} setup={setup} discord={discord} />}
      {mockName && <MockSwitcher />}
    </div>
  );
}

/* ---------------------------------- setup ----------------------------------- */

// Desktop app only: on start the app installs/updates our Lua and checks REFramework + _CatLib (the user installs those).
function useSetup() {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [seenUpdate, setSeenUpdate] = useState(false);
  const check = () => { window.huntApp?.getSetup().then(setStatus).catch(() => {}); };
  useEffect(check, []);
  return { status, check, seenUpdate, dismiss: () => setSeenUpdate(true) };
}
type Setup = ReturnType<typeof useSetup>;
const setupProblem = (s: SetupStatus) => !s.gameDir || !s.reframework || !s.catlib || s.lua === 'error';

// Banner under the header: what's missing (with where to get it), or "reset scripts" after we updated the Lua.
function SetupNotice({ status, check, seenUpdate, dismiss }: Setup) {
  if (!status) return null;
  const problem = setupProblem(status);
  if (!problem && (status.lua !== 'updated' || seenUpdate)) return null;
  return (
    <div role="status" className={cx('flex shrink-0 flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border px-5 py-3 text-[15px]',
      problem ? 'border-accent/60 bg-accent/10' : 'border-gold/40 bg-surface-2')}>
      <Icon name={problem ? 'alert' : 'check'} size={22} className={problem ? 'text-accent' : 'text-gold'} />
      {problem ? <SetupList status={status} compact /> : <span className="min-w-0 flex-1">{t.setup.reset}</span>}
      <button type="button" onClick={problem ? check : dismiss}
        className="rounded-lg border border-line px-3 py-1.5 text-sm hover:border-gold focus-visible:outline-2 focus-visible:outline-gold">
        {problem ? t.setup.recheck : t.setup.dismiss}
      </button>
    </div>
  );
}

function SetupList({ status: st, compact }: { status: SetupStatus; compact?: boolean }) {
  const rows: [string, boolean, string, ReactNode?][] = [
    [t.setup.game, !!st.gameDir, st.gameDir ?? t.setup.noGame],
    [t.setup.reframework, st.reframework, st.reframework ? t.setup.ok : t.setup.missing,
      <a href={REFRAMEWORK_URL} target="_blank" rel="noreferrer" className="text-gold-hi underline">{t.setup.getReframework}</a>],
    [t.setup.catlib, st.catlib, st.catlib ? t.setup.ok : t.setup.missing,
      <a href={CATLIB_URL} target="_blank" rel="noreferrer" className="text-gold-hi underline">{t.setup.getCatlib}</a>],
    [t.setup.lua, st.lua === 'current' || st.lua === 'updated', `${t.setup.luaState[st.lua]}${st.error ? ` · ${st.error}` : ''}`],
  ];
  const shown = compact ? rows.filter(([, ok]) => !ok) : rows;
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      {compact && <span className="text-ink-2">{t.setup.needs}</span>}
      {shown.map(([name, ok, text, link]) => (
        <div key={name} className="flex min-w-0 flex-wrap items-baseline gap-x-3 text-sm">
          <span className={cx('size-2 shrink-0 self-center rounded-full', ok ? 'bg-ok' : 'bg-accent')} />
          <b className="font-semibold">{name}</b>
          <span className="min-w-0 truncate text-muted">{text}</span>
          {!ok && link}
        </div>
      ))}
    </div>
  );
}

/* --------------------------------- discord ---------------------------------- */

function useDiscordStatus() {
  const [st, setSt] = useState<DiscordStatus>({ state: 'off' });
  useEffect(() => {
    const app = window.huntApp;
    if (!app) return;
    app.getDiscordStatus().then(setSt).catch(() => {});
    return app.onDiscordStatus(setSt);
  }, []);
  return st;
}

const DISCORD_DOT: Record<DiscordStatus['state'], string> = { live: 'bg-[#5865F2]', connecting: 'bg-disabled', error: 'bg-accent', off: 'bg-disabled' };

// Header chip: what friends see in the member list right now (line 2), full text on hover
function DiscordChip({ st }: { st: DiscordStatus }) {
  if (st.state === 'off') return null;
  const text = st.state === 'live' ? st.line2 ?? t.settings.discordNothing : t.settings.discordStatus[st.state];
  return (
    <Chip className="max-w-64 gap-2.5">
      <span className={cx('size-2.5 shrink-0 rounded-full', DISCORD_DOT[st.state])} />
      <span className="flex min-w-0 flex-col leading-tight" title={[st.details, st.line2].filter(Boolean).join('\n') || text}>
        <span className="text-[10px] tracking-[1.5px] text-muted uppercase">Discord</span>
        <span className={cx('truncate text-sm', st.state === 'error' ? 'text-accent' : 'text-ink-2')}>{text}</span>
      </span>
    </Chip>
  );
}

/* ---------------------------------- sound ----------------------------------- */

// Short tones when something you should act on *appears*: capture, a monster disabled, enrage.
// Generated with Web Audio (no sound files). Browsers allow it only after a click, which the settings toggle provides.
let audio: AudioContext | null = null;
export function beep(freqs: number[]) {
  audio ??= new AudioContext();
  const ctx = audio;
  freqs.forEach((f, i) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    const at = ctx.currentTime + i * 0.14;
    o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.18, at + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.22);
    o.connect(g).connect(ctx.destination);
    o.start(at);
    o.stop(at + 0.25);
  });
}
const TONES: Partial<Record<Callout['kind'], number[]>> = { capture: [880, 1175], ailment: [660, 880], enrage: [440, 330] };

function useAlertSound(items: Callout[], on: boolean) {
  const seen = useRef(new Set<string>());
  useEffect(() => {
    const keys = new Set(items.filter((c) => TONES[c.kind]).map((c) => `${c.kind}:${'id' in c ? c.id : ''}:${c.who ?? ''}`));
    const fresh = [...keys].find((k) => !seen.current.has(k));
    seen.current = keys;
    if (on && fresh) beep(TONES[fresh.split(':')[0] as Callout['kind']]!);
  });
}

/**
 * Top: "do this now" for every monster. Middle: monsters. Player (our buffs + team damage) is its own block.
 * landscape/wide: one monster = full 3-column layout, 2–3 monsters = one complete pane each, side by side;
 *                 player block at the bottom (landscape) or right (wide).
 * portrait:       every monster gets a full-width pane, stacked; player block at the bottom.
 * Finished monsters (dead/captured) collapse into one slim "done" row so the live ones get the space;
 * when only one is still alive it goes back to the full single-monster layout.
 */
function Dashboard({ snap, layout, samples }: { snap: Snapshot; layout: Layout; samples: DamageSample[] }) {
  const { panels } = useSettings();
  const phys = physTypeFor(snap.player.weapon);
  const all = snap.monsters.slice(0, 3);
  const alive = all.filter((m) => hpState(m) !== 'done');
  const shown = alive.length > 0 ? alive : all; // all finished → keep showing them in full
  const finished = alive.length > 0 ? all.filter((m) => hpState(m) === 'done') : [];
  const monster = shown.find((m) => m.id === pickMonster(snap).monster?.id) ?? shown[0] ?? null;
  const multi = shown.length > 1;
  const done = finished.length > 0 && <DoneRow monsters={finished} />;
  const now = panels.now && <NowPanel items={callouts(snap, monster)} cols={layout === 'portrait' ? 2 : 4} done={done} />;

  if (layout === 'portrait') {
    return (
      <>
        {now}
        <div className="flex min-h-0 flex-1 flex-col gap-4">
          {shown.length === 0 && <MonsterCard monster={null} phys={phys} ringZoom={1} />}
          {shown.map((m) => (
            <MonsterPane key={m.id} m={m} phys={phys} selected={multi && m.id === monster?.id} ringZoom={multi ? 0.55 : 0.8} fitContent />
          ))}
        </div>
        <PlayerBlock snap={snap} samples={samples} direction="row" fitContent />
      </>
    );
  }

  const wide = layout === 'wide';
  // single monster: card + optional parts / ailments columns (settings can hide either)
  const cols = ['440px', panels.parts && 'minmax(0,1fr)', panels.ailments && (panels.parts ? '360px' : 'minmax(0,1fr)')].filter(Boolean).join(' ');
  const monsters = !multi ? (
    <div className="grid min-h-0 flex-1 gap-4" style={{ gridTemplateColumns: cols }}>
      <MonsterCard monster={monster} phys={phys} ringZoom={wide ? 1.1 : 0.9} />
      {panels.parts && <PartsPanel monster={monster} phys={phys} />}
      {panels.ailments && <AilmentsPanel ailments={monster?.ailments ?? []} />}
    </div>
  ) : (
    <div className="grid min-h-0 flex-1 gap-4" style={{ gridTemplateColumns: `repeat(${shown.length}, minmax(0, 1fr))` }}>
      {shown.map((m) => <MonsterPane key={m.id} m={m} phys={phys} selected={m.id === monster?.id} ringZoom={shown.length === 2 ? 0.62 : 0.5} />)}
    </div>
  );
  return (
    <>
      {now}
      {wide ? (
        <div className="flex min-h-0 flex-1 gap-4">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">{monsters}</div>
          <PlayerBlock snap={snap} samples={samples} direction="column" />
        </div>
      ) : (
        <>
          {monsters}
          <PlayerBlock snap={snap} samples={samples} direction="row" />
        </>
      )}
    </>
  );
}

// Finished monsters, one slim chip each: greyed icon · name · ✓ done.
function DoneRow({ monsters }: { monsters: Monster[] }) {
  return (
    <div className="flex min-w-0 shrink justify-end gap-2 overflow-hidden">
      {monsters.map((m) => {
        return (
          <div key={m.id} className="flex h-7 min-w-0 items-center gap-1.5 rounded-full border border-line bg-surface-2/80 pr-3 pl-0.5">
            <div className="flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-avatar text-disabled">
              <Icon name="claw" size={13} />
            </div>
            <span className="truncate font-display text-sm font-semibold text-ink-2 line-through decoration-disabled/60">{m.name}</span>
            <span className="flex shrink-0 items-center gap-1 text-sm font-semibold text-ok">
              <Icon name="check" size={16} stroke={2.4} />{t.done}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------------------------- player ---------------------------------- */

// "Us" block: our buffs/vitals + team damage. Bottom row (landscape/portrait) or right column (wide).
function PlayerBlock({ snap, samples, direction, fitContent }: { snap: Snapshot; samples: DamageSample[]; direction: 'row' | 'column'; fitContent?: boolean }) {
  const { panels } = useSettings();
  if (!panels.buffs && !panels.damage) return null;
  const buffs = panels.buffs && <BuffsPanel snap={snap} />;
  const damage = panels.damage && <DamageMeter {...partyViews(snap.party, snap.quest?.elapsedSec ?? 0)} samples={samples} />;
  if (direction === 'column') {
    return <div className="flex min-h-0 w-[360px] shrink-0 flex-col gap-4">{buffs}{damage}</div>;
  }
  const both = panels.buffs && panels.damage;
  return (
    <div className={cx('grid shrink-0 gap-4', both ? 'grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]' : 'grid-cols-1', !fitContent && 'h-[190px]')}>
      {buffs}{damage}
    </div>
  );
}

/* ---------------------------------- shared ---------------------------------- */

function Panel({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <section className={cx('wilds-panel', className)}>
      {children}
    </section>
  );
}

function Eyebrow({ icon, children, right }: { icon: IconName; children: ReactNode; right?: ReactNode }) {
  return (
    // Wilds-style section title: gold icon + serif title + gold rule fading out
    <div className="flex items-center gap-3">
      <Icon name={icon} size={18} stroke={1.8} className="shrink-0 text-gold" />
      <span className="shrink-0 font-display text-[15px] font-semibold tracking-wide text-gold-hi">{children}</span>
      <span className="h-px min-w-6 flex-1 bg-linear-to-r from-gold/50 to-transparent" />
      {right}
    </div>
  );
}

function Bar({ value, color, h = 10 }: { value: number; color: string; h?: number }) {
  return (
    <div className="overflow-hidden rounded-full bg-track" style={{ height: h }}>
      <div className="h-full rounded-full transition-[width] duration-250 ease-out" style={{ width: `${value * 100}%`, background: color }} />
    </div>
  );
}

function Tile({ icon, size, className, style }: { icon: IconName; size: number; className?: string; style?: CSSProperties }) {
  return (
    <div className={cx('flex shrink-0 items-center justify-center rounded-xl', className)} style={{ width: size, height: size, ...style }}>
      <Icon name={icon} size={Math.round(size * 0.53)} />
    </div>
  );
}

function Center({ icon, title, sub }: { icon: IconName; title: string; sub?: string }) {
  return (
    <Panel className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
      <Icon name={icon} size={44} stroke={1.8} className="text-muted" />
      <div className="text-[30px] font-bold">{title}</div>
      {sub && <div className="text-[17px] text-ink-2">{sub}</div>}
    </Panel>
  );
}

/* ---------------------------------- header ---------------------------------- */

const LINK_DOT: Record<Link, string> = { live: 'bg-ok shadow-[0_0_8px_#5BC489]', stale: 'bg-accent', offline: 'bg-disabled', connecting: 'bg-disabled' };

function Header({ snap, link, tab, discord, onSettings }: { snap: Snapshot | null; link: Link; tab: Tab; discord: DiscordStatus; onSettings: () => void }) {
  const q = snap?.connected ? snap.quest : undefined;
  const world = snap?.connected ? snap.world : null;
  return (
    // one row: title takes what's left (truncates); every control on the right is the same 48px tall
    <header className="flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-x-5 gap-y-3">
      <div className="flex min-w-0 flex-1 basis-64 items-center gap-3.5">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-gold-hi/40 bg-linear-to-br from-gold-hi to-gold text-on-accent shadow-[0_0_16px_rgb(200_169_106/0.3)]">
          <Icon name="claw" size={26} stroke={2.2} />
        </div>
        <div className="flex min-w-0 flex-col">
          <div className="font-deco text-[11px] tracking-[4px] text-gold">{t.brand}</div>
          <div className="truncate font-display text-xl font-semibold">
            {tab === 'hunter' ? t.tabs.hunter : q?.active ? `${q.name || t.quest} · ${t.hunting(snap!.monsters.length)}` : t.notInQuest}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2.5">
        {(q?.active || world) && (
          // quest time and the in-game clock share one chip
          <Chip className="gap-3">
            {q?.active && <>
              <span className="text-[26px] font-bold tracking-tight">{mmss(q.elapsedSec)}</span>
              <span className="flex flex-col text-xs leading-tight text-muted">
                {q.limitSec > 0 && <span>/ {mmss(q.limitSec)}</span>}
                {q.remainSec != null && q.remainSec > 0 && <span className="text-ink-2">{t.questRemain(mmss(q.remainSec))}</span>}
              </span>
            </>}
            {q?.active && world && <span className="h-7 w-px bg-line" />}
            {world && (
              <span className="flex items-center gap-1.5" title={t.phase[world.phase]}>
                <Icon name={world.phase === 'night' || world.phase === 'dusk' ? 'moon' : 'sun'} size={18} stroke={1.8} className="text-moon" />
                <span className="text-[15px] font-semibold">{world.clock}</span>
              </span>
            )}
          </Chip>
        )}
        <DiscordChip st={discord} />
        <nav aria-label={t.tabs.key} title={t.tabs.key} className="flex h-12 items-center rounded-xl border border-line bg-surface/90 p-1">
          {(['hunt', 'hunter'] as const).map((k, i) => (
            <button key={k} type="button" onClick={() => setSettings({ tab: k })} aria-current={tab === k}
              className={cx('flex h-full items-center gap-1.5 rounded-lg px-3.5 font-display text-[15px] font-semibold focus-visible:outline-2 focus-visible:outline-gold',
                tab === k ? 'bg-[#2A2014] text-gold-hi shadow-[inset_0_0_0_1px_rgb(200_169_106/0.35)]' : 'text-muted hover:text-ink')}>
              {t.tabs[k]}<kbd className="font-sans text-[10px] font-normal text-muted">{i + 1}</kbd>
            </button>
          ))}
        </nav>
        {/* connection: just a dot while all is well, spelled out when it isn't */}
        <Chip className={cx('gap-2', link === 'live' && 'w-12 justify-center px-0')}>
          <span className={cx('size-2.5 shrink-0 rounded-full', LINK_DOT[link])} title={t.link[link]} aria-label={t.link[link]} role="img" />
          {link !== 'live' && <span className={cx('text-sm whitespace-nowrap', link === 'stale' ? 'text-accent' : 'text-ink-2')}>{t.link[link]}</span>}
        </Chip>
        <button type="button" onClick={onSettings} title={t.settings.open} aria-label={t.settings.open}
          className="flex size-12 items-center justify-center rounded-xl border border-line bg-surface/90 text-muted hover:border-gold hover:text-gold-hi focus-visible:outline-2 focus-visible:outline-gold">
          <Icon name="gear" size={22} stroke={1.8} />
        </button>
      </div>
    </header>
  );
}

function Chip({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('flex h-12 items-center gap-2.5 rounded-xl border border-line bg-surface/90 px-4 shadow-[inset_0_1px_0_rgb(230_204_143/0.07)]', className)}>{children}</div>;
}

/* ------------------------------- monster pane ------------------------------- */

// Everything about one monster in one frame, used when the quest has 2–3 monsters side by side.
// The one you hit last gets a gold frame.
function MonsterPane({ m, phys, selected, ringZoom, fitContent }: { m: Monster; phys: PhysType | null; selected: boolean; ringZoom: number; fitContent?: boolean }) {
  const { panels } = useSettings();
  const state = hpState(m);
  const done = state === 'done';
  const broken = m.parts.filter((p) => p.broken).length;
  return (
    <Panel className={cx('flex min-h-0 min-w-0 flex-col gap-3 p-4', fitContent ? 'flex-auto' : 'flex-1', selected && 'border-gold! shadow-[0_0_20px_rgb(200_169_106/0.2)]', done && 'opacity-70')}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className={cx('flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 bg-avatar',
            done ? 'border-disabled text-disabled' : 'border-gold text-gold')}>
            <Icon name="claw" size={24} />
          </div>
          <div className="min-w-0">
            <div className={cx('truncate font-display text-[24px] leading-[1.15] font-bold', selected && 'text-gold-hi')}>{m.name}</div>
          </div>
        </div>
        {m.enraged && !done && <EnrageBadge remainSec={m.enrageRemainSec} />}
      </div>

      <div className="flex items-center gap-3">
        <div className="shrink-0" style={{ zoom: ringZoom }}><HpRing m={m} state={state} /></div>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {state === 'capture' && <CaptureBanner />}
          {done && <div className="rounded-xl border border-line bg-surface-2 p-2.5 text-center text-lg font-bold text-ink-2">{t.done}</div>}
          {!done && <WeakStrip hitzones={m.hitzones} phys={phys} />}
          <div className="flex gap-2 text-[13px] text-muted">
            {m.wounds != null && <span className="rounded-lg bg-surface-2 px-2.5 py-1.5">{t.wounds} <b className="text-[17px] text-danger-ink">{m.wounds}</b></span>}
            {m.parts.length > 0 && <span className="rounded-lg bg-surface-2 px-2.5 py-1.5">{t.breaks} <b className="text-[17px] text-info-soft">{broken}/{m.parts.length}</b></span>}
          </div>
        </div>
      </div>

      {(panels.parts || panels.ailments) && (
        <div className={cx('grid min-h-0 flex-1 gap-3', panels.parts && panels.ailments ? 'grid-cols-2' : 'grid-cols-1')}>
          {panels.parts && <PartsPanel monster={m} phys={phys} bare />}
          {panels.ailments && <AilmentsPanel ailments={m.ailments} bare />}
        </div>
      )}
    </Panel>
  );
}

/* ------------------------------- monster card ------------------------------- */

function MonsterCard({ monster: m, ringZoom, phys }: { monster: Monster | null; ringZoom: number; phys: PhysType | null }) {
  if (!m) return <Panel className="flex items-center justify-center p-6 text-[21px] text-muted">{t.noMonster}</Panel>;
  const state = hpState(m);
  const done = state === 'done';
  const broken = m.parts.filter((p) => p.broken).length;
  const sizeLine = [m.sizePct != null && t.size(m.sizePct), m.crown && t.crown[m.crown]].filter(Boolean).join(' · ');
  const raw = m.scars.filter((s) => s.state === 'raw').length;
  const tear = m.scars.filter((s) => s.state === 'tear').length;

  return (
    <Panel className="flex min-h-0 flex-col gap-4 p-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3.5">
          <div className={cx('flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 bg-avatar',
            done ? 'border-disabled text-disabled' : 'border-gold text-gold shadow-[0_0_14px_rgb(200_169_106/0.25)]')}>
            <Icon name="claw" size={30} />
          </div>
          <div className="min-w-0">
            <div className="truncate font-display text-[30px] leading-[1.15] font-bold">{m.name}</div>
            {sizeLine && (
              <div className="flex items-center gap-1.5 text-[15px] text-crown">
                {m.crown && <Icon name="crown" size={16} />}
                <span className="truncate">{sizeLine}</span>
              </div>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          {m.enraged && !done && <EnrageBadge remainSec={m.enrageRemainSec} />}
        </div>
      </div>

      <FitRing max={ringZoom}><HpRing m={m} state={state} /></FitRing>

      {state === 'capture' && <CaptureBanner />}
      {done && (
        <div className="flex items-center justify-center gap-2.5 rounded-xl border border-line bg-surface-2 p-[13px] text-[21px] font-bold text-ink-2">
          <Icon name="check" size={24} stroke={2.2} />
          <span>{t.done}</span>
        </div>
      )}

      {!done && <WeakStrip hitzones={m.hitzones} phys={phys} />}

      <div className="mt-auto flex flex-wrap gap-2 text-[13px] text-muted">
        {m.wounds != null && (
          <span className="rounded-lg bg-surface-2 px-3 py-2">
            {t.wounds} <b className="text-xl text-danger-ink">{m.wounds}</b>
            {raw + tear > 0 && <span className="ml-1.5 text-danger-ink/80">({[raw > 0 && `${t.scar.raw} ${raw}`, tear > 0 && `${t.scar.tear} ${tear}`].filter(Boolean).join(' · ')})</span>}
          </span>
        )}
        {m.parts.length > 0 && <span className="rounded-lg bg-surface-2 px-3 py-2">{t.breaks} <b className="text-xl text-info-soft">{broken} / {m.parts.length}</b></span>}
      </div>
    </Panel>
  );
}

const RING_R = 130;
const RING_C = 2 * Math.PI * RING_R;
const ZONE_R = 149; // thin outer arc marking the capture zone
const ZONE_C = 2 * Math.PI * ZONE_R;

// The ring takes whatever height the card has left (up to `max` zoom), so the rows below it never get pushed out.
const RING_PX = 304;
function FitRing({ max, children }: { max: number; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(max);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setZoom(Math.max(0.35, Math.min(max, el.clientHeight / RING_PX, el.clientWidth / RING_PX)));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [max]);
  return (
    <div ref={box} className="flex min-h-0 flex-1 basis-0 items-center justify-center overflow-hidden">
      <div style={{ zoom }}>{children}</div>
    </div>
  );
}

function HpRing({ m, state }: { m: Monster; state: ReturnType<typeof hpState> }) {
  const r = ratio(m.hp, m.hpMax);
  const color = state === 'done' ? '#8A7C66' : state === 'capture' ? '#F2A541' : '#5AA9E6';
  const th = m.captureThreshold;
  const a = (th ?? 0) * 2 * Math.PI; // clockwise from 12 o'clock
  return (
    <div className="relative size-[304px] shrink-0 self-center">
      <svg width="304" height="304" viewBox="-2 -2 304 304" className="absolute inset-0 -rotate-90 overflow-visible">
        <circle cx="150" cy="150" r={RING_R} fill="none" stroke="#2A2219" strokeWidth="24" />
        {th != null && state !== 'done' && (
          <circle cx="150" cy="150" r={ZONE_R} fill="none" stroke="#F2A541" strokeOpacity={state === 'capture' ? 0.9 : 0.4} strokeWidth="4"
            strokeLinecap="round" strokeDasharray={`${ZONE_C * th} ${ZONE_C}`} />
        )}
        {r > 0 && (
          <circle cx="150" cy="150" r={RING_R} fill="none" stroke={color} strokeWidth="24" strokeLinecap="round"
            strokeDasharray={`${RING_C * r} ${RING_C}`}
            style={{
              transition: 'stroke-dasharray 250ms ease-out, stroke 250ms ease-out',
              filter: state === 'capture' ? 'drop-shadow(0 0 10px rgb(242 165 65 / 0.55))' : 'drop-shadow(0 0 6px rgb(90 169 230 / 0.25))',
            }} />
        )}
      </svg>
      {th != null && state !== 'done' && (
        <svg width="304" height="304" viewBox="-2 -2 304 304" className="absolute inset-0 overflow-visible">
          <line x1={150 + 112 * Math.sin(a)} y1={150 - 112 * Math.cos(a)} x2={150 + 153 * Math.sin(a)} y2={150 - 153 * Math.cos(a)}
            stroke="#E8E6E1" strokeWidth="3" strokeLinecap="round" />
        </svg>
      )}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
        <div className="text-[13px] tracking-[3px] text-muted">HP</div>
        <div className={cx('text-[92px] leading-[0.95] font-bold', state === 'done' && 'text-disabled', state === 'capture' && 'text-accent')}>
          {pct(m.hp, m.hpMax)}<span className="text-[40px]">%</span>
        </div>
        <div className="text-[15px] text-muted">{fmtInt(Math.max(0, m.hp))} / {fmtInt(m.hpMax)}</div>
      </div>
    </div>
  );
}

function WeakStrip({ hitzones, phys }: { hitzones: Hitzone[]; phys: PhysType | null }) {
  const spots = weakSpots(hitzones, phys);
  const els = elementRank(hitzones).slice(0, 3).map((e) => ({ el: e.el, label: String(e.value) }));
  if (spots.length === 0 && els.length === 0) return null;
  return (
    <div className="grid grid-cols-[64px_1fr] items-center gap-x-3 gap-y-2 rounded-xl border border-line/70 bg-surface-2/80 px-3.5 py-3">
      {spots.length > 0 && <span className="text-[13px] text-muted">{t.weakTitle}</span>}
      {spots.length > 0 && (
        <div className="flex min-w-0 flex-wrap gap-1.5">
          {spots.map((s, i) => (
            <span key={s.name} className={cx('flex min-w-0 items-center gap-1.5 rounded-lg px-2.5 py-1 text-[15px] font-semibold',
              i === 0 ? 'bg-info-bg text-info-soft' : 'bg-track text-ink-2')}>
              <span className="truncate">{s.name}</span>
              <span className={cx('shrink-0', s.value >= WEAK_HITZONE ? 'font-bold' : 'text-muted')}>{s.value}</span>
            </span>
          ))}
        </div>
      )}
      {els.length > 0 && <span className="text-[13px] text-muted">{t.elementTitle}</span>}
      {els.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {els.map((e) => {
            return (
              <span key={e.el} className="flex items-center gap-1.5 rounded-lg bg-track px-2.5 py-1 text-[15px] font-semibold" style={{ color: ELEMENT_COLORS[e.el] }}>
                <Icon name={iconFor(e.el)} size={16} />
                {t.element[e.el]} <span className="text-ink">{e.label}</span>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

function EnrageBadge({ remainSec }: { remainSec?: number | null }) {
  return (
    <div className="flex animate-enrage-in items-center gap-2 rounded-xl border border-danger bg-danger-bg px-3 py-2 text-danger-ink">
      <Icon name="flame" size={22} />
      <div className="flex flex-col leading-[1.1]">
        <span className="text-[13px]">{t.enraged}</span>
        {remainSec != null && <span className="text-xl font-bold">{mmss(remainSec)}</span>}
      </div>
    </div>
  );
}

function CaptureBanner() {
  return (
    <div className="flex animate-capture-in items-center justify-center gap-2.5 rounded-xl bg-accent p-[13px] text-[21px] font-bold text-on-accent">
      <Icon name="target" size={24} stroke={2.2} />
      <span>{t.capture}</span>
    </div>
  );
}

/* ------------------------------ "do this now" ------------------------------ */

function NowPanel({ items, cols = 4, done }: { items: Callout[]; cols?: 2 | 4; done?: ReactNode }) {
  return (
    <Panel className="flex shrink-0 flex-col gap-3 px-5 py-4">
      <Eyebrow icon="alert" right={done}>{t.nowTitle}</Eyebrow>
      <div className={cx('grid gap-2.5', cols === 2 ? 'grid-cols-2' : 'grid-cols-4')}>
        {items.length === 0 && (
          <div className="col-span-full flex h-16 items-center justify-center rounded-xl border border-dashed border-line text-[17px] text-muted">
            {t.nowEmpty}
          </div>
        )}
        {items.map((c, i) => <CalloutTile key={`${c.kind}-${'id' in c ? c.id : 'name' in c ? c.name : i}`} c={c} />)}
      </div>
    </Panel>
  );
}

function CalloutTile({ c }: { c: Callout }) {
  let icon: IconName = 'alert', title = '', detail = '', time: number | null | undefined;
  let className = '', style: CSSProperties | undefined, timeClass = '';
  switch (c.kind) {
    case 'capture':
      [title, detail] = t.now.capture; icon = 'target';
      className = 'animate-capture-in bg-accent border-accent text-on-accent';
      break;
    case 'ailment': {
      const [color, bg] = ailColors(c.id);
      title = t.ailment[c.id] ?? c.id; detail = t.now.ailment; icon = iconFor(c.id, 'star'); time = c.remainSec;
      style = { background: bg, borderColor: color, color };
      className = 'animate-enrage-in border-l-4';
      break;
    }
    case 'enrage':
      [title, detail] = t.now.enrage; icon = 'flame'; time = c.remainSec;
      className = 'animate-enrage-in bg-danger-bg border-danger text-danger-ink';
      break;
    case 'part':
      [title, detail] = t.now.part(c.name, c.remain); icon = 'hammer';
      className = 'bg-accent-bg border-accent-line text-accent';
      break;
    case 'buff':
      [title, detail] = t.now.buff(c.name); icon = 'flask'; time = c.remainSec;
      className = 'bg-accent-warn border-accent-line text-accent';
      break;
    case 'buildup': {
      const [color, bg] = ailColors(c.id);
      [title, detail] = t.now.buildup(t.ailment[c.id] ?? c.id, c.pct); icon = iconFor(c.id, 'star');
      style = { background: bg, borderColor: `${color}55`, color };
      timeClass = 'hidden';
      break;
    }
  }
  return (
    <div className={cx('flex h-16 min-w-0 items-center gap-3 rounded-xl border px-3.5', className)} style={style}>
      <Icon name={icon} size={26} stroke={2.2} className="shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="truncate text-[19px] font-bold">{c.who ? `${c.who} · ${title}` : title}</span>
        <span className="truncate text-[13px] opacity-80">{detail}</span>
      </div>
      {time != null && <span className={cx('shrink-0 text-[26px] font-bold', timeClass)}>{mmss(time)}</span>}
    </div>
  );
}

/* ----------------------------------- parts ---------------------------------- */

function PartsPanel({ monster, phys, bare }: { monster: Monster | null; phys: PhysType | null; bare?: boolean }) {
  const parts = monster ? partViews(monster.parts) : [];
  const zones = new Map(monster?.hitzones.map((h) => [h.id, physValue(h, phys)]));
  const scars = new Map(monster?.scars.map((s) => [s.partId, s]));

  // FLIP reorder (spec §8): remember each row's top, animate from the old spot.
  const rows = useRef(new Map<string, HTMLElement>());
  const tops = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    rows.current.forEach((el, id) => {
      const top = el.offsetTop;
      const old = tops.current.get(id);
      if (!reduce && old != null && old !== top) {
        el.animate([{ transform: `translateY(${old - top}px)` }, { transform: 'none' }], { duration: 250, easing: 'ease-in-out' });
      }
      tops.current.set(id, top);
    });
  });

  const body = (
    <>
      <Eyebrow icon="hammer" right={!bare && <span className="text-sm text-muted">{t.partsSort}</span>}>{t.partsTitle}</Eyebrow>
      {parts.length === 0 && <div className="py-6 text-center text-[17px] text-muted">{t.noParts}</div>}
      <div className="relative -mx-1 flex min-h-0 flex-col gap-2.5 overflow-y-auto px-1">
        {parts.map((p) => (
          <PartRow key={p.id} p={p} hitzone={zones.get(p.id)} scar={scars.get(p.id)} compact={bare}
            rowRef={(el) => { if (el) rows.current.set(p.id, el); else rows.current.delete(p.id); }} />
        ))}
      </div>
    </>
  );
  return bare
    ? <div className="flex min-h-0 min-w-0 flex-col gap-2.5">{body}</div>
    : <Panel className="flex min-h-0 flex-1 flex-col gap-3 px-6 py-5">{body}</Panel>;
}

const PART_STYLE = {
  normal: { row: 'bg-surface-2 border-surface-2', tile: 'bg-info-bg text-info-soft', label: 'text-ink', bar: '#5AA9E6' },
  near: { row: 'bg-accent-bg border-accent-line', tile: 'bg-accent-tile text-accent', label: 'text-accent', bar: '#F2A541' },
  broken: { row: 'bg-surface-2/60 border-transparent', tile: 'bg-track text-disabled', label: 'text-disabled', bar: '#5AA9E6' },
};

function PartRow({ p, hitzone, scar, compact, rowRef }: { p: PartView; hitzone?: number; scar?: Scar; compact?: boolean; rowRef: (el: HTMLElement | null) => void }) {
  const s = PART_STYLE[p.variant];
  const wasBroken = useRef(p.broken);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (p.broken && !wasBroken.current) setFlash(true);
    wasBroken.current = p.broken;
  }, [p.broken]);

  const label = p.variant === 'broken' ? t.partBroken : p.variant === 'near' ? t.partLeft(p.remain) : `${p.remain}%`;
  return (
    <div ref={rowRef} onAnimationEnd={() => setFlash(false)}
      className={cx('flex shrink-0 items-center rounded-[14px] border', compact ? 'gap-2.5 px-3 py-2' : 'gap-4 px-4 py-3', s.row, flash && 'animate-break-flash')}>
      <Tile icon={p.broken ? 'check' : iconFor(p.kind, 'claw')} size={compact ? 32 : 42} className={s.tile} />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className={cx('min-w-12 truncate font-semibold', compact ? 'text-[17px]' : 'text-[21px]', p.broken && 'text-disabled')}>{p.name}</span>
            {/* narrow panes: icon-only chips so the part name keeps its room */}
            {scar && !p.broken && (
              <span title={t.scar[scar.state]} className="shrink-0 rounded-md bg-danger-bg px-1.5 py-0.5 text-xs font-semibold text-danger-ink">
                {compact ? <Icon name="wound" size={12} stroke={2.4} /> : t.scar[scar.state]}
              </span>
            )}
            {hitzone != null && hitzone >= WEAK_HITZONE && !p.broken && (
              <span className="shrink-0 rounded-md bg-info-bg px-1.5 py-0.5 text-xs font-semibold text-info-soft">★{compact ? '' : ` ${hitzone}`}</span>
            )}
          </div>
          <span className={cx('shrink-0 text-[17px] font-semibold', s.label)}>{label}</span>
        </div>
        <Bar value={p.broken ? 0 : p.remain / 100} color={s.bar} />
      </div>
    </div>
  );
}

/* --------------------------------- ailments --------------------------------- */

function AilmentsPanel({ ailments, bare }: { ailments: Ailment[]; bare?: boolean }) {
  // active first (they're the ones to act on), then closest to triggering
  const sorted = [...ailments].sort((a, b) => Number(!!b.active) - Number(!!a.active) || b.buildup - a.buildup);
  const body = (
    <>
      <Eyebrow icon="bolt">{t.ailmentsTitle}</Eyebrow>
      {sorted.length === 0 && <div className="text-[15px] text-muted">{t.noAilments}</div>}
      <div className="-mx-1 flex min-h-0 flex-col gap-2.5 overflow-y-auto px-1">
        {sorted.map((a) => <AilmentRow key={a.id} a={a} />)}
      </div>
    </>
  );
  return bare
    ? <div className="flex min-h-0 min-w-0 flex-col gap-2.5">{body}</div>
    : <Panel className="flex min-h-0 flex-col gap-3 px-[22px] py-5">{body}</Panel>;
}

function AilmentRow({ a }: { a: Ailment }) {
  const [color, bg] = ailColors(a.id);
  const p = pct(a.buildup, 1);
  const hot = p >= 75;
  return (
    <div className={cx('flex shrink-0 items-center gap-3 rounded-xl', a.active && 'border px-2.5 py-2')}
      style={a.active ? { background: bg, borderColor: color } : undefined}>
      <Tile icon={iconFor(a.id, 'star')} size={36} className="rounded-[10px]" style={{ background: bg, color }} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[17px] font-semibold" style={a.active ? { color } : undefined}>{t.ailment[a.id] ?? a.id}</span>
          {a.active ? (
            <span className="shrink-0 text-[15px] font-bold" style={{ color }}>
              {t.ailmentActive}{a.remainSec != null && <span className="ml-1.5 text-xl">{mmss(a.remainSec)}</span>}
            </span>
          ) : (
            <span className="shrink-0 text-sm text-muted">
              ×{a.procs} · <b className={hot ? 'font-bold' : 'font-semibold text-ink'} style={hot ? { color } : undefined}>{p}%</b>
            </span>
          )}
        </div>
        {!a.active && <Bar value={p / 100} color={color} h={8} />}
      </div>
    </div>
  );
}

/* ----------------------------------- buffs ---------------------------------- */

const BUFF_STYLE = {
  normal: { card: 'bg-surface-2 border-surface-2', icon: 'text-buff', time: 'text-ink' },
  infinite: { card: 'bg-surface-2 border-surface-2', icon: 'text-buff', time: 'text-ink' },
  warn: { card: 'bg-accent-warn border-accent-line', icon: 'text-accent', time: 'text-accent' },
  cooldown: { card: 'bg-surface-2/50 border-dashed border-line', icon: 'text-muted', time: 'text-muted' }, // mantle recharging: info, not an alert
};

function BuffsPanel({ snap }: { snap: Snapshot }) {
  const buffs = buffViews(snap.player.buffs);
  const v = snap.player.vitals;
  return (
    <Panel className="flex min-h-0 flex-1 flex-col gap-2 px-5 py-3.5">
      <Eyebrow icon="shield">{t.buffsTitle}</Eyebrow>
      {v && (v.hpMax || v.staminaMax) ? <VitalsBars v={v} /> : null}
      {buffs.length === 0 && <div className="text-[15px] text-muted">{t.noBuffs}</div>}
      <div className="grid min-h-0 grid-cols-[repeat(auto-fill,minmax(180px,1fr))] content-start gap-2 overflow-y-auto">
        {buffs.map((b) => {
          const s = BUFF_STYLE[b.variant];
          const icon: IconName = b.kind === 'song' ? 'note' : b.kind === 'mantle' ? 'shield' : iconFor(b.id, 'flask');
          return (
            // one line: icon · name · time — four fit in two rows of the bottom player block
            <div key={b.id} className={cx('flex h-11 min-w-0 items-center gap-2.5 rounded-xl border px-3', s.card)}>
              <Icon name={icon} size={18} className={cx('shrink-0', s.icon)} />
              <span className="min-w-0 flex-1 truncate text-sm text-ink-2">{b.name}{b.cooldown && <span className="ml-1.5 text-xs text-muted">{t.cooldown}</span>}</span>
              <span className={cx('shrink-0 text-[22px] leading-none font-bold', s.time)}>{b.remainSec == null ? '∞' : mmss(b.remainSec)}</span>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

// Our HP (green, red part = recoverable) and stamina (yellow) as two thin bars.
function VitalsBars({ v }: { v: Vitals }) {
  const hp = ratio(v.hp ?? 0, v.hpMax ?? 0), red = ratio((v.hp ?? 0) + (v.hpRed ?? 0), v.hpMax ?? 0);
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 text-[13px]">
      {v.hpMax ? <>
        <span className="text-muted">{t.vitals.hp}</span>
        <div className="relative h-2.5 overflow-hidden rounded-full bg-track">
          <div className="absolute inset-y-0 left-0 rounded-full bg-danger/50" style={{ width: `${red * 100}%` }} />
          <div className="absolute inset-y-0 left-0 rounded-full bg-ok transition-[width] duration-250" style={{ width: `${hp * 100}%` }} />
        </div>
        <span className="font-semibold text-ink">{Math.round(v.hp ?? 0)}</span>
      </> : null}
      {v.staminaMax ? <>
        <span className="text-muted">{t.vitals.stamina}</span>
        <Bar value={ratio(v.stamina ?? 0, v.staminaMax)} color="#E6C84A" h={8} />
        <span className="font-semibold text-ink">{Math.round(v.stamina ?? 0)}</span>
      </> : null}
    </div>
  );
}

/* ------------------------------- damage meter ------------------------------- */

function DamageMeter({ members, dps, samples }: ReturnType<typeof partyViews> & { samples?: DamageSample[] }) {
  let other = 0;
  return (
    // one row per hunter: name | bar | damage · % | crit  (fits both the bottom row and the right column)
    <Panel className="flex min-h-0 flex-1 flex-col gap-2 px-5 py-3.5">
      <Eyebrow icon="sword" right={<span className="shrink-0 text-[15px] text-ink-2">DPS <b className="text-ink">{dps.toFixed(1)}</b></span>}>{t.damageTitle}</Eyebrow>
      {members.length === 0 && <div className="text-[15px] text-muted">{t.noDamage}</div>}
      <div className="relative flex min-h-0 flex-1 flex-col justify-center gap-1.5 overflow-y-auto">
        {/* DPS trend sits faintly behind the rows so it costs no height */}
        {samples && samples.length > 2 && (
          <div className="pointer-events-none absolute inset-0 opacity-35"><DpsChart samples={samples} height={0} fill /></div>
        )}
        {members.map((m, i) => {
          const color = m.self ? '#F2A541' : PARTY_COLORS[other++ % PARTY_COLORS.length];
          return (
            <div key={`${m.name}-${i}`} className={cx('grid grid-cols-[minmax(0,100px)_minmax(0,1fr)_auto_auto] items-center gap-3', m.palico && 'pl-4 opacity-80')}>
              <div className="flex min-w-0 items-center gap-2">
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: color }} />
                <span className={cx('truncate text-[15px] font-semibold', m.self && 'text-accent')}>{m.name}</span>
              </div>
              <Bar value={m.pct / 100} color={color} h={8} />
              <span className="text-right text-sm text-muted">{fmtInt(m.damage)} · <b className="text-ink">{m.pct}%</b></span>
              <span className="w-14 text-right text-xs text-muted" title={t.critTitle}>{m.critPct != null ? `${t.crit} ${m.critPct}%` : ''}</span>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

// Rolling 15s DPS over the quest: team (blue area) and you (orange line).
function DpsChart({ samples, height, fill }: { samples: DamageSample[]; height: number; fill?: boolean }) {
  const pts = dpsSeries(samples);
  const W = 600, H = fill ? 100 : height;
  const tMax = pts.at(-1)?.t || 1;
  const yMax = Math.max(1, ...pts.map((p) => p.team));
  const x = (v: number) => (v / tMax) * W;
  const y = (v: number) => H - (v / yMax) * (H - 2);
  const line = (k: 'team' | 'self') => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p[k]).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={cx('w-full shrink-0', fill && 'h-full')}
      style={fill ? undefined : { height }} aria-label={t.dpsChart}>
      <path d={`${line('team')} L${W},${H} L0,${H} Z`} fill="rgb(90 169 230 / 0.18)" />
      <path d={line('team')} fill="none" stroke="#5AA9E6" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      <path d={line('self')} fill="none" stroke="#F2A541" strokeWidth="1.8" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/* ------------------------------ post-quest summary ------------------------------ */

// Out of a quest: the latest hunt's summary, plus a strip of earlier hunts to flip through (click or ←/→).
function HistoryView({ latest }: { latest: { snap: Snapshot; samples: DamageSample[]; uptime: HuntRecord['uptime'] } | null }) {
  const records = useHistory();
  const [i, setI] = useState(0);
  useEffect(() => { setI(0); }, [records.length]); // a new hunt was saved → show it
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setI((v) => Math.min(v + 1, records.length - 1));
      else if (e.key === 'ArrowLeft') setI((v) => Math.max(v - 1, 0));
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [records.length]);
  const r = records[i];
  if (!r && !latest) return <Center icon="target" title={t.notInQuest} />;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {r ? <SummaryView snap={r.snap} samples={r.samples} uptime={r.uptime} /> : <SummaryView snap={latest!.snap} samples={latest!.samples} uptime={latest!.uptime} />}
      {records.length > 1 && (
        <nav aria-label={t.summary.history} className="flex shrink-0 gap-2 overflow-x-auto pb-1">
          {records.map((h, k) => {
            const self = h.snap.party.find((m) => m.self);
            return (
              <button key={h.id} type="button" onClick={() => setI(k)} aria-current={k === i}
                className={cx('flex min-w-44 shrink-0 flex-col items-start gap-0.5 rounded-xl border px-3 py-2 text-left text-xs',
                  k === i ? 'border-gold bg-[#241C12] text-ink' : 'border-line bg-surface/80 text-ink-2 hover:border-gold/60')}>
                <span className="text-muted">{new Date(h.endedAt).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                <span className="max-w-40 truncate font-display text-sm font-semibold">{h.snap.monsters.map((m) => m.name).join(', ') || t.quest}</span>
                <span>{mmss(h.snap.quest?.elapsedSec ?? 0)} · {fmtInt(self?.damage ?? 0)}</span>
              </button>
            );
          })}
        </nav>
      )}
    </div>
  );
}

function SummaryView({ snap, samples, uptime }: { snap: Snapshot; samples: DamageSample[]; uptime?: HuntRecord['uptime'] }) {
  const s = questSummary(snap);
  let other = 0;
  return (
    <Panel className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-8 py-6">
      <div className="flex items-baseline justify-between gap-4">
        <Eyebrow icon="check">{t.summary.title}</Eyebrow>
        <span className="shrink-0 text-[15px] text-muted">{t.summary.time} <b className="text-2xl text-ink">{mmss(s.elapsed)}</b></span>
      </div>
      <div className="flex flex-wrap gap-3">
        {s.monsters.map((m) => (
          <div key={m.name} className="flex min-w-60 flex-1 items-center gap-3 rounded-xl border border-line bg-surface-2 px-4 py-3">
            <Icon name={m.done ? 'check' : 'claw'} size={22} className={m.done ? 'text-ok' : 'text-muted'} />
            <div className="min-w-0 flex-1">
              <div className="truncate font-display text-lg font-semibold">{m.name}</div>
              <div className="text-[13px] text-muted">{m.done ? t.done : t.summary.hpLeft(m.hpPct)} · {t.breaks} {m.broken}/{m.parts}</div>
            </div>
          </div>
        ))}
      </div>
      {s.procs.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-[15px]">
          <span className="text-muted">{t.summary.procs}</span>
          {s.procs.map((p) => {
            const [color, bg] = ailColors(p.id);
            return <span key={p.id} className="rounded-lg px-2.5 py-1 font-semibold" style={{ color, background: bg }}>{t.ailment[p.id] ?? p.id} ×{p.n}</span>;
          })}
        </div>
      )}
      {samples.length > 2 && <DpsChart samples={samples} height={110} />}
      {uptime && Object.keys(uptime).length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-[13px] text-muted">{t.summary.uptime}</span>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-x-6 gap-y-2">
            {uptimeViews(uptime, s.elapsed).map((u) => (
              <div key={u.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-3 text-sm">
                <span className="truncate text-ink-2">{u.name}</span>
                <Bar value={u.pct / 100} color={u.pct >= 80 ? '#8FD3A8' : '#C8A96A'} h={6} />
                <b className="w-10 text-right">{u.pct}%</b>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="grid grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,1fr))] gap-x-4 gap-y-2.5 text-[15px]">
        {[t.summary.hunter, t.summary.damage, 'DPS', t.crit, t.summary.weak].map((h) => <span key={h} className="text-[13px] text-muted">{h}</span>)}
        {s.party.members.map((m, i) => {
          const color = m.self ? '#F2A541' : PARTY_COLORS[other++ % PARTY_COLORS.length];
          return [
            <span key={`n${i}`} className={cx('flex min-w-0 items-center gap-2 font-semibold', m.self && 'text-accent')}>
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: color }} /><span className="truncate">{m.name}</span>
            </span>,
            <span key={`d${i}`}>{fmtInt(m.damage)} <span className="text-muted">({m.pct}%)</span></span>,
            <span key={`p${i}`}>{m.dps.toFixed(1)}</span>,
            <span key={`c${i}`}>{m.critPct != null ? `${m.critPct}%` : '—'}</span>,
            <span key={`w${i}`}>{m.weakPct != null ? `${m.weakPct}%` : '—'}</span>,
          ];
        })}
      </div>
    </Panel>
  );
}

/* ------------------------------- hunter tab ------------------------------- */

const hms = (sec: number) => (sec >= 3600 ? `${Math.floor(sec / 3600)}:${mmss(sec % 3600).padStart(5, '0')}` : mmss(sec));

// Separate from the hunt: who we are (HR, weapon, active skills from the game) + totals from our own hunt history.
// Works without the game too (history is local). Gear / attack stats / save-data stats come in phase 2 (probe.lua).
function HunterView({ profile, layout }: { profile: Profile | null; layout: Layout }) {
  const st = historyStats(useHistory());
  const portrait = layout === 'portrait';
  const has = st.hunts > 0;
  const stats: [string, string][] = [
    [t.hunter.hunts, has ? String(st.hunts) : '—'], [t.hunter.totalTime, has ? hms(st.totalSec) : '—'],
    [t.hunter.totalDamage, has ? fmtInt(st.selfDamage) : '—'], [t.hunter.avgDps, has ? st.avgDps.toFixed(1) : '—'],
    [t.hunter.bestDps, has ? st.bestDps.toFixed(1) : '—'],
  ];
  const topCount = Math.max(1, ...st.monsters.map((m) => m.count));
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {/* who + totals: one wide card */}
      <Panel className="flex shrink-0 flex-wrap items-center gap-x-8 gap-y-5 px-7 py-6">
        <div className="flex min-w-0 flex-1 basis-72 items-center gap-5">
          <div className="flex size-18 shrink-0 items-center justify-center rounded-full border-2 border-gold bg-avatar text-gold shadow-[0_0_18px_rgb(200_169_106/0.25)]">
            <Icon name="shield" size={34} />
          </div>
          {profile ? (
            <div className="flex min-w-0 flex-col gap-1">
              <span className="truncate font-display text-[30px] leading-tight font-bold">{profile.name || t.hunter.profile}</span>
              {profile.weapon && <span className="truncate text-[15px] text-ink-2">{profile.weapon.name || profile.weapon.type}</span>}
            </div>
          ) : <span className="text-[17px] text-ink-2">{t.hunter.noProfile}</span>}
          {profile?.hr != null && (
            <div className="ml-auto flex shrink-0 flex-col items-center rounded-xl border border-gold/40 bg-[#241C12] px-5 py-2">
              <span className="text-[11px] tracking-[3px] text-gold">{t.hunter.hr}</span>
              <span className="font-deco text-[40px] leading-none font-semibold text-gold-hi">{profile.hr}</span>
            </div>
          )}
        </div>
        {/* sized by content (numbers never cut); wraps under the name when there's no room */}
        <dl className={cx('flex divide-x divide-line', portrait && 'basis-full justify-between')}>
          {stats.map(([k, v]) => (
            <div key={k} className="flex flex-col gap-1 px-5 first:pl-0 last:pr-0">
              <dt className="text-[13px] whitespace-nowrap text-muted">{k}</dt>
              <dd className={cx('text-2xl leading-tight font-bold whitespace-nowrap', !has && 'text-disabled')}>{v}</dd>
            </div>
          ))}
        </dl>
      </Panel>

      <div className={cx('grid min-h-0 flex-1 gap-4', portrait ? 'grid-rows-2' : 'grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]')}>
        <Panel className="flex min-h-0 flex-col gap-4 px-6 py-5">
          <Eyebrow icon="star" right={profile && profile.skills.length > 0 && <span className="text-sm text-muted">{profile.skills.length}</span>}>{t.hunter.skills}</Eyebrow>
          {!profile?.skills.length ? <span className="text-ink-2">{profile ? t.hunter.noSkills : t.hunter.noProfile}</span> : (
            <ul className="grid min-h-0 grid-cols-[repeat(auto-fill,minmax(250px,1fr))] content-start gap-2 overflow-y-auto pr-1">
              {profile.skills.map((k) => {
                const maxed = !!k.max && k.lv >= k.max;
                return (
                  <li key={k.id} className={cx('flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5',
                    maxed ? 'border-gold/30 bg-[#211A10]' : 'border-transparent bg-surface-2')}>
                    <span className={cx('truncate text-[15px]', maxed && 'text-gold-hi')}>{k.name}</span>
                    <span className="flex shrink-0 items-center gap-0.75" aria-label={`Lv ${k.lv}${k.max ? ` / ${k.max}` : ''}`}>
                      {Array.from({ length: Math.max(k.lv, k.max || 0) }, (_, i) => (
                        <span key={i} className={cx('h-3 w-1.5 -skew-x-12 rounded-[1px]', i < k.lv ? 'bg-gold-hi' : 'bg-track')} />
                      ))}
                      <b className="ml-2 w-5 text-right text-sm">{k.lv}</b>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel className="flex min-h-0 flex-col gap-4 px-6 py-5">
          <Eyebrow icon="target" right={has && <span className="text-xs text-muted">{t.hunter.statsNote(st.hunts)}</span>}>{t.hunter.monstersTitle}</Eyebrow>
          {st.monsters.length === 0 ? <span className="text-ink-2">{t.hunter.noHistory}</span> : (
            <div className="flex min-h-0 flex-col gap-1.5 overflow-y-auto pr-1">
              <div className="grid grid-cols-[minmax(0,1fr)_3.5rem_3.5rem_4rem] gap-3 px-3 text-xs text-muted">
                <span>{t.hunter.monster}</span><span className="text-right">{t.hunter.count}</span>
                <span className="text-right">{t.hunter.slain}</span><span className="text-right">{t.hunter.best}</span>
              </div>
              {st.monsters.map((m) => (
                <div key={m.name} className="relative grid grid-cols-[minmax(0,1fr)_3.5rem_3.5rem_4rem] items-center gap-3 overflow-hidden rounded-lg bg-surface-2 px-3 py-2.5 text-[15px]">
                  {/* faint bar behind the row: how often, relative to the most hunted */}
                  <span className="absolute inset-y-0 left-0 bg-gold/8" style={{ width: `${(m.count / topCount) * 100}%` }} />
                  <span className="relative truncate font-display font-semibold">{m.name}</span>
                  <span className="relative text-right font-semibold">{m.count}</span>
                  <span className="relative text-right text-ink-2">{m.slain}</span>
                  <span className="relative text-right text-ink-2">{m.bestSec != null ? mmss(m.bestSec) : '—'}</span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

/* --------------------------------- settings --------------------------------- */

const PANEL_KEYS: PanelKey[] = ['now', 'parts', 'ailments', 'buffs', 'damage'];
type Section = 'general' | 'discord' | 'setup' | 'about';
const REPO_URL = 'https://github.com/PJsongsana/MHWilds-Next';

// On/off switch: a real checkbox (keyboard + screen readers) drawn as a track with a knob.
function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <input type="checkbox" role="switch" aria-label={label} checked={checked} onChange={(e) => onChange(e.target.checked)}
      className={cx('relative h-6 w-11 shrink-0 cursor-pointer appearance-none rounded-full border transition-colors',
        'after:absolute after:top-0.5 after:left-0.5 after:size-[18px] after:rounded-full after:bg-ink after:transition-transform',
        'checked:border-gold checked:bg-gold/70 checked:after:translate-x-5 checked:after:bg-on-accent',
        'border-line bg-track focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold')} />
  );
}

// One setting: label (+ hint) on the left, its control on the right.
function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 py-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span>{label}</span>
        {hint && <span className="text-xs text-muted">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col">
      <h3 className="mb-1 text-xs font-semibold tracking-[1.5px] text-gold uppercase">{title}</h3>
      <div className="flex flex-col divide-y divide-line/70">{children}</div>
    </section>
  );
}

const inputCls = 'rounded-lg border border-line bg-surface-2 px-3 py-1.5 focus-visible:border-gold focus-visible:outline-none';

// Opened with the gear button or S (Esc closes). Sections on the left; every control is a native input.
function SettingsDialog({ onClose, setup, discord }: { onClose: () => void; setup: Setup; discord: DiscordStatus }) {
  const s = useSettings();
  const app = !!window.huntApp; // Discord + install status only exist in the desktop app
  const sections: Section[] = ['general', ...(app ? (['discord', 'setup'] as const) : []), 'about'];
  const [sec, setSec] = useState<Section>('general');
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => { panel.current?.focus(); }, []);
  const setDiscord = (patch: Partial<typeof s.discord>) => setSettings({ discord: { ...s.discord, ...patch } });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/65 p-4 backdrop-blur-[2px]" onClick={onClose}>
      <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label={t.settings.title} onClick={(e) => e.stopPropagation()}
        className="wilds-panel flex h-[min(680px,92vh)] w-full max-w-3xl flex-col overflow-hidden text-[15px] outline-none">
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-line px-6 py-4">
          <Eyebrow icon="gear">{t.settings.title}</Eyebrow>
          <button type="button" onClick={onClose} aria-label={t.settings.close} title={t.settings.close}
            className="flex size-9 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-gold">
            <span aria-hidden className="text-xl leading-none">×</span>
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          <nav aria-label={t.settings.title} className="flex shrink-0 gap-1 overflow-x-auto border-b border-line p-3 sm:w-44 sm:flex-col sm:border-r sm:border-b-0">
            {sections.map((k) => (
              <button key={k} type="button" onClick={() => setSec(k)} aria-current={sec === k}
                className={cx('flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-left whitespace-nowrap focus-visible:outline-2 focus-visible:outline-gold',
                  sec === k ? 'bg-[#2A2014] text-gold-hi shadow-[inset_0_0_0_1px_rgb(200_169_106/0.3)]' : 'text-ink-2 hover:bg-surface-2 hover:text-ink')}>
                {t.settings.sections[k]}
                {k === 'discord' && <span className={cx('size-2 rounded-full', DISCORD_DOT[discord.state])} />}
                {k === 'setup' && setup.status && setupProblem(setup.status) && <span className="size-2 rounded-full bg-accent" />}
              </button>
            ))}
          </nav>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            {sec === 'general' && (
              <div className="flex flex-col gap-6">
                <Group title={t.settings.display}>
                  <Row label={t.settings.scale} hint={`${Math.round(s.scale * 100)}%`}>
                    <input type="range" min={0.7} max={1.5} step={0.05} value={s.scale} aria-label={t.settings.scale}
                      onChange={(e) => setSettings({ scale: Number(e.target.value) })} className="w-48 accent-gold" />
                  </Row>
                  <Row label={t.settings.sound}>
                    <Switch label={t.settings.sound} checked={s.sound} onChange={(v) => { setSettings({ sound: v }); if (v) beep(TONES.capture!); }} />
                  </Row>
                </Group>
                <Group title={t.settings.panels}>
                  {PANEL_KEYS.map((k) => (
                    <Row key={k} label={t.settings.panel[k]}>
                      <Switch label={t.settings.panel[k]} checked={s.panels[k]} onChange={(v) => setSettings({ panels: { ...s.panels, [k]: v } })} />
                    </Row>
                  ))}
                </Group>
                <Group title={t.settings.advanced}>
                  <Row label={t.settings.port}>
                    <input type="number" min={1024} max={65535} value={s.port} aria-label={t.settings.port}
                      onChange={(e) => { const p = Number(e.target.value); if (p >= 1024 && p <= 65535) setSettings({ port: p }); }}
                      className={cx(inputCls, 'w-28 text-right')} />
                  </Row>
                </Group>
              </div>
            )}

            {sec === 'discord' && (
              <div className="flex flex-col gap-6">
                {/* what friends see right now */}
                <div className="flex flex-col gap-1 rounded-xl border border-line bg-surface-2 px-4 py-3">
                  <span className="flex items-center gap-2 text-sm text-muted">
                    <span className={cx('size-2 rounded-full', DISCORD_DOT[discord.state])} />{t.settings.discordStatus[discord.state]}
                  </span>
                  {discord.state === 'live' && <>
                    <b className="font-semibold">{discord.details ?? '—'}</b>
                    <span className="text-ink-2">{discord.line2 ?? t.settings.discordNothing}</span>
                  </>}
                </div>
                <Group title={t.settings.connection}>
                  <Row label={t.settings.discord}>
                    <Switch label={t.settings.discord} checked={s.discord.enabled} onChange={(v) => setDiscord({ enabled: v })} />
                  </Row>
                  <Row label={t.settings.discordId} hint={t.settings.discordHint}>
                    <input type="text" inputMode="numeric" value={s.discord.clientId} placeholder="1234567890123456789" aria-label={t.settings.discordId}
                      onChange={(e) => setDiscord({ clientId: e.target.value.replace(/\D/g, '') })}
                      className={cx(inputCls, 'w-56 text-right tabular-nums')} />
                  </Row>
                </Group>
                <Group title={t.settings.discordText}>
                  <p className="py-2 text-xs text-muted">{t.settings.discordTextHint}</p>
                  {Object.entries(DISCORD_TEXT).map(([k, def]) => (
                    <Row key={k} label={t.settings.discordTextKey[k] ?? k}>
                      <input id={`discord-text-${k}`} type="text" value={s.discord.text[k] ?? ''} placeholder={def} maxLength={100}
                        aria-label={t.settings.discordTextKey[k] ?? k}
                        onChange={(e) => setDiscord({ text: { ...s.discord.text, [k]: e.target.value } })}
                        className={cx(inputCls, 'w-72 min-w-0')} />
                    </Row>
                  ))}
                  <div className="py-3">
                    <button type="button" onClick={() => setDiscord({ text: {} })} className="text-sm text-muted underline hover:text-ink">{t.settings.discordTextReset}</button>
                  </div>
                </Group>
              </div>
            )}

            {sec === 'setup' && (
              <div className="flex flex-col gap-4">
                {setup.status ? <SetupList status={setup.status} /> : <span className="text-muted">…</span>}
                <p className="text-xs text-muted">{t.setup.needs}</p>
                <button type="button" onClick={setup.check}
                  className="self-start rounded-lg border border-line px-4 py-2 text-sm hover:border-gold focus-visible:outline-2 focus-visible:outline-gold">{t.setup.recheck}</button>
              </div>
            )}

            {sec === 'about' && (
              <div className="flex flex-col gap-5">
                <div className="flex items-center gap-4">
                  <div className="flex size-12 items-center justify-center rounded-xl bg-linear-to-br from-gold-hi to-gold text-on-accent">
                    <Icon name="claw" size={26} stroke={2.2} />
                  </div>
                  <div className="flex flex-col">
                    <span className="font-display text-lg font-semibold">Hunt Dashboard</span>
                    <span className="text-sm text-muted">{t.settings.version} {APP_VERSION}</span>
                  </div>
                  <a href={REPO_URL} target="_blank" rel="noreferrer" className="ml-auto text-sm text-gold-hi underline">{t.settings.source}</a>
                </div>
                <Changelog text={CHANGELOG} />
              </div>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-line px-6 py-3">
          <span className="text-xs text-muted">{t.settings.hint}</span>
          <button type="button" onClick={() => setSettings({ ...DEFAULT_SETTINGS })} className="text-sm whitespace-nowrap text-muted underline hover:text-ink">{t.settings.reset}</button>
        </div>
      </div>
    </div>
  );
}

// CHANGELOG.md, drawn without a markdown library: "## version", "### group", "- item", **bold**.
function Changelog({ text }: { text: string }) {
  const bold = (s: string) => s.split('**').map((part, i) => (i % 2 ? <b key={i} className="text-ink">{part}</b> : part));
  const out: ReactNode[] = [];
  let items: string[] = [];
  const flush = () => {
    if (items.length) out.push(<ul key={out.length} className="mb-3 flex list-disc flex-col gap-1 pl-5 text-sm text-ink-2 marker:text-gold/60">{items.map((x, i) => <li key={i}>{bold(x)}</li>)}</ul>);
    items = [];
  };
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('- ')) { items.push(line.slice(2)); continue; }
    flush();
    if (line.startsWith('## ')) out.push(<h3 key={out.length} className="mt-2 border-b border-line pb-1 font-display text-lg font-semibold text-gold-hi">{line.slice(3)}</h3>);
    else if (line.startsWith('### ')) out.push(<h4 key={out.length} className="mt-1 text-xs font-semibold tracking-[1.5px] text-muted uppercase">{line.slice(4)}</h4>);
  }
  flush();
  return <div className="flex flex-col gap-2">{out}</div>;
}

/* ------------------------------- dev: mock bar ------------------------------ */

function MockSwitcher() {
  const names = ['connecting', 'stale', 'summary', ...Object.keys(mocks)];
  return (
    <nav className="fixed top-1 left-1/2 flex -translate-x-1/2 flex-wrap gap-1 rounded-lg border border-line bg-surface/95 p-1.5 text-xs opacity-20 transition-opacity hover:opacity-100">
      {names.map((n) => (
        <a key={n} href={`?mock=${n}`}
          className={cx('rounded px-2 py-1 no-underline', n === mockName ? 'bg-accent text-on-accent' : 'text-ink-2 hover:bg-surface-2')}>
          {n}
        </a>
      ))}
    </nav>
  );
}
