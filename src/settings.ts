// User settings (spec §10): bridge port, size, sound, which panels show. Saved in localStorage.
import { useSyncExternalStore } from 'react';

export type PanelKey = 'now' | 'parts' | 'ailments' | 'buffs' | 'damage';
export type Tab = 'hunt' | 'hunter';
export interface Settings {
  tab: Tab; // การล่า / นักล่า
  port: number;
  scale: number; // multiplies the auto-fit zoom
  sound: boolean;
  panels: Record<PanelKey, boolean>;
  discord: { enabled: boolean; clientId: string }; // desktop app only
}

export const DEFAULT_SETTINGS: Settings = {
  tab: 'hunt',
  port: 8787,
  scale: 1,
  sound: false, // browsers only allow audio after a click, so it's opt-in from the settings screen
  panels: { now: true, parts: true, ailments: true, buffs: true, damage: true },
  discord: { enabled: false, clientId: '' },
};

const KEY = 'hunt-dashboard-settings';

function load(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULT_SETTINGS, ...saved, panels: { ...DEFAULT_SETTINGS.panels, ...saved.panels }, discord: { ...DEFAULT_SETTINGS.discord, ...saved.discord } };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

let current = load();
const listeners = new Set<() => void>();

export function setSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch, panels: { ...current.panels, ...patch.panels } };
  try { localStorage.setItem(KEY, JSON.stringify(current)); } catch { /* private mode: keep in memory */ }
  listeners.forEach((f) => f());
}

export const useSettings = () =>
  useSyncExternalStore((cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; }, () => current);
