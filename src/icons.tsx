// Hand-drawn stroke icons (paths from Main.dc.html). No game assets (spec §6).
const P = {
  clock: 'M21 12a9 9 0 1 1-18 0a9 9 0 0 1 18 0Z M12 7v5l3 2',
  moon: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z',
  sun: 'M12 8a4 4 0 1 0 0 8a4 4 0 0 0 0-8Z M12 2v2 M12 20v2 M4.9 4.9l1.4 1.4 M17.7 17.7l1.4 1.4 M2 12h2 M20 12h2 M4.9 19.1l1.4-1.4 M17.7 6.3l1.4-1.4',
  claw: 'M6 19L13 4 M10 20L17 6 M14 20L20 9',
  wound: 'M6 19L13 4 M10 20L17 6',
  crown: 'M3 8l4 4l5-6l5 6l4-4l-2 11H5L3 8Z',
  flame: 'M12 3c1 3 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5c0 2 1 3 2 3c0-3-1-5 1-8.5Z',
  target: 'M12 3v4 M12 17v4 M3 12h4 M17 12h4 M12 8a4 4 0 1 0 0 8a4 4 0 0 0 0-8Z',
  hammer: 'M14 4l6 6l-3 3l-6-6l3-3Z M11 7L4 14l3 3l7-7',
  head: 'M12 3a7 7 0 0 0-7 7v3l-2 4h18l-2-4v-3a7 7 0 0 0-7-7Z M9 11h.01 M15 11h.01',
  wing: 'M3 18c4-1 7-4 9-12c2 8 5 11 9 12 M7 16l2-4 M17 16l-2-4',
  tail: 'M4 20c6 0 9-3 9-8s3-8 7-8 M17 4l3 0l0 3',
  leg: 'M9 3v9l-4 8 M15 3v9l4 8 M5 20h4 M15 20h4',
  check: 'M5 12l5 5l9-10',
  bolt: 'M13 2L4 14h7l-1 8l9-12h-7l1-8Z',
  drop: 'M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11Z M10 14h.01 M14 16h.01',
  star: 'M12 3l2.6 5.6l6.1.7l-4.5 4.2l1.2 6l-5.4-3l-5.4 3l1.2-6l-4.5-4.2l6.1-.7Z',
  zz: 'M4 6h6l-6 7h6 M14 12h5l-5 6h5',
  flask: 'M9 3h6 M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3',
  leaf: 'M5 19c0-8 6-14 15-14c0 9-6 15-14 15 M5 19l7-7',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9c-4.5-1-8-4-8-9V6l8-3Z',
  cup: 'M5 9h11v6a5 5 0 0 1-10 0V9Z M16 11h2a2 2 0 0 1 0 4h-2 M8 3c0 2 2 2 2 4 M12 3c0 2 2 2 2 4',
  sword: 'M14.5 3H21v6.5L9.5 21L3 14.5L14.5 3Z M7 13l4 4',
  burst: 'M12 2v5 M12 17v5 M2 12h5 M17 12h5 M5 5l3.5 3.5 M15.5 15.5L19 19 M5 19l3.5-3.5 M15.5 8.5L19 5',
  dot: 'M12 8a4 4 0 1 0 0 8a4 4 0 0 0 0-8Z',
  snow: 'M12 2v20 M3.5 7l17 10 M3.5 17l17-10 M9 3.5l3 2.5l3-2.5 M9 20.5l3-2.5l3 2.5',
  wave: 'M3 10c3-3 6 3 9 0s6 3 9 0 M3 16c3-3 6 3 9 0s6 3 9 0',
  ride: 'M4 18l6-6l4 3l6-9 M14 6h6v6',
  pit: 'M3 10h18 M6 10l2.5 9h7L18 10 M9 14h6',
  eye: 'M2 12s4-7 10-7s10 7 10 7s-4 7-10 7S2 12 2 12Z M12 9a3 3 0 1 0 0 6a3 3 0 0 0 0-6Z',
  alert: 'M12 3l10 18H2L12 3Z M12 10v5 M12 18h.01',
  gear: 'M12 9a3 3 0 1 0 0 6a3 3 0 0 0 0-6Z M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3a1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5a1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8a1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5a1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z',
  note: 'M9 18V5l12-2v13 M9 18a3 3 0 1 1-6 0a3 3 0 0 1 6 0Z M21 16a3 3 0 1 1-6 0a3 3 0 0 1 6 0Z',
} as const;
export type IconName = keyof typeof P;

// id → icon, with a fallback for ids we don't know yet (spec §6)
const BY_ID: Record<string, IconName> = {
  // part kinds
  head: 'head', wing: 'wing', tail: 'tail', leg: 'leg', other: 'claw',
  // ailments
  paralysis: 'bolt', poison: 'drop', stun: 'star', sleep: 'zz', blast: 'burst',
  exhaust: 'wave', ride: 'ride', flash: 'eye', pitfall: 'pit',
  // elements
  fire: 'flame', water: 'drop', thunder: 'bolt', ice: 'snow', dragon: 'claw',
  // buffs
  demondrug: 'flask', mega_demondrug: 'flask', demon_powder: 'flask',
  might_seed: 'leaf', might_pill: 'leaf',
  adamant_seed: 'shield', adamant_pill: 'shield', armorskin: 'shield', mega_armorskin: 'shield', hard_powder: 'shield', mantle: 'shield',
  hot_drink: 'cup', cool_drink: 'cup', dash_juice: 'bolt', immunizer: 'drop',
};
export const iconFor = (id: string, fallback: IconName = 'dot'): IconName => BY_ID[id] ?? fallback;

export function Icon({ name, size = 22, stroke = 2, className }: { name: IconName; size?: number; stroke?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke}
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={P[name]} />
    </svg>
  );
}
