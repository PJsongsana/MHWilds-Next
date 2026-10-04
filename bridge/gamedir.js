// Locate the MH Wilds install: MHW_GAME_DIR env, else every Steam library listed in libraryfolders.vdf.
import fs from 'node:fs';
import path from 'node:path';

const STEAM_VDF = [
  'C:/Program Files (x86)/Steam/steamapps/libraryfolders.vdf',
  'C:/Program Files/Steam/steamapps/libraryfolders.vdf',
];

export function findGameDir() {
  const candidates = [];
  if (process.env.MHW_GAME_DIR) candidates.push(process.env.MHW_GAME_DIR);
  for (const vdf of STEAM_VDF) {
    if (!fs.existsSync(vdf)) continue;
    for (const [, p] of fs.readFileSync(vdf, 'utf8').matchAll(/"path"\s+"([^"]+)"/g)) {
      candidates.push(path.join(p.replace(/\\\\/g, '\\'), 'steamapps/common/MonsterHunterWilds'));
    }
  }
  return candidates.find((dir) => fs.existsSync(path.join(dir, 'MonsterHunterWilds.exe'))) ?? null;
}
