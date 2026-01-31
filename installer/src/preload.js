const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods to renderer process
contextBridge.exposeInMainWorld('api', {
  // System info
  getSystemInfo: () => ipcRenderer.invoke('get-system-info'),
  getUpdaterInfo: () => ipcRenderer.invoke('get-updater-info'),

  // Extension management
  checkExtensionInstalled: (browser) => ipcRenderer.invoke('check-extension-installed', browser),
  installExtension: (browser) => ipcRenderer.invoke('install-extension', browser),
  uninstallExtension: (browser) => ipcRenderer.invoke('uninstall-extension', browser),
  installFirefoxDevEdition: () => ipcRenderer.invoke('install-firefox-dev-edition'),
  
  // Extension updates
  checkForUpdates: (browser) => ipcRenderer.invoke('check-for-updates', browser),
  updateExtension: (browser) => ipcRenderer.invoke('update-extension', browser),
  forceReinstallExtension: (browser) => ipcRenderer.invoke('force-reinstall-extension', browser),
  restartBrowser: (browser) => ipcRenderer.invoke('restart-browser', browser),

  // Updater
  installUpdater: () => ipcRenderer.invoke('install-updater'),
  installUpdaterWithDirectory: (installDir) => ipcRenderer.invoke('install-updater-with-directory', installDir),
  installUpdaterWithOptions: (options) => ipcRenderer.invoke('install-updater-with-options', options),
  launchUpdater: () => ipcRenderer.invoke('launch-updater'),
  launchWizard: () => ipcRenderer.invoke('launch-wizard'),

  // Discord
  openDiscordInvite: () => ipcRenderer.invoke('open-discord-invite'),

  // Pairing
  generatePairingCode: () => ipcRenderer.invoke('generate-pairing-code'),
  createPairing: (code) => ipcRenderer.invoke('create-pairing', code),
  checkPairing: (code) => ipcRenderer.invoke('check-pairing', code),

  // Utilities
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  quitApp: () => ipcRenderer.invoke('quit-app')
});
