/**
 * Background Script - Chrome & Firefox Support
 * Handles data storage, API authentication, and communication between Dice Cloud and Roll20
 */

// For Chrome service workers, import debug utility
if (typeof importScripts === 'function' && typeof chrome !== 'undefined') {
  importScripts('src/common/debug.js');
  importScripts('src/lib/supabase-client.js');
}

debug.log('RollCloud: Background script starting...');

// Detect browser and use appropriate API
// For Firefox, use the native Promise-based 'browser' API
// For Chrome, use native 'chrome' API directly (no polyfill needed in service worker)
const browserAPI = (typeof browser !== 'undefined' && browser.runtime) ? browser : chrome;

// Detect which browser we're running on
const isFirefox = typeof browser !== 'undefined';
debug.log('RollCloud: Background script initialized on', isFirefox ? 'Firefox' : 'Chrome');

// Firefox-specific debugging
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
          // Also sync to Supabase if cloud sync is enabled
          if (request.syncToCloud && typeof SupabaseTokenManager !== 'undefined') {
            const supabase = new SupabaseTokenManager();
            await supabase.storeCharacter(request.data, request.pairingCode);
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

        case 'syncCustomMacros': {
          // Sync custom macros to Supabase
          const syncResult = await syncCustomMacrosToSupabase(request.characterId, request.customMacros);
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
            // Start command polling
            startCommandPolling(request.pairingId);
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
          const testResult = await testDiscordWebhook(request.webhookUrl);
          response = testResult;
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
 * Logs in to DiceCloud API with username/password
 * Per DiceCloud API docs: POST https://dicecloud.com/api/login
 * Accepts either username or email with password
 */
async function loginToDiceCloud(username, password) {
  try {
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
    await browserAPI.storage.local.set({
      diceCloudToken: data.token,
      diceCloudUserId: data.id,
      tokenExpires: data.tokenExpires,
      username: username
    });

    debug.log('Successfully logged in to DiceCloud');
    debug.log('Token expires:', data.tokenExpires);
    return data;
  } catch (error) {
    debug.error('Failed to login to DiceCloud:', error);
    throw error;
  }
}

/**
 * Stores the API token (extracted from DiceCloud session or manually entered)
 */
async function setApiToken(token, userId = null, tokenExpires = null, username = null) {
  try {
    // Validate token format (basic check)
    if (!token || token.length < 10) {
      throw new Error('Invalid API token format');
    }

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

    await browserAPI.storage.local.set(storageData);

    // Clear the explicitly logged out flag since user is now logging in
    await browserAPI.storage.local.remove('explicitlyLoggedOut');

    debug.log('Successfully stored API token');
    return { success: true };
  } catch (error) {
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

    if (!result.diceCloudToken) {
      return null;
    }

    // Check if token is expired (only if tokenExpires exists - API tokens don't expire)
    if (result.tokenExpires) {
      const expiryDate = new Date(result.tokenExpires);
      const now = new Date();
      if (now >= expiryDate) {
        debug.warn('API token has expired');
        await logout();
        return null;
      }
    }

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

    if (!result.diceCloudToken) {
      return { loggedIn: false };
    }

    // Check if token is expired (only if tokenExpires exists - API tokens don't expire)
    if (result.tokenExpires) {
      const expiryDate = new Date(result.tokenExpires);
      const now = new Date();
      if (now >= expiryDate) {
        debug.warn('Session expired - please login again');
        await logout();
        return { loggedIn: false };
      }
    }

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
    // Set flag first to prevent autoRefreshToken from re-saving the token
    await browserAPI.storage.local.set({ explicitlyLoggedOut: true });
    await browserAPI.storage.local.remove(['diceCloudToken', 'diceCloudUserId', 'tokenExpires', 'username']);
    debug.log('Logged out successfully');
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
    // CRITICAL: Preserve the exact data structure from DiceCloud
    // Do NOT transform field names - this breaks consistency with database storage
    
    // Use slotId if provided, otherwise fall back to character ID from the data
    const storageId = slotId || characterData.id || characterData._id || 'default';

    // Get existing profiles
    const result = await browserAPI.storage.local.get(['characterProfiles', 'activeCharacterId']);
    const characterProfiles = result.characterProfiles || {};

    // Store this character's data EXACTLY as received
    characterProfiles[storageId] = characterData;

    // Only update activeCharacterId if slotId was explicitly provided
    // This prevents the "default" storage from overriding a specific slot selection
    const updates = {
      characterProfiles: characterProfiles,
      timestamp: Date.now()
    };

    // If slotId was explicitly provided, set it as active
    // If no slotId was provided but there's no active character, set this as active
    if (slotId || !result.activeCharacterId) {
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

    // If specific character ID requested, return it
    if (characterId) {
      return characterProfiles[characterId] || null;
    }

    // Otherwise return active character
    const activeCharacterId = result.activeCharacterId;
    if (activeCharacterId && characterProfiles[activeCharacterId]) {
      debug.log('Retrieved active character data:', characterProfiles[activeCharacterId]);
      return characterProfiles[activeCharacterId];
    }

    // Fallback: return first available character
    const characterIds = Object.keys(characterProfiles);
    if (characterIds.length > 0) {
      debug.log('No active character, returning first available:', characterProfiles[characterIds[0]]);
      return characterProfiles[characterIds[0]];
    }

    return null;
  } catch (error) {
    debug.error('Failed to retrieve character data:', error);
    throw error;
  }
}

/**
 * Gets all character profiles from both local storage and database
 */
async function getAllCharacterProfiles() {
  try {
    // Get local profiles first
    const localResult = await browserAPI.storage.local.get(['characterProfiles']);
    const localProfiles = localResult.characterProfiles || {};
    
    // Try to get database characters if SupabaseTokenManager is available
    let databaseCharacters = {};
    try {
      if (typeof SupabaseTokenManager !== 'undefined') {
        const supabase = new SupabaseTokenManager();
        
        // Get current user's DiceCloud ID from auth tokens
        const tokenResult = await supabase.retrieveToken();
        if (tokenResult.success && tokenResult.userId) {
          debug.log('🌐 Fetching database characters for DiceCloud user:', tokenResult.userId);
          
          // Get all characters for this user from database
          const response = await fetch(
            `${supabase.supabaseUrl}/rest/v1/rollcloud_characters?user_id_dicecloud=eq.${tokenResult.userId}&select=*`,
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
    
    // Merge local and database profiles
    const mergedProfiles = { ...localProfiles, ...databaseCharacters };
    
    debug.log('📋 Character profiles loaded:', {
      local: Object.keys(localProfiles).length,
      database: Object.keys(databaseCharacters).length,
      total: Object.keys(mergedProfiles).length
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
    const response = await fetch(
      `${supabase.supabaseUrl}/rest/v1/rollcloud_characters?dicecloud_character_id=eq.${characterId}&select=*`,
      {
        headers: {
          'apikey': supabase.supabaseKey,
          'Authorization': `Bearer ${supabase.supabaseKey}`
        }
      }
    );
    
    if (!response.ok) {
      throw new Error(`Failed to fetch database character: ${response.status}`);
    }
    
    const characters = await response.json();
    if (characters.length === 0) {
      throw new Error('Character not found in database');
    }
    
    const dbCharacter = characters[0];

    // If raw_dicecloud_data contains the full character object, use it directly
    // This preserves all parsed data (spells, features, actions, etc.) exactly as synced
    if (dbCharacter.raw_dicecloud_data && typeof dbCharacter.raw_dicecloud_data === 'object') {
      const fullCharacter = dbCharacter.raw_dicecloud_data;
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
      // Add custom macros from database if they exist
      if (dbCharacter.custom_macros) {
        fullCharacter.customMacros = dbCharacter.custom_macros;
      }
      debug.log('✅ Loaded full character from database raw_dicecloud_data:', fullCharacter.name);
      return fullCharacter;
    }

    // Fallback: Return database record with minimal transformation
    // This should rarely be used since raw_dicecloud_data should always be present
    debug.log('⚠️ No raw_dicecloud_data found, using database fields directly');
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
      customMacros: dbCharacter.custom_macros || {}, // Include custom macros from database
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
    await browserAPI.storage.local.set({
      activeCharacterId: characterId
    });
    debug.log(`Active character set to: ${characterId}`);

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
      // Clear all characters
      await browserAPI.storage.local.remove(['characterProfiles', 'activeCharacterId', 'timestamp']);
      debug.log('All character data cleared successfully');
    }
  } catch (error) {
    debug.error('Failed to clear character data:', error);
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
      debug.warn('No Roll20 tabs found');
      return;
    }

    // Send roll to each Roll20 tab
    const promises = tabs.map(tab => {
      return browserAPI.tabs.sendMessage(tab.id, {
        action: 'postRollToChat',
        roll: rollData
      });
    });

    await Promise.all(promises);
    debug.log(`Roll sent to ${tabs.length} Roll20 tab(s)`);
  } catch (error) {
    debug.error('Failed to send roll to Roll20 tabs:', error);
    throw error;
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
    
  } else if (details.reason === 'update') {
    debug.log('Extension updated to version', browserAPI.runtime.getManifest().version);
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
        color: 0x4ECDC4, // Teal color matching the extension theme
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
        color: 0x4ECDC4, // Teal - active turn
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
        color: hasUsedActions ? 0xF39C12 : 0x4ECDC4, // Orange if actions used, teal if available
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
    const browserFingerprint = [
      navigator.userAgent,
      navigator.language,
      screen.width + 'x' + screen.height,
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

    // Build update payload with all available Discord fields
    const updatePayload = {
      discord_user_id: discordUserId,
      updated_at: new Date().toISOString()
    };
    if (discordUsername) {
      updatePayload.discord_username = discordUsername;
    }
    if (discordGlobalName) {
      updatePayload.discord_global_name = discordGlobalName;
    }

    // Update auth_tokens with Discord info
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/auth_tokens?user_id=eq.${visitorId}`,
      {
        method: 'PATCH',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify(updatePayload)
      }
    );

    if (response.ok) {
      debug.log('✅ Discord user linked to auth_tokens');

      // Also update any existing characters with this user's DiceCloud ID
      const authResult = await browserAPI.storage.local.get(['diceCloudUserId']);
      if (authResult.diceCloudUserId) {
        await linkDiscordUserToCharacters(discordUserId, authResult.diceCloudUserId);
      }

      return { success: true };
    } else {
      const errorText = await response.text();
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
    const browserFingerprint = [
      navigator.userAgent,
      navigator.language,
      screen.width + 'x' + screen.height,
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
    let dicecloudUserId = characterData.dicecloudUserId || characterData.userId || null;
    if (!dicecloudUserId) {
      const stored = await browserAPI.storage.local.get(['diceCloudUserId']);
      dicecloudUserId = stored.diceCloudUserId || null;
      if (dicecloudUserId) {
        debug.log('✅ Got DiceCloud user ID from storage:', dicecloudUserId);
      }
    }

    const payload = {
      user_id_dicecloud: dicecloudUserId,
      dicecloud_character_id: characterData.id,
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
      armor_class: characterData.armorClass || 10,
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
      // Store the FULL parsed character object so it can be rebuilt exactly
      // The individual fields above are for Discord bot quick access
      raw_dicecloud_data: characterData,
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
          payload.pairing_id = pairings[0].id;
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
            `${SUPABASE_URL}/rest/v1/rollcloud_pairings?dicecloud_user_id=eq.${payload.user_id_dicecloud}&status=eq.connected&select=discord_user_id,discord_username,discord_global_name`,
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
              debug.log('✅ Found Discord user ID from pairings:', discordUserId);
              // Also update auth_tokens so future lookups are faster
              await linkDiscordUserToAuthTokens(
                discordUserId,
                pairings[0].discord_username,
                pairings[0].discord_global_name
              );
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
                discordUserId = pairings[0].discord_user_id;
                debug.log('✅ Found Discord user ID from stored pairing:', discordUserId);
                // Also update auth_tokens with all Discord info
                await linkDiscordUserToAuthTokens(
                  discordUserId,
                  pairings[0].discord_username,
                  pairings[0].discord_global_name
                );
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

    // Try POST first (insert)
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
 * Sync custom macros to Supabase
 * Updates only the custom_macros field for a specific character
 */
async function syncCustomMacrosToSupabase(characterId, customMacros) {
  if (!isSupabaseConfigured()) {
    debug.warn('Supabase not configured - custom macros sync unavailable');
    return {
      success: false,
      error: 'Custom macros sync not available. Supabase not configured.',
      supabaseNotConfigured: true
    };
  }

  try {
    debug.log('⚙️ Syncing custom macros to Supabase:', characterId, Object.keys(customMacros));

    // Update only the custom_macros field
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
          custom_macros: customMacros
        })
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      debug.error('❌ Failed to sync custom macros to Supabase:', response.status, errorText);
      return { success: false, error: `Sync failed: ${response.status}` };
    }

    debug.log('✅ Custom macros synced to Supabase successfully');
    return { success: true };
  } catch (error) {
    debug.error('❌ Failed to sync custom macros to Supabase:', error);
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

    if (characterData && activeCharacterName === characterName) {
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

// Supabase configuration - set these to enable automatic pairing
// If not configured, users can still use manual webhook URL entry
const SUPABASE_URL = 'https://gkfpxwvmumaylahtxqrk.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdrZnB4d3ZtdW1heWxhaHR4cXJrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ0NDA4MDIsImV4cCI6MjA4MDAxNjgwMn0.P4a17PQ7i1ZgUvLnFdQGupOtKxx8-CWvPhIaFOl2i7g';

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

              // Start command polling
              startCommandPolling(record.id);
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

// ============================================================================
// Discord Command Polling (Discord → Extension → Roll20)
// ============================================================================

let commandPollInterval = null;
let currentPairingId = null;
const COMMAND_POLL_INTERVAL_MS = 2000; // Poll every 2 seconds

/**
 * Start polling for Discord commands
 * Called when webhook is connected and user is in Roll20
 */
async function startCommandPolling(pairingId) {
  if (commandPollInterval) {
    debug.log('Command polling already active');
    return;
  }

  if (!pairingId) {
    // Try to get pairing ID from storage
    const settings = await browserAPI.storage.local.get(['discordPairingId']);
    pairingId = settings.discordPairingId;
  }

  if (!pairingId) {
    debug.warn('No pairing ID available for command polling');
    return;
  }

  currentPairingId = pairingId;
  debug.log('🎧 Starting Discord command polling for pairing:', pairingId);

  // Poll immediately, then set interval
  await pollForCommands();
  commandPollInterval = setInterval(pollForCommands, COMMAND_POLL_INTERVAL_MS);
}

/**
 * Stop polling for Discord commands
 */
function stopCommandPolling() {
  if (commandPollInterval) {
    clearInterval(commandPollInterval);
    commandPollInterval = null;
    debug.log('🔇 Stopped Discord command polling');
  }
}

/**
 * Poll Supabase for pending commands
 */
async function pollForCommands() {
  if (!isSupabaseConfigured() || !currentPairingId) {
    return;
  }

  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/rollcloud_commands?pairing_id=eq.${currentPairingId}&status=eq.pending&order=created_at.asc&limit=5`,
      {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
        }
      }
    );

    if (!response.ok) {
      debug.warn('Failed to poll for commands:', response.status);
      return;
    }

    const commands = await response.json();

    if (commands.length > 0) {
      debug.log(`📥 Received ${commands.length} command(s) from Discord`);

      for (const command of commands) {
        await executeCommand(command);
      }
    }
  } catch (error) {
    debug.error('Command poll error:', error);
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
    modifier: command_data.modifier
  };

  // Send to Roll20
  await sendRollToAllRoll20Tabs(rollData);

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

// Auto-start polling when extension loads and webhook is configured
(async () => {
  try {
    const settings = await browserAPI.storage.local.get(['discordWebhookEnabled', 'discordPairingId']);
    if (settings.discordWebhookEnabled && settings.discordPairingId) {
      debug.log('Auto-starting command polling...');
      await startCommandPolling(settings.discordPairingId);
    }
  } catch (error) {
    debug.warn('Failed to auto-start command polling:', error);
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
