/**
 * Background Script - Chrome & Firefox Support
 * Handles data storage, API authentication, and communication between Dice Cloud and Roll20
 */

// For service workers (Chrome) and event pages (Firefox), import utility modules
if (typeof importScripts === 'function' && (typeof chrome !== 'undefined' || typeof browser !== 'undefined')) {
  // Service worker is at src/background.js, so paths are relative to src/ directory
  importScripts('./common/debug.js');
  importScripts('./lib/supabase-client.js');
  // Load edge case modules first (they export to globalThis)
  importScripts('./modules/spell-edge-cases.js');
  importScripts('./modules/class-feature-edge-cases.js');
  importScripts('./modules/racial-feature-edge-cases.js');
  importScripts('./modules/combat-maneuver-edge-cases.js');
  // Then load action-executor which depends on them
  importScripts('./modules/action-executor.js');
}

debug.log('RollCloud: Background script starting...');

// Detect browser and use appropriate API
// For Firefox, use the native Promise-based 'browser' API
// For Chrome, use native 'chrome' API directly (no polyfill needed in service worker)
const browserAPI = (typeof browser !== 'undefined' && browser.runtime) ? browser : chrome;

/**
 * Chrome MV3-compatible storage wrapper
 * Handles both Promise-based and callback-based Chrome storage API
 */
const storage = {
  async get(keys) {
    return new Promise((resolve, reject) => {
      try {
        const result = browserAPI.storage.local.get(keys, (items) => {
          if (browserAPI.runtime.lastError) {
            reject(new Error(browserAPI.runtime.lastError.message));
          } else {
            resolve(items);
          }
        });
        // If it returns a Promise, use that instead (Chrome MV3)
        if (result && typeof result.then === 'function') {
          result.then(resolve).catch(reject);
        }
      } catch (error) {
        reject(error);
      }
    });
  },

  async set(items) {
    return new Promise((resolve, reject) => {
      try {
        const result = browserAPI.storage.local.set(items, () => {
          if (browserAPI.runtime.lastError) {
            reject(new Error(browserAPI.runtime.lastError.message));
          } else {
            resolve();
          }
        });
        // If it returns a Promise, use that instead (Chrome MV3)
        if (result && typeof result.then === 'function') {
          result.then(resolve).catch(reject);
        }
      } catch (error) {
        reject(error);
      }
    });
  },

  async remove(keys) {
    return new Promise((resolve, reject) => {
      try {
        const result = browserAPI.storage.local.remove(keys, () => {
          if (browserAPI.runtime.lastError) {
            reject(new Error(browserAPI.runtime.lastError.message));
          } else {
            resolve();
          }
        });
        // If it returns a Promise, use that instead (Chrome MV3)
        if (result && typeof result.then === 'function') {
          result.then(resolve).catch(reject);
        }
      } catch (error) {
        reject(error);
      }
    });
  }
};

// Listen for storage changes to help debug unexpected logout/token removal
if (browserAPI && browserAPI.storage && browserAPI.storage.onChanged) {
  browserAPI.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.diceCloudToken) {
      const oldVal = changes.diceCloudToken.oldValue;
      const newVal = changes.diceCloudToken.newValue;
      debug.log('🔁 Storage change: diceCloudToken updated', { hasOld: !!oldVal, hasNew: !!newVal });
    }
    if (changes.explicitlyLoggedOut) {
      debug.log('🔒 Storage change: explicitlyLoggedOut set/cleared', { old: changes.explicitlyLoggedOut.oldValue, new: changes.explicitlyLoggedOut.newValue });
    }
  });
  debug.log('🛰️ Storage change listener registered for debug');
}

// Add startup storage check to debug auth persistence
(async () => {
  try {
    const startupStorage = await storage.get(['diceCloudToken', 'diceCloudUserId', 'tokenExpires', 'username', 'explicitlyLoggedOut']);
    debug.log('🚀 Background script startup storage state:', {
      hasToken: !!startupStorage.diceCloudToken,
      tokenLength: startupStorage.diceCloudToken ? startupStorage.diceCloudToken.length : 0,
      tokenStart: startupStorage.diceCloudToken ? startupStorage.diceCloudToken.substring(0, 20) + '...' : 'none',
      username: startupStorage.username,
      diceCloudUserId: startupStorage.diceCloudUserId,
      tokenExpires: startupStorage.tokenExpires,
      explicitlyLoggedOut: startupStorage.explicitlyLoggedOut,
      allKeys: Object.keys(startupStorage)
    });

    // If we have a token but no explicitlyLoggedOut flag, ensure we're in a good state
    if (startupStorage.diceCloudToken && !startupStorage.explicitlyLoggedOut) {
      debug.log('✅ Service worker restarted with valid auth state');

      // Validate the token expiry on startup
      if (startupStorage.tokenExpires) {
        const expiryDate = new Date(startupStorage.tokenExpires);
        const now = new Date();

        if (!isNaN(expiryDate.getTime()) && now < expiryDate) {
          debug.log('✅ Token is still valid on startup');
        } else if (isNaN(expiryDate.getTime())) {
          debug.warn('⚠️ Invalid expiry date on startup, clearing it');
          await storage.remove('tokenExpires');
        } else {
          debug.warn('⏰ Token expired on startup, logging out');
          await logout();
        }
      }
    } else if (startupStorage.explicitlyLoggedOut) {
      debug.log('⏭️ Service worker restarted after explicit logout');
    } else {
      debug.log('🔍 No auth state found on startup');
    }
  } catch (error) {
    debug.error('Failed to check startup storage:', error);
  }
})();

// Detect which browser we're running on
const isFirefox = typeof browser !== 'undefined';
debug.log('RollCloud: Background script initialized on', isFirefox ? 'Firefox' : 'Chrome');

// Add service worker lifecycle listeners for Chrome
if (!isFirefox && chrome.runtime && chrome.runtime.onSuspend) {
  chrome.runtime.onSuspend.addListener(() => {
    debug.log('🔌 Service worker suspending - saving state...');
    // Any cleanup before suspension goes here
  });
}

if (!isFirefox && chrome.runtime && chrome.runtime.onSuspendCanceled) {
  chrome.runtime.onSuspendCanceled.addListener(() => {
    debug.log('♻️ Service worker suspension canceled');
  });
}

if (!isFirefox && chrome.runtime && chrome.runtime.onStartup) {
  chrome.runtime.onStartup.addListener(() => {
    debug.log('🚀 Chrome startup event received');
  });
}

// Persistent alarm to keep service worker alive for realtime connections
// Chrome MV3 service workers terminate after ~30s of inactivity, breaking WebSockets
// Firefox event pages also benefit from periodic activity
const REALTIME_KEEPALIVE_ALARM = 'realtimeKeepAlive';

// Setup alarm listener for both Chrome and Firefox
if (browserAPI.alarms) {
  browserAPI.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === REALTIME_KEEPALIVE_ALARM) {
      debug.log('⏰ Realtime keep-alive alarm triggered');

      // Check if we should have a realtime connection
      const settings = await browserAPI.storage.local.get(['discordWebhookEnabled', 'discordPairingId', 'discordWebhookUrl']);
      const hasWebhookIntegration = settings.discordWebhookEnabled && settings.discordWebhookUrl;
      const hasPairingIntegration = settings.discordPairingId;

      if (!hasWebhookIntegration && !hasPairingIntegration) {
        debug.log('⏭️ No active Discord connection, skipping realtime check');
        return;
      }

      // Check if WebSocket is still connected
      if (!commandRealtimeSocket || commandRealtimeSocket.readyState !== WebSocket.OPEN) {
        debug.log('🔄 WebSocket disconnected, reconnecting...');
        await subscribeToCommandRealtime(settings.discordPairingId);
      } else {
        debug.log('✅ WebSocket still connected');
      }

      // Drain any pending commands that may have arrived
      drainPendingCommands();
    }
  });
  debug.log('🛰️ Realtime keep-alive alarm listener registered');
}

/**
 * Start the realtime keep-alive alarm (call when Discord is connected)
 */
function startRealtimeKeepAlive() {
  if (browserAPI.alarms) {
    // Fire every 1 minute to keep service worker/event page alive
    // Chrome terminates after ~30s of inactivity, but sub-minute alarms are unreliable
    // Firefox event pages benefit from periodic activity too
    browserAPI.alarms.create(REALTIME_KEEPALIVE_ALARM, { periodInMinutes: 1 });
    debug.log('⏰ Started realtime keep-alive alarm');
  }
}

/**
 * Stop the realtime keep-alive alarm (call when Discord is disconnected)
 */
function stopRealtimeKeepAlive() {
  if (browserAPI.alarms) {
    browserAPI.alarms.clear(REALTIME_KEEPALIVE_ALARM);
    debug.log('⏰ Stopped realtime keep-alive alarm');
  }
}

let keepAliveInterval = null;

/**
 * Keeps the service worker alive during critical operations
 * Chrome service workers can be terminated after ~5 minutes of inactivity
 */
function keepServiceWorkerAlive(durationMs = 30000) {
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
  }
  
  debug.log('💓 Keeping service worker alive for', durationMs, 'ms');
  
  // Use chrome.alarms API if available, otherwise fallback to setInterval
  if (chrome.alarms) {
    chrome.alarms.create('keepAlive', { delayInMinutes: durationMs / 60000 });
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === 'keepAlive') {
        debug.log('💓 Keep-alive alarm triggered');
      }
    });
  } else {
    // Fallback: ping ourselves every 25 seconds
    keepAliveInterval = setInterval(() => {
      debug.log('💓 Service worker keep-alive ping');
    }, 25000);
    
    setTimeout(() => {
      if (keepAliveInterval) {
        clearInterval(keepAliveInterval);
        keepAliveInterval = null;
        debug.log('💓 Keep-alive interval cleared');
      }
    }, durationMs);
  }
}

/**
 * Stops the keep-alive mechanism
 */
function stopKeepAlive() {
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
    keepAliveInterval = null;
  }
  if (chrome.alarms) {
    chrome.alarms.clear('keepAlive');
  }
  debug.log('💔 Keep-alive stopped');
}
if (isFirefox) {
  debug.log('🦊 Firefox detected - checking extension context...');
  
  // Test if we can access runtime
  try {
    const manifest = browserAPI.runtime.getManifest();
    debug.log('✅ Firefox runtime accessible, version:', manifest.version);
  } catch (error) {
    debug.error('❌ Firefox runtime not accessible:', error);
  }
  
  // Test storage
  try {
    browserAPI.storage.local.get(['test'], (result) => {
      if (browserAPI.runtime.lastError) {
        debug.error('❌ Firefox storage error:', browserAPI.runtime.lastError);
      } else {
        debug.log('✅ Firefox storage working');
      }
    });
  } catch (error) {
    debug.error('❌ Firefox storage test error:', error);
  }
}

const API_BASE = 'https://dicecloud.com/api';

// Listen for messages from content scripts and popup
browserAPI.runtime.onMessage.addListener((request, sender, sendResponse) => {
  debug.log('Background received message:', request);
  debug.log('Message sender:', sender);

  // If this is a content script message, let it handle itself
  if (sender.tab && request.action === 'extractAuthToken') {
    debug.log('📤 Passing extractAuthToken to content script - not handling in background');
    return false; // Don't handle here, let content script handle it
  }

  // Handle async operations and call sendResponse when done
  // This pattern keeps the message port open until sendResponse is called
  (async () => {
    try {
      let response;

      switch (request.action) {
        case 'storeCharacterData':
          await storeCharacterData(request.data, request.slotId);
          // Auto-sync to Supabase if Discord is connected (for Discord bot commands)
          // This ensures spells/actions are always available to Discord commands
          try {
            if (typeof SupabaseTokenManager !== 'undefined') {
              const webhookSettings = await browserAPI.storage.local.get(['discordWebhookEnabled', 'discordUserId']);
              const shouldAutoSync = request.syncToCloud || webhookSettings.discordWebhookEnabled || webhookSettings.discordUserId;
              if (shouldAutoSync) {
                debug.log('☁️ Auto-syncing character to cloud (Discord connected)');
                await storeCharacterToCloud(request.data, request.pairingCode);
              }
            }
          } catch (syncError) {
            debug.warn('⚠️ Auto-sync to cloud failed (non-fatal):', syncError.message);
          }
          response = { success: true };
          break;

        case 'syncCharacterToCloud': {
          // Explicitly sync character to Supabase
          const syncResult = await storeCharacterToCloud(request.characterData, request.pairingCode);
          response = syncResult;
          break;
        }

        case 'syncCharacterColor': {
          // Sync character color to Supabase
          const syncResult = await syncCharacterColorToSupabase(request.characterId, request.color);
          response = syncResult;
          break;
        }

        case 'checkDiscordCharacterIntegration': {
          // Check if current character is active in Discord bot
          const checkResult = await checkDiscordCharacterIntegration(request.characterName, request.characterId);
          response = checkResult;
          break;
        }

        case 'fetchDiceCloudAPI': {
          // Fetch from DiceCloud API (used by Roll20 content script)
          const fetchResult = await fetchFromDiceCloudAPI(request.url, request.token);
          response = fetchResult;
          break;
        }

        case 'getCharacterData': {
          const data = await getCharacterData(request.characterId);
          response = { success: true, data };
          break;
        }

        case 'getCharacterDataFromDatabase': {
          // Handle database character loading
          const data = await getCharacterDataFromDatabase(request.characterId);
          response = { success: true, data };
          break;
        }

        case 'getAllCharacterProfiles': {
          const profiles = await getAllCharacterProfiles();
          response = { success: true, profiles };
          break;
        }

        case 'setActiveCharacter':
          await setActiveCharacter(request.characterId);
          response = { success: true };
          break;

        case 'clearCharacterData':
          await clearCharacterData(request.characterId);
          response = { success: true };
          break;

        case 'deleteCharacterFromCloud':
          await deleteCharacterFromCloud(request.characterId);
          response = { success: true };
          break;

        case 'loginToDiceCloud': {
          const authData = await loginToDiceCloud(request.username, request.password);
          response = { success: true, authData };
          break;
        }

        case 'setApiToken': {
          await setApiToken(request.token, request.userId, request.tokenExpires, request.username);
          response = { success: true };
          break;
        }

        case 'getApiToken': {
          const token = await getApiToken();
          response = { success: true, token };
          break;
        }

        case 'getManifest': {
          const manifest = browserAPI.runtime.getManifest();
          response = { success: true, manifest };
          break;
        }

        case 'logout':
          await logout();
          response = { success: true };
          break;

        case 'rollResult':
          // Forward roll result to Roll20 content script for popup forwarding
          debug.log('🧬 Forwarding roll result to Roll20 for popup:', request);
          
          // Send to Roll20 content script to forward to popup
          const roll20Tabs = await browserAPI.tabs.query({ url: '*://app.roll20.net/*' });
          if (roll20Tabs.length > 0) {
            await browserAPI.tabs.sendMessage(roll20Tabs[0].id, {
              action: 'forwardToPopup',
              rollResult: request.rollResult,
              baseRoll: request.baseRoll,
              characterName: request.characterName,
              characterId: request.characterId
            });
            response = { success: true };
          } else {
            response = { success: false, error: 'No Roll20 tabs found' };
          }
          break;

        case 'relayRollToRoll20': {
          // Relay roll from popup-sheet to Roll20 content script
          debug.log('🎲 Relaying roll to Roll20:', request.roll);

          const r20Tabs = await browserAPI.tabs.query({ url: '*://app.roll20.net/*' });
          if (r20Tabs.length > 0) {
            for (const tab of r20Tabs) {
              try {
                await browserAPI.tabs.sendMessage(tab.id, {
                  action: 'rollFromPopout',
                  roll: request.roll,
                  name: request.roll?.name,
                  formula: request.roll?.formula,
                  characterName: request.roll?.characterName
                });
                debug.log('✅ Roll relayed to Roll20 tab:', tab.id);
              } catch (tabError) {
                debug.warn('⚠️ Could not send to tab', tab.id, tabError.message);
              }
            }
            response = { success: true };
          } else {
            debug.warn('⚠️ No Roll20 tabs found to relay roll');
            response = { success: false, error: 'No Roll20 tabs found' };
          }
          break;
        }

        case 'postChatMessageFromPopup': {
          // Post character broadcast or other messages to Roll20 chat
          debug.log('📨 Posting chat message from popup:', request.message?.substring(0, 100));
          await sendChatMessageToAllRoll20Tabs(request.message);
          response = { success: true };
          break;
        }

        // Handle extractAuthToken with tabId and forward to content script
        case 'extractAuthToken': {
          if (request.tabId) {
            debug.log('📤 Forwarding extractAuthToken to tab:', request.tabId);
            try {
              const contentResponse = await browserAPI.tabs.sendMessage(request.tabId, {
                action: 'extractAuthToken'
              });
              debug.log('📥 Received response from content script:', contentResponse);
              response = { success: true, data: contentResponse };
            } catch (error) {
              debug.error('❌ Error forwarding to content script:', error);
              response = { success: false, error: error.message };
            }
          } else {
            response = { success: false, error: 'No tabId provided' };
          }
          break;
        }

        // ============== Discord Pairing Message Handlers ==============

        case 'checkLoginStatus': {
          const loginStatus = await checkLoginStatus();
          response = { success: true, ...loginStatus };
          break;
        }

        case 'toggleGMMode': {
          // Forward GM Mode toggle to all Roll20 tabs
          debug.log('👑 Received toggleGMMode request, forwarding to Roll20 tabs');
          await sendGMModeToggleToRoll20Tabs(request.enabled);
          response = { success: true };
          break;
        }

        case 'createDiscordPairing': {
          const pairingResult = await createDiscordPairing(request.code, request.username, request.diceCloudUserId);
          response = pairingResult;
          break;
        }

        case 'checkDiscordPairing': {
          const checkResult = await checkDiscordPairing(request.code);
          response = checkResult;
          break;
        }

        case 'setDiscordWebhook': {
          // Use request.enabled if provided, otherwise default to true when URL is provided
          const enabled = request.enabled !== undefined ? request.enabled : !!request.webhookUrl;
          debug.log('📝 setDiscordWebhook called:', {
            webhookUrl: request.webhookUrl ? `${request.webhookUrl.substring(0, 50)}...` : '(empty)',
            enabled,
            serverName: request.serverName,
            pairingId: request.pairingId
          });
          await setDiscordWebhookSettings(request.webhookUrl, enabled, request.serverName);
          // Also set the pairing ID for command polling if provided
          if (request.pairingId) {
            currentPairingId = request.pairingId;
            await browserAPI.storage.local.set({
              currentPairingId: request.pairingId,
              discordPairingId: request.pairingId
            });
            // Subscribe to command realtime
            subscribeToCommandRealtime(request.pairingId);
          }
          // Link Discord user info to auth_tokens if provided
          if (request.discordUserId && request.discordUserId !== 'null') {
            await linkDiscordUserToAuthTokens(
              request.discordUserId,
              request.discordUsername,
              request.discordGlobalName
            );
          }
          response = { success: true };
          break;
        }

        case 'getDiscordWebhook': {
          const settings = await getDiscordWebhookSettings();

          // If connected, ensure discord_user_id is linked to auth_tokens
          if (settings.enabled && settings.webhookUrl) {
            const stored = await browserAPI.storage.local.get(['discordPairingId']);
            if (stored.discordPairingId && isSupabaseConfigured()) {
              try {
                const pairingResponse = await fetch(
                  `${SUPABASE_URL}/rest/v1/rollcloud_pairings?id=eq.${stored.discordPairingId}&select=discord_user_id,discord_username,discord_global_name`,
                  {
                    headers: {
                      'apikey': SUPABASE_ANON_KEY,
                      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
                    }
                  }
                );
                if (pairingResponse.ok) {
                  const pairings = await pairingResponse.json();
                  if (pairings.length > 0 && pairings[0].discord_user_id) {
                    // Ensure auth_tokens has all Discord info
                    await linkDiscordUserToAuthTokens(
                      pairings[0].discord_user_id,
                      pairings[0].discord_username,
                      pairings[0].discord_global_name
                    );
                  }
                }
              } catch (e) {
                debug.warn('Could not sync discord_user_id on getDiscordWebhook:', e);
              }
            }
          }

          response = { success: true, ...settings };
          break;
        }

        case 'testDiscordWebhook': {
          // Use the provided URL, or fall back to the stored webhook URL
          let webhookUrlToTest = request.webhookUrl;
          if (!webhookUrlToTest) {
            const settings = await getDiscordWebhookSettings();
            webhookUrlToTest = settings.webhookUrl;
          }
          const testResult = await testDiscordWebhook(webhookUrlToTest);
          response = testResult;
          break;
        }

        case 'getUserCharacters': {
          // Get user's synced characters from Supabase
          const characters = await getUserCharactersFromCloud(request.pairingId);
          response = { success: true, characters };
          break;
        }

        case 'requestPairingCodeFromInstaller': {
          // Request pairing code from native messaging host
          if (installerPort) {
            installerPort.postMessage({ type: 'getPairingCode' });
            response = { success: true, message: 'Pairing code requested from installer' };
          } else {
            // Try to connect first
            const port = await connectToInstaller();
            if (port) {
              port.postMessage({ type: 'getPairingCode' });
              response = { success: true, message: 'Connected and requested pairing code' };
            } else {
              response = { success: false, error: 'Could not connect to installer' };
            }
          }
          break;
        }

        case 'getRealtimeStatus': {
          // Return current Realtime connection status for debugging
          const realtimeConnected = commandRealtimeSocket && commandRealtimeSocket.readyState === WebSocket.OPEN;
          const settings = await browserAPI.storage.local.get(['discordPairingId', 'discordWebhookEnabled']);
          response = {
            success: true,
            realtimeConnected,
            socketState: commandRealtimeSocket ? commandRealtimeSocket.readyState : null,
            currentPairingId,
            storedPairingId: settings.discordPairingId,
            webhookEnabled: settings.discordWebhookEnabled,
            supabaseConfigured: isSupabaseConfigured()
          };
          debug.log('Realtime status:', response);
          break;
        }

        case 'ping':
          // Keep-alive ping to wake up service worker (Opera compatibility)
          debug.log('📡 Received ping from content script');
          response = { success: true, pong: true, timestamp: Date.now() };
          break;

        default:
          debug.warn('Unknown action:', request.action);
          response = { success: false, error: 'Unknown action: ' + request.action };
          break;
      }

      debug.log('Sending response:', response);
      sendResponse(response);
    } catch (error) {
      debug.error('Error handling message:', error);
      sendResponse({ success: false, error: error.message });
    }
  })();

  // Return true to indicate we'll respond asynchronously
  return true;
});

/**
 * Clears all existing auth and character data before logging in
 * This ensures a clean state when switching between accounts
 */
async function clearExistingAuthData() {
  debug.log('🧹 Clearing existing auth and character data for new login...');

  try {
    // Clear all auth-related data
    await new Promise((resolve, reject) => {
      const keysToRemove = [
        'diceCloudToken',
        'diceCloudUserId',
        'tokenExpires',
        'username',
        'characterProfiles',
        'activeCharacterId',
        'characterData',
        'explicitlyLoggedOut'
      ];

      try {
        const result = browserAPI.storage.local.remove(keysToRemove);
        if (result && typeof result.then === 'function') {
          result.then(resolve).catch(reject);
        } else {
          browserAPI.runtime.lastError ? reject(new Error(browserAPI.runtime.lastError.message)) : resolve();
        }
      } catch (error) {
        reject(error);
      }
    });

    debug.log('✅ Existing auth data cleared successfully');
  } catch (error) {
    debug.error('❌ Failed to clear existing auth data:', error);
    // Don't throw - continue with login even if clear fails
  }
}

/**
 * Logs in to DiceCloud API with username/password
 * Per DiceCloud API docs: POST https://dicecloud.com/api/login
 * Accepts either username or email with password
 */
async function loginToDiceCloud(username, password) {
  try {
    // Keep service worker alive during login process
    keepServiceWorkerAlive(60000); // Keep alive for 1 minute during login

    // Clear any existing auth data first to prevent conflicts when switching accounts
    await clearExistingAuthData();

    // Try to determine if input is email or username
    const isEmail = username.includes('@');

    const response = await fetch(`${API_BASE}/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(isEmail ? {
        email: username,
        password: password
      } : {
        username: username,
        password: password
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Login failed: ${response.status} - ${errorText}`);
    }

    const data = await response.json();

    // Store authentication data including token expiry
    // Use explicit Promise wrapper for Chrome MV3 compatibility
    await new Promise((resolve, reject) => {
      const storageData = {
        diceCloudToken: data.token,
        diceCloudUserId: data.id,
        tokenExpires: data.tokenExpires,
        username: username
      };

      debug.log('📝 Storing auth data:', {
        hasToken: !!data.token,
        userId: data.id,
        username: username
      });

      try {
        const result = browserAPI.storage.local.set(storageData);

        // Handle both Promise and callback-based APIs
        if (result && typeof result.then === 'function') {
          result.then(resolve).catch(reject);
        } else {
          // Callback-based (older Chrome)
          browserAPI.runtime.lastError ? reject(new Error(browserAPI.runtime.lastError.message)) : resolve();
        }
      } catch (error) {
        reject(error);
      }
    });

    debug.log('Successfully logged in to DiceCloud');
    debug.log('Token expires:', data.tokenExpires);
    
    // Keep alive a bit longer to ensure token is properly stored
    setTimeout(() => stopKeepAlive(), 5000);
    
    return data;
  } catch (error) {
    stopKeepAlive();
    debug.error('Failed to login to DiceCloud:', error);
    throw error;
  }
}

/**
 * Stores the API token (extracted from DiceCloud session or manually entered)
 */
async function setApiToken(token, userId = null, tokenExpires = null, username = null) {
  try {
    // Keep service worker alive during token storage
    keepServiceWorkerAlive(30000); // Keep alive for 30 seconds

    debug.log('🔐 setApiToken called:', {
      tokenLength: token ? token.length : 0,
      tokenStart: token ? token.substring(0, 20) + '...' : 'none',
      userId,
      tokenExpires,
      username
    });

    // Validate token format (basic check)
    if (!token || token.length < 10) {
      throw new Error('Invalid API token format');
    }

    // Clear any existing auth data first to prevent conflicts when switching accounts
    await clearExistingAuthData();

    // Store the API token with optional metadata
    const storageData = {
      diceCloudToken: token,
      username: username || 'DiceCloud User'
    };

    if (userId) {
      storageData.diceCloudUserId = userId;
    }

    if (tokenExpires) {
      storageData.tokenExpires = tokenExpires;
    }

    // Use explicit Promise wrapper for Chrome MV3 compatibility
    await new Promise((resolve, reject) => {
      debug.log('📝 setApiToken: Storing token data');
      try {
        const result = browserAPI.storage.local.set(storageData);
        if (result && typeof result.then === 'function') {
          result.then(resolve).catch(reject);
        } else {
          browserAPI.runtime.lastError ? reject(new Error(browserAPI.runtime.lastError.message)) : resolve();
        }
      } catch (error) {
        reject(error);
      }
    });

    // Verify the token was stored correctly
    const verification = await new Promise((resolve, reject) => {
      try {
        const result = browserAPI.storage.local.get(['diceCloudToken', 'diceCloudUserId', 'tokenExpires', 'username']);
        if (result && typeof result.then === 'function') {
          result.then(resolve).catch(reject);
        } else {
          browserAPI.runtime.lastError ? reject(new Error(browserAPI.runtime.lastError.message)) : resolve(result);
        }
      } catch (error) {
        reject(error);
      }
    });
    debug.log('✅ setApiToken verification:', {
      storedToken: verification.diceCloudToken ? verification.diceCloudToken.substring(0, 20) + '...' : 'none',
      storedUserId: verification.diceCloudUserId,
      storedUsername: verification.username,
      storedExpires: verification.tokenExpires
    });

    debug.log('Successfully stored API token');
    
    // Keep alive a bit longer to ensure token is properly stored
    setTimeout(() => stopKeepAlive(), 3000);
    
    return { success: true };
  } catch (error) {
    stopKeepAlive();
    debug.error('Failed to store API token:', error);
    throw error;
  }
}

/**
 * Gets the stored API token
 * Checks expiry for tokens obtained via username/password login
 */
async function getApiToken() {
  try {
    const result = await browserAPI.storage.local.get(['diceCloudToken', 'tokenExpires']);
    
    debug.log('🔍 getApiToken called, storage result:', {
      hasToken: !!result.diceCloudToken,
      tokenLength: result.diceCloudToken ? result.diceCloudToken.length : 0,
      tokenStart: result.diceCloudToken ? result.diceCloudToken.substring(0, 20) + '...' : 'none',
      tokenExpires: result.tokenExpires,
      allKeys: Object.keys(result)
    });

    if (!result.diceCloudToken) {
      debug.warn('❌ No diceCloudToken found in storage');
      return null;
    }

    // Check if token is expired (only if tokenExpires exists - API tokens don't expire)
    if (result.tokenExpires) {
      let expiryDate;
      
      // Handle different date formats that DiceCloud might send
      if (typeof result.tokenExpires === 'number') {
        // Unix timestamp (milliseconds)
        expiryDate = new Date(result.tokenExpires);
      } else if (typeof result.tokenExpires === 'string') {
        // ISO string or other format
        expiryDate = new Date(result.tokenExpires);
        // Check if date parsing failed
        if (isNaN(expiryDate.getTime())) {
          debug.warn('⚠️ Invalid tokenExpires date format:', result.tokenExpires);
          // Don't logout, just skip expiry check
          expiryDate = null;
        }
      }
      
      const now = new Date();
      debug.log('🔍 Token expiry check:', {
        tokenExpires: result.tokenExpires,
        expiryDate: expiryDate ? expiryDate.toISOString() : 'invalid',
        now: now.toISOString(),
        isExpired: expiryDate ? now >= expiryDate : 'unknown'
      });
      
      if (expiryDate && now >= expiryDate) {
        debug.warn('⏰ API token has expired, logging out');
        await logout();
        return null;
      }
    }

    debug.log('✅ getApiToken returning valid token');
    return result.diceCloudToken;
  } catch (error) {
    debug.error('Failed to retrieve API token:', error);
    throw error;
  }
}

/**
 * Checks if the user is logged in
 * Also validates token expiry for username/password logins
 */
async function checkLoginStatus() {
  try {
    const result = await browserAPI.storage.local.get(['diceCloudToken', 'username', 'tokenExpires', 'diceCloudUserId']);
    
    debug.log('🔍 checkLoginStatus called, storage result:', {
      hasToken: !!result.diceCloudToken,
      tokenLength: result.diceCloudToken ? result.diceCloudToken.length : 0,
      tokenStart: result.diceCloudToken ? result.diceCloudToken.substring(0, 20) + '...' : 'none',
      username: result.username,
      diceCloudUserId: result.diceCloudUserId,
      tokenExpires: result.tokenExpires,
      allKeys: Object.keys(result)
    });

    if (!result.diceCloudToken) {
      debug.warn('❌ checkLoginStatus: No diceCloudToken found');
      return { loggedIn: false };
    }

    // Check if token is expired (only if tokenExpires exists - API tokens don't expire)
    if (result.tokenExpires) {
      let expiryDate;
      
      // Handle different date formats that DiceCloud might send
      if (typeof result.tokenExpires === 'number') {
        // Unix timestamp (milliseconds)
        expiryDate = new Date(result.tokenExpires);
      } else if (typeof result.tokenExpires === 'string') {
        // ISO string or other format
        expiryDate = new Date(result.tokenExpires);
        // Check if date parsing failed
        if (isNaN(expiryDate.getTime())) {
          debug.warn('⚠️ Invalid tokenExpires date format in checkLoginStatus:', result.tokenExpires);
          // Don't logout, just skip expiry check
          expiryDate = null;
        }
      }
      
      const now = new Date();
      debug.log('🔍 Login status expiry check:', {
        tokenExpires: result.tokenExpires,
        expiryDate: expiryDate ? expiryDate.toISOString() : 'invalid',
        now: now.toISOString(),
        isExpired: expiryDate ? now >= expiryDate : 'unknown'
      });
      
      if (expiryDate && now >= expiryDate) {
        debug.warn('⏰ Session expired - please login again');
        await logout();
        return { loggedIn: false };
      }
    }

    debug.log('✅ checkLoginStatus: User is logged in');
    return {
      loggedIn: true,
      username: result.username || 'DiceCloud User',
      userId: result.diceCloudUserId || null
    };
  } catch (error) {
    debug.error('Failed to check login status:', error);
    throw error;
  }
}

/**
 * Logs out (clears authentication data)
 */
async function logout() {
  try {
    debug.warn('🚪 logout() called - getting current storage state...');

    // Get current state before clearing - use Promise wrapper
    const currentState = await new Promise((resolve, reject) => {
      try {
        const result = browserAPI.storage.local.get(['diceCloudToken', 'diceCloudUserId', 'tokenExpires', 'username', 'explicitlyLoggedOut']);
        if (result && typeof result.then === 'function') {
          result.then(resolve).catch(reject);
        } else {
          browserAPI.runtime.lastError ? reject(new Error(browserAPI.runtime.lastError.message)) : resolve(result);
        }
      } catch (error) {
        reject(error);
      }
    });

    debug.log('🔍 Current storage before logout:', {
      hasToken: !!currentState.diceCloudToken,
      tokenLength: currentState.diceCloudToken ? currentState.diceCloudToken.length : 0,
      username: currentState.username,
      diceCloudUserId: currentState.diceCloudUserId,
      tokenExpires: currentState.tokenExpires,
      explicitlyLoggedOut: currentState.explicitlyLoggedOut
    });

    // Set flag first to prevent autoRefreshToken from re-saving the token
    await new Promise((resolve, reject) => {
      debug.log('📝 logout: Setting explicitlyLoggedOut flag');
      try {
        const result = browserAPI.storage.local.set({ explicitlyLoggedOut: true });
        if (result && typeof result.then === 'function') {
          result.then(resolve).catch(reject);
        } else {
          browserAPI.runtime.lastError ? reject(new Error(browserAPI.runtime.lastError.message)) : resolve();
        }
      } catch (error) {
        reject(error);
      }
    });

    // Remove all auth data
    await new Promise((resolve, reject) => {
      debug.log('🗑️ logout: Removing auth tokens');
      try {
        const result = browserAPI.storage.local.remove(['diceCloudToken', 'diceCloudUserId', 'tokenExpires', 'username']);
        if (result && typeof result.then === 'function') {
          result.then(resolve).catch(reject);
        } else {
          browserAPI.runtime.lastError ? reject(new Error(browserAPI.runtime.lastError.message)) : resolve();
        }
      } catch (error) {
        reject(error);
      }
    });

    // Also delete token from Supabase database to prevent auto-restore
    try {
      if (typeof SupabaseTokenManager !== 'undefined') {
        debug.log('🗑️ logout: Removing auth token from Supabase database');
        const tokenManager = new SupabaseTokenManager();
        await tokenManager.deleteToken();
        debug.log('✅ logout: Token removed from Supabase');
      }
    } catch (dbError) {
      debug.warn('⚠️ logout: Failed to delete token from Supabase (non-fatal):', dbError.message);
    }

    debug.warn('🚪 logout() completed - storage cleared');
  } catch (error) {
    debug.error('Failed to logout:', error);
    throw error;
  }
}

/**
 * Stores character data in browserAPI.storage (supports multiple profiles)
 * @param {Object} characterData - Character data to store
 * @param {string} slotId - Optional slot ID (e.g., 'slot-1'). If not provided, uses characterId from data.
 */
async function storeCharacterData(characterData, slotId) {
  try {
    // Normalize field names: database uses character_name, DiceCloud uses name
    // Ensure 'name' field exists for consistent display
    if (characterData.character_name && !characterData.name) {
      characterData.name = characterData.character_name;
    }

    // Tag the character with the current DiceCloud user ID for ownership filtering.
    // This prevents characters viewed on other users' pages from leaking into the
    // current user's character list.
    if (!characterData.ownerUserId) {
      try {
        const stored = await browserAPI.storage.local.get(['diceCloudUserId']);
        if (stored.diceCloudUserId) {
          characterData.ownerUserId = stored.diceCloudUserId;
        }
      } catch (e) {
        debug.warn('Could not retrieve DiceCloud user ID for ownership tagging:', e);
      }
    }

    // Use slotId if provided, otherwise fall back to character ID from the data
    const storageId = slotId || characterData.id || characterData._id || 'default';

    // --- Ensure armorClass is populated for local saves ---
    try {
      // Try to extract armor class from common locations in the raw payload
      const extractArmor = (obj) => {
        if (!obj || typeof obj !== 'object') return null;
        if (typeof obj.armorClass === 'number') return obj.armorClass;
        if (typeof obj.armor_class === 'number') return obj.armor_class;
        if (obj.ac && typeof obj.ac === 'object') {
          if (typeof obj.ac.base === 'number') return obj.ac.base;
          if (typeof obj.ac.total === 'number') return obj.ac.total;
        }
        if (obj.defenses && typeof obj.defenses === 'object') {
          if (typeof obj.defenses.armor_class === 'number') return obj.defenses.armor_class;
          if (typeof obj.defenses.armorClass === 'number') return obj.defenses.armorClass;
        }
        return null;
      };

      let candidate = null;
      if (characterData && characterData.raw_dicecloud_data) candidate = characterData.raw_dicecloud_data;
      else if (characterData && characterData._fullData && characterData._fullData.raw_dicecloud_data) candidate = characterData._fullData.raw_dicecloud_data;
      else if (characterData && characterData._fullData) candidate = characterData._fullData;

      // Unwrap nested wrappers
      const seenLocal = new Set();
      while (candidate && typeof candidate === 'object' && candidate.raw_dicecloud_data && !seenLocal.has(candidate)) {
        seenLocal.add(candidate);
        candidate = candidate.raw_dicecloud_data;
      }

      const acFromRaw = extractArmor(candidate);
      if (typeof acFromRaw === 'number') {
        characterData.armorClass = acFromRaw;
      } else if (!characterData.armorClass && characterData.ac && typeof characterData.ac === 'number') {
        characterData.armorClass = characterData.ac;
      }
    } catch (e) {
      debug.warn('⚠️ Failed to derive armorClass for local save:', e && e.message ? e.message : e);
    }

    // Get existing profiles
    const result = await browserAPI.storage.local.get(['characterProfiles', 'activeCharacterId']);
    const characterProfiles = result.characterProfiles || {};

    // Deduplication: Check if this character already exists in a different slot
    // If it does, delete it from the old slot before saving to the new slot
    const characterId = characterData.id || characterData._id;
    if (characterId) {
      for (const [existingSlotId, existingProfile] of Object.entries(characterProfiles)) {
        // Skip if it's the same slot we're saving to
        if (existingSlotId === storageId) continue;

        // Check if the existing profile has the same character ID
        const existingId = existingProfile.id || existingProfile._id;
        if (existingId === characterId) {
          debug.log(`🔄 Deduplicating character: "${characterData.name}" found in ${existingSlotId}, removing before saving to ${storageId}`);
          delete characterProfiles[existingSlotId];
          break; // Only one duplicate should exist
        }
      }
    }

    // SPECIAL CASE: Preserve notification color from existing profile
    // When syncing from DiceCloud, the character data may not include notificationColor
    // or may have a default color. Preserve the user's chosen color if it exists.
    const existingProfile = characterProfiles[storageId];
    if (existingProfile && existingProfile.notificationColor) {
      // Only preserve if the new data doesn't have a color, or has the default color
      if (!characterData.notificationColor || characterData.notificationColor === '#3498db') {
        debug.log(`🎨 Preserving existing notification color: ${existingProfile.notificationColor}`);
        characterData.notificationColor = existingProfile.notificationColor;
      }
    }

    // Store this character's data EXACTLY as received (now includes ownerUserId)
    characterProfiles[storageId] = characterData;

    // Only update activeCharacterId if slotId was explicitly provided
    // This prevents the "default" storage from overriding a specific slot selection
    const updates = {
      characterProfiles: characterProfiles,
      timestamp: Date.now()
    };

    // Only set activeCharacterId if there's no active character currently
    // This prevents character data updates from overwriting user's character selection
    if (!result.activeCharacterId) {
      updates.activeCharacterId = storageId;
      debug.log(`Setting active character to: ${storageId}`);
    } else {
      debug.log(`Keeping existing active character: ${result.activeCharacterId}`);
    }

    await browserAPI.storage.local.set(updates);

    debug.log(`Character data stored successfully for ID: ${storageId}`, characterData);
  } catch (error) {
    debug.error('Failed to store character data:', error);
    throw error;
  }
}

/**
 * Retrieves character data from browserAPI.storage
 * If characterId is provided, returns that specific character
 * Otherwise returns the active character
 */
async function getCharacterData(characterId = null) {
  try {
    const result = await browserAPI.storage.local.get(['characterProfiles', 'activeCharacterId', 'characterData']);

    // Migration: if old single characterData exists, migrate it
    if (result.characterData && !result.characterProfiles) {
      debug.log('Migrating old single character data to profiles...');
      const charId = result.characterData.characterId || result.characterData._id || 'default';
      const characterProfiles = {};
      characterProfiles[charId] = result.characterData;

      await browserAPI.storage.local.set({
        characterProfiles: characterProfiles,
        activeCharacterId: charId
      });

      // Remove old storage
      await browserAPI.storage.local.remove('characterData');

      return result.characterData;
    }

    // Get character profiles
    const characterProfiles = result.characterProfiles || {};

    // Helper function to extract full character data from database profiles
    const extractFullData = (characterData) => {
      if (!characterData) return null;

      // For database profiles, extract full character data from _fullData.raw_dicecloud_data
      if (characterData.source === 'database' && characterData._fullData) {
        const fullData = characterData._fullData.raw_dicecloud_data;
        if (fullData && typeof fullData === 'object') {
          debug.log('📦 Extracting full character data from database raw_dicecloud_data');
          // Merge the full data with metadata
          return {
            ...fullData,
            source: 'database',
            lastUpdated: characterData.lastUpdated || characterData._fullData.updated_at,
            notificationColor: characterData._fullData.notification_color || fullData.notificationColor
          };
        } else {
          debug.warn('⚠️ Database profile missing raw_dicecloud_data, using summary only');
        }
      }

      // For local profiles or database profiles without nested data, return as-is
      return characterData;
    };

    // If specific character ID requested, return it
    if (characterId) {
      const characterData = characterProfiles[characterId] || null;
      return extractFullData(characterData);
    }

    // Otherwise return active character
    const activeCharacterId = result.activeCharacterId;
    debug.log(`🎯 Getting active character: activeCharacterId="${activeCharacterId}"`);
    debug.log(`🎯 Available characters:`, Object.keys(characterProfiles));

    if (activeCharacterId && characterProfiles[activeCharacterId]) {
      const activeChar = characterProfiles[activeCharacterId];
      debug.log('✅ Retrieved active character data:', {
        id: activeCharacterId,
        name: activeChar.name || activeChar.character_name,
        class: activeChar.class,
        level: activeChar.level
      });
      return extractFullData(activeChar);
    }

    // Fallback: If activeCharacterId is a raw DiceCloud ID, search for a matching profile
    // by checking the character's ID fields (prioritize local profiles over database)
    if (activeCharacterId) {
      debug.log(`🔍 Active character not found by key, searching by ID: ${activeCharacterId}`);

      // Check local profiles first (they have full actions/spells data)
      for (const [key, profile] of Object.entries(characterProfiles)) {
        if (profile.source !== 'database') {
          const charId = profile.id || profile._id || profile.dicecloud_character_id || profile.characterId;
          if (charId === activeCharacterId) {
            debug.log(`✅ Found matching local profile by ID: ${key}`);
            return extractFullData(profile);
          }
        }
      }

      // Then check database profiles if no local match found
      for (const [key, profile] of Object.entries(characterProfiles)) {
        if (profile.source === 'database') {
          const charId = profile.id || profile._id || profile.dicecloud_character_id || profile.characterId;
          if (charId === activeCharacterId) {
            debug.log(`✅ Found matching database profile by ID: ${key}`);
            return extractFullData(profile);
          }
        }
      }

      debug.warn(`⚠️ No profile found matching activeCharacterId: ${activeCharacterId}`);
    }

    // Fallback: return first available character (prefer local over database)
    const characterIds = Object.keys(characterProfiles);
    if (characterIds.length > 0) {
      // Prefer local profiles over database profiles
      const localProfile = characterIds.find(key => {
        const profile = characterProfiles[key];
        return !profile.source || profile.source !== 'database';
      });

      if (localProfile) {
        debug.log('No active character found, returning first local profile:', characterProfiles[localProfile]);
        return extractFullData(characterProfiles[localProfile]);
      }

      debug.log('No active character, returning first available:', characterProfiles[characterIds[0]]);
      return extractFullData(characterProfiles[characterIds[0]]);
    }

    return null;
  } catch (error) {
    debug.error('Failed to retrieve character data:', error);
    throw error;
  }
}

/**
 * Gets all character profiles from both local storage and database.
 * Deduplicates by DiceCloud character ID and filters out characters
 * that don't belong to the current user.
 */
async function getAllCharacterProfiles() {
  try {
    // Get local profiles first
    const localResult = await browserAPI.storage.local.get(['characterProfiles']);
    const localProfiles = localResult.characterProfiles || {};

    // Normalize local profiles: ensure 'name' field exists (database uses character_name)
    for (const id of Object.keys(localProfiles)) {
      const profile = localProfiles[id];
      if (profile.character_name && !profile.name) {
        profile.name = profile.character_name;
      }
    }

    // Try to get database characters and the current user's DiceCloud ID
    let databaseCharacters = {};
    let currentDicecloudUserId = null;
    try {
      if (typeof SupabaseTokenManager !== 'undefined') {
        const supabase = new SupabaseTokenManager();

        // Prefer local cached token/user when available to avoid hitting Supabase every popup open
        try {
          const stored = await browserAPI.storage.local.get(['diceCloudToken', 'diceCloudUserId', 'tokenExpires']);
          if (stored.diceCloudToken && stored.diceCloudUserId) {
            let useStored = true;
            if (stored.tokenExpires) {
              const expiry = new Date(stored.tokenExpires);
              if (isNaN(expiry.getTime()) || expiry <= new Date()) {
                useStored = false;
              }
            }
            if (useStored) {
              currentDicecloudUserId = stored.diceCloudUserId;
              debug.log('🌐 Using cached DiceCloud user from storage:', currentDicecloudUserId);
            } else {
              debug.log('🔁 Cached token expired or invalid, falling back to Supabase lookup');
            }
          }
        } catch (e) {
          debug.warn('⚠️ Error reading stored token:', e);
        }

        // If we don't have a valid cached user ID, retrieve from Supabase
        if (!currentDicecloudUserId) {
          const tokenResult = await supabase.retrieveToken();
          if (tokenResult.success && tokenResult.userId) {
            currentDicecloudUserId = tokenResult.userId;
            debug.log('🌐 Fetching database characters for DiceCloud user:', currentDicecloudUserId);
          }
        }

        if (currentDicecloudUserId) {
          // Get all characters for this user from database
          const response = await fetch(
            `${supabase.supabaseUrl}/rest/v1/rollcloud_characters?user_id_dicecloud=eq.${currentDicecloudUserId}&select=*`,
            {
              headers: {
                'apikey': supabase.supabaseKey,
                'Authorization': `Bearer ${supabase.supabaseKey}`
              }
            }
          );

          if (response.ok) {
            const characters = await response.json();
            debug.log(`📦 Found ${characters.length} characters in database`);

            // Convert database characters to profile format
            characters.forEach(character => {
              const slotId = `db-${character.dicecloud_character_id}`;
              databaseCharacters[slotId] = {
                name: character.character_name,
                id: character.dicecloud_character_id,
                source: 'database',
                lastUpdated: character.updated_at,
                race: character.race,
                class: character.class,
                level: character.level,
                // Store full character data for loading
                _fullData: character
              };
            });
          } else {
            debug.warn('⚠️ Failed to fetch database characters:', response.status);
          }
        }
      }
    } catch (dbError) {
      debug.warn('⚠️ Failed to load database characters:', dbError);
      // Continue with local profiles only
    }

    // Also try to get the current DiceCloud user ID from local storage if
    // the Supabase lookup didn't provide one (e.g. offline / not configured)
    if (!currentDicecloudUserId) {
      try {
        const stored = await browserAPI.storage.local.get(['diceCloudUserId']);
        currentDicecloudUserId = stored.diceCloudUserId || null;
      } catch (e) {
        // ignore
      }
    }

    // Filter local profiles: remove characters belonging to a different user.
    // Character data may store the owner's DiceCloud user ID under several
    // possible field names depending on the code path that created it.
    // If ANY of them is set and doesn't match the current user, drop it.
    if (currentDicecloudUserId) {
      for (const key of Object.keys(localProfiles)) {
        const profile = localProfiles[key];
        const profileOwner = profile.ownerUserId
          || profile.dicecloudUserId
          || profile.userId
          || profile.user_id_dicecloud
          || null;
        if (profileOwner && profileOwner !== currentDicecloudUserId) {
          debug.log(`🚫 Filtering out character "${profile.name || profile.character_name}" (belongs to ${profileOwner}, current user is ${currentDicecloudUserId})`);
          delete localProfiles[key];
        }
      }
    }

    // --- Deduplication ---
    // Merge local and database profiles, keeping only one entry per unique
    // character. Local entries take precedence over database ones.
    //
    // We use two dedup strategies:
    //  1. By DiceCloud character ID (checking multiple possible field names)
    //  2. By display fingerprint (name + class + level) as a fallback for
    //     entries where the ID field is missing or stored under a different key
    const seenCharacterIds = new Map();    // charId -> storage key
    const seenFingerprints = new Map();     // "Name|Class|Level" -> storage key
    const mergedProfiles = {};

    // Extract the DiceCloud character ID from a profile, checking all known fields
    function getCharId(profile) {
      return profile.id || profile._id || profile.dicecloud_character_id || profile.characterId || null;
    }

    // Build a display fingerprint for fallback dedup
    function getFingerprint(profile) {
      const name = (profile.name || profile.character_name || '').trim().toLowerCase();
      const cls = (profile.class || '').trim().toLowerCase();
      const level = String(profile.level || '');
      return name ? `${name}|${cls}|${level}` : null;
    }

    // Returns true if this profile is a duplicate of one already seen
    function isDuplicate(profile, key) {
      const charId = getCharId(profile);
      if (charId && seenCharacterIds.has(charId)) {
        debug.log(`🔄 Skipping duplicate "${profile.name || profile.character_name}" (key: ${key}), same char ID as: ${seenCharacterIds.get(charId)}`);
        return true;
      }
      const fp = getFingerprint(profile);
      if (fp && seenFingerprints.has(fp)) {
        debug.log(`🔄 Skipping duplicate "${profile.name || profile.character_name}" (key: ${key}), same fingerprint as: ${seenFingerprints.get(fp)}`);
        return true;
      }
      return false;
    }

    // Mark a profile as seen
    function markSeen(profile, key) {
      const charId = getCharId(profile);
      if (charId) seenCharacterIds.set(charId, key);
      const fp = getFingerprint(profile);
      if (fp) seenFingerprints.set(fp, key);
    }

    // Build a lookup of database characters by ID and fingerprint for marking local profiles
    const dbCharactersByCharId = new Map();
    const dbCharactersByFingerprint = new Map();
    for (const [key, profile] of Object.entries(databaseCharacters)) {
      const charId = getCharId(profile);
      const fp = getFingerprint(profile);
      if (charId) dbCharactersByCharId.set(charId, { key, profile });
      if (fp) dbCharactersByFingerprint.set(fp, { key, profile });
    }

    // Process local profiles first (local saves have priority)
    for (const [key, profile] of Object.entries(localProfiles)) {
      const fp = getFingerprint(profile);
      const charId = getCharId(profile);

      const existingById = charId ? seenCharacterIds.get(charId) : null;
      const existingByFp = fp ? seenFingerprints.get(fp) : null;

      // Check if this local profile has a database counterpart
      const dbMatch = (charId && dbCharactersByCharId.get(charId)) ||
                      (fp && dbCharactersByFingerprint.get(fp));
      if (dbMatch) {
        // Mark this local profile as having a cloud version
        profile.source = 'database';
        profile.hasCloudVersion = true;
        profile.cloudSlotId = dbMatch.key;
        debug.log(`☁️ Local profile "${profile.name || profile.character_name}" has cloud version, marking as database source`);

        // SPECIAL CASE: Always prefer database notification color over local
        // This ensures color changes sync across devices
        if (dbMatch.profile.notificationColor || dbMatch.profile.notification_color) {
          const dbColor = dbMatch.profile.notificationColor || dbMatch.profile.notification_color;
          if (profile.notificationColor !== dbColor) {
            debug.log(`🎨 Updating local profile color from database: ${profile.notificationColor} -> ${dbColor}`);
            profile.notificationColor = dbColor;
          }
        }
      }

      // If there's an existing entry with the same character ID, decide
      // whether to replace it. Prefer local `slot-` keys over DB keys.
      if (existingById) {
        if (key.startsWith('slot-') && existingById.startsWith('db-')) {
          delete mergedProfiles[existingById];
          markSeen(profile, key);
          mergedProfiles[key] = profile;
        } else {
          debug.log(`🔄 Skipping duplicate "${profile.name || profile.character_name}" (key: ${key}), same char ID as: ${existingById}`);
        }
        continue;
      }

      // If there's an existing fingerprint match, prefer local slot keys
      // over non-slot keys. If neither is a slot key, keep the first seen.
      if (existingByFp) {
        if (key.startsWith('slot-') && !existingByFp.startsWith('slot-')) {
          delete mergedProfiles[existingByFp];
          markSeen(profile, key);
          mergedProfiles[key] = profile;
        } else {
          debug.log(`🔄 Skipping duplicate "${profile.name || profile.character_name}" (key: ${key}), same fingerprint as: ${existingByFp}`);
        }
        continue;
      }

      // Otherwise mark and add
      markSeen(profile, key);
      mergedProfiles[key] = profile;
    }

    // Then add database characters only if not already present
    for (const [key, profile] of Object.entries(databaseCharacters)) {
      if (!isDuplicate(profile, key)) {
        markSeen(profile, key);
        mergedProfiles[key] = profile;
      } else {
        debug.log(`🔒 Skipping database character ${key} because a local version exists (but marked with cloud source)`);
      }
    }

    debug.log('📋 Character profiles loaded:', {
      local: Object.keys(localProfiles).length,
      database: Object.keys(databaseCharacters).length,
      deduplicated: Object.keys(mergedProfiles).length
    });

    return mergedProfiles;
  } catch (error) {
    debug.error('Failed to retrieve character profiles:', error);
    throw error;
  }
}

/**
 * Get character data from database by character ID
 */
async function getCharacterDataFromDatabase(characterId) {
  try {
    if (typeof SupabaseTokenManager === 'undefined') {
      throw new Error('SupabaseTokenManager not available');
    }

    const supabase = new SupabaseTokenManager();

    // Scope the query to the current user so we never load another user's character
    let userFilter = '';
    try {
      // Prefer local cached user id when available to avoid extra Supabase calls
      try {
        const stored = await browserAPI.storage.local.get(['diceCloudUserId', 'diceCloudToken', 'tokenExpires']);
        if (stored.diceCloudUserId && stored.diceCloudToken) {
          let useStored = true;
          if (stored.tokenExpires) {
            const expiry = new Date(stored.tokenExpires);
            if (isNaN(expiry.getTime()) || expiry <= new Date()) {
              useStored = false;
            }
          }
          if (useStored) {
            userFilter = `&user_id_dicecloud=eq.${stored.diceCloudUserId}`;
            debug.log('🌐 Using cached DiceCloud user for DB query:', stored.diceCloudUserId);
          }
        }
      } catch (e) {
        debug.warn('⚠️ Error reading stored user for DB query:', e);
      }

      if (!userFilter) {
        const tokenResult = await supabase.retrieveToken();
        if (tokenResult.success && tokenResult.userId) {
          userFilter = `&user_id_dicecloud=eq.${tokenResult.userId}`;
        }
      }
    } catch (e) {
      debug.warn('Could not get user ID for database character query:', e);
    }

    // Try multiple lookup strategies so callers can pass either a DiceCloud ID,
    // a storage key, or a DB primary key. Query order: exact dicecloud_character_id,
    // dicecloud_character_id prefixed with/without `db-`, then primary `id`.
    const tryQuery = async (field, value) => {
      const url = `${supabase.supabaseUrl}/rest/v1/rollcloud_characters?${field}=eq.${encodeURIComponent(value)}${userFilter}&select=*&order=updated_at.desc&limit=1`;
      const resp = await fetch(url, {
        headers: {
          'apikey': supabase.supabaseKey,
          'Authorization': `Bearer ${supabase.supabaseKey}`
        }
      });
      if (!resp.ok) return null;
      const arr = await resp.json();
      return (arr && arr.length > 0) ? arr[0] : null;
    };

    let dbCharacter = null;

    // 1) Try as dicecloud_character_id exactly
    dbCharacter = await tryQuery('dicecloud_character_id', characterId);

    // 2) If not found, try adding/removing a leading `db-` prefix
    if (!dbCharacter) {
      if (characterId && characterId.startsWith('db-')) {
        dbCharacter = await tryQuery('dicecloud_character_id', characterId.replace(/^db-/, ''));
      } else {
        dbCharacter = await tryQuery('dicecloud_character_id', `db-${characterId}`);
      }
    }

    // 3) If still not found, query by primary `id` (some callers pass DB PK)
    if (!dbCharacter) {
      dbCharacter = await tryQuery('id', characterId);
    }

    if (!dbCharacter) {
      throw new Error('Character not found in database');
    }

    // If raw_dicecloud_data contains the full character object, prefer it.
    // Also defensively unwrap any nested DB wrappers and normalize IDs.
    let rawData = dbCharacter.raw_dicecloud_data || dbCharacter._fullData || null;

    // Handle raw_dicecloud_data being a JSON string (Supabase may return JSONB as string in some cases)
    if (rawData && typeof rawData === 'string') {
      try {
        rawData = JSON.parse(rawData);
        debug.log('📦 Parsed raw_dicecloud_data from JSON string');
      } catch (parseError) {
        debug.warn('⚠️ raw_dicecloud_data is a string but not valid JSON:', parseError.message);
        rawData = null;
      }
    }

    // DEBUG: Check what data was actually returned from Supabase
    debug.log('🔍 POST-RETRIEVE: raw_dicecloud_data from Supabase:', {
      hasRawData: !!rawData,
      rawDataType: typeof rawData,
      rawDataIsArray: Array.isArray(rawData),
      hasSpells: !!(rawData && rawData.spells),
      spellsIsArray: Array.isArray(rawData?.spells),
      spellsLength: rawData?.spells?.length,
      hasActions: !!(rawData && rawData.actions),
      actionsIsArray: Array.isArray(rawData?.actions),
      actionsLength: rawData?.actions?.length,
      topLevelKeys: rawData ? Object.keys(rawData).slice(0, 30) : []
    });

    if (rawData && typeof rawData === 'object' && !Array.isArray(rawData)) {
      // Defensive unwrap: if rawData itself contains `raw_dicecloud_data`, drill down
      let candidate = rawData;
      const seen = new Set();
      while (candidate && typeof candidate === 'object' && candidate.raw_dicecloud_data && !seen.has(candidate)) {
        seen.add(candidate);
        candidate = candidate.raw_dicecloud_data;
      }

      // If candidate.id looks like a DB-wrapped id (db-...), try to recover an original id
      if (candidate && typeof candidate.id === 'string' && candidate.id.startsWith('db-')) {
        if (candidate._id && typeof candidate._id === 'string' && !candidate._id.startsWith('db-')) {
          candidate.id = candidate._id;
        } else if (candidate.raw_dicecloud_data && candidate.raw_dicecloud_data.id && !candidate.raw_dicecloud_data.id.startsWith('db-')) {
          candidate.id = candidate.raw_dicecloud_data.id;
        }
      }

      const fullCharacter = candidate;
      // Add database metadata
      fullCharacter.source = 'database';
      fullCharacter.lastUpdated = dbCharacter.updated_at;
      // Ensure ID fields are set correctly (in case of older records)
      if (!fullCharacter.id) {
        fullCharacter.id = dbCharacter.dicecloud_character_id;
      }
      if (!fullCharacter.name) {
        fullCharacter.name = dbCharacter.character_name;
      }
      // Restore notification color from database
      if (dbCharacter.notification_color) {
        fullCharacter.notificationColor = dbCharacter.notification_color;
      }

      // DEBUG: Check if spells and actions are present
      debug.log('🔍 Database character data check:', {
        name: fullCharacter.name,
        hasSpells: !!fullCharacter.spells,
        spellsIsArray: Array.isArray(fullCharacter.spells),
        spellsLength: fullCharacter.spells?.length,
        hasActions: !!fullCharacter.actions,
        actionsIsArray: Array.isArray(fullCharacter.actions),
        actionsLength: fullCharacter.actions?.length,
        topLevelKeys: Object.keys(fullCharacter).slice(0, 30)
      });
      // Add a compact preview of the parsed raw data for debugging
      try {
        const keys = Object.keys(fullCharacter || {}).slice(0, 50);
        let sample = '';
        try {
          sample = JSON.stringify(fullCharacter, keys);
        } catch (e) {
          sample = '[unserializable fullCharacter]';
        }
        debug.log('✅ Loaded full character from database raw_dicecloud_data:', fullCharacter.name, {
          keys: keys,
          sample: sample && sample.slice ? sample.slice(0, 2000) : sample,
          lastUpdated: fullCharacter.lastUpdated
        });
      } catch (e) {
        debug.log('✅ Loaded full character from database raw_dicecloud_data:', fullCharacter.name);
      }
      return fullCharacter;
    }

    // Fallback: Return database record with minimal transformation
    // This should rarely be used since raw_dicecloud_data should always be present
    debug.warn('⚠️ No raw_dicecloud_data found (type:', typeof rawData, '), using database fields directly');
    debug.warn('⚠️ DB record keys:', Object.keys(dbCharacter));
    const characterData = {
      // Use the exact database field names to maintain consistency
      id: dbCharacter.dicecloud_character_id,
      name: dbCharacter.character_name,
      race: dbCharacter.race,
      class: dbCharacter.class,
      level: dbCharacter.level,
      alignment: dbCharacter.alignment,
      hitPoints: dbCharacter.hit_points,
      hitDice: dbCharacter.hit_dice,
      temporaryHP: dbCharacter.temporary_hp,
      deathSaves: dbCharacter.death_saves,
      inspiration: dbCharacter.inspiration,
      armorClass: dbCharacter.armor_class,
      speed: dbCharacter.speed,
      initiative: dbCharacter.initiative,
      proficiencyBonus: dbCharacter.proficiency_bonus,
      attributes: dbCharacter.attributes,
      attributeMods: dbCharacter.attribute_mods,
      saves: dbCharacter.saves,
      skills: dbCharacter.skills,
      spellSlots: dbCharacter.spell_slots,
      resources: dbCharacter.resources,
      conditions: dbCharacter.conditions,
      notificationColor: dbCharacter.notification_color,
      // Preserve the raw database record for debugging
      rawDiceCloudData: dbCharacter,
      source: 'database',
      lastUpdated: dbCharacter.updated_at
    };

    debug.log('✅ Loaded character from database (individual fields):', characterData.name);
    return characterData;
  } catch (error) {
    debug.error('❌ Failed to get character data from database:', error);
    throw error;
  }
}

/**
 * Sets the active character
 */
async function setActiveCharacter(characterId) {
  try {
    // Get character data before setting for logging
    const result = await browserAPI.storage.local.get(['characterProfiles']);
    const characterProfiles = result.characterProfiles || {};
    const characterData = characterProfiles[characterId];
    
    debug.log(`🎯 Setting active character: ${characterId}`);
    debug.log(`🎯 Character data:`, characterData ? {
      name: characterData.name || characterData.character_name,
      class: characterData.class,
      level: characterData.level
    } : 'NOT FOUND');

    await browserAPI.storage.local.set({
      activeCharacterId: characterId
    });
    debug.log(`✅ Active character set to: ${characterId}`);

    // Also mark this character as active in Supabase
    if (characterData && characterData.id) {
      try {
        await markCharacterActiveInSupabase(characterData.id, characterData.name || characterData.character_name);
      } catch (error) {
        debug.warn('⚠️ Failed to mark character as active in Supabase:', error);
      }
    }

    // Notify Roll20 tabs about the character change for experimental sync
    try {
      const tabs = await browserAPI.tabs.query({ url: '*://app.roll20.net/*' });
      if (tabs.length > 0) {
        // Get the character data to send the DiceCloud character ID
        const result = await browserAPI.storage.local.get(['characterProfiles']);
        const characterProfiles = result.characterProfiles || {};
        const characterData = characterProfiles[characterId];

        if (characterData && characterData.id) {
          debug.log(`Broadcasting active character change to Roll20 tabs: ${characterData.id}`);
          for (const tab of tabs) {
            browserAPI.tabs.sendMessage(tab.id, {
              action: 'activeCharacterChanged',
              characterId: characterData.id,
              slotId: characterId
            }).catch(err => {
              debug.warn(`Failed to notify tab ${tab.id} about character change:`, err);
            });
          }
        }
      }
    } catch (error) {
      debug.warn('Failed to broadcast character change to Roll20 tabs:', error);
    }
  } catch (error) {
    debug.error('Failed to set active character:', error);
    throw error;
  }
}

/**
 * Mark a character as active in Supabase
 */
async function markCharacterActiveInSupabase(characterId, characterName) {
  if (!isSupabaseConfigured()) {
    debug.warn('Supabase not configured - cannot mark character as active');
    return;
  }

  try {
    debug.log(`🎯 Marking character as active in Supabase: ${characterName} (${characterId})`);

    // First, get the Discord user ID for this character
    const pairingResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/rollcloud_characters?dicecloud_character_id=eq.${characterId}&select=discord_user_id`,
      {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
        }
      }
    );

    if (pairingResponse.ok) {
      const characters = await pairingResponse.json();
      if (characters.length > 0) {
        const discordUserId = characters[0].discord_user_id;
        
        if (discordUserId && discordUserId !== 'not_linked') {
          // Deactivate all other characters for this user
          await fetch(
            `${SUPABASE_URL}/rest/v1/rollcloud_characters?discord_user_id=eq.${discordUserId}`,
            {
              method: 'PATCH',
              headers: {
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ is_active: false })
            }
          );

          // Activate this character
          const updateResponse = await fetch(
            `${SUPABASE_URL}/rest/v1/rollcloud_characters?dicecloud_character_id=eq.${characterId}`,
            {
              method: 'PATCH',
              headers: {
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ is_active: true })
            }
          );

          if (updateResponse.ok) {
            debug.log(`✅ Successfully marked ${characterName} as active in Supabase`);
          } else {
            debug.warn(`⚠️ Failed to update active status in Supabase: ${updateResponse.status}`);
          }
        } else {
          debug.warn(`⚠️ Character ${characterName} not linked to Discord user, cannot mark as active`);
        }
      } else {
        debug.warn(`⚠️ Character ${characterId} not found in Supabase`);
      }
    } else {
      debug.warn(`⚠️ Failed to query Supabase for character: ${pairingResponse.status}`);
    }
  } catch (error) {
    debug.error('❌ Error marking character as active in Supabase:', error);
  }
}

/**
 * Clears stored character data (all profiles or specific profile)
 */
async function clearCharacterData(characterId = null) {
  try {
    if (characterId) {
      // Clear specific character
      const result = await browserAPI.storage.local.get(['characterProfiles', 'activeCharacterId']);
      const characterProfiles = result.characterProfiles || {};
      const activeCharacterId = result.activeCharacterId;

      delete characterProfiles[characterId];

      const updates = {
        characterProfiles: characterProfiles
      };

      // If we just deleted the active character, switch to another one
      if (activeCharacterId === characterId) {
        const remainingIds = Object.keys(characterProfiles);
        if (remainingIds.length > 0) {
          // Set first available character as active
          updates.activeCharacterId = remainingIds[0];
          debug.log(`Active character was cleared, switching to ${remainingIds[0]}`);
        } else {
          // No characters left, clear active ID
          updates.activeCharacterId = null;
          debug.log('No characters remaining, clearing active character ID');
        }
      }

      await browserAPI.storage.local.set(updates);

      debug.log(`Character profile cleared for ID: ${characterId}`);
    } else {
      // Clear all characters - include ALL legacy storage keys
      const legacyKeys = [
        'characterProfiles',
        'activeCharacterId',
        'timestamp',
        'characterData',           // Legacy single-character key
        'activeSlot',              // Legacy slot system
        'slot1', 'slot2', 'slot3', 'slot4', 'slot5',  // Legacy slots
        'currentCharacter',        // Another legacy key
        'cachedCharacter'          // Cache key
      ];
      await browserAPI.storage.local.remove(legacyKeys);
      debug.log('All character data cleared successfully (including legacy keys)');
    }
  } catch (error) {
    debug.error('Failed to clear character data:', error);
    throw error;
  }
}

/**
 * Delete character from cloud (Supabase)
 */
async function deleteCharacterFromCloud(characterId) {
  try {
    if (!characterId) {
      throw new Error('Character ID is required');
    }

    if (!isSupabaseConfigured()) {
      throw new Error('Supabase not configured');
    }

    debug.log(`🗑️ Deleting character from cloud: ${characterId}`);

    // Strip db- prefix if present for database query
    const cleanId = characterId.startsWith('db-') ? characterId.replace('db-', '') : characterId;

    // Try to delete with both the clean ID and the original ID
    // Some records may have been stored with the prefix, some without
    const idsToTry = [cleanId];
    if (cleanId !== characterId) {
      idsToTry.push(characterId); // Also try with prefix
    }

    let deleted = false;
    for (const idToDelete of idsToTry) {
      const response = await fetch(
        `${SUPABASE_URL}/rest/v1/rollcloud_characters?dicecloud_character_id=eq.${encodeURIComponent(idToDelete)}`,
        {
          method: 'DELETE',
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'Prefer': 'return=representation'  // Return deleted rows to verify
          }
        }
      );

      if (response.ok) {
        const deletedRows = await response.json();
        if (deletedRows && deletedRows.length > 0) {
          debug.log(`✅ Deleted ${deletedRows.length} record(s) from cloud with ID: ${idToDelete}`);
          deleted = true;
        }
      }
    }

    if (!deleted) {
      debug.warn(`⚠️ No records found in cloud for character: ${characterId}`);
    }

    debug.log(`✅ Character delete from cloud completed: ${characterId}`);
    return { success: true };
  } catch (error) {
    debug.error('Failed to delete character from cloud:', error);
    throw error;
  }
}

/**
 * Rolls in Dice Cloud and forwards to Roll20
 */
async function rollInDiceCloudAndForward(rollData) {
  try {
    // Find Dice Cloud tab
    const diceCloudTabs = await browserAPI.tabs.query({ url: '*://dicecloud.com/*' });
    
    if (diceCloudTabs.length === 0) {
      throw new Error('No Dice Cloud tab found. Please open Dice Cloud first.');
    }

    // Send roll request to Dice Cloud
    const diceCloudTab = diceCloudTabs[0];
    const response = await browserAPI.tabs.sendMessage(diceCloudTab.id, {
      action: 'rollInDiceCloud',
      roll: rollData
    });

    if (!response || !response.success) {
      throw new Error('Failed to roll in Dice Cloud');
    }

    debug.log(' Roll initiated in Dice Cloud, will be forwarded automatically');
    return response;
  } catch (error) {
    debug.error('Failed to roll in Dice Cloud:', error);
    throw error;
  }
}

/**
 * Sends a roll to all open Roll20 tabs
 */
async function sendRollToAllRoll20Tabs(rollData) {
  try {
    // Query all tabs for Roll20
    const tabs = await browserAPI.tabs.query({ url: '*://app.roll20.net/*' });

    if (tabs.length === 0) {
      debug.warn('⚠️ No Roll20 tabs found - roll not sent');
      return { success: false, error: 'No Roll20 tabs open. Please open Roll20 in a browser tab.' };
    }

    // Send roll to each Roll20 tab with individual error handling
    let successCount = 0;
    let failCount = 0;
    const errors = [];

    for (const tab of tabs) {
      try {
        await browserAPI.tabs.sendMessage(tab.id, {
          action: 'postRollToChat',
          roll: rollData
        });
        successCount++;
      } catch (err) {
        failCount++;
        debug.warn(`Failed to send roll to tab ${tab.id}:`, err.message);
        errors.push(`Tab ${tab.id}: ${err.message}`);
      }
    }

    if (successCount > 0) {
      debug.log(`✅ Roll sent to ${successCount}/${tabs.length} Roll20 tab(s)`);
      return { success: true, tabsSent: successCount, tabsFailed: failCount };
    } else {
      debug.error(`❌ Failed to send roll to any Roll20 tabs. Errors: ${errors.join(', ')}`);
      return { success: false, error: 'Failed to send roll to Roll20. Try refreshing the Roll20 page.' };
    }
  } catch (error) {
    debug.error('Failed to send roll to Roll20 tabs:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Sends GM Mode toggle to all open Roll20 tabs
 */
async function sendGMModeToggleToRoll20Tabs(enabled) {
  try {
    // Query all tabs for Roll20
    const tabs = await browserAPI.tabs.query({ url: '*://app.roll20.net/*' });

    if (tabs.length === 0) {
      debug.warn('No Roll20 tabs found');
      return;
    }

    // Send GM Mode toggle to each Roll20 tab
    const promises = tabs.map(tab => {
      return browserAPI.tabs.sendMessage(tab.id, {
        action: 'toggleGMMode',
        enabled: enabled
      }).catch(err => {
        debug.warn(`Failed to send GM Mode toggle to tab ${tab.id}:`, err);
      });
    });

    await Promise.all(promises);
    debug.log(`GM Mode toggle sent to ${tabs.length} Roll20 tab(s)`);
  } catch (error) {
    debug.error('Failed to send GM Mode toggle to Roll20 tabs:', error);
    throw error;
  }
}

/**
 * Sends chat message to all open Roll20 tabs
 */
async function sendChatMessageToAllRoll20Tabs(message) {
  try {
    // Query all tabs for Roll20
    const tabs = await browserAPI.tabs.query({ url: '*://app.roll20.net/*' });

    if (tabs.length === 0) {
      debug.warn('No Roll20 tabs found');
      return;
    }

    // Send chat message to each Roll20 tab
    const promises = tabs.map(tab => {
      return browserAPI.tabs.sendMessage(tab.id, {
        action: 'postChatMessageFromPopup',
        message: message
      }).catch(err => {
        debug.warn(`Failed to send chat message to tab ${tab.id}:`, err);
      });
    });

    await Promise.all(promises);
    debug.log(`Chat message sent to ${tabs.length} Roll20 tab(s)`);
  } catch (error) {
    debug.error('Failed to send chat message to Roll20 tabs:', error);
    throw error;
  }
}

/**
 * Handle extension installation
 */
browserAPI.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    debug.log('Extension installed');
    
    // Auto-open popup after installation
    setTimeout(() => {
      openExtensionPopup();
    }, 1000); // Wait 1 second for extension to fully initialize
    // Prompt user to re-sync Discord integration after install
    try {
      browserAPI.storage.local.set({ requireDiscordResync: true });
      debug.log('Set requireDiscordResync flag after install');
    } catch (e) {
      debug.warn('Could not set requireDiscordResync flag:', e);
    }
  } else if (details.reason === 'update') {
    debug.log('Extension updated to version', browserAPI.runtime.getManifest().version);
    // Prompt user to re-sync Discord integration after update
    try {
      browserAPI.storage.local.set({ requireDiscordResync: true });
      debug.log('Set requireDiscordResync flag after update');
    } catch (e) {
      debug.warn('Could not set requireDiscordResync flag on update:', e);
    }
    // Attempt automatic resync to cloud if Discord integration appears active
    (async () => {
      try {
        const stored = await browserAPI.storage.local.get(['discordWebhookEnabled', 'discordUserId', 'discordPairingId']);
        const discordConnected = stored.discordWebhookEnabled || stored.discordUserId || stored.discordPairingId;

        if (!discordConnected) {
          debug.log('No Discord integration detected on update; skipping automatic resync');
          return;
        }

        if (!isSupabaseConfigured()) {
          debug.log('Supabase not configured; skipping automatic resync');
          return;
        }

        debug.log('🔁 Attempting automatic character resync after update (Discord connected)');
        // Keep service worker alive while we attempt the sync
        keepServiceWorkerAlive(60000);

        const activeChar = await getCharacterData();
        if (!activeChar) {
          debug.log('No active character found; nothing to resync');
          return;
        }

        const res = await storeCharacterToCloud(activeChar);
        if (res && res.success) {
          debug.log('✅ Automatic resync successful after update');
        } else {
          debug.warn('⚠️ Automatic resync failed after update:', res && res.error);
        }
      } catch (err) {
        debug.warn('⚠️ Automatic resync encountered an error on update:', err);
      } finally {
        // Allow the service worker to stop naturally after a short delay
        setTimeout(() => stopKeepAlive(), 5000);
      }
    })();
  }
});

/**
 * Open the extension popup
 */
async function openExtensionPopup() {
  try {
    debug.log('🚀 Opening extension popup after installation...');
    
    // For Chrome, we can open the popup directly
    if (!isFirefox) {
      // Chrome doesn't have a direct API to open popup, but we can open the options page
      // which serves a similar purpose for first-time setup
      browserAPI.runtime.openOptionsPage();
      debug.log('✅ Opened options page for Chrome');
    } else {
      // For Firefox, we can try to open the popup
      try {
        // Firefox doesn't have a direct popup opening API either
        // So we'll open the options page as well
        browserAPI.runtime.openOptionsPage();
        debug.log('✅ Opened options page for Firefox');
      } catch (error) {
        debug.log('⚠️ Could not open options page:', error);
      }
    }
  } catch (error) {
    debug.log('❌ Error opening popup/options:', error);
  }
}

// ============================================================================
// Discord Webhook Integration
// ============================================================================

/**
 * Stores Discord webhook settings
 * @param {string} webhookUrl - The Discord webhook URL
 * @param {boolean} enabled - Whether notifications are enabled
 * @param {string} serverName - Optional Discord server name for display
 */
async function setDiscordWebhookSettings(webhookUrl, enabled = true, serverName = null) {
  try {
    const settings = {
      discordWebhookUrl: webhookUrl || '',
      discordWebhookEnabled: enabled
    };
    if (serverName) {
      settings.discordServerName = serverName;
    }
    debug.log('📝 Saving Discord webhook settings:', {
      webhookUrl: webhookUrl ? `${webhookUrl.substring(0, 50)}...` : '(empty)',
      enabled,
      serverName
    });
    await browserAPI.storage.local.set(settings);

    // Verify storage was successful
    const verification = await browserAPI.storage.local.get(['discordWebhookUrl', 'discordWebhookEnabled']);
    debug.log('✅ Discord webhook settings verified:', {
      storedUrl: verification.discordWebhookUrl ? `${verification.discordWebhookUrl.substring(0, 50)}...` : '(empty)',
      storedEnabled: verification.discordWebhookEnabled
    });

    // Sync webhook URL to the pairing record in Supabase if we have a pairing ID
    if (webhookUrl && isSupabaseConfigured()) {
      try {
        const stored = await browserAPI.storage.local.get(['discordPairingId']);
        if (stored.discordPairingId) {
          debug.log('☁️ Syncing webhook URL to pairing record:', stored.discordPairingId);
          await fetch(
            `${SUPABASE_URL}/rest/v1/rollcloud_pairings?id=eq.${stored.discordPairingId}`,
            {
              method: 'PATCH',
              headers: {
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal'
              },
              body: JSON.stringify({ webhook_url: webhookUrl })
            }
          );
          debug.log('✅ Webhook URL synced to pairing');
        }
      } catch (syncError) {
        debug.warn('⚠️ Failed to sync webhook to pairing:', syncError.message);
        // Don't throw - local save was successful
      }
    }
  } catch (error) {
    debug.error('Failed to save Discord webhook settings:', error);
    throw error;
  }
}

/**
 * Gets Discord webhook settings
 */
async function getDiscordWebhookSettings() {
  try {
    const result = await browserAPI.storage.local.get([
      'discordWebhookUrl',
      'discordWebhookEnabled',
      'discordServerName'
    ]);
    return {
      webhookUrl: result.discordWebhookUrl || '',
      enabled: result.discordWebhookEnabled !== false, // Default to true if URL exists
      serverName: result.discordServerName || null
    };
  } catch (error) {
    debug.error('Failed to get Discord webhook settings:', error);
    return { webhookUrl: '', enabled: false, serverName: null };
  }
}

/**
 * Tests a Discord webhook by sending a test message
 */
async function testDiscordWebhook(webhookUrl) {
  try {
    if (!webhookUrl || !webhookUrl.includes('discord.com/api/webhooks')) {
      return { success: false, error: 'Invalid Discord webhook URL' };
    }

    const testEmbed = {
      embeds: [{
        title: '🎲 RollCloud Connected!',
        description: 'Discord webhook integration is working correctly.',
        color: 0xFC57F9, // Teal color matching the extension theme
        footer: {
          text: 'RollCloud - Dice Cloud → Roll20 Bridge'
        },
        timestamp: new Date().toISOString()
      }]
    };

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testEmbed)
    });

    if (response.ok || response.status === 204) {
      debug.log('✅ Discord webhook test successful');
      return { success: true };
    } else {
      const errorText = await response.text();
      debug.warn('❌ Discord webhook test failed:', response.status, errorText);
      return { success: false, error: `HTTP ${response.status}: ${errorText}` };
    }
  } catch (error) {
    debug.error('❌ Discord webhook test error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Posts a message to Discord via webhook
 * Rate limited to prevent spam (max 1 message per second)
 */
let lastDiscordPost = 0;
const DISCORD_RATE_LIMIT_MS = 1000;

async function postToDiscordWebhook(payload) {
  try {
    // Get webhook settings
    const settings = await getDiscordWebhookSettings();

    if (!settings.enabled || !settings.webhookUrl) {
      debug.log('Discord webhook disabled or not configured');
      return { success: false, error: 'Webhook not configured' };
    }

    // Rate limiting
    const now = Date.now();
    if (now - lastDiscordPost < DISCORD_RATE_LIMIT_MS) {
      debug.log('Discord rate limit - skipping post');
      return { success: false, error: 'Rate limited' };
    }
    lastDiscordPost = now;

    // Build the Discord message
    const message = buildDiscordMessage(payload);

    const response = await fetch(settings.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message)
    });

    if (response.ok || response.status === 204) {
      debug.log('✅ Posted to Discord:', payload.type);
      return { success: true };
    } else {
      const errorText = await response.text();
      debug.warn('❌ Discord post failed:', response.status);
      return { success: false, error: `HTTP ${response.status}` };
    }
  } catch (error) {
    debug.error('❌ Discord post error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Builds a Discord embed message from the payload
 * Messages are structured for both human readability and Pip Bot parsing
 *
 * Pip Bot can parse these fields:
 * - embed.title: Contains character name and event type
 * - embed.fields: Structured data (character, round, actions)
 * - embed.footer.text: Contains parseable metadata like "TURN_START|Chepi|Round:3"
 */
function buildDiscordMessage(payload) {
  const { type, characterName, combatant, round, actions, initiative } = payload;

  // Action economy status icons
  const getIcon = (used) => used ? '❌' : '✅';

  // Build action status string
  const buildActionStatus = (acts) => {
    if (!acts) return null;
    return [
      `Action: ${getIcon(acts.action)}`,
      `Bonus: ${getIcon(acts.bonus)}`,
      `Move: ${getIcon(acts.movement)}`,
      `React: ${getIcon(acts.reaction)}`
    ].join(' | ');
  };

  // Build parseable footer for Pip Bot
  const buildFooter = (eventType, charName, roundNum, acts) => {
    const parts = [eventType, charName];
    if (roundNum) parts.push(`Round:${roundNum}`);
    if (acts) {
      const actionBits = [
        acts.action ? '0' : '1',
        acts.bonus ? '0' : '1',
        acts.movement ? '0' : '1',
        acts.reaction ? '0' : '1'
      ].join('');
      parts.push(`Actions:${actionBits}`); // e.g., "Actions:1111" = all available
    }
    return parts.join('|');
  };

  if (type === 'turnStart') {
    const actionStatus = buildActionStatus(actions);

    return {
      embeds: [{
        title: `🎲 ${characterName}'s Turn`,
        description: actionStatus || 'Combat turn started!',
        color: 0xFC57F9, // Teal - active turn
        fields: [
          { name: 'Character', value: characterName, inline: true },
          ...(round ? [{ name: 'Round', value: String(round), inline: true }] : []),
          ...(initiative ? [{ name: 'Initiative', value: String(initiative), inline: true }] : [])
        ],
        footer: { text: buildFooter('TURN_START', characterName, round, actions) },
        timestamp: new Date().toISOString()
      }]
    };
  }

  if (type === 'turnEnd') {
    return {
      embeds: [{
        title: `⏸️ ${characterName}'s Turn Ended`,
        color: 0x95A5A6, // Gray - inactive
        fields: [
          { name: 'Character', value: characterName, inline: true }
        ],
        footer: { text: buildFooter('TURN_END', characterName, round) },
        timestamp: new Date().toISOString()
      }]
    };
  }

  if (type === 'actionUpdate') {
    const actionStatus = buildActionStatus(actions);
    const hasUsedActions = actions && (actions.action || actions.bonus);

    return {
      embeds: [{
        title: `⚔️ ${characterName}`,
        description: actionStatus,
        color: hasUsedActions ? 0xF39C12 : 0xFC57F9, // Orange if actions used, teal if available
        fields: [
          { name: 'Character', value: characterName, inline: true },
          { name: 'Status', value: hasUsedActions ? 'Actions Used' : 'Actions Available', inline: true }
        ],
        footer: { text: buildFooter('ACTION_UPDATE', characterName, round, actions) },
        timestamp: new Date().toISOString()
      }]
    };
  }

  if (type === 'combatStart') {
    return {
      embeds: [{
        title: '⚔️ Combat Started!',
        description: combatant ? `First up: **${combatant}**` : 'Roll for initiative!',
        color: 0xE74C3C, // Red - combat
        footer: { text: 'COMBAT_START' },
        timestamp: new Date().toISOString()
      }]
    };
  }

  if (type === 'roundChange') {
    return {
      embeds: [{
        title: `🔄 Round ${round}`,
        description: combatant ? `Current turn: **${combatant}**` : 'New round begins!',
        color: 0x9B59B6, // Purple - round change
        footer: { text: `ROUND_CHANGE|Round:${round}` },
        timestamp: new Date().toISOString()
      }]
    };
  }

  if (type === 'roll') {
    // Format the roll string for Discord display
    const rollDisplay = rollString.replace(/\[\[([^\]]+)\]/g, '$1'); // Convert [XdY] to XdY
    
    return {
      embeds: [{
        title: `🎲 ${characterName} rolls ${rollName}`,
        description: `**${rollDisplay}**`,
        color: 0xFC57F9, // Teal - roll
        fields: [
          { name: 'Character', value: characterName || 'Unknown', inline: true },
          { name: 'Roll', value: rollDisplay, inline: true }
        ],
        timestamp: new Date().toISOString()
      }]
    };
  }

  // Default simple message
  return {
    content: payload.message || `🎲 ${characterName || 'Unknown'}: ${type}`
  };
}

// ============================================================================
// Discord User Linking
// ============================================================================

/**
 * Link Discord user info to auth_tokens table
 * This allows character sync to associate characters with Discord accounts
 * @param {string} discordUserId - The Discord user ID
 * @param {string} [discordUsername] - The Discord username
 * @param {string} [discordGlobalName] - The Discord display name
 */
async function linkDiscordUserToAuthTokens(discordUserId, discordUsername, discordGlobalName) {
  if (!isSupabaseConfigured() || !discordUserId) {
    debug.warn('Cannot link Discord user - Supabase not configured or no user ID');
    return { success: false };
  }

  try {
    // Generate browser fingerprint (same as SupabaseTokenManager)
    // Note: screen is not available in service workers, use fallback
    const screenDimensions = (typeof screen !== 'undefined' && screen)
      ? `${screen.width}x${screen.height}`
      : '0x0';
    const browserFingerprint = [
      navigator.userAgent,
      navigator.language,
      screenDimensions,
      new Date().getTimezoneOffset()
    ].join('|');
    let hash = 0;
    for (let i = 0; i < browserFingerprint.length; i++) {
      const char = browserFingerprint.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    const visitorId = 'user_' + Math.abs(hash).toString(36);

    debug.log('🔗 Linking Discord user to auth_tokens:', discordUserId, discordUsername, discordGlobalName, 'for browser:', visitorId);

    // Build upsert payload with all available Discord fields
    const upsertPayload = {
      user_id: visitorId,
      discord_user_id: discordUserId,
      updated_at: new Date().toISOString()
    };
    if (discordUsername) {
      upsertPayload.discord_username = discordUsername;
    }
    if (discordGlobalName) {
      upsertPayload.discord_global_name = discordGlobalName;
    }

    // Upsert auth_tokens with Discord info (insert if not exists, update if exists)
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/auth_tokens`,
      {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates,return=minimal'
        },
        body: JSON.stringify(upsertPayload)
      }
    );

    if (response.ok) {
      debug.log('✅ Discord user linked to auth_tokens via POST');

      // Also update any existing characters with this user's DiceCloud ID
      const authResult = await browserAPI.storage.local.get(['diceCloudUserId']);
      if (authResult.diceCloudUserId) {
        await linkDiscordUserToCharacters(discordUserId, authResult.diceCloudUserId);
      }

      return { success: true };
    } else {
      const errorText = await response.text();

      // If duplicate key error, try PATCH instead
      if (response.status === 409 && errorText.includes('auth_tokens_user_id_key')) {
        debug.log('⚠️ Auth token exists, trying PATCH update:', visitorId);

        const patchResponse = await fetch(
          `${SUPABASE_URL}/rest/v1/auth_tokens?user_id=eq.${encodeURIComponent(visitorId)}`,
          {
            method: 'PATCH',
            headers: {
              'apikey': SUPABASE_ANON_KEY,
              'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
              'Content-Type': 'application/json',
              'Prefer': 'return=minimal'
            },
            body: JSON.stringify(upsertPayload)
          }
        );

        if (patchResponse.ok) {
          debug.log('✅ Discord user linked to auth_tokens via PATCH');

          // Also update any existing characters with this user's DiceCloud ID
          const authResult = await browserAPI.storage.local.get(['diceCloudUserId']);
          if (authResult.diceCloudUserId) {
            await linkDiscordUserToCharacters(discordUserId, authResult.diceCloudUserId);
          }

          return { success: true };
        } else {
          const patchError = await patchResponse.text();
          debug.error('❌ PATCH also failed:', patchResponse.status, patchError);
          return { success: false, error: patchError };
        }
      }

      debug.error('❌ Failed to link Discord user:', response.status, errorText);
      return { success: false, error: errorText };
    }
  } catch (error) {
    debug.error('❌ Error linking Discord user:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Update existing characters with the Discord user ID
 */
async function linkDiscordUserToCharacters(discordUserId, diceCloudUserId) {
  if (!isSupabaseConfigured()) return;

  try {
    debug.log('🔗 Linking Discord user to existing characters:', discordUserId);

    // Update characters that have user_id_dicecloud matching but discord_user_id is 'not_linked'
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/rollcloud_characters?user_id_dicecloud=eq.${diceCloudUserId}&discord_user_id=eq.not_linked`,
      {
        method: 'PATCH',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({
          discord_user_id: discordUserId,
          updated_at: new Date().toISOString()
        })
      }
    );

    if (response.ok) {
      debug.log('✅ Updated existing characters with Discord user ID');
    } else {
      debug.warn('⚠️ Could not update existing characters:', response.status);
    }
  } catch (error) {
    debug.warn('⚠️ Error updating existing characters:', error);
  }
}

// ============================================================================
// Character Cloud Sync to Supabase
// ============================================================================

/**
 * Store character data in Supabase for cloud sync
 * This allows character data to be accessed by the Discord bot
 */
async function storeCharacterToCloud(characterData, pairingCode = null) {
  if (!isSupabaseConfigured()) {
    debug.warn('Supabase not configured - character sync unavailable');
    return {
      success: false,
      error: 'Cloud sync not available. Supabase not configured.',
      supabaseNotConfigured: true
    };
  }

  try {
    debug.log('🎭 Storing character in Supabase:', characterData.name || characterData.id);

    // Generate a browser ID for looking up auth tokens
    // Note: screen is not available in service workers, use fallback
    const screenDimensions = (typeof screen !== 'undefined' && screen)
      ? `${screen.width}x${screen.height}`
      : '0x0';
    const browserFingerprint = [
      navigator.userAgent,
      navigator.language,
      screenDimensions,
      new Date().getTimezoneOffset()
    ].join('|');
    let hash = 0;
    for (let i = 0; i < browserFingerprint.length; i++) {
      const char = browserFingerprint.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    const visitorId = 'user_' + Math.abs(hash).toString(36);

    // Get DiceCloud user ID from character data, or fall back to local storage
    let dicecloudUserId = characterData.dicecloudUserId || characterData.userId || characterData.ownerUserId || null;
    if (!dicecloudUserId) {
      const stored = await browserAPI.storage.local.get(['diceCloudUserId']);
      dicecloudUserId = stored.diceCloudUserId || null;
      if (dicecloudUserId) {
        debug.log('✅ Got DiceCloud user ID from storage:', dicecloudUserId);
      }
    }

    // Refuse to store a character to the cloud without a valid user ID.
    // Without this, the character would be saved with null ownership and
    // could leak into other users' character lists.
    if (!dicecloudUserId) {
      debug.error('❌ Cannot store character to cloud: no DiceCloud user ID available');
      return {
        success: false,
        error: 'Cannot sync to cloud: not logged in to DiceCloud. Please login first.'
      };
    }

    // Resolve the real DiceCloud character ID.  Storage slot keys like
    // "slot-1" or "db-slot-1" must NOT be used as the character ID in the
    // database — they are internal storage keys, not DiceCloud identifiers.
    let resolvedCharId = characterData.id || characterData._id || null;

    // Helper to check if an ID looks like a storage/internal key
    const isStorageKey = (id) => {
      if (!id) return false;
      // Match: slot-N, db-slot-N, db-db-slot-N, db-UUID, etc.
      return /^(db-)+/.test(id) || /^slot-\d+$/.test(id) || /^db-slot-\d+$/.test(id);
    };

    // Helper to check if an ID looks like a real DiceCloud ID (17-char alphanumeric)
    const isDiceCloudId = (id) => {
      if (!id) return false;
      // DiceCloud IDs are typically 17-character alphanumeric strings
      return /^[A-Za-z0-9]{17}$/.test(id);
    };

    if (resolvedCharId && isStorageKey(resolvedCharId)) {
      debug.warn(`⚠️ Character ID "${resolvedCharId}" looks like a storage key, not a DiceCloud ID`);

      // Try to find the real DiceCloud character ID from multiple sources
      const nested = characterData.raw_dicecloud_data || characterData._fullData || {};
      const possibleIds = [
        nested.dicecloud_character_id,
        nested._id,
        nested.id,
        characterData.dicecloud_character_id,
        characterData.dicecloudId,
        characterData.characterId,
        // Also check nested raw_dicecloud_data (for double-nested data)
        nested.raw_dicecloud_data?.id,
        nested.raw_dicecloud_data?._id
      ].filter(id => id && !isStorageKey(id));

      // Prefer a real DiceCloud ID if found
      const realId = possibleIds.find(isDiceCloudId) || possibleIds[0];

      if (realId) {
        resolvedCharId = realId;
        debug.log(`✅ Resolved real DiceCloud character ID: ${resolvedCharId}`);
      } else {
        // Last resort: generate a fingerprint from character name + user ID + class/level
        // This ensures the same character always gets the same ID
        const fingerprint = `${dicecloudUserId}-${characterData.name}-${characterData.class}-${characterData.level}`;
        let fpHash = 0;
        for (let i = 0; i < fingerprint.length; i++) {
          const char = fingerprint.charCodeAt(i);
          fpHash = ((fpHash << 5) - fpHash) + char;
          fpHash = fpHash & fpHash;
        }
        resolvedCharId = `fp-${Math.abs(fpHash).toString(36)}`;
        debug.warn(`⚠️ Using fingerprint ID for dedup: ${resolvedCharId}`);
      }
    }

    // Prepare payload, ensuring we store the original DiceCloud raw object
    // and avoid embedding previous DB wrapper objects (which cause deep nesting).
    const prepareRawForPayload = (data) => {
      try {
        // Prefer explicit nested raw_dicecloud_data or _fullData.raw_dicecloud_data
        let candidate = null;
        if (data && data._fullData && data._fullData.raw_dicecloud_data) {
          candidate = data._fullData.raw_dicecloud_data;
        } else if (data && data.raw_dicecloud_data) {
          candidate = data.raw_dicecloud_data;
        } else if (data && data._fullData) {
          candidate = data._fullData;
        }

        // Unwrap repeated wrappers like { raw_dicecloud_data: { raw_dicecloud_data: { ... } } }
        const seen = new Set();
        while (candidate && typeof candidate === 'object' && candidate.raw_dicecloud_data && !seen.has(candidate)) {
          seen.add(candidate);
          candidate = candidate.raw_dicecloud_data;
        }

        // If candidate looks like a DB wrapper (id starting with db-), try to recover original
        if (candidate && typeof candidate.id === 'string' && candidate.id.startsWith('db-')) {
          if (candidate._id && typeof candidate._id === 'string' && !candidate._id.startsWith('db-')) {
            candidate.id = candidate._id;
          } else if (candidate.raw_dicecloud_data && candidate.raw_dicecloud_data.id && !candidate.raw_dicecloud_data.id.startsWith('db-')) {
            candidate.id = candidate.raw_dicecloud_data.id;
          }
        }

        // Small normalization: if there are snake_case keys in raw payload, prefer camelCase aliases
        if (candidate && typeof candidate === 'object') {
          if (candidate.armor_class && !candidate.armorClass) candidate.armorClass = candidate.armor_class;
          if (candidate.hit_points && !candidate.hitPoints) candidate.hitPoints = candidate.hit_points;
        }

        // If we managed to find a candidate that looks like a DiceCloud object, use it;
        // otherwise fall back to the original `data` (best-effort).
        if (candidate && typeof candidate === 'object') return candidate;
      } catch (e) {
        debug.warn('⚠️ Error while preparing raw_dicecloud_data for payload:', e && e.message ? e.message : e);
      }
      return data;
    };

    // Extract armor class from a prepared raw object using common field names
    const extractArmorClass = (raw, fallback) => {
      if (!raw || typeof raw !== 'object') return fallback;
      if (typeof raw.armorClass === 'number') return raw.armorClass;
      if (typeof raw.armor_class === 'number') return raw.armor_class;
      if (raw.ac && typeof raw.ac === 'object') {
        if (typeof raw.ac.base === 'number') return raw.ac.base;
        if (typeof raw.ac.total === 'number') return raw.ac.total;
      }
      if (raw.defenses && typeof raw.defenses === 'object') {
        if (typeof raw.defenses.armor_class === 'number') return raw.defenses.armor_class;
        if (typeof raw.defenses.armorClass === 'number') return raw.defenses.armorClass;
      }
      return fallback;
    };

    const preparedRaw = prepareRawForPayload(characterData);

    // DEBUG: Check what preparedRaw contains BEFORE saving to database
    debug.log('🔍 PRE-SAVE: Prepared raw_dicecloud_data check:', {
      hasSpells: !!preparedRaw.spells,
      spellsIsArray: Array.isArray(preparedRaw.spells),
      spellsLength: preparedRaw.spells?.length,
      hasActions: !!preparedRaw.actions,
      actionsIsArray: Array.isArray(preparedRaw.actions),
      actionsLength: preparedRaw.actions?.length,
      topLevelKeys: Object.keys(preparedRaw || {}).slice(0, 30),
      rawDataSizeKB: (JSON.stringify(preparedRaw).length / 1024).toFixed(2)
    });

    const payload = {
      user_id_dicecloud: dicecloudUserId,
      dicecloud_character_id: resolvedCharId,
      character_name: characterData.name || 'Unknown',
      race: characterData.race || null,
      class: characterData.class || null,
      level: characterData.level || 1,
      alignment: characterData.alignment || null,
      hit_points: characterData.hitPoints || { current: 0, max: 0 },
      hit_dice: characterData.hitDice || { current: 0, max: 0, type: 'd8' },
      temporary_hp: characterData.temporaryHP || 0,
      death_saves: characterData.deathSaves || { successes: 0, failures: 0 },
      inspiration: characterData.inspiration || false,
      armor_class: extractArmorClass(preparedRaw, characterData.armorClass || 10),
      speed: characterData.speed || 30,
      initiative: characterData.initiative || 0,
      proficiency_bonus: characterData.proficiencyBonus || 2,
      attributes: characterData.attributes || {},
      attribute_mods: characterData.attributeMods || {},
      saves: characterData.saves || {},
      skills: characterData.skills || {},
      spell_slots: characterData.spellSlots || {},
      resources: characterData.resources || [],
      conditions: characterData.conditions || [],
      notification_color: characterData.notificationColor || '#3498db',
      // Mark character as active in Roll20 when synced
      is_active: true,
      // Store the FULL parsed character object (but unwrap DB wrappers first)
      // The individual fields above are for Discord bot quick access
      raw_dicecloud_data: preparedRaw,
      updated_at: new Date().toISOString()
    };

    // If pairing code provided, look up the pairing to link
    if (pairingCode) {
      const pairingResponse = await fetch(
        `${SUPABASE_URL}/rest/v1/rollcloud_pairings?pairing_code=eq.${pairingCode}&select=id,discord_user_id`,
        {
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
          }
        }
      );
      if (pairingResponse.ok) {
        const pairings = await pairingResponse.json();
        if (pairings.length > 0) {
          // TODO: pairing_id field requires database migration - commented out for now
          // payload.pairing_id = pairings[0].id;
          payload.discord_user_id = pairings[0].discord_user_id;
          debug.log('✅ Linked to pairing:', pairings[0].id);
        }
      }
    } else {
      // No pairing code provided - try multiple sources for Discord user ID
      let discordUserId = null;

      // 1. First check auth_tokens
      try {
        const authResponse = await fetch(
          `${SUPABASE_URL}/rest/v1/auth_tokens?user_id=eq.${visitorId}&select=discord_user_id`,
          {
            headers: {
              'apikey': SUPABASE_ANON_KEY,
              'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
            }
          }
        );
        if (authResponse.ok) {
          const authTokens = await authResponse.json();
          if (authTokens.length > 0 && authTokens[0].discord_user_id) {
            discordUserId = authTokens[0].discord_user_id;
            debug.log('✅ Found Discord user ID from auth_tokens:', discordUserId);
          }
        }
      } catch (error) {
        debug.warn('⚠️ Failed to check auth_tokens:', error.message);
      }

      // 2. If not in auth_tokens, check pairings table for this DiceCloud user
      if (!discordUserId && payload.user_id_dicecloud) {
        try {
          const pairingResponse = await fetch(
            `${SUPABASE_URL}/rest/v1/rollcloud_pairings?dicecloud_user_id=eq.${payload.user_id_dicecloud}&status=eq.connected&select=id,discord_user_id,discord_username,discord_global_name,webhook_url`,
            {
              headers: {
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
              }
            }
          );
          if (pairingResponse.ok) {
            const pairings = await pairingResponse.json();
            if (pairings.length > 0 && pairings[0].discord_user_id) {
              discordUserId = pairings[0].discord_user_id;
              // TODO: pairing_id field requires database migration - commented out for now
              // payload.pairing_id = pairings[0].id;
              debug.log('✅ Found Discord user ID from pairings:', discordUserId);
              debug.log('✅ Linked to pairing:', pairings[0].id);
              // Also update auth_tokens so future lookups are faster
              await linkDiscordUserToAuthTokens(
                discordUserId,
                pairings[0].discord_username,
                pairings[0].discord_global_name
              );
              // Restore webhook URL from pairing if available
              if (pairings[0].webhook_url) {
                const currentSettings = await getDiscordWebhookSettings();
                if (!currentSettings.webhookUrl) {
                  debug.log('✅ Restoring webhook URL from pairing');
                  await setDiscordWebhookSettings(pairings[0].webhook_url, true);
                }
              }
            }
          }
        } catch (error) {
          debug.warn('⚠️ Failed to check pairings:', error.message);
        }
      }

      // 3. If still not found, check local storage for saved pairing ID
      if (!discordUserId) {
        try {
          const stored = await browserAPI.storage.local.get(['discordPairingId']);
          if (stored.discordPairingId) {
            const pairingResponse = await fetch(
              `${SUPABASE_URL}/rest/v1/rollcloud_pairings?id=eq.${stored.discordPairingId}&select=id,discord_user_id,discord_username,discord_global_name,webhook_url`,
              {
                headers: {
                  'apikey': SUPABASE_ANON_KEY,
                  'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
                }
              }
            );
            if (pairingResponse.ok) {
              const pairings = await pairingResponse.json();
              if (pairings.length > 0 && pairings[0].discord_user_id) {
                discordUserId = pairings[0].discord_user_id;
                // TODO: pairing_id field requires database migration - commented out for now
                // payload.pairing_id = pairings[0].id;
                debug.log('✅ Found Discord user ID from stored pairing:', discordUserId);
                debug.log('✅ Linked to pairing:', pairings[0].id);
                // Also update auth_tokens with all Discord info
                await linkDiscordUserToAuthTokens(
                  discordUserId,
                  pairings[0].discord_username,
                  pairings[0].discord_global_name
                );
                // Restore webhook URL from pairing if available
                if (pairings[0].webhook_url) {
                  const currentSettings = await getDiscordWebhookSettings();
                  if (!currentSettings.webhookUrl) {
                    debug.log('✅ Restoring webhook URL from stored pairing');
                    await setDiscordWebhookSettings(pairings[0].webhook_url, true);
                  }
                }
              }
            }
          }
        } catch (error) {
          debug.warn('⚠️ Failed to check stored pairing:', error.message);
        }
      }

      payload.discord_user_id = discordUserId || 'not_linked';
      if (!discordUserId) {
        debug.log('⚠️ No Discord user ID found from any source, using placeholder');
      }
    }

    debug.log('📤 Sending character payload to Supabase:', payload.character_name);

    // Lightweight payload preview for debugging: keys + small sample of raw data
    try {
      const raw = payload.raw_dicecloud_data;
      const rawKeys = raw && typeof raw === 'object' && !Array.isArray(raw) ? Object.keys(raw) : [];
      let rawSample = '';
      try {
        if (raw && typeof raw === 'object') {
          const allowed = rawKeys.slice(0, 50);
          rawSample = JSON.stringify(raw, allowed);
        } else {
          rawSample = String(raw);
        }
      } catch (e) {
        rawSample = '[unserializable raw_dicecloud_data]';
      }
      debug.log('🔁 storeCharacterToCloud payload preview', {
        dicecloud_character_id: payload.dicecloud_character_id,
        character_name: payload.character_name,
        raw_keys_count: rawKeys.length,
        raw_keys: rawKeys.slice(0, 20),
        raw_sample: rawSample && rawSample.slice ? rawSample.slice(0, 2000) : rawSample
      });
    } catch (e) {
      debug.warn('⚠️ Failed to produce storeCharacterToCloud payload preview:', e && e.message ? e.message : e);
    }

    // Delete any existing records for this user + character name to prevent duplicates
    // This handles cases where the same character was stored with different IDs
    try {
      const deleteResponse = await fetch(
        `${SUPABASE_URL}/rest/v1/rollcloud_characters?user_id_dicecloud=eq.${encodeURIComponent(payload.user_id_dicecloud)}&character_name=eq.${encodeURIComponent(payload.character_name)}`,
        {
          method: 'DELETE',
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'Prefer': 'return=minimal'
          }
        }
      );
      if (deleteResponse.ok) {
        debug.log('🧹 Cleaned up existing character records before insert');
      }
    } catch (deleteError) {
      debug.warn('⚠️ Failed to cleanup existing records:', deleteError.message);
      // Continue anyway - insert will still work (or upsert)
    }

    // Insert the new character record
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/rollcloud_characters`,
      {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates,return=minimal'
        },
        body: JSON.stringify(payload)
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      debug.log('⚠️ Character POST failed, trying PATCH:', response.status, errorText);

      // Try PATCH (update) instead
      const updateResponse = await fetch(
        `${SUPABASE_URL}/rest/v1/rollcloud_characters?dicecloud_character_id=eq.${characterData.id}`,
        {
          method: 'PATCH',
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify(payload)
        }
      );

      if (!updateResponse.ok) {
        const patchError = await updateResponse.text();
        debug.error('❌ Character PATCH also failed:', updateResponse.status, patchError);
        throw new Error(`Character update failed: ${patchError}`);
      }
      debug.log('✅ Character updated via PATCH');
    } else {
      debug.log('✅ Character inserted via POST');
    }

    debug.log('✅ Character stored in Supabase:', characterData.name);
    
    // Update last sync time for session tracking
    await browserAPI.storage.local.set({
      lastSyncTime: new Date().toISOString()
    });
    
    return { success: true };
  } catch (error) {
    debug.error('❌ Failed to store character in Supabase:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Sync character color to Supabase
 * Updates only the notification_color field for a specific character
 */
async function syncCharacterColorToSupabase(characterId, color) {
  if (!isSupabaseConfigured()) {
    debug.warn('Supabase not configured - color sync unavailable');
    return {
      success: false,
      error: 'Color sync not available. Supabase not configured.',
      supabaseNotConfigured: true
    };
  }

  try {
    debug.log('🎨 Syncing character color to Supabase:', characterId, color);

    // Update only the notification_color field
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/rollcloud_characters?dicecloud_character_id=eq.${characterId}`,
      {
        method: 'PATCH',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({
          notification_color: color
        })
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      debug.error('❌ Failed to sync color to Supabase:', response.status, errorText);
      return { success: false, error: `Sync failed: ${response.status}` };
    }

    debug.log('✅ Character color synced to Supabase successfully');
    return { success: true };
  } catch (error) {
    debug.error('❌ Failed to sync character color to Supabase:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Check if character is currently active in Discord bot instances
 * This calls the pip-bot's character status API
 */
async function checkDiscordCharacterIntegration(characterName, characterId) {
  try {
    debug.log(`🔍 Checking Discord integration for character: ${characterName} (${characterId})`);
    
    // Check for both webhook and pairing-based integration
    const webhookResult = await getDiscordWebhookSettings();
    const pairingResult = await browserAPI.storage.local.get(['discordPairingId', 'discordPairingCode']);
    
    debug.log(`🔍 Webhook result:`, { hasUrl: !!webhookResult.webhookUrl, enabled: webhookResult.enabled });
    debug.log(`🔍 Pairing result:`, { hasPairingId: !!pairingResult.discordPairingId, hasCode: !!pairingResult.discordPairingCode });
    
    // Check if either webhook or pairing is configured
    const hasWebhookIntegration = webhookResult.webhookUrl && webhookResult.enabled;
    const hasPairingIntegration = pairingResult.discordPairingId || pairingResult.discordPairingCode;
    
    if (!hasWebhookIntegration && !hasPairingIntegration) {
      debug.log('❌ Discord integration not configured - no webhook or pairing found');
      return {
        success: true,
        found: false,
        serverName: null,
        message: 'Discord integration not configured'
      };
    }
    
    let serverName = webhookResult.serverName;
    
    if (hasWebhookIntegration) {
      // Extract Discord server info from webhook URL
      // Webhook URL format: https://discord.com/api/webhooks/{bot_id}/{token}
      const webhookUrl = new URL(webhookResult.webhookUrl);
      const botId = webhookUrl.pathname.split('/')[2];
      
      debug.log(`🤖 Checking with bot ID: ${botId} for character: ${characterName}`);
    } else if (hasPairingIntegration) {
      debug.log(`🤖 Checking with pairing system for character: ${characterName}`);
      serverName = 'Discord Server (Paired)';
    }
    
    // Get active character data to compare
    const characterData = await getCharacterData();
    // Handle both DiceCloud format (name) and database format (character_name)
    const activeCharacterName = characterData?.character_name || characterData?.name;

    debug.log(`🔍 Character comparison: Discord="${characterName}" vs Active="${activeCharacterName}"`);
    debug.log(`🔍 Active character data:`, characterData);

    // Normalize character names for comparison (trim whitespace, case-insensitive)
    const normalizedDiscordName = characterName?.trim().toLowerCase();
    const normalizedActiveName = activeCharacterName?.trim().toLowerCase();

    debug.log(`🔍 Normalized comparison: Discord="${normalizedDiscordName}" vs Active="${normalizedActiveName}"`);

    if (characterData && normalizedDiscordName && normalizedActiveName && normalizedDiscordName === normalizedActiveName) {
      debug.log(`✅ Character ${characterName} found in local storage and matches Discord integration`);

      return {
        success: true,
        found: true,
        serverName: serverName || 'Unknown Server',
        message: `Character ${characterName} is active in Discord server: ${serverName || 'Unknown Server'}`,
        characterData: {
          name: activeCharacterName,
          race: characterData.race,
          class: characterData.class,
          level: characterData.level,
          discordServer: serverName
        }
      };
    } else {
      debug.log(`❌ Character ${characterName} not found in local storage or doesn't match active character`);
      debug.log(`❌ Comparison failed: "${normalizedDiscordName}" !== "${normalizedActiveName}"`);

      return {
        success: true,
        found: false,
        serverName: null,
        message: `Character ${characterName} is not currently active in Discord`,
        availableCharacter: characterData ? {
          name: activeCharacterName,
          race: characterData.race,
          class: characterData.class,
          level: characterData.level
        } : null
      };
    }
    
  } catch (error) {
    debug.error('❌ Error checking Discord character integration:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Fetch data from DiceCloud API
 * Used by Roll20 content script to get character data
 */
async function fetchFromDiceCloudAPI(url, token) {
  try {
    debug.log('🔌 Fetching from DiceCloud API:', url);

    const headers = {
      'Content-Type': 'application/json'
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(url, {
      method: 'GET',
      headers: headers
    });

    if (!response.ok) {
      const errorText = await response.text();
      debug.error('❌ DiceCloud API fetch failed:', response.status, errorText);
      return { success: false, error: `API error: ${response.status}` };
    }

    const data = await response.json();
    debug.log('✅ DiceCloud API fetch successful');
    return { success: true, data: data };
  } catch (error) {
    debug.error('❌ Failed to fetch from DiceCloud API:', error);
    return { success: false, error: error.message };
  }
}

// ============================================================================
// Discord Pairing via Supabase
// ============================================================================

/**
 * Check if Supabase is configured
 */
function isSupabaseConfigured() {
  return SUPABASE_URL &&
         !SUPABASE_URL.includes('your-project') &&
         SUPABASE_ANON_KEY &&
         SUPABASE_ANON_KEY !== 'your-anon-key';
}

// ============================================================================
// Supabase Realtime Subscription for Pairing Updates
// ============================================================================

let realtimeSocket = null;
let realtimeHeartbeat = null;
let currentPairingCode = null;

/**
 * Subscribe to Realtime updates for a pairing code
 * When the Discord bot completes the pairing, we'll get notified immediately
 */
function subscribeToRealtimePairing(pairingCode) {
  if (!isSupabaseConfigured()) {
    debug.warn('Cannot subscribe to Realtime - Supabase not configured');
    return;
  }

  // Store the pairing code we're watching
  currentPairingCode = pairingCode;

  // Close existing connection if any
  if (realtimeSocket) {
    realtimeSocket.close();
  }

  // Extract project ref from URL
  const projectRef = SUPABASE_URL.replace('https://', '').split('.')[0];
  const wsUrl = `wss://${projectRef}.supabase.co/realtime/v1/websocket?apikey=${SUPABASE_ANON_KEY}&vsn=1.0.0`;

  debug.log('🔌 Connecting to Supabase Realtime for pairing:', pairingCode);

  try {
    realtimeSocket = new WebSocket(wsUrl);

    realtimeSocket.onopen = () => {
      debug.log('✅ Realtime WebSocket connected');

      // Send join message to subscribe to pairing updates
      const joinMessage = {
        topic: `realtime:public:rollcloud_pairings:pairing_code=eq.${pairingCode}`,
        event: 'phx_join',
        payload: {
          config: {
            broadcast: { self: false },
            presence: { key: '' },
            postgres_changes: [{
              event: 'UPDATE',
              schema: 'public',
              table: 'rollcloud_pairings',
              filter: `pairing_code=eq.${pairingCode}`
            }]
          }
        },
        ref: '1'
      };
      realtimeSocket.send(JSON.stringify(joinMessage));

      // Start heartbeat to keep connection alive
      realtimeHeartbeat = setInterval(() => {
        if (realtimeSocket && realtimeSocket.readyState === WebSocket.OPEN) {
          realtimeSocket.send(JSON.stringify({
            topic: 'phoenix',
            event: 'heartbeat',
            payload: {},
            ref: Date.now().toString()
          }));
        }
      }, 30000);
    };

    realtimeSocket.onmessage = async (event) => {
      try {
        const message = JSON.parse(event.data);
        debug.log('📨 Realtime message:', message.event);

        // Handle postgres_changes events
        if (message.event === 'postgres_changes' && message.payload?.data?.record) {
          const record = message.payload.data.record;

          // Check if pairing was completed
          if (record.status === 'connected' && record.discord_user_id) {
            debug.log('🎉 Pairing completed via Realtime! Discord user:', record.discord_user_id);

            // Update auth_tokens with full Discord info
            await linkDiscordUserToAuthTokens(
              record.discord_user_id,
              record.discord_username,
              record.discord_global_name
            );

            // IMPORTANT: Save webhook settings directly - don't rely on popup being open
            if (record.webhook_url) {
              debug.log('📝 Saving webhook URL from Realtime:', record.webhook_url.substring(0, 50) + '...');
              await setDiscordWebhookSettings(record.webhook_url, true, record.discord_guild_name);

              // Also save pairing ID for command polling
              await browserAPI.storage.local.set({
                currentPairingId: record.id,
                discordPairingId: record.id
              });

              // Subscribe to command realtime
              subscribeToCommandRealtime(record.id);
              debug.log('✅ Discord webhook and pairing ID saved from Realtime');
            }

            // Notify popup that pairing is complete (if it's open)
            try {
              await browserAPI.runtime.sendMessage({
                action: 'pairingComplete',
                discordUserId: record.discord_user_id,
                discordUsername: record.discord_username,
                discordGlobalName: record.discord_global_name,
                webhookUrl: record.webhook_url,
                serverName: record.discord_guild_name,
                pairingId: record.id
              });
            } catch (e) {
              // Popup might not be open - but webhook is already saved above
              debug.log('Could not notify popup (probably not open)');
            }

            // Clean up subscription
            unsubscribeFromRealtimePairing();
          }
        }
      } catch (e) {
        debug.warn('Error processing Realtime message:', e);
      }
    };

    realtimeSocket.onerror = (error) => {
      debug.warn('Realtime WebSocket error:', error);
    };

    realtimeSocket.onclose = () => {
      debug.log('🔌 Realtime WebSocket closed');
      if (realtimeHeartbeat) {
        clearInterval(realtimeHeartbeat);
        realtimeHeartbeat = null;
      }
    };
  } catch (error) {
    debug.error('Failed to connect to Realtime:', error);
  }
}

/**
 * Unsubscribe from Realtime updates
 */
function unsubscribeFromRealtimePairing() {
  if (realtimeSocket) {
    realtimeSocket.close();
    realtimeSocket = null;
  }
  if (realtimeHeartbeat) {
    clearInterval(realtimeHeartbeat);
    realtimeHeartbeat = null;
  }
  currentPairingCode = null;
  debug.log('🔌 Unsubscribed from Realtime pairing updates');
}

// Before creating new pairing, expire old ones
async function createPairing(code, username, userId) {
  // Clean up old pairings for this user
  await supabase
    .from('rollcloud_pairings')
    .update({ status: 'expired' })
    .eq('dicecloud_user_id', userId)
    .eq('status', 'connected');
  
  // NOW create the new one
  const { data } = await supabase
    .from('rollcloud_pairings')
    .insert({
      pairing_code: code,
      dicecloud_username: username,
      dicecloud_user_id: userId,
      status: 'pending'
    });
}

/**
 * Create a Discord pairing code in Supabase
 */
async function createDiscordPairing(code, diceCloudUsername, diceCloudUserId) {
  // Check if Supabase is configured
  if (!isSupabaseConfigured()) {
    debug.warn('Supabase not configured - pairing unavailable');
    return {
      success: false,
      error: 'Automatic pairing not available. Please use manual webhook setup.',
      supabaseNotConfigured: true
    };
  }

  try {
    // Expire ALL existing pairings for this DiceCloud user (both pending and connected)
    // This ensures only one active pairing exists per user at a time
    if (diceCloudUserId) {
      try {
        const expireResponse = await fetch(
          `${SUPABASE_URL}/rest/v1/rollcloud_pairings?dicecloud_user_id=eq.${diceCloudUserId}&status=in.(pending,connected)`,
          {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              'apikey': SUPABASE_ANON_KEY,
              'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
              'Prefer': 'return=minimal'
            },
            body: JSON.stringify({ status: 'expired' })
          }
        );
        if (expireResponse.ok) {
          debug.log('🧹 Expired old pairings (pending + connected) for user:', diceCloudUserId);
        }
      } catch (expireError) {
        debug.warn('⚠️ Could not expire old pairings:', expireError.message);
        // Continue anyway - this is not critical
      }
    }

    const response = await fetch(`${SUPABASE_URL}/rest/v1/rollcloud_pairings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({
        pairing_code: code,
        dicecloud_username: diceCloudUsername,
        dicecloud_user_id: diceCloudUserId, // Store the actual DiceCloud user ID (Meteor ID)
        status: 'pending'
      })
    });

    if (response.ok) {
      debug.log('✅ Discord pairing created:', code, 'for DiceCloud user:', diceCloudUserId);

      // Subscribe to Realtime updates for this pairing code
      // This will notify us immediately when the Discord bot completes the pairing
      subscribeToRealtimePairing(code);

      return { success: true, code };
    } else {
      const error = await response.text();
      debug.error('❌ Failed to create pairing:', error);
      return { success: false, error: 'Failed to create pairing code' };
    }
  } catch (error) {
    debug.error('❌ Supabase error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Check if a Discord pairing has been completed (webhook URL filled in)
 */
async function checkDiscordPairing(code) {
  // Check if Supabase is configured
  if (!isSupabaseConfigured()) {
    return { success: false, error: 'Supabase not configured', supabaseNotConfigured: true };
  }

  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/rollcloud_pairings?pairing_code=eq.${code}&select=*`,
      {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
        }
      }
    );

    if (response.ok) {
      const data = await response.json();
      if (data.length > 0) {
        const pairing = data[0];
        if (pairing.status === 'connected' && pairing.webhook_url) {
          debug.log('✅ Discord pairing connected!');
          return {
            success: true,
            connected: true,
            webhookUrl: pairing.webhook_url,
            serverName: pairing.discord_guild_name,
            pairingId: pairing.id, // Return pairing ID for command polling
            discordUserId: pairing.discord_user_id, // Return Discord user ID to link to auth_tokens
            discordUsername: pairing.discord_username,
            discordGlobalName: pairing.discord_global_name
          };
        } else {
          return { success: true, connected: false };
        }
      } else {
        return { success: false, error: 'Pairing code not found' };
      }
    } else {
      return { success: false, error: 'Failed to check pairing' };
    }
  } catch (error) {
    debug.error('❌ Supabase check error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get user's synced characters from Supabase
 */
async function getUserCharactersFromCloud(pairingId = null) {
  if (!isSupabaseConfigured()) {
    debug.warn('Supabase not configured - cannot get user characters');
    return [];
  }

  try {
    let characters = [];
    
    if (pairingId) {
      // Get characters for specific pairing
      const response = await fetch(
        `${SUPABASE_URL}/rest/v1/rollcloud_pairings?id=eq.${pairingId}&select=discord_user_id`,
        {
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
          }
        }
      );

      if (response.ok) {
        const pairings = await response.json();
        if (pairings.length > 0) {
          const discordUserId = pairings[0].discord_user_id;
          
          // Get characters for this Discord user
          const charsResponse = await fetch(
            `${SUPABASE_URL}/rest/v1/rollcloud_characters?discord_user_id=eq.${discordUserId}&select=character_name,level,race,class,is_active,updated_at&order=updated_at.desc`,
            {
              headers: {
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
              }
            }
          );

          if (charsResponse.ok) {
            characters = await charsResponse.json();
          }
        }
      }
    } else {
      // No pairing ID - try to get from current webhook settings
      const settings = await getDiscordWebhookSettings();
      if (settings.pairingId) {
        return await getUserCharactersFromCloud(settings.pairingId);
      }
    }

    debug.log(`📋 Retrieved ${characters.length} characters from cloud`);
    return characters;
  } catch (error) {
    debug.error('❌ Error getting user characters from cloud:', error);
    return [];
  }
}

// ============================================================================
// Discord Command Realtime Subscription (Discord → Extension → Roll20)
// ============================================================================

let commandRealtimeSocket = null;
let commandRealtimeHeartbeat = null;
let currentPairingId = null;
let commandRealtimeReconnectTimeout = null;

/**
 * CORRECTED subscribeToCommandRealtime function
 * Replace the existing function in background.js with this
 */

async function subscribeToCommandRealtime(pairingId) {
  if (!pairingId) {
    const settings = await browserAPI.storage.local.get(['discordPairingId']);
    pairingId = settings.discordPairingId;
  }

  if (!pairingId) {
    debug.warn('No pairing ID available for command subscription');
    return;
  }

  if (!isSupabaseConfigured()) {
    debug.warn('Supabase not configured — cannot subscribe to commands');
    return;
  }

  // If already subscribed with same pairing, skip
  if (commandRealtimeSocket && commandRealtimeSocket.readyState === WebSocket.OPEN && currentPairingId === pairingId) {
    debug.log('Command realtime already connected for pairing:', pairingId);
    return;
  }

  // Tear down any existing connection first
  unsubscribeFromCommandRealtime();

  currentPairingId = pairingId;

  const projectRef = SUPABASE_URL.replace('https://', '').split('.')[0];
  const wsUrl = `wss://${projectRef}.supabase.co/realtime/v1/websocket?apikey=${SUPABASE_ANON_KEY}&vsn=1.0.0`;

  debug.log('🔌 Connecting to Supabase Realtime for commands, pairing:', pairingId);

  try {
    commandRealtimeSocket = new WebSocket(wsUrl);

    commandRealtimeSocket.onopen = () => {
      debug.log('✅ Command Realtime WebSocket connected');

      // CORRECTED: Subscribe to postgres_changes for INSERT events on rollcloud_commands
      const topic = `realtime:public:rollcloud_commands`;
      const joinMessage = {
        topic: topic,
        event: 'phx_join',
        payload: {
          config: {
            postgres_changes: [{
              event: 'INSERT',  // ✅ Listen for new commands being inserted
              schema: 'public',
              table: 'rollcloud_commands',  // ✅ Correct table
              filter: `pairing_id=eq.${pairingId}`  // ✅ Only this pairing's commands
            }]
          }
        },
        ref: 'cmd_1'
      };
      
      debug.log('📤 Subscribing to postgres_changes:', JSON.stringify(joinMessage, null, 2));
      commandRealtimeSocket.send(JSON.stringify(joinMessage));

      // Start keep-alive alarm to prevent service worker termination
      startRealtimeKeepAlive();

      // Heartbeat every 30s to keep connection alive and drain pending commands
      commandRealtimeHeartbeat = setInterval(() => {
        if (commandRealtimeSocket && commandRealtimeSocket.readyState === WebSocket.OPEN) {
          commandRealtimeSocket.send(JSON.stringify({
            topic: 'phoenix',
            event: 'heartbeat',
            payload: {},
            ref: 'cmd_hb_' + Date.now()
          }));
          // Also drain pending commands periodically in case realtime missed anything
          drainPendingCommands();
        }
      }, 5000);

      // Also drain any pending commands that arrived while we were disconnected
      drainPendingCommands();
    };

    commandRealtimeSocket.onmessage = async (event) => {
      try {
        const message = JSON.parse(event.data);

        // Log ALL raw messages for debugging
        debug.log('📨 RAW Realtime message:', JSON.stringify(message).substring(0, 500));

        // Handle Phoenix protocol replies (subscription confirmation)
        if (message.event === 'phx_reply') {
          if (message.payload?.status === 'ok') {
            debug.log('✅ Realtime subscription confirmed for topic:', message.topic || 'unknown');
          } else {
            debug.error('❌ Realtime subscription FAILED:', message.payload?.response || message.payload);
          }
          return;
        }

        // Handle system messages
        if (message.event === 'system' && message.payload?.status === 'ok') {
          debug.log('✅ Realtime system ready:', message.payload?.message || 'connected');
          return;
        }

        // ✅ CORRECTED: Handle postgres_changes events (not broadcast)
        if (message.event === 'postgres_changes') {
          const payload = message.payload;
          
          debug.log('📥 postgres_changes event received:', payload?.data?.type || 'unknown type');

          // For INSERT events, the new record is in payload.data.record
          if (payload?.data?.type === 'INSERT' && payload.data.record) {
            const record = payload.data.record;
            
            debug.log('📥 New command inserted! Type:', record.command_type, 'ID:', record.id);

            // Only process if status is pending
            if (record.status === 'pending') {
              debug.log('⚡ Executing command:', record.command_type);
              await executeCommand(record);
            } else {
              debug.log('⏭️ Skipping command with status:', record.status);
            }
          }
          return;
        }

        // Still handle broadcast events as fallback (if you add that later)
        if (message.event === 'broadcast') {
          const record = message.payload?.record ?? message.payload?.new ?? message.payload;

          debug.log('📥 Broadcast received! Record:', JSON.stringify(record).substring(0, 300));

          if (record && record.status === 'pending') {
            debug.log('📥 Realtime command received via broadcast:', record.command_type, record.id);
            await executeCommand(record);
          }
        }
      } catch (e) {
        debug.warn('Error processing command Realtime message:', e);
      }
    };

    commandRealtimeSocket.onerror = (error) => {
      debug.warn('Command Realtime WebSocket error:', error);
    };

    commandRealtimeSocket.onclose = () => {
      debug.log('🔌 Command Realtime WebSocket closed');
      if (commandRealtimeHeartbeat) {
        clearInterval(commandRealtimeHeartbeat);
        commandRealtimeHeartbeat = null;
      }

      // Auto-reconnect after 5 seconds if we still have a pairing
      if (currentPairingId) {
        debug.log('⏳ Scheduling command realtime reconnect in 5s...');
        commandRealtimeReconnectTimeout = setTimeout(() => {
          if (currentPairingId) {
            subscribeToCommandRealtime(currentPairingId);
          }
        }, 5000);
      }
    };
  } catch (error) {
    debug.error('Failed to connect to command Realtime:', error);
  }
}

/**
 * Unsubscribe from command Realtime updates
 */
function unsubscribeFromCommandRealtime() {
  // Stop keep-alive alarm
  stopRealtimeKeepAlive();

  if (commandRealtimeReconnectTimeout) {
    clearTimeout(commandRealtimeReconnectTimeout);
    commandRealtimeReconnectTimeout = null;
  }
  if (commandRealtimeSocket) {
    commandRealtimeSocket.close();
    commandRealtimeSocket = null;
  }
  if (commandRealtimeHeartbeat) {
    clearInterval(commandRealtimeHeartbeat);
    commandRealtimeHeartbeat = null;
  }
  debug.log('🔇 Unsubscribed from command Realtime');
}

/**
 * Drain any pending commands that may have arrived while disconnected.
 * Called once on (re-)connect to catch anything missed.
 */
async function drainPendingCommands() {
  if (!isSupabaseConfigured() || !currentPairingId) return;

  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/rollcloud_commands?pairing_id=eq.${currentPairingId}&status=eq.pending&order=created_at.asc&limit=10`,
      {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
        }
      }
    );

    if (!response.ok) {
      debug.warn('Failed to drain pending commands:', response.status);
      return;
    }

    const commands = await response.json();
    if (commands.length > 0) {
      debug.log(`📥 Draining ${commands.length} pending command(s)`);
      for (const command of commands) {
        await executeCommand(command);
      }
    }
  } catch (error) {
    debug.error('Drain pending commands error:', error);
  }
}

/**
 * Execute a command from Discord
 */
async function executeCommand(command) {
  debug.log('⚡ Executing command:', command.command_type, command);

  try {
    // Mark as processing
    await updateCommandStatus(command.id, 'processing');

    let result;

    switch (command.command_type) {
      case 'roll':
        result = await executeRollCommand(command);
        break;

      case 'rollhere':
        result = await executeRollHereCommand(command);
        break;

      case 'use_action':
        result = await executeUseActionCommand(command, 'action');
        break;

      case 'use_bonus':
        result = await executeUseActionCommand(command, 'bonus');
        break;

      case 'end_turn':
        result = await executeEndTurnCommand(command);
        break;

      case 'use_ability':
        result = await executeUseAbilityCommand(command);
        break;

      case 'use':
        // Handle /use command from Discord bot (actions, abilities, etc.)
        result = await executeUseAbilityCommand(command);
        break;

      case 'cast':
        result = await executeCastCommand(command);
        break;

      case 'heal':
        result = await executeHealCommand(command);
        break;

      case 'takedamage':
        result = await executeTakeDamageCommand(command);
        break;

      case 'rest':
        result = await executeRestCommand(command);
        break;

      default:
        result = { success: false, error: `Unknown command type: ${command.command_type}` };
    }

    // Mark as completed or failed
    await updateCommandStatus(
      command.id,
      result.success ? 'completed' : 'failed',
      result
    );

    debug.log('✅ Command executed:', command.command_type, result);
  } catch (error) {
    debug.error('❌ Command execution failed:', error);
    await updateCommandStatus(command.id, 'failed', null, error.message);
  }
}

/**
 * Execute a rollhere command (roll dice in Discord only, not Roll20)
 * Uses Roll20-style [XdY] or [XdY+X] format
 */
async function executeRollHereCommand(command) {
  const { action_name, command_data } = command;

  // Get roll string from command data, default to 1d20
  const rollString = command_data.roll_string || '1d20';
  const rollName = action_name || command_data.roll_name || 'Roll';
  const characterName = command_data.character_name || 'Unknown';

  debug.log('🎲 Rolling in Discord (not Roll20):', rollString, rollName);

  try {
    // Post the roll to Discord webhook with proper payload structure
    const payload = {
      type: 'roll',
      characterName: characterName,
      rollName: rollName,
      rollString: rollString,
      timestamp: new Date().toISOString()
    };

    const result = await postToDiscordWebhook(payload);

    if (result.success) {
      debug.log('✅ Roll posted to Discord:', rollName);
      return { success: true, message: `Rolled ${rollName} in Discord` };
    } else {
      debug.error('❌ Failed to post roll to Discord:', result.error);
      return { success: false, message: `Failed to roll in Discord: ${result.error}` };
    }
  } catch (error) {
    debug.error('❌ Error executing rollhere command:', error);
    return { success: false, message: `Error: ${error.message}` };
  }
}

/**
 * Execute a roll command (e.g., attack roll, save, check)
 */
async function executeRollCommand(command) {
  const { action_name, command_data } = command;

  // Build roll data from command data
  const rollString = command_data.roll_string || `/roll 1d20`;
  const rollName = action_name || command_data.roll_name || 'Discord Roll';

  // Build comprehensive roll data for Roll20
  const rollData = {
    formula: rollString,
    name: rollName,
    source: 'discord',
    characterName: command_data.character_name,
    characterId: command_data.character_id,
    checkType: command_data.check_type,
    advantage: command_data.advantage,
    disadvantage: command_data.disadvantage,
    count: command_data.count,
    sides: command_data.sides,
    modifier: command_data.modifier,
    color: command_data.notification_color || '#3498db'  // Include character's notification color for colored announcements
  };

  // Send to Roll20
  const result = await sendRollToAllRoll20Tabs(rollData);

  if (!result || !result.success) {
    const errorMsg = result?.error || 'Failed to send roll to Roll20';
    debug.error('❌ Roll command failed:', errorMsg);
    return { success: false, message: errorMsg };
  }

  return { success: true, message: `Rolled ${rollName}` };
}

/**
 * Execute an action/bonus action use command
 */
async function executeUseActionCommand(command, actionType) {
  const { action_name, command_data } = command;

  // Send action use to Roll20 tabs
  const tabs = await browserAPI.tabs.query({ url: '*://app.roll20.net/*' });

  for (const tab of tabs) {
    try {
      await browserAPI.tabs.sendMessage(tab.id, {
        action: 'useActionFromDiscord',
        actionType: actionType,
        actionName: action_name,
        commandData: command_data
      });
    } catch (err) {
      debug.warn(`Failed to send action to tab ${tab.id}:`, err);
    }
  }

  return { success: true, message: `Used ${actionType}: ${action_name}` };
}

/**
 * Execute end turn command
 */
async function executeEndTurnCommand(command) {
  const tabs = await browserAPI.tabs.query({ url: '*://app.roll20.net/*' });

  for (const tab of tabs) {
    try {
      await browserAPI.tabs.sendMessage(tab.id, {
        action: 'endTurnFromDiscord'
      });
    } catch (err) {
      debug.warn(`Failed to send end turn to tab ${tab.id}:`, err);
    }
  }

  return { success: true, message: 'Turn ended' };
}

/**
 * Execute use ability command (spell, feature, etc.)
 */
async function executeUseAbilityCommand(command) {
  const { action_name, command_data } = command;

  const tabs = await browserAPI.tabs.query({ url: '*://app.roll20.net/*' });

  for (const tab of tabs) {
    try {
      await browserAPI.tabs.sendMessage(tab.id, {
        action: 'useAbilityFromDiscord',
        abilityName: action_name,
        abilityData: command_data
      });
    } catch (err) {
      debug.warn(`Failed to send ability use to tab ${tab.id}:`, err);
    }
  }

  return { success: true, message: `Used ability: ${action_name}` };
}

/**
 * Execute a cast spell command from Discord
 */
async function executeCastCommand(command) {
  const { action_name, command_data } = command;

  try {
    // Get character data for metamagic processing
    const characterData = await getCharacterDataForDiscordCommand(command_data.character_name, command_data.character_id);
    
    if (!characterData) {
      debug.warn(`No character data found for Discord command: ${command_data.character_name}`);
      return { success: false, error: 'Character not found' };
    }

    // Process metamagic using action-executor
    // Note: executeDiscordCast should be available from content script context where action-executor is loaded
    // For now, return basic data and let content script handle execution
    const castResult = (typeof globalThis.executeDiscordCast === 'function')
      ? globalThis.executeDiscordCast(command_data, characterData)
      : { rolls: [], effects: [], text: '' }; // Fallback if not available

    debug.log('🔮 Discord spell execution result:', castResult);

    // Build enhanced spell data with all processed effects
    const rolls = castResult.rolls || [];
    // Handle both spell and spell_data field names (Discord bot uses 'spell', others may use 'spell_data')
    const spellData = command_data.spell || command_data.spell_data || {};
    const enhancedSpellData = {
      ...command_data,
      spell_data: spellData,
      spell: spellData, // Include both for compatibility
      // Apply metamagic modifications to damage rolls if any (at top level for content script)
      damageRolls: rolls.map(roll => ({
        damage: roll.formula,
        damageType: roll.damageType || roll.type || 'damage',
        name: roll.name
      })),
      // Include all processed effects for Roll20 display
      metamagicUsed: castResult.metamagicUsed,
      slotUsed: castResult.slotUsed,
      effects: castResult.effects,
      isCantrip: castResult.isCantrip,
      isFreecast: castResult.isFreecast,
      resourceChanges: castResult.resourceChanges,
      executionResult: castResult,
      // Upcasting information
      isUpcast: castResult.embed?.isUpcast || false,
      actualCastLevel: castResult.embed?.castLevel || parseInt(command_data.cast_level) || 0
    };

    // Send to all Roll20 tabs
    const tabs = await browserAPI.tabs.query({ url: '*://app.roll20.net/*' });

    for (const tab of tabs) {
      try {
        await browserAPI.tabs.sendMessage(tab.id, {
          action: 'castSpellFromDiscord',
          spellName: action_name,
          spellData: enhancedSpellData
        });
      } catch (err) {
        debug.warn(`Failed to send cast to tab ${tab.id}:`, err);
      }
    }

    return { success: true, message: `Cast spell: ${action_name}`, result: castResult };
  } catch (error) {
    debug.error('Error executing Discord cast command:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Execute a heal command from Discord
 */
async function executeHealCommand(command) {
  const { command_data } = command;

  try {
    const tabs = await browserAPI.tabs.query({ url: '*://app.roll20.net/*' });

    for (const tab of tabs) {
      try {
        await browserAPI.tabs.sendMessage(tab.id, {
          action: 'healFromDiscord',
          amount: command_data.amount,
          isTemp: command_data.is_temp || false,
          characterName: command_data.character_name
        });
      } catch (err) {
        debug.warn(`Failed to send heal to tab ${tab.id}:`, err);
      }
    }

    return {
      success: true,
      message: command_data.is_temp
        ? `Added ${command_data.amount} temp HP`
        : `Healed ${command_data.amount} HP`
    };
  } catch (error) {
    debug.error('Error executing Discord heal command:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Execute a take damage command from Discord
 */
async function executeTakeDamageCommand(command) {
  const { command_data } = command;

  try {
    const tabs = await browserAPI.tabs.query({ url: '*://app.roll20.net/*' });

    for (const tab of tabs) {
      try {
        await browserAPI.tabs.sendMessage(tab.id, {
          action: 'takeDamageFromDiscord',
          amount: command_data.amount,
          damageType: command_data.damage_type || 'untyped',
          characterName: command_data.character_name
        });
      } catch (err) {
        debug.warn(`Failed to send damage to tab ${tab.id}:`, err);
      }
    }

    return {
      success: true,
      message: `Took ${command_data.amount} ${command_data.damage_type || ''} damage`.trim()
    };
  } catch (error) {
    debug.error('Error executing Discord take damage command:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Execute a rest command from Discord
 */
async function executeRestCommand(command) {
  const { command_data } = command;

  try {
    const tabs = await browserAPI.tabs.query({ url: '*://app.roll20.net/*' });

    for (const tab of tabs) {
      try {
        await browserAPI.tabs.sendMessage(tab.id, {
          action: 'restFromDiscord',
          restType: command_data.rest_type,
          characterName: command_data.character_name
        });
      } catch (err) {
        debug.warn(`Failed to send rest to tab ${tab.id}:`, err);
      }
    }

    return {
      success: true,
      message: `Took a ${command_data.rest_type} rest`
    };
  } catch (error) {
    debug.error('Error executing Discord rest command:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Safely parse JSON with circular reference detection
 * @param {string} jsonString - JSON string to parse
 * @param {number} maxDepth - Maximum allowed depth
 * @returns {Object|null} Parsed object or null if parsing fails
 */
function safeJsonParse(jsonString, maxDepth = 20) {
  try {
    const seen = new WeakSet();
    
    return JSON.parse(jsonString, (key, value) => {
      // Check for circular references
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) {
          debug.warn(`Circular reference detected for key: ${key}`);
          return '[Circular Reference]';
        }
        seen.add(value);
      }
      return value;
    });
  } catch (error) {
    debug.error('JSON parsing failed:', error.message);
    return null;
  }
}

/**
 * Get character data for Discord command processing
 */
async function getCharacterDataForDiscordCommand(characterName, characterId) {
  try {
    // First try to get active character from local storage (this is what /roll uses)
    const result = await browserAPI.storage.local.get(['characterProfiles', 'activeCharacterId']);
    const characterProfiles = result.characterProfiles || {};
    const activeCharacterId = result.activeCharacterId;
    
    debug.log(`🎯 Discord command looking for character: ${characterName}, activeCharacterId: ${activeCharacterId}`);
    
    // If we have an active character, use it
    if (activeCharacterId && characterProfiles[activeCharacterId]) {
      const activeChar = characterProfiles[activeCharacterId];
      // Check if the active character matches the requested name (if provided)
      if (!characterName || activeChar.character?.name === characterName || activeChar.name === characterName) {
        debug.log(`📥 Using active character for Discord command: ${activeChar.character?.name || activeChar.name}`);
        return activeChar.character || activeChar;
      }
    }
    
    // Fallback: try to find character by name in local storage
    if (characterName && characterProfiles) {
      for (const [id, profile] of Object.entries(characterProfiles)) {
        if (profile.type === 'dicecloud' && (profile.character?.name === characterName || profile.name === characterName)) {
          debug.log(`📥 Found character by name in local storage for ${characterName}`);
          return profile.character || profile;
        }
      }
    }
    
    // Last resort: try Supabase (but this is unlikely to work for most users)
    if (characterId && isSupabaseConfigured()) {
      const response = await fetch(
        `${SUPABASE_URL}/rest/v1/raw_dicecloud_data?character_id=eq.${characterId}&select=*`,
        {
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Content-Type': 'application/json'
          }
        }
      );
      
      if (response.ok) {
        const responseText = await response.text();
        const data = safeJsonParse(responseText);
        
        if (data && Array.isArray(data) && data.length > 0) {
          debug.log(`📥 Retrieved character data from Supabase for ${characterName}`);
          return data[0].character_data;
        }
      }
    }

    debug.warn(`No character data found for ${characterName || 'unknown character'}`);
    return null;
  } catch (error) {
    debug.error(`Error getting character data for ${characterName}:`, error);
    
    // Re-throw with more context if it's a stack overflow
    if (error.message && error.message.includes('Maximum call stack size exceeded')) {
      debug.error('Stack overflow detected in character data processing');
      return null;
    }
    
    return null;
  }
}

/**
 * Update command status in Supabase
 */
async function updateCommandStatus(commandId, status, result = null, errorMessage = null) {
  if (!isSupabaseConfigured()) return;

  try {
    const update = {
      status: status,
      processed_at: new Date().toISOString()
    };

    if (result) {
      update.result = result;
    }

    if (errorMessage) {
      update.error_message = errorMessage;
    }

    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/rollcloud_commands?id=eq.${commandId}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify(update)
      }
    );

    if (!response.ok) {
      debug.warn('Failed to update command status:', response.status);
    }
  } catch (error) {
    debug.error('Error updating command status:', error);
  }
}

/**
 * Store pairing ID for command polling
 */
async function storePairingId(pairingId) {
  await browserAPI.storage.local.set({ discordPairingId: pairingId });
  debug.log('Stored pairing ID:', pairingId);
}

/**
 * Cleanup old Discord commands periodically
 */
async function cleanupDiscordCommands() {
  try {
    if (!isSupabaseConfigured()) {
      debug.log('Skipping command cleanup - Supabase not configured');
      return;
    }

    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/rpc/cleanup_and_maintain_commands`,
      {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (response.ok) {
      const result = await response.json();
      debug.log('🧹 Command cleanup completed:', result);
    } else {
      debug.warn('Failed to run command cleanup:', response.status);
    }
  } catch (error) {
    debug.error('Error during command cleanup:', error);
  }
}

/**
 * Get command health metrics for monitoring
 */
async function getCommandHealthMetrics() {
  try {
    if (!isSupabaseConfigured()) {
      return null;
    }

    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/rpc/get_command_health_metrics`,
      {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (response.ok) {
      const metrics = await response.json();
      debug.log('📊 Command health metrics:', metrics);
      
      // If cleanup is needed, run it
      if (metrics.cleanup_needed && metrics.length > 0) {
        debug.log('🧹 Cleanup needed, running automatic cleanup...');
        await cleanupDiscordCommands();
      }
      
      return metrics[0] || metrics;
    } else {
      debug.warn('Failed to get command health metrics:', response.status);
      return null;
    }
  } catch (error) {
    debug.error('Error getting command health metrics:', error);
    return null;
  }
}

// Set up periodic cleanup (every 15 minutes)
setInterval(async () => {
  try {
    await cleanupDiscordCommands();
  } catch (error) {
    debug.error('Periodic cleanup failed:', error);
  }
}, 15 * 60 * 1000); // 15 minutes

// Set up health check (every 5 minutes)
setInterval(async () => {
  try {
    await getCommandHealthMetrics();
  } catch (error) {
    debug.error('Health check failed:', error);
  }
}, 5 * 60 * 1000); // 5 minutes

// Auto-start command realtime subscription when extension loads and Discord is configured
(async () => {
  try {
    const settings = await browserAPI.storage.local.get(['discordWebhookEnabled', 'discordPairingId', 'discordWebhookUrl']);
    debug.log('🔄 Auto-start check - webhookEnabled:', settings.discordWebhookEnabled, 'pairingId:', settings.discordPairingId ? 'set' : 'not set', 'webhookUrl:', settings.discordWebhookUrl ? 'set' : 'not set');
    
    // Start Discord connection if EITHER webhook is enabled OR we have a pairing ID
    const hasWebhookIntegration = settings.discordWebhookEnabled && settings.discordWebhookUrl;
    const hasPairingIntegration = settings.discordPairingId;
    
    if (hasWebhookIntegration || hasPairingIntegration) {
      debug.log('✅ Discord integration detected, auto-starting command realtime subscription...');
      await subscribeToCommandRealtime(settings.discordPairingId);
    } else {
      debug.log('⏭️ Skipping auto-start - no Discord integration configured (webhook:', hasWebhookIntegration, 'pairing:', hasPairingIntegration);
    }
  } catch (error) {
    debug.warn('Failed to auto-start command realtime:', error);
  }
})();

// ============================================================================
// Turn Posting via Supabase (for Pip Bot to add buttons)
// ============================================================================

/**
 * Post turn data to Supabase for Pip Bot to pick up and post with buttons
 * This enables interactive buttons on Discord messages (webhooks can't do this)
 */
async function postTurnToSupabase(payload) {
  // Check if Supabase is configured
  if (!isSupabaseConfigured()) {
    // Fall back to webhook if Supabase not configured
    debug.log('Supabase not configured, falling back to webhook');
    return await postToDiscordWebhook(payload);
  }

  // Get pairing ID
  const settings = await browserAPI.storage.local.get(['discordPairingId']);
  if (!settings.discordPairingId) {
    debug.warn('No pairing ID, falling back to webhook');
    return await postToDiscordWebhook(payload);
  }

  const { type, characterName, round, actions, initiative } = payload;

  // Map payload type to event type
  const eventTypeMap = {
    turnStart: 'turn_start',
    turnEnd: 'turn_end',
    actionUpdate: 'action_update',
    combatStart: 'combat_start',
    roundChange: 'round_change'
  };

  const eventType = eventTypeMap[type] || type;

  try {
    // Get character data for available actions
    const characterData = await getCharacterData();
    const availableActions = characterData ? extractAvailableActions(characterData) : [];

    const turnData = {
      pairing_id: settings.discordPairingId,
      event_type: eventType,
      character_name: characterName,
      character_id: characterData?.id || null,
      round_number: round || null,
      initiative: initiative || null,
      action_available: actions ? !actions.action : true,
      bonus_available: actions ? !actions.bonus : true,
      movement_available: actions ? !actions.movement : true,
      reaction_available: actions ? !actions.reaction : true,
      available_actions: availableActions,
      status: 'pending'
    };

    const response = await fetch(`${SUPABASE_URL}/rest/v1/rollcloud_turns`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(turnData)
    });

    if (response.ok) {
      debug.log('✅ Turn posted to Supabase for Pip Bot:', eventType);
      return { success: true };
    } else {
      const error = await response.text();
      debug.warn('❌ Failed to post turn to Supabase:', error);
      // Fall back to webhook
      return await postToDiscordWebhook(payload);
    }
  } catch (error) {
    debug.error('❌ Error posting turn to Supabase:', error);
    // Fall back to webhook
    return await postToDiscordWebhook(payload);
  }
}

/**
 * Extract available actions from character data for Discord buttons
 * Returns array of { name, type, roll } objects
 */
function extractAvailableActions(characterData) {
  const actions = [];

  // Extract attacks
  if (characterData.attacks) {
    for (const attack of characterData.attacks) {
      actions.push({
        name: attack.name,
        type: 'action',
        roll: attack.attackBonus ? `1d20+${attack.attackBonus}` : '1d20',
        damage: attack.damage
      });
    }
  }

  // Extract spells (cantrips and prepared)
  if (characterData.spells) {
    for (const spell of characterData.spells) {
      if (spell.prepared || spell.level === 0) {
        actions.push({
          name: spell.name,
          type: spell.level === 0 ? 'cantrip' : 'spell',
          level: spell.level,
          actionType: spell.castingTime?.includes('bonus') ? 'bonus' : 'action'
        });
      }
    }
  }

  // Extract common actions
  actions.push(
    { name: 'Dodge', type: 'action', builtin: true },
    { name: 'Dash', type: 'action', builtin: true },
    { name: 'Disengage', type: 'action', builtin: true },
    { name: 'Help', type: 'action', builtin: true },
    { name: 'Hide', type: 'action', builtin: true, roll: '1d20+stealth' }
  );

  return actions;
}

// ============================================================================
// Native Messaging for Installer Communication
// ============================================================================

let installerPort = null;

/**
 * Connect to installer via native messaging
 */
async function connectToInstaller() {
  try {
    if (installerPort) {
      return installerPort;
    }

    // Try to connect to the installer native messaging host
    installerPort = browserAPI.runtime.connectNative('com.rollcloud.installer');
    
    installerPort.onMessage.addListener((message) => {
      debug.log('Received message from installer:', message);
      handleInstallerMessage(message);
    });
    
    installerPort.onDisconnect.addListener(() => {
      debug.log('Disconnected from installer');
      installerPort = null;
    });

    // Send a ping to test connection
    installerPort.postMessage({ type: 'ping' });
    
    debug.log('✅ Connected to installer via native messaging');
    return installerPort;
  } catch (error) {
    debug.warn('Failed to connect to installer:', error);
    return null;
  }
}

/**
 * Handle messages from installer
 */
function handleInstallerMessage(message) {
  switch (message.type) {
    case 'pong':
      debug.log('✅ Installer is available, requesting pairing code...');
      // After confirming connection, request pairing code
      if (installerPort) {
        installerPort.postMessage({ type: 'getPairingCode' });
      }
      break;

    case 'pairingCode':
      if (message.code) {
        debug.log('📥 Received pairing code from installer:', message.code);
        // Store the pairing code and start the pairing process
        handleInstallerPairingCode(message.code, message.username);
      } else {
        debug.log('No pairing code available from installer (code is null)');
      }
      break;

    default:
      debug.warn('Unknown message type from installer:', message.type);
  }
}

/**
 * Handle pairing code received from installer
 * @param {string} code - The pairing code
 * @param {string} installerUsername - Optional username from installer
 */
async function handleInstallerPairingCode(code, installerUsername = null) {
  try {
    // Store the pairing code
    await browserAPI.storage.local.set({
      installerPairingCode: code,
      pairingSource: 'installer'
    });

    // Get DiceCloud username - prefer installer-provided, fall back to local
    let diceCloudUsername = installerUsername;
    if (!diceCloudUsername) {
      const loginStatus = await checkLoginStatus();
      diceCloudUsername = loginStatus.username || 'DiceCloud User';
    }

    debug.log('📤 Creating Discord pairing with code:', code, 'username:', diceCloudUsername);

    // Create pairing in Supabase
    const result = await createDiscordPairing(code, diceCloudUsername);

    if (result.success) {
      debug.log('✅ Pairing created from installer code');

      // Notify popup that pairing is in progress
      broadcastToPopup({
        action: 'installerPairingStarted',
        code: code
      });
    } else {
      debug.error('Failed to create pairing from installer code:', result.error);
    }
  } catch (error) {
    debug.error('Error handling installer pairing code:', error);
  }
}

/**
 * Broadcast message to popup if it's open
 */
async function broadcastToPopup(message) {
  try {
    // Try to send to popup via runtime message
    await browserAPI.runtime.sendMessage(message);
  } catch (error) {
    // Popup might not be open, that's okay
    debug.log('Popup not available for broadcast');
  }
}

// Auto-connect to installer when extension loads
(async () => {
  setTimeout(async () => {
    await connectToInstaller();
  }, 2000); // Wait 2 seconds for extension to fully initialize
})();
