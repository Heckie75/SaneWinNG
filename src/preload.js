'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('scanner', {
  getLocale: () => ipcRenderer.invoke('locale:get'),
  getHosts: () => ipcRenderer.invoke('hosts:get'),
  setHosts: (hosts) => ipcRenderer.invoke('hosts:set', hosts),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (settings) => ipcRenderer.invoke('settings:set', settings),
  discoverHosts: () => ipcRenderer.invoke('hosts:discover'),
  listDevices: (hosts) => ipcRenderer.invoke('devices:list', hosts),
  capabilities: (device, hosts, settings) => ipcRenderer.invoke('devices:capabilities', device, hosts, settings),
  preview: (request) => ipcRenderer.invoke('preview', request),
  scan: (request) => ipcRenderer.invoke('scan', request),
  cancelScan: () => ipcRenderer.invoke('scan:cancel'),
  removePage: (id) => ipcRenderer.invoke('pages:remove', id),
  reorderPages: (ids) => ipcRenderer.invoke('pages:reorder', ids),
  editPage: (request) => ipcRenderer.invoke('page:edit', request),
  exportPage: (request) => ipcRenderer.invoke('page:export', request),
  languages: () => ipcRenderer.invoke('ocr:languages'),
  exportPdf: (options) => ipcRenderer.invoke('pdf:export', options),
  onProgress: (callback) => ipcRenderer.on('progress', (_event, message) => callback(message)),
});