// Package the desktop app: npm run dist → release/HuntDashboard-<version>-portable.exe
// electron-builder works in the OS temp folder: inside the project, the editor's file watcher /
// Defender can lock the freshly unpacked electron.exe and the build fails with EPERM on rename.
// Only the finished .exe is copied back.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const out = path.join(os.tmpdir(), 'hunt-dashboard-build');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE; // inherited from editor terminals; breaks electron-builder's Electron calls

execSync(`npx electron-builder --win portable -c.directories.output="${out}"`, { stdio: 'inherit', env });

fs.mkdirSync('release', { recursive: true });
for (const f of fs.readdirSync(out).filter((f) => f.endsWith('.exe'))) {
  fs.copyFileSync(path.join(out, f), path.join('release', f));
  console.log(`→ release/${f}`);
}
