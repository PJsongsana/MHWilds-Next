import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { ensureSetup } from './setup.js';

const lua = path.resolve('lua/reframework');

test('setup: reports missing mods, installs our Lua only once REFramework is there', () => {
  const game = fs.mkdtempSync(path.join(os.tmpdir(), 'mhw-'));
  try {
    expect(ensureSetup(lua, null)).toMatchObject({ gameDir: null, lua: 'skipped' });
    // no REFramework: report it and leave the game folder untouched
    expect(ensureSetup(lua, game)).toMatchObject({ reframework: false, catlib: false, lua: 'skipped' });
    expect(fs.existsSync(path.join(game, 'reframework'))).toBe(false);
    // REFramework, no _CatLib: our script goes in, _CatLib still reported missing
    fs.writeFileSync(path.join(game, 'dinput8.dll'), '');
    fs.mkdirSync(path.join(game, 'reframework'));
    expect(ensureSetup(lua, game)).toMatchObject({ reframework: true, catlib: false, lua: 'updated' });
    expect(fs.existsSync(path.join(game, 'reframework/autorun/hunt_dashboard/game_reader.lua'))).toBe(true);
    // second start: nothing to copy
    fs.mkdirSync(path.join(game, 'reframework/autorun/_CatLib'));
    fs.writeFileSync(path.join(game, 'reframework/autorun/_CatLib/init.lua'), '');
    expect(ensureSetup(lua, game)).toMatchObject({ catlib: true, lua: 'current' });
  } finally {
    fs.rmSync(game, { recursive: true, force: true });
  }
});
