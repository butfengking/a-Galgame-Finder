const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  listSites: () => ipcRenderer.invoke('sites:list'),
  addSite: (site) => ipcRenderer.invoke('sites:add', site),
  updateSite: (site) => ipcRenderer.invoke('sites:update', site),
  removeSite: (id) => ipcRenderer.invoke('sites:remove', id),
  setSiteEnabled: (id, enabled) => ipcRenderer.invoke('sites:set-enabled', id, enabled),
  resetSites: () => ipcRenderer.invoke('sites:reset'),
  search: (keyword) => ipcRenderer.invoke('search', keyword),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (settings) => ipcRenderer.invoke('settings:set', settings),
  pickBackgroundImage: () => ipcRenderer.invoke('settings:pick-bg'),
  clearBackgroundImage: () => ipcRenderer.invoke('settings:clear-bg'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  indexStatus: () => ipcRenderer.invoke('index:status'),
  updateIndex: () => ipcRenderer.invoke('index:update'),
  onIndexProgress: (callback) => {
    ipcRenderer.on('index-progress', (e, p) => callback(p));
  },
});
