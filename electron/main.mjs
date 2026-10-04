// Desktop wrapper (spec §11 / milestone 4): one app = bridge + dashboard window.
//   npm run app       build the UI, then open it (bridge included)
//   npm run app:dev   open the running dev server (npm run dev already runs the bridge)
// A normal Windows window (resize, maximize, Snap; dark title bar), F11 = fullscreen.
// Opens on the second monitor the first time, then remembers position / maximized,
// and never takes focus from the game (shown inactive).
import { app, BrowserWindow, nativeTheme, screen } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startBridge } from '../bridge/server.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dev = process.argv.includes('--dev');
app.setName('Hunt Dashboard'); // own userData folder (%APPDATA%/Hunt Dashboard) instead of the generic "Electron"
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
    webPreferences: { backgroundThrottling: false }, // keep updating while the game has focus
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

  app.on('window-all-closed', () => {
    bridge?.close();
    app.quit();
  });
});
