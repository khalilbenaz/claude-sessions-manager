'use strict';
// Pont minimal et typé entre la page et l'application (contextIsolation + sandbox : pas d'accès Node côté page).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('csmNative', {
  platform: process.platform,
  pickFolder: initial => ipcRenderer.invoke('csm:pick-folder', typeof initial === 'string' ? initial : ''),
  setAttention: n => ipcRenderer.send('csm:attention', Number(n) || 0),
  focus: () => ipcRenderer.send('csm:focus'),
  onAction: cb => {
    const h = (e, action) => { if (typeof action === 'string') cb(action); };
    ipcRenderer.on('csm:action', h);
    return () => ipcRenderer.removeListener('csm:action', h);
  },
});
