'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('officeApp', {
  minimize: () => ipcRenderer.send('office:minimize'),
  close: () => ipcRenderer.send('office:close'),
  togglePin: () => ipcRenderer.invoke('office:togglePin'),
  getPin: () => ipcRenderer.invoke('office:getPin'),
  setCounts: c => ipcRenderer.send('office:counts', c),
  setWidget: on => ipcRenderer.send('office:setWidget', !!on),
  onGoto: cb => ipcRenderer.on('office:goto', (_e, sid) => cb(sid)),
});
