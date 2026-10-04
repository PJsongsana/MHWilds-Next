// What the dashboard needs in the game folder, and installing our part of it.
//   REFramework and _CatLib: the user installs them (we only check and tell them).
//   Our Lua (lua/reframework/**): copied in when missing or different. Used by the desktop app on every
//   start and by `npm run install-lua`.
import fs from 'node:fs';
import path from 'node:path';
import { findGameDir } from './gamedir.js';

/**
 * @param luaSrc folder holding our `reframework/` tree (lua/reframework in the repo, resources/lua/reframework in the app)
 * @returns {{ gameDir: string|null, reframework: boolean, catlib: boolean,
 *             lua: 'current'|'updated'|'skipped'|'error', error?: string }}
 *   lua 'updated' = files were copied (a running game needs Reset scripts), 'skipped' = no game / no REFramework yet
 */
export function ensureSetup(luaSrc, gameDir = findGameDir()) {
  if (!gameDir) return { gameDir: null, reframework: false, catlib: false, lua: 'skipped' };
  const rf = path.join(gameDir, 'reframework');
  const reframework = fs.existsSync(path.join(gameDir, 'dinput8.dll')) && fs.existsSync(rf);
  const catlib = ['autorun/_CatLib/init.lua', 'autorun/_CatLib.lua'].some((f) => fs.existsSync(path.join(rf, f)));
  // without REFramework there is nothing to load our script; don't create folders in the game dir
  if (!reframework) return { gameDir, reframework, catlib, lua: 'skipped' };
  try {
    let copied = 0;
    for (const rel of fs.readdirSync(luaSrc, { recursive: true })) {
      const from = path.join(luaSrc, rel);
      if (!fs.statSync(from).isFile()) continue;
      const to = path.join(rf, rel);
      const data = fs.readFileSync(from);
      if (fs.existsSync(to) && fs.readFileSync(to).equals(data)) continue;
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.writeFileSync(to, data);
      copied++;
    }
    return { gameDir, reframework, catlib, lua: copied ? 'updated' : 'current' };
  } catch (e) {
    return { gameDir, reframework, catlib, lua: 'error', error: e.message };
  }
}
