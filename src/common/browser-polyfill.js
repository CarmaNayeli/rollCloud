/**
 * Browser API Compatibility Layer - Chrome & Firefox Support
 *
 * This provides a consistent browserAPI interface across Chrome and Firefox.
 * Firefox uses the 'browser' namespace (Promise-based), while Chrome uses 'chrome' (callback-based).
 */

console.log('🌐 Loading browser polyfill...');

// Use 'self' for service workers, 'window' for content scripts/popups
const globalScope = typeof window !== 'undefined' ? window : self;

// Detect browser and use appropriate API
let browserAPI;

if (typeof browser !== 'undefined' && browser.runtime) {
  // Firefox - uses native Promise-based API
  console.log('🦊 Detected Firefox');
  browserAPI = browser;
} else if (typeof chrome !== 'undefined' && chrome.runtime) {
  // Chrome - wrap callback-based API to be consistent with Firefox
  console.log('🌐 Detected Chrome');
  // Helper to check if Chrome extension context is valid
  const isChromeContextValid = () => {
    try {
      return chrome && chrome.runtime && chrome.runtime.id;
    } catch (error) {
      return false;
    }
  };

  browserAPI = {
    runtime: {
      sendMessage: (message, callback) => {
        // If callback is provided, use callback-based API
        if (typeof callback === 'function') {
          try {
            if (!isChromeContextValid()) {
              console.error('❌ Extension context invalidated');
              callback(null);
              return;
            }
            chrome.runtime.sendMessage(message, callback);
          } catch (error) {
            // Handle "Extension context invalidated" error in Chrome
            console.error('❌ Extension context error:', error.message);
            callback(null);
          }
          return;
        }
        // Otherwise return a Promise
        return new Promise((resolve, reject) => {
          try {
            if (!isChromeContextValid()) {
              reject(new Error('Extension context invalidated'));
              return;
            }
            chrome.runtime.sendMessage(message, (response) => {
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
              } else {
                resolve(response);
              }
            });
          } catch (error) {
            // Handle "Extension context invalidated" error in Chrome
            console.error('❌ Extension context error:', error.message);
            reject(error);
          }
        });
      },
      onMessage: chrome.runtime.onMessage,
      getURL: (path) => {
        try {
          if (!isChromeContextValid()) return null;
          return chrome.runtime.getURL(path);
        } catch (error) {
          console.error('❌ Extension context error:', error.message);
          return null;
        }
      },
      getManifest: () => {
        try {
          if (!isChromeContextValid()) return null;
          return chrome.runtime.getManifest();
        } catch (error) {
          console.error('❌ Extension context error:', error.message);
          return null;
        }
      },
      get id() {
        try {
          if (!isChromeContextValid()) return null;
          return chrome.runtime.id;
        } catch (error) {
          console.error('❌ Extension context error:', error.message);
          return null;
        }
      },
      get lastError() {
        try {
          if (!isChromeContextValid()) return null;
          return chrome.runtime.lastError;
        } catch (error) {
          return null;
        }
      },
      connectNative: (application) => {
        try {
          if (!isChromeContextValid()) {
            console.error('❌ Extension context invalidated');
            return null;
          }
          const port = chrome.runtime.connectNative(application);
          // Check for immediate errors
          if (chrome.runtime.lastError) {
            console.warn('⚠️ Native messaging error:', chrome.runtime.lastError.message);
            return null;
          }
          return port;
        } catch (error) {
          console.error('❌ Native messaging error:', error.message);
          return null;
        }
      }
    },
    storage: {
      local: {
        get: (keys) => {
          return new Promise((resolve, reject) => {
            try {
              if (!isChromeContextValid()) {
                reject(new Error('Extension context invalidated'));
                return;
              }
              chrome.storage.local.get(keys, (result) => {
                if (chrome.runtime.lastError) {
                  reject(new Error(chrome.runtime.lastError.message));
                } else {
                  resolve(result);
                }
              });
            } catch (error) {
              reject(new Error('Extension context invalidated'));
            }
          });
        },
        set: (items) => {
          return new Promise((resolve, reject) => {
            try {
              if (!isChromeContextValid()) {
                reject(new Error('Extension context invalidated'));
                return;
              }
              chrome.storage.local.set(items, () => {
                if (chrome.runtime.lastError) {
                  reject(new Error(chrome.runtime.lastError.message));
                } else {
                  resolve();
                }
              });
            } catch (error) {
              reject(new Error('Extension context invalidated'));
            }
          });
        },
        remove: (keys) => {
          return new Promise((resolve, reject) => {
            try {
              if (!isChromeContextValid()) {
                reject(new Error('Extension context invalidated'));
                return;
              }
              chrome.storage.local.remove(keys, () => {
                if (chrome.runtime.lastError) {
                  reject(new Error(chrome.runtime.lastError.message));
                } else {
                  resolve();
                }
              });
            } catch (error) {
              reject(new Error('Extension context invalidated'));
            }
          });
        },
        clear: () => {
          return new Promise((resolve, reject) => {
            try {
              if (!isChromeContextValid()) {
                reject(new Error('Extension context invalidated'));
                return;
              }
              chrome.storage.local.clear(() => {
                if (chrome.runtime.lastError) {
                  reject(new Error(chrome.runtime.lastError.message));
                } else {
                  resolve();
                }
              });
            } catch (error) {
              reject(new Error('Extension context invalidated'));
            }
          });
        }
      },
      onChanged: chrome.storage.onChanged
    },
    tabs: {
      query: (queryInfo) => {
        return new Promise((resolve, reject) => {
          try {
            if (!isChromeContextValid()) {
              reject(new Error('Extension context invalidated'));
              return;
            }
            chrome.tabs.query(queryInfo, (tabs) => {
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
              } else {
                resolve(tabs);
              }
            });
          } catch (error) {
            reject(new Error('Extension context invalidated'));
          }
        });
      },
      sendMessage: (tabId, message, callback) => {
        // If callback is provided, use callback-based API
        if (typeof callback === 'function') {
          try {
            if (!isChromeContextValid()) {
              console.error('❌ Extension context invalidated');
              callback(null);
              return;
            }
            chrome.tabs.sendMessage(tabId, message, callback);
          } catch (error) {
            // Handle "Extension context invalidated" error in Chrome
            console.error('❌ Extension context error:', error.message);
            callback(null);
          }
          return;
        }
        // Otherwise return a Promise
        return new Promise((resolve, reject) => {
          try {
            if (!isChromeContextValid()) {
              reject(new Error('Extension context invalidated'));
              return;
            }
            chrome.tabs.sendMessage(tabId, message, (response) => {
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
              } else {
                resolve(response);
              }
            });
          } catch (error) {
            // Handle "Extension context invalidated" error in Chrome
            console.error('❌ Extension context error:', error.message);
            reject(error);
          }
        });
      },
      create: (createProperties) => {
        return new Promise((resolve, reject) => {
          try {
            if (!isChromeContextValid()) {
              reject(new Error('Extension context invalidated'));
              return;
            }
            chrome.tabs.create(createProperties, (tab) => {
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
              } else {
                resolve(tab);
              }
            });
          } catch (error) {
            reject(new Error('Extension context invalidated'));
          }
        });
      },
      update: (tabId, updateProperties) => {
        return new Promise((resolve, reject) => {
          try {
            if (!isChromeContextValid()) {
              reject(new Error('Extension context invalidated'));
              return;
            }
            chrome.tabs.update(tabId, updateProperties, (tab) => {
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
              } else {
                resolve(tab);
              }
            });
          } catch (error) {
            reject(new Error('Extension context invalidated'));
          }
        });
      }
    }
  };
} else {
  console.error('❌ FATAL: No browser API available!');
  throw new Error('No browser API available');
}

// Expose as browserAPI for consistent naming
globalScope.browserAPI = browserAPI;

// Verify API is available
if (!globalScope.browserAPI || !globalScope.browserAPI.runtime) {
  console.error('❌ FATAL: Browser API not available!');
  throw new Error('Browser API not available');
}

console.log('✅ Browser API ready:', (typeof browser !== 'undefined' && browserAPI === browser) ? 'Firefox' : 'Chrome');
