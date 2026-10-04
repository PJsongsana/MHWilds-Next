// Start the desktop app. Clears ELECTRON_RUN_AS_NODE first: terminals inside other Electron apps
// (e.g. an editor's built-in terminal) inherit it, which would make Electron run as plain Node.
import { spawn } from 'node:child_process';
import electron from 'electron'; // in plain Node this is the path to the Electron binary

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
spawn(electron, ['electron/main.mjs', ...process.argv.slice(2)], { stdio: 'inherit', env })
  .on('exit', (code) => process.exit(code ?? 0));
