// Finished hunts, newest first (like "My Hunt Report" history). Same store pattern as settings.ts:
// localStorage (the Electron app keeps it in its userData folder), shared with React via useSyncExternalStore.
import { useSyncExternalStore } from 'react';
import type { HuntRecord } from './logic';

const KEY = 'hunt-dashboard-history';
const MAX = 50;

function load(): HuntRecord[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

let records = load();
const listeners = new Set<() => void>();

export function addHunt(r: HuntRecord) {
  records = [r, ...records.filter((x) => x.id !== r.id)].slice(0, MAX);
  try { localStorage.setItem(KEY, JSON.stringify(records)); } catch { /* storage full/private: keep in memory */ }
  listeners.forEach((f) => f());
}

export const useHistory = () =>
  useSyncExternalStore((cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; }, () => records);
