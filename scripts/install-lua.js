// Copy the REFramework script into the game folder: npm run install-lua
import fs from 'node:fs';
import path from 'node:path';
import { findGameDir } from '../bridge/gamedir.js';

const gameDir = findGameDir();
if (!gameDir) {
  console.error('MH Wilds not found. Set MHW_GAME_DIR to the game folder.');
  process.exit(1);
}
if (!fs.existsSync(path.join(gameDir, 'reframework/autorun/_CatLib'))) {
  console.warn('warning: _CatLib not found in reframework/autorun — the reader needs it (comes with MHWilds Overlay).');
}
fs.cpSync(path.resolve('lua/reframework'), path.join(gameDir, 'reframework'), { recursive: true });
console.log(`installed → ${path.join(gameDir, 'reframework/autorun/hunt_dashboard.lua')}`);
console.log('In game: REFramework menu → ScriptRunner → Reset scripts (or restart the game).');
