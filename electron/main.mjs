// Desktop wrapper (spec §11 / milestone 4): one app = bridge + dashboard window.
//   npm run app       build the UI, then open it (bridge included)
//   npm run app:dev   open the running dev server (npm run dev already runs the bridge)
// A normal Windows window (resize, maximize, Snap; dark title bar), F11 = fullscreen.
// Opens on the second monitor the first time, then remembers position / maximized,
// and never takes focus from the game (shown inactive).
import { app, BrowserWindow, ipcMain, nativeTheme, screen, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startBridge } from '../bridge/server.js';
import { ensureSetup } from '../bridge/setup.js';
import { configureDiscord, discordStatus, onDiscordStatus, shutdownDiscord } from './discord.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const dev = process.argv.includes('--dev');
app.setName('Hunt Dashboard'); // own userData folder (%APPDATA%/Hunt Dashboard) instead of the generic "Electron"
// our Lua: shipped next to the app (package.json extraResources), or the repo folder when not packaged
const luaSrc = () => (app.isPackaged ? path.join(process.resourcesPath, 'lua/reframework') : path.join(here, '../lua/reframework'));
const stateFile = () => path.join(app.getPath('userData'), 'window.json');

// { x, y, width, height, maximized } — null if missing or that monitor is gone
function savedState() {
  try {
    const s = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    const onScreen = screen.getAllDisplays().some(({ bounds: d }) =>
      s.x + 50 > d.x && s.y + 50 > d.y && s.x < d.x + d.width && s.y < d.y + d.height);
    return onScreen ? s : null;
  } catch {
    return null;
  }
}

app.whenReady().then(() => {
  nativeTheme.themeSource = 'dark'; // dark title bar on Windows 10/11
  const bridge = dev ? null : startBridge();
  const primary = screen.getPrimaryDisplay();
  const second = screen.getAllDisplays().find((d) => d.id !== primary.id);
  const saved = savedState();
  const { x, y, width, height } = saved ?? (second ?? primary).workArea;

  const win = new BrowserWindow({
    x, y, width, height,
    minWidth: 640,
    minHeight: 480,
    show: false,
    backgroundColor: '#0D0A07',
    title: 'Hunt Dashboard',
    autoHideMenuBar: true,
    // packaged: Windows takes the .exe icon (electron-builder embeds build/icon.ico); dev: point at it
    ...(app.isPackaged ? {} : { icon: path.join(here, '../build/icon.ico') }),
    // keep updating while the game has focus; preload exposes window.huntApp (Discord settings)
    webPreferences: { backgroundThrottling: false, preload: path.join(here, 'preload.cjs') },
  });
  if (dev) win.loadURL('http://127.0.0.1:5173');
  else win.loadFile(path.join(here, '../dist/index.html'));
  win.once('ready-to-show', () => {
    // First run already fills the second monitor's work area. maximize() only after showing:
    // on a hidden window Windows reports the wrong state and the saved bounds come out wrong.
    win.showInactive();
    if (saved?.maximized) win.maximize();
  });

  // remember the normal (un-maximized) bounds plus whether it was maximized
  const save = () => {
    if (win.isMinimized() || win.isFullScreen()) return;
    fs.writeFileSync(stateFile(), JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() }));
  };
  for (const ev of ['moved', 'resized', 'maximize', 'unmaximize']) win.on(ev, save);
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') win.setFullScreen(!win.isFullScreen());
  });

  ipcMain.on('discord:configure', (_e, cfg) => configureDiscord(cfg));
  // what Discord currently shows, for the page (status chip + settings)
  ipcMain.handle('discord:status', () => discordStatus());
  onDiscordStatus((st) => { if (!win.isDestroyed()) win.webContents.send('discord:status', st); });
  // install/update our Lua in the game folder and report REFramework/_CatLib (also the page's "check again" button)
  ipcMain.handle('setup:get', () => ensureSetup(luaSrc()));
  // links on the page (setup help) open in the browser, never in a new app window; https only
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });

  app.on('window-all-closed', () => {
    shutdownDiscord();
    bridge?.close();
    app.quit();
  });
});
