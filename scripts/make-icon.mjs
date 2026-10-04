// npm run icon: every build/*.svg → .png. icon.svg → icon.png (1024, Discord app) + icon.ico (the .exe / window);
// status-*.svg → the small Discord badges used by electron/presence.mjs.
// Uses the Electron we already have to render the SVG (no image library). Re-launches itself inside Electron.
// No top-level await: Electron holds back `ready` until the ESM entry finishes evaluating.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electron from 'electron'; // plain Node: path to the Electron binary; inside Electron: the API

const self = fileURLToPath(import.meta.url);
const dir = path.join(path.dirname(self), '../build');

if (!process.versions.electron) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  spawn(electron, [self], { stdio: 'inherit', env }).on('exit', (code) => process.exit(code ?? 0));
} else {
  const { app, BrowserWindow } = electron;
  app.disableHardwareAcceleration();

  app.whenReady().then(async () => {
    // every build/*.svg → .png at its own width (icon 1024, Discord status badges 256); icon also gets the .ico
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.svg'))) {
      const img = await render(fs.readFileSync(path.join(dir, file), 'utf8'));
      const name = file.slice(0, -4);
      fs.writeFileSync(path.join(dir, `${name}.png`), img.toPNG());
      if (name === 'icon') saveIco(img);
      console.log(`→ build/${name}.png`);
    }
    app.quit();
  }).catch((e) => { console.error(e); app.exit(1); });

  // One 1024 window for every file, scaled down after: a second or smaller offscreen window paints blank white.
  let win;
  function render(svg) {
    const size = Number(/width="(\d+)"/.exec(svg)?.[1] ?? 1024);
    win ??= new BrowserWindow({
      width: 1024, height: 1024, show: false, transparent: true, frame: false,
      webPreferences: { offscreen: true, deviceScaleFactor: 1 },
    });
    const html = `<html><body style="margin:0;background:transparent"><style>svg{display:block;width:1024px;height:1024px}</style>${svg}</body></html>`;
    // offscreen + transparent: the paint event carries the alpha channel (capturePage would not)
    return new Promise((resolve) => {
      // frames right after a load can still be blank white: take one painted a moment later
      let loaded = false;
      win.webContents.once('did-finish-load', () => setTimeout(() => { loaded = true; win.webContents.invalidate(); }, 500));
      win.webContents.on('paint', (_e, _dirty, image) => {
        if (!loaded || image.getSize().width < 1024) return; // Windows display scaling can make it 1px larger
        win.webContents.removeAllListeners('paint');
        resolve(image.resize({ width: size, height: size, quality: 'best' }));
      });
      win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    });
  }

  function saveIco(img) {
    // .ico with PNG entries (supported since Vista): 6-byte header, 16 bytes per entry, then the PNGs
    const pngs = [16, 24, 32, 48, 64, 128, 256].map((s) => [s, img.resize({ width: s, height: s, quality: 'best' }).toPNG()]);
    const head = Buffer.alloc(6 + 16 * pngs.length);
    head.writeUInt16LE(1, 2);
    head.writeUInt16LE(pngs.length, 4);
    let offset = head.length;
    pngs.forEach(([s, png], i) => {
      const e = 6 + 16 * i;
      head.writeUInt8(s % 256, e); // 256 is stored as 0
      head.writeUInt8(s % 256, e + 1);
      head.writeUInt16LE(1, e + 4);  // planes
      head.writeUInt16LE(32, e + 6); // bits per pixel
      head.writeUInt32LE(png.length, e + 8);
      head.writeUInt32LE(offset, e + 12);
      offset += png.length;
    });
    fs.writeFileSync(path.join(dir, 'icon.ico'), Buffer.concat([head, ...pngs.map(([, p]) => p)]));
    console.log('→ build/icon.ico');
  }
}
