// Desktop wrapper (spec §11 / milestone 4): one app = bridge + borderless dashboard window.
//   npm run app       build the UI, then open it (bridge included)
//   npm run app:dev   open the running dev server (npm run dev already runs the bridge)
// The window opens on the second monitor the first time, then remembers where you put it,
// and never takes focus from the game (shown inactive).
import { app, BrowserWindow, screen } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startBridge } from '../bridge/server.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dev = process.argv.includes('--dev');
const stateFile = () => path.join(app.getPath('userData'), 'window.json');

function savedBounds() {
  try {
    const b = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    // ignore it if that monitor is gone
    const onScreen = screen.getAllDisplays().some(({ bounds: d }) =>
      b.x + 50 > d.x && b.y + 50 > d.y && b.x < d.x + d.width && b.y < d.y + d.height);
    return onScreen ? b : null;
  } catch {
    return null;
  }
}

app.whenReady().then(() => {
  const bridge = dev ? null : startBridge();
  const primary = screen.getPrimaryDisplay();
  const second = screen.getAllDisplays().find((d) => d.id !== primary.id);
  const bounds = savedBounds() ?? (second ?? primary).workArea;

  const win = new BrowserWindow({
    ...bounds,
    frame: false, // drag by the header; Alt+F4 closes
    show: false,
    backgroundColor: '#0D0A07',
    title: 'Hunt Dashboard',
    autoHideMenuBar: true,
    webPreferences: { backgroundThrottling: false }, // keep updating while the game has focus
  });
  if (dev) win.loadURL('http://127.0.0.1:5173');
  else win.loadFile(path.join(here, '../dist/index.html'));
  win.once('ready-to-show', () => win.showInactive());

  const save = () => {
    if (!win.isMinimized() && !win.isFullScreen()) fs.writeFileSync(stateFile(), JSON.stringify(win.getBounds()));
  };
  win.on('moved', save);
  win.on('resized', save);
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') win.setFullScreen(!win.isFullScreen());
  });

  app.on('window-all-closed', () => {
    bridge?.close();
    app.quit();
  });
});
