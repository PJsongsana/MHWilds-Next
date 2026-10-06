// Exposes the few app-only actions to the dashboard page (contextIsolation stays on).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('huntApp', {
  setDiscord: (cfg) => ipcRenderer.send('discord:configure', cfg),
  getSetup: () => ipcRenderer.invoke('setup:get'),
  checkUpdate: (version) => ipcRenderer.invoke('update:check', version),
  getDiscordStatus: () => ipcRenderer.invoke('discord:status'),
  onDiscordStatus: (cb) => {
    const handler = (_e, st) => cb(st);
    ipcRenderer.on('discord:status', handler);
    return () => ipcRenderer.removeListener('discord:status', handler);
  },
});
