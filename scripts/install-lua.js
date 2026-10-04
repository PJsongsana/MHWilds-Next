// Copy the REFramework script into the game folder: npm run install-lua
// (the desktop app does the same on every start, see bridge/setup.js)
import path from 'node:path';
import { ensureSetup } from '../bridge/setup.js';

const s = ensureSetup(path.resolve('lua/reframework'));
if (!s.gameDir) {
  console.error('MH Wilds not found. Set MHW_GAME_DIR to the game folder.');
  process.exit(1);
}
if (!s.reframework) {
  console.error(`REFramework not found in ${s.gameDir} (dinput8.dll + reframework/). Install it first.`);
  process.exit(1);
}
if (!s.catlib) console.warn('warning: _CatLib not found in reframework/autorun — the reader needs it (comes with MHWilds Overlay).');
if (s.lua === 'error') {
  console.error(`copy failed: ${s.error}`);
  process.exit(1);
}
console.log(s.lua === 'updated' ? `installed → ${path.join(s.gameDir, 'reframework/autorun/hunt_dashboard.lua')}` : 'already up to date');
if (s.lua === 'updated') console.log('In game: REFramework menu → ScriptRunner → Reset scripts (or restart the game).');
