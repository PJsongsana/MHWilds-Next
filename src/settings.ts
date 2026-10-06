// User settings (spec §10): bridge port, size, sound, which panels show. Saved in localStorage.
import { useSyncExternalStore } from 'react';

export type PanelKey = 'now' | 'parts' | 'ailments' | 'buffs' | 'damage';
export type Tab = 'hunt' | 'hunter' | 'history';
export type SoundMode = 'off' | 'beep' | 'voice';
export interface Settings {
  tab: Tab; // การล่า / นักล่า / ประวัติ
  port: number;
  scale: number; // multiplies the auto-fit zoom
  sound: SoundMode;
  voice: { name: string; rate: number }; // speech voice (empty name = first Thai voice found)
  watchBuffs: string[]; // WATCHABLE_BUFFS groups to remind about when they run out
  checkUpdates: boolean; // desktop app: look for a newer release on GitHub
  panels: Record<PanelKey, boolean>;
  // desktop app only; text = the user's wording for line 2 (empty/missing key = default, see electron/presence-text.json)
  discord: { enabled: boolean; clientId: string; text: Record<string, string> };
}

export const DEFAULT_SETTINGS: Settings = {
  tab: 'hunt',
  port: 8787,
  scale: 1,
  sound: 'off', // browsers only allow audio after a click, so it's opt-in from the settings screen
  voice: { name: '', rate: 1.1 },
  watchBuffs: [],
  checkUpdates: true,
  panels: { now: true, parts: true, ailments: true, buffs: true, damage: true },
  discord: { enabled: false, clientId: '', text: {} },
};

const KEY = 'hunt-dashboard-settings';

function load(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    // older versions saved sound as true/false
    const sound: SoundMode = saved.sound === true ? 'beep' : ['off', 'beep', 'voice'].includes(saved.sound) ? saved.sound : 'off';
    return {
      ...DEFAULT_SETTINGS, ...saved, sound,
      panels: { ...DEFAULT_SETTINGS.panels, ...saved.panels },
      discord: { ...DEFAULT_SETTINGS.discord, ...saved.discord },
      voice: { ...DEFAULT_SETTINGS.voice, ...saved.voice },
      watchBuffs: Array.isArray(saved.watchBuffs) ? saved.watchBuffs : [],
    };
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
