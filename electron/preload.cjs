// Exposes the few app-only actions to the dashboard page (contextIsolation stays on).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('huntApp', {
  setDiscord: (cfg) => ipcRenderer.send('discord:configure', cfg),
  getSetup: () => ipcRenderer.invoke('setup:get'),
});
