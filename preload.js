const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  listSites: () => ipcRenderer.invoke('sites:list'),
  addSite: (site) => ipcRenderer.invoke('sites:add', site),
  updateSite: (site) => ipcRenderer.invoke('sites:update', site),
  removeSite: (id) => ipcRenderer.invoke('sites:remove', id),
  setSiteEnabled: (id, enabled) => ipcRenderer.invoke('sites:set-enabled', id, enabled),
  resetSites: () => ipcRenderer.invoke('sites:reset'),
  search: (keyword, opts) => ipcRenderer.invoke('search', keyword, opts),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (settings) => ipcRenderer.invoke('settings:set', settings),
  pickBackgroundImage: () => ipcRenderer.invoke('settings:pick-bg'),
  clearBackgroundImage: () => ipcRenderer.invoke('settings:clear-bg'),
  pickDownloadDir: () => ipcRenderer.invoke('settings:pick-download-dir'),
  proxyTest: () => ipcRenderer.invoke('proxy:test'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  openInApp: (url) => ipcRenderer.invoke('open-in-app', url),
  downloadPixivById: (payload) => ipcRenderer.invoke('pixiv:download-by-id', payload),
  pixivStatus: () => ipcRenderer.invoke('pixiv:status'),
  pixivLogin: () => ipcRenderer.invoke('pixiv:login'),
  pixivLogout: () => ipcRenderer.invoke('pixiv:logout'),
  indexStatus: () => ipcRenderer.invoke('index:status'),
  updateIndex: () => ipcRenderer.invoke('index:update'),
  onIndexProgress: (callback) => {
    ipcRenderer.on('index-progress', (e, p) => callback(p));
  },
});
