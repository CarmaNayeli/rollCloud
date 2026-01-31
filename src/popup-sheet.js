debug.log('✅ Popup HTML loaded');

// Note: Edge case modules and action-executor.js are loaded as regular scripts before this script.
// They export their functions to globalThis, making them globally available without needing to import.
// Functions like isEdgeCase, getEdgeCase, resolveSpellCast, etc. are already available globally.

// Initialize theme manager
if (typeof ThemeManager !== 'undefined') {
  ThemeManager.init().then(() => {
    debug.log('🎨 Theme system initialized');

    // Set up theme button click handlers
    // Note: Don't wrap in DOMContentLoaded since this script runs after the DOM is loaded
    const themeButtons = document.querySelectorAll('.theme-btn');
    themeButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const theme = btn.dataset.theme;
        ThemeManager.setTheme(theme);

        // Update active state
        themeButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    // Set initial active button based on current theme
    const currentTheme = ThemeManager.getCurrentTheme();
    const activeBtn = document.querySelector(`[data-theme="${currentTheme}"]`);
    if (activeBtn) {
      themeButtons.forEach(b => b.classList.remove('active'));
      activeBtn.classList.add('active');
    }
  });
} else {
  debug.warn('⚠️ ThemeManager not available');
}

// Store character data globally so we can update it
// Using 'var' instead of 'let' to ensure global scope accessibility for modules
var characterData = null;

// Track current character slot ID (e.g., "slot-1") for persistence
var currentSlotId = null;


// Note: activeBuffs and activeConditions are now in effects-manager.js

// Track Feline Agility usage
var felineAgilityUsed = false;

// Setting: Show custom macro gear buttons on spells (disabled by default)
let showCustomMacroButtons = false;

// Track if DOM is ready
let domReady = false;

// Queue for operations waiting for DOM
let pendingOperations = [];


// Listen for character data from parent window via postMessage
window.addEventListener('message', async (event) => {
  debug.log('✅ Received message in popup:', event.data);

  if (event.data && event.data.action === 'initCharacterSheet') {
    debug.log('✅ Initializing character sheet with data:', event.data.data.name);
    
    // Check if this is opened from GM panel (read-only mode)
    const isFromGMPanel = event.data.source === 'gm-panel';
    if (isFromGMPanel) {
      debug.log('👑 Popup opened from GM panel - hiding GM controls');
      hideGMControls();

      // Initialize action economy as disabled until we receive activateTurn message
      // (combat might already be active when sheet is opened)
      setTimeout(() => {
        deactivateTurn();
        debug.log('⏸️ Action economy initialized as disabled (combat may be active)');
      }, 100);
    }
    
    // Function to initialize the sheet
    const initSheet = async () => {
      characterData = event.data.data;  // Store globally

      // Validate that character data has required arrays (spells and actions)
      const hasSpells = Array.isArray(characterData.spells);
      const hasActions = Array.isArray(characterData.actions);

      if (!hasSpells || !hasActions) {
        debug.warn('⚠️ Character data from initCharacterSheet is incomplete');
        debug.warn(`Missing data: spells=${!hasSpells}, actions=${!hasActions}`);
        showNotification('⚠️ Character data incomplete. Please resync from DiceCloud.', 'error');
        return;
      }

      // Get and store current slot ID for persistence
      currentSlotId = await getActiveCharacterId();
      debug.log('📋 Current slot ID set to:', currentSlotId);

      // Build tabs first (need to load profiles from storage)
      await loadAndBuildTabs();

      // Then build the sheet with character data
      buildSheet(characterData);
      
      // Initialize racial traits based on character data
      initRacialTraits();

      // Initialize feat traits based on character data
      initFeatTraits();

      // Initialize class features based on character data
      initClassFeatures();

      // Restore concentration state from saved data
      if (characterData.concentrationSpell) {
        // Directly set the global variable and update display
        concentratingSpell = characterData.concentrationSpell;
        if (typeof updateConcentrationDisplay === 'function') {
          updateConcentrationDisplay();
        }
        debug.log(`🧠 Restored concentration: ${characterData.concentrationSpell}`);
      }

      // Initialize character cache with current data
      if (characterData && characterData.id) {
        characterCache.set(characterData.id, JSON.parse(JSON.stringify(characterData)));
        debug.log(`📂 Initialized cache for character: ${characterData.name}`);
      }

      // Register this character with GM Initiative Tracker (if it exists)
      // Use postMessage to avoid CORS issues - send character name only
      if (window.opener) {
        window.opener.postMessage({
          action: 'registerPopup',
          characterName: event.data.data.name
        }, '*');
        debug.log(`✅ Sent registration message for: ${event.data.data.name}`);
        
        // Check if it's currently this character's turn by reading recent chat
        // Add a small delay to ensure combat system has processed start of combat
        setTimeout(() => {
          checkCurrentTurnFromChat(event.data.data.name);
        }, 500);
      } else {
        debug.warn(`⚠️ No window.opener available for: ${event.data.data.name}`);
      }
    };

    // Only initialize if DOM is ready, otherwise queue it
    if (domReady) {
      await initSheet();
    } else {
      debug.log('⏳ DOM not ready yet, queuing initialization...');
      pendingOperations.push(initSheet);
    }
  } else if (event.data && event.data.action === 'loadCharacterData') {
    debug.log('📋 Loading character data from GM panel:', event.data.characterData.name);
    
    // This is from GM panel - hide GM controls
    hideGMControls();
    
    // Load the character data using the same initialization process
    characterData = event.data.characterData;

    // Validate that character data has required arrays (spells and actions)
    const hasSpells = Array.isArray(characterData.spells);
    const hasActions = Array.isArray(characterData.actions);

    if (!hasSpells || !hasActions) {
      debug.warn('⚠️ Shared character data is incomplete');
      debug.warn(`Missing data: spells=${!hasSpells}, actions=${!hasActions}`);
      showNotification('⚠️ Shared character data incomplete. Player needs to resync from DiceCloud.', 'error');
      return;
    }

    // Function to initialize the sheet with GM panel data
    const initSheetFromGM = async () => {
      // DO NOT load tabs for shared characters - show only this character
      // Skip loadAndBuildTabs() to prevent mixing with GM's own characters

      // Hide the character tabs container since this is a standalone sheet
      const tabsContainer = document.getElementById('character-tabs');
      if (tabsContainer) {
        tabsContainer.style.display = 'none';
        debug.log('🔒 Hidden character tabs for standalone GM view');
      }

      // Build the sheet directly with character data
      buildSheet(characterData);

      // Initialize racial traits based on character data
      initRacialTraits();

      // Initialize feat traits based on character data
      initFeatTraits();

      // Initialize class features based on character data
      initClassFeatures();

      // Restore concentration state from saved data
      if (characterData.concentrationSpell) {
        // Directly set the global variable and update display
        concentratingSpell = characterData.concentrationSpell;
        if (typeof updateConcentrationDisplay === 'function') {
          updateConcentrationDisplay();
        }
        debug.log(`🧠 Restored concentration: ${characterData.concentrationSpell}`);
      }

      // Initialize character cache with current data
      if (characterData && characterData.id) {
        characterCache.set(characterData.id, JSON.parse(JSON.stringify(characterData)));
        debug.log(`📂 Initialized cache for character: ${characterData.name}`);
      }

      // Register this popup with GM Initiative Tracker for turn notifications
      if (window.opener) {
        window.opener.postMessage({
          action: 'registerPopup',
          characterName: characterData.name
        }, '*');
        debug.log(`✅ Sent registration message for: ${characterData.name}`);

        // Check if it's currently this character's turn
        setTimeout(() => {
          if (window.opener && !window.opener.closed) {
            window.opener.postMessage({
              action: 'checkCurrentTurn',
              characterName: characterData.name
            }, '*');
            debug.log(`🎯 Checking current turn for: ${characterData.name}`);
          }
        }, 500);
      } else {
        debug.warn(`⚠️ No window.opener available for: ${characterData.name}`);
      }
    };

    // Only initialize if DOM is ready, otherwise queue it
    if (domReady) {
      await initSheetFromGM();
    } else {
      debug.log('⏳ DOM not ready yet, queuing GM panel initialization...');
      pendingOperations.push(initSheetFromGM);
    }
  } else if (event.data && event.data.action === 'requestStatusData') {
    // Status bar is requesting current character status
    debug.log('📊 Status bar requesting data');
    sendStatusUpdate(event.source);
  }
});

// Tell parent window we're ready - wait for DOM to be fully loaded
// This prevents race conditions in Firefox
function notifyParentReady() {
  try {
    if (window.opener && !window.opener.closed) {
      debug.log('✅ Sending ready message to parent window...');
      window.opener.postMessage({ action: 'popupReady' }, '*');
    } else {
      debug.warn('⚠️ No parent window available, waiting for postMessage...');
    }
  } catch (error) {
    debug.warn('⚠️ Could not notify parent (this is normal):', error.message);
  }
}

// Wait for DOM to be ready before doing anything
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', async () => {
    debug.log('✅ DOM is ready');
    domReady = true;
    
    // Send ready message to parent
    notifyParentReady();
    
    // Execute any pending operations
    for (const operation of pendingOperations) {
      await operation();
    }
    pendingOperations = [];
  });
} else {
  // DOM is already ready
  debug.log('✅ DOM already ready');
  domReady = true;
  notifyParentReady();
}

debug.log('✅ Waiting for character data via postMessage...');

// Fallback: If we don't receive data via postMessage within 1.5 seconds,
// load directly from storage (Firefox sometimes blocks postMessage between windows)
setTimeout(() => {
  if (!characterData && domReady) {
    debug.log('⏱️ No data received via postMessage, loading from storage...');
    loadCharacterWithTabs();
  } else if (!characterData && !domReady) {
    debug.log('⏳ DOM not ready yet, will retry fallback...');
    setTimeout(() => {
      if (!characterData) {
        debug.log('⏱️ Retry: Loading from storage...');
        loadCharacterWithTabs();
      }
    }, 500);
  }
}, 1500);

// Global timeout: If we still don't have character data after 10 seconds, show error
setTimeout(() => {
  if (!characterData) {
    debug.warn('⏰ Loading timeout - no character data after 10 seconds');
    showLoadingError();
  }
}, 10000);

// Show loading error with try again button
function showLoadingError() {
  const loadingOverlay = document.getElementById('loading-overlay');
  if (!loadingOverlay) return;

  loadingOverlay.innerHTML = `
    <div style="text-align: center; color: var(--text-primary); max-width: 450px; padding: 20px;">
      <div style="font-size: 4em; margin-bottom: 20px;">⚠️</div>
      <div style="font-size: 1.3em; font-weight: bold; margin-bottom: 15px; color: var(--accent-danger);">
        No Valid Character Data Found
      </div>
      <div style="font-size: 0.95em; color: var(--text-secondary); line-height: 1.6; margin-bottom: 25px;">
        No character data could be loaded. This might happen if you haven't synced a character yet, or if the character data is outdated.
      </div>
      <div style="background: var(--background-secondary); padding: 20px; border-radius: 8px; margin-bottom: 25px; border-left: 4px solid var(--accent-info);">
        <p style="margin: 0 0 12px 0; font-weight: bold; color: var(--text-primary); font-size: 0.95em;">To fix this:</p>
        <ol style="text-align: left; margin: 0; padding-left: 20px; line-height: 1.8; font-size: 0.9em; color: var(--text-secondary);">
          <li>Use the <strong>Refresh Characters</strong> button in the extension popup</li>
          <li>Or visit your character on <a href="https://dicecloud.com" target="_blank" style="color: var(--accent-info);">DiceCloud.com</a> and click <strong>Sync to Extension</strong></li>
        </ol>
      </div>
      <button id="try-again-btn" style="
        padding: 14px 28px;
        background: linear-gradient(135deg, var(--accent-info) 0%, #2980b9 100%);
        color: white;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        font-weight: bold;
        font-size: 1em;
        box-shadow: 0 2px 8px rgba(52, 152, 219, 0.3);
        transition: transform 0.2s, box-shadow 0.2s;
      " onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 4px 12px rgba(52, 152, 219, 0.4)';" onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 2px 8px rgba(52, 152, 219, 0.3)';">
        🔄 Try Again
      </button>
    </div>
  `;

  // Add click handler to try again button
  const tryAgainBtn = document.getElementById('try-again-btn');
  if (tryAgainBtn) {
    tryAgainBtn.addEventListener('click', () => {
      debug.log('🔄 Try again button clicked - reloading character data...');

      // Reset the loading overlay to show loading state
      loadingOverlay.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: center; width: 80px; height: 80px; margin: 0 auto 20px;">
          <div style="width: 100%; height: 100%; border: 4px solid var(--border-subtle); border-top: 4px solid var(--accent-primary); border-radius: 50%; animation: spin 1s linear infinite;"></div>
        </div>
        <div style="text-align: center; color: var(--text-primary);">
          <div style="font-size: 1.2em; font-weight: bold; margin-bottom: 10px;">
            Loading Characters...
          </div>
          <div style="font-size: 0.9em; color: var(--text-secondary); max-width: 300px; line-height: 1.4;">
            Attempting to reload character data...
          </div>
        </div>
      `;

      // Reset characterData and try loading again
      characterData = null;
      loadCharacterWithTabs();

      // Set another timeout in case it fails again
      setTimeout(() => {
        if (!characterData) {
          debug.warn('⏰ Retry timeout - still no character data');
          showLoadingError();
        }
      }, 10000);
    });
  }
}

// Load profiles and build tabs (without building sheet)
async function loadAndBuildTabs() {
  try {
    debug.log('📋 Loading character profiles for tabs...');

    // Get all character profiles
    const profilesResponse = await browserAPI.runtime.sendMessage({ action: 'getAllCharacterProfiles' });
    const profiles = profilesResponse.success ? profilesResponse.profiles : {};
    debug.log('📋 Profiles loaded:', Object.keys(profiles));

    // Get active character ID (this is the slotId like "slot-1")
    const activeCharacterId = await getActiveCharacterId();
    debug.log('📋 Active character ID:', activeCharacterId);

    // Build character tabs
    buildCharacterTabs(profiles, activeCharacterId);
  } catch (error) {
    debug.error('❌ Failed to load and build tabs:', error);
  }
}

// Load character data and build tabs
async function loadCharacterWithTabs() {
  // Wait for DOM to be ready
  if (!domReady) {
    debug.log('⏳ DOM not ready, queuing loadCharacterWithTabs...');
    pendingOperations.push(loadCharacterWithTabs);
    return;
  }

  try {
    // Build tabs first
    await loadAndBuildTabs();

    // Get and store current slot ID for persistence
    currentSlotId = await getActiveCharacterId();
    debug.log('📋 Current slot ID set to:', currentSlotId);

    // Get active character data
    let activeCharacter = null;
    
    // Check if this is a database character
    if (currentSlotId && currentSlotId.startsWith('db-')) {
      // Load from database
      const characterId = currentSlotId.replace('db-', '');
      try {
        const dbResponse = await browserAPI.runtime.sendMessage({ 
          action: 'getCharacterDataFromDatabase', 
          characterId: characterId 
        });
        if (dbResponse.success) {
          activeCharacter = dbResponse.data;
          debug.log('✅ Loaded character from database:', activeCharacter.name);
        }
      } catch (dbError) {
        debug.warn('⚠️ Failed to load database character:', dbError);
      }
    } else {
      // Load from local storage
      const activeResponse = await browserAPI.runtime.sendMessage({ action: 'getCharacterData' });
      activeCharacter = activeResponse.success ? activeResponse.data : null;
    }

    // Load active character
    if (activeCharacter) {
      characterData = activeCharacter;

      // Validate that character data has required arrays (spells and actions)
      const hasSpells = Array.isArray(characterData.spells);
      const hasActions = Array.isArray(characterData.actions);

      if (!hasSpells || !hasActions) {
        debug.warn('⚠️ Character data is incomplete or outdated');
        debug.warn(`Missing data: spells=${!hasSpells}, actions=${!hasActions}`);

        // Show error message to user
        const characterName = characterData.name || characterData.character_name || 'this character';
        const missingData = [];
        if (!hasSpells) missingData.push('spells');
        if (!hasActions) missingData.push('actions');

        const errorContainer = document.getElementById('main-content');
        if (errorContainer) {
          errorContainer.innerHTML = `
            <div style="padding: 40px; text-align: center; color: var(--text-primary);">
              <h2 style="color: #e74c3c; margin-bottom: 20px;">⚠️ Incomplete Character Data</h2>
              <p style="margin-bottom: 15px; font-size: 1.1em;">
                The character data for <strong>${characterName}</strong> is missing ${missingData.join(' and ')}.
              </p>
              <p style="margin-bottom: 15px; color: var(--text-secondary);">
                This usually happens when loading old cloud data that was saved before spells and actions were synced.
              </p>
              <div style="background: #2c3e50; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <p style="margin-bottom: 10px; font-weight: bold;">To fix this:</p>
                <ol style="text-align: left; max-width: 500px; margin: 0 auto; line-height: 1.8;">
                  <li>Go to your character on <a href="https://dicecloud.com" target="_blank" style="color: #FC57F9;">DiceCloud.com</a></li>
                  <li>Click the <strong>"Sync to Extension"</strong> button on the character page</li>
                  <li>Wait for the sync to complete</li>
                  <li>Reopen this character sheet</li>
                </ol>
              </div>
              <p style="color: var(--text-secondary); font-size: 0.9em;">
                Character ID: ${characterData.id || characterData.dicecloud_character_id || 'unknown'}
              </p>
            </div>
          `;
        }

        // Don't continue loading the incomplete character
        return;
      }

      buildSheet(characterData);

      // Initialize racial traits based on character data
      initRacialTraits();

      // Initialize feat traits based on character data
      initFeatTraits();

      // Initialize class features based on character data
      initClassFeatures();
    } else {
      debug.error('❌ No character data found');
      // Hide loading overlay even if no character data
      const loadingOverlay = document.getElementById('loading-overlay');
      if (loadingOverlay) {
        loadingOverlay.innerHTML = `
          <div style="text-align: center; color: var(--text-primary); max-width: 400px;">
            <div style="font-size: 3em; margin-bottom: 20px;">📋</div>
            <div style="font-size: 1.2em; font-weight: bold; margin-bottom: 10px;">
              No Character Found
            </div>
            <div style="font-size: 0.9em; color: var(--text-secondary); line-height: 1.4;">
              Use the <strong>Refresh Characters</strong> button in the extension popup to sync your characters from DiceCloud
            </div>
          </div>
        `;
      }
    }
  } catch (error) {
    debug.error('❌ Failed to load characters:', error);
    // Hide loading overlay and show error
    const loadingOverlay = document.getElementById('loading-overlay');
    if (loadingOverlay) {
      loadingOverlay.innerHTML = `
        <div style="text-align: center; color: var(--text-primary); max-width: 400px;">
          <div style="font-size: 3em; margin-bottom: 20px;">⚠️</div>
          <div style="font-size: 1.2em; font-weight: bold; margin-bottom: 10px;">
            Failed to Load Character
          </div>
          <div style="font-size: 0.9em; color: var(--text-secondary); line-height: 1.4; margin-bottom: 15px;">
            ${error.message || 'Unknown error'}
          </div>
          <div style="font-size: 0.9em; color: var(--text-secondary); line-height: 1.4;">
            Try using the <strong>Refresh Characters</strong> button in the extension popup
          </div>
        </div>
      `;
    }
  }
}

// Get the active character ID from storage
async function getActiveCharacterId() {
  // Use Promise-based API (works in both Chrome and Firefox with our polyfill)
  const result = await browserAPI.storage.local.get(['activeCharacterId']);
  return result.activeCharacterId || null;
}

// Build character tabs UI
/**
 * Check recent chat messages to see if it's currently this character's turn
 * This handles the case where a character tab is switched after turn notifications were sent
 */
function checkCurrentTurnFromChat(characterName) {
  try {
    if (!window.opener) {
      debug.warn('⚠️ No window.opener available for turn check');
      return;
    }

    // Request recent chat messages from parent window
    window.opener.postMessage({
      action: 'checkCurrentTurn',
      characterName: characterName
    }, '*');
    
    debug.log(`🔍 Requested turn check for: ${characterName}`);
  } catch (error) {
    debug.warn('⚠️ Error checking current turn:', error);
  }
}

// Switch to a different character
async function switchToCharacter(characterId) {
  try {
    debug.log(`🔄 Switching to character: ${characterId}`);

    // Save current character data before switching to preserve local state
    // CRITICAL: Save to BOTH cache AND browser storage to persist through refresh
    if (characterData && currentSlotId && currentSlotId !== characterId) {
      debug.log('💾 Saving current character data before switching');
      const dataToSave = JSON.parse(JSON.stringify(characterData));
      
      // Save to cache for immediate access
      if (typeof characterCache !== 'undefined') {
        characterCache.set(currentSlotId, dataToSave);
        debug.log(`✅ Cached current character data: ${characterData.name}`);
      }

      // Save to browser storage (persists through refresh/close) WITH slotId
      await browserAPI.runtime.sendMessage({
        action: 'storeCharacterData',
        data: dataToSave,
        slotId: currentSlotId
      });
      debug.log(`✅ Saved current character data to storage: ${characterData.name}`);
    }

    // Set as active character
    await setActiveCharacter(characterId);
    currentSlotId = characterId;

    // Load the new character data
    let newCharacterData = null;
    
    // Check if this is a database character
    if (characterId.startsWith('db-')) {
      // Load from database
      const dbCharacterId = characterId.replace('db-', '');
      try {
        const dbResponse = await browserAPI.runtime.sendMessage({ 
          action: 'getCharacterDataFromDatabase', 
          characterId: dbCharacterId 
        });
        if (dbResponse.success) {
          newCharacterData = dbResponse.data;
          debug.log('✅ Loaded database character:', newCharacterData.name);
          showNotification(`☁️ Loaded ${newCharacterData.name} from cloud`, 'info');
        } else {
          throw new Error(dbResponse.error || 'Failed to load database character');
        }
      } catch (dbError) {
        debug.error('❌ Failed to load database character:', dbError);
        showNotification('❌ Failed to load character from database', 'error');
        return;
      }
    } else {
      // Load from local storage
      const response = await browserAPI.runtime.sendMessage({
        action: 'getCharacterData',
        characterId: characterId
      });

      if (response.success) {
        newCharacterData = response.data;
        debug.log('✅ Loaded local character:', newCharacterData.name);
        showNotification(`💾 Loaded ${newCharacterData.name} from local storage`, 'success');
      } else {
        throw new Error(response.error || 'Failed to load local character');
      }
    }

    if (newCharacterData) {
      characterData = newCharacterData;
      
      // Cache the loaded character data
      if (typeof characterCache !== 'undefined') {
        characterCache.set(characterId, characterData);
      }

      // Build the character sheet
      buildSheet(characterData);
      
      // Initialize racial traits based on character data
      initRacialTraits();

      // Initialize feat traits based on character data
      initFeatTraits();

      // Initialize class features based on character data
      initClassFeatures();

      // Send sync message to DiceCloud if experimental sync is available
      // Always send sync messages in experimental build - they'll be handled by Roll20 content script
      debug.log('🔄 Sending character data update to DiceCloud sync...');

      // Extract Channel Divinity from resources if it exists
      const channelDivinityResource = characterData.resources?.find(r =>
        r.name && r.name.toLowerCase().includes('channel divinity')
      );

      const syncMessage = {
        action: 'characterUpdate',
        characterId: characterData.id,
        characterName: characterData.name,
        hitPoints: characterData.hitPoints,
        temporaryHP: characterData.temporaryHP,
        spellSlots: characterData.spellSlots,
        channelDivinity: channelDivinityResource ? {
          current: channelDivinityResource.current,
          max: channelDivinityResource.max,
          variableName: channelDivinityResource.variableName || channelDivinityResource.varName
        } : null,
        resources: characterData.resources || [],
        actions: characterData.actions || [],
        deathSaves: characterData.deathSaves,
        inspiration: characterData.inspiration,
        conditions: characterData.conditions || [],
        source: characterData.source || 'local'
      };

      // Send to all Roll20 tabs
      try {
        const tabs = await browserAPI.tabs.query({ url: '*://app.roll20.net/*' });
        for (const tab of tabs) {
          browserAPI.tabs.sendMessage(tab.id, syncMessage).catch(err => {
            debug.warn(`Failed to send sync to tab ${tab.id}:`, err);
          });
        }
        debug.log(`📤 Sent character update to ${tabs.length} Roll20 tabs`);
      } catch (syncError) {
        debug.warn('Failed to send sync to Roll20 tabs:', syncError);
      }

      // Update tabs to show new active character
      await loadAndBuildTabs();
      
      // Show success notification
      const source = characterData.source || 'local';
      const sourceText = source === 'database' ? '🌐' : '💾';
      showNotification(`${sourceText} Switched to ${characterData.name}`, 'success');
      
      debug.log(`✅ Successfully switched to character: ${characterData.name}`);
    } else {
      throw new Error('No character data available');
    }
  } catch (error) {
    debug.error('❌ Failed to switch character:', error);
    showNotification('❌ Failed to switch character', 'error');
  }
}

// Show options modal for clearing/deleting character
function showClearCharacterOptions(slotId, slotNum, characterName) {
  const colors = getPopupThemeColors();

  // Create modal overlay
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
  `;

  const modal = document.createElement('div');
  modal.style.cssText = `
    background: ${colors.background};
    border: 2px solid ${colors.border};
    border-radius: 12px;
    padding: 24px;
    max-width: 400px;
    width: 90%;
    box-shadow: 0 4px 20px rgba(0,0,0,0.3);
  `;

  modal.innerHTML = `
    <h3 style="margin: 0 0 16px 0; color: ${colors.text};">Clear Character Data</h3>
    <p style="margin: 0 0 20px 0; color: ${colors.textSecondary};">
      What would you like to do with <strong>${characterName}</strong>?
    </p>

    <div style="display: flex; flex-direction: column; gap: 12px;">
      <button id="clear-local-btn" style="
        padding: 12px 20px;
        background: linear-gradient(135deg, #f39c12 0%, #e67e22 100%);
        color: white;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        font-weight: bold;
        font-size: 14px;
      ">
        🗑️ Clear Local Data Only
      </button>
      <p style="margin: -8px 0 0 0; padding-left: 8px; font-size: 12px; color: ${colors.textSecondary};">
        Remove from this browser, keep in cloud
      </p>

      <button id="delete-cloud-btn" style="
        padding: 12px 20px;
        background: linear-gradient(135deg, #e74c3c 0%, #c0392b 100%);
        color: white;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        font-weight: bold;
        font-size: 14px;
      ">
        ☁️ Delete from Cloud
      </button>
      <p style="margin: -8px 0 0 0; padding-left: 8px; font-size: 12px; color: ${colors.textSecondary};">
        Delete from cloud AND local storage
      </p>

      <button id="cancel-clear-btn" style="
        padding: 12px 20px;
        background: ${colors.buttonSecondary};
        color: ${colors.text};
        border: 2px solid ${colors.border};
        border-radius: 8px;
        cursor: pointer;
        font-weight: bold;
        font-size: 14px;
        margin-top: 8px;
      ">
        Cancel
      </button>
    </div>
  `;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  // Clear local only
  modal.querySelector('#clear-local-btn').addEventListener('click', async () => {
    document.body.removeChild(overlay);
    await clearCharacterSlot(slotId, slotNum, false);
  });

  // Delete from cloud
  modal.querySelector('#delete-cloud-btn').addEventListener('click', async () => {
    if (confirm(`⚠️ Delete ${characterName} from cloud?\n\nThis will permanently delete the character from cloud storage and remove it from this browser.`)) {
      document.body.removeChild(overlay);
      await deleteCharacterFromCloud(slotId, slotNum);
    }
  });

  // Cancel
  modal.querySelector('#cancel-clear-btn').addEventListener('click', () => {
    document.body.removeChild(overlay);
  });

  // Close on overlay click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      document.body.removeChild(overlay);
    }
  });
}

// Clear a character slot (local only)
async function clearCharacterSlot(slotId, slotNum) {
  try {
    // Clear in-memory state if this is the current character
    if (currentSlotId === slotId) {
      characterData = null;
      currentSlotId = null;
    }

    await browserAPI.runtime.sendMessage({
      action: 'clearCharacterData',
      characterId: slotId
    });

    showNotification(`✅ Slot ${slotNum} cleared from local storage`);

    // Reload tabs (will load a different character if available)
    loadCharacterWithTabs();
  } catch (error) {
    debug.error('❌ Failed to clear slot:', error);
    showNotification('❌ Failed to clear slot', 'error');
  }
}

// Delete character from cloud AND local
async function deleteCharacterFromCloud(slotId, slotNum) {
  try {
    // Clear in-memory state if this is the current character
    if (currentSlotId === slotId) {
      characterData = null;
      currentSlotId = null;
    }

    // First delete from cloud
    await browserAPI.runtime.sendMessage({
      action: 'deleteCharacterFromCloud',
      characterId: slotId
    });

    // Then clear from local
    await browserAPI.runtime.sendMessage({
      action: 'clearCharacterData',
      characterId: slotId
    });

    showNotification(`✅ Character deleted from cloud and local storage`);

    // Reload tabs (will load a different character if available)
    loadCharacterWithTabs();
  } catch (error) {
    debug.error('❌ Failed to delete character:', error);
    showNotification('❌ Failed to delete character: ' + error.message, 'error');
  }
}


// Global advantage state
let advantageState = 'normal'; // 'advantage', 'normal', or 'disadvantage'

// Add event listeners for rest buttons and advantage toggle
document.addEventListener('DOMContentLoaded', () => {
  const shortRestBtn = document.getElementById('short-rest-btn');
  const longRestBtn = document.getElementById('long-rest-btn');

  if (shortRestBtn) {
    shortRestBtn.addEventListener('click', takeShortRest);
  }

  if (longRestBtn) {
    longRestBtn.addEventListener('click', takeLongRest);
  }

  // Advantage toggle buttons
  const advantageBtn = document.getElementById('advantage-btn');
  const normalBtn = document.getElementById('normal-btn');
  const disadvantageBtn = document.getElementById('disadvantage-btn');

  if (advantageBtn) {
    advantageBtn.addEventListener('click', () => setAdvantageState('advantage'));
  }

  if (normalBtn) {
    normalBtn.addEventListener('click', () => setAdvantageState('normal'));
  }

  if (disadvantageBtn) {
    disadvantageBtn.addEventListener('click', () => setAdvantageState('disadvantage'));
  }
});

// Helper function for setting active character (backup if runtime message fails)
async function setActiveCharacter(characterId) {
  try {
    await browserAPI.storage.local.set({
      activeCharacterId: characterId
    });
    debug.log(`✅ Set active character: ${characterId}`);
  } catch (error) {
    debug.error('❌ Failed to set active character:', error);
  }
}

function setAdvantageState(state) {
  advantageState = state;

  const advantageBtn = document.getElementById('advantage-btn');
  const normalBtn = document.getElementById('normal-btn');
  const disadvantageBtn = document.getElementById('disadvantage-btn');

  // Reset all buttons
  [advantageBtn, normalBtn, disadvantageBtn].forEach(btn => {
    if (btn) {
      btn.classList.remove('active');
      const color = btn.id.includes('advantage') ? 'var(--accent-success)' :
                   btn.id.includes('normal') ? '#FC57F9' :
                   'var(--accent-danger)';
      btn.style.background = 'transparent';
      btn.style.color = color;
      btn.style.borderColor = color;
    }
  });

  // Highlight active button
  const activeBtn = state === 'advantage' ? advantageBtn :
                   state === 'normal' ? normalBtn :
                   disadvantageBtn;

  if (activeBtn) {
    activeBtn.classList.add('active');
    const color = state === 'advantage' ? 'var(--accent-success)' :
                 state === 'normal' ? '#FC57F9' :
                 'var(--accent-danger)';
    activeBtn.style.background = color;
    activeBtn.style.color = 'white';
  }

  debug.log(`🎲 Advantage state set to: ${state}`);
  showNotification(`🎲 ${state === 'advantage' ? 'Advantage' : state === 'disadvantage' ? 'Disadvantage' : 'Normal'} rolls selected`);

  // Announce advantage state change to Roll20
  const stateEmoji = state === 'advantage' ? '🎯' : state === 'disadvantage' ? '🎲' : '⚖️';
  const announcement = `&{template:default} {{name=${getColoredBanner(characterData)}${characterData.name} sets roll mode}} {{${stateEmoji}=${state === 'advantage' ? 'Advantage' : state === 'disadvantage' ? 'Disadvantage' : 'Normal'} rolls selected}}`;
  const messageData = {
    action: 'announceSpell',
    message: announcement,
    color: characterData.notificationColor
  };

  // Send to Roll20
  if (window.opener && !window.opener.closed) {
    try {
      window.opener.postMessage(messageData, '*');
    } catch (error) {
      debug.warn('⚠️ Could not send advantage state via window.opener:', error.message);
      browserAPI.runtime.sendMessage({
        action: 'relayRollToRoll20',
        roll: messageData
      });
    }
  } else {
    browserAPI.runtime.sendMessage({
      action: 'relayRollToRoll20',
      roll: messageData
    });
  }
}


// buildSpellsBySource is now in modules/spell-display.js

// Store Sneak Attack toggle state (independent from DiceCloud - controlled only by our sheet)
let sneakAttackEnabled = false;  // Always starts unchecked - user manually enables when needed
let sneakAttackDamage = '';

// Store Elemental Weapon toggle state (independent from DiceCloud - controlled only by our sheet)
let elementalWeaponEnabled = false;  // Always starts unchecked - user manually enables when needed
let elementalWeaponDamage = '1d4';  // Default to level 3 (base damage)

// Filter state for actions
// actionFilters now in modules/action-filters.js

// Filter state for spells (now handled by modules/spell-display.js as window.spellFilters)

// Filter state for inventory (default to equipped only)
let inventoryFilters = {
  filter: 'equipped', // all, equipped, attuned, container
  search: ''
};

// Helper function to categorize an action
// categorizeAction now in modules/action-filters.js

// categorizeSpell is now in modules/spell-display.js

// Initialize filter event listeners
function initializeFilters() {
  // Action filters now handled by modules/action-filters.js
  initializeActionFilters();

  // Spell filters now handled by modules/spell-display.js
  initializeSpellFilters();

  // Inventory filters
  const inventorySearch = document.getElementById('inventory-search');
  if (inventorySearch) {
    inventorySearch.addEventListener('input', (e) => {
      inventoryFilters.search = e.target.value.toLowerCase();
      rebuildInventory();
    });
  }

  // Inventory type filters
  document.querySelectorAll('[data-type="inventory-filter"]').forEach(btn => {
    btn.addEventListener('click', () => {
      inventoryFilters.filter = btn.dataset.filter;
      document.querySelectorAll('[data-type="inventory-filter"]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      rebuildInventory();
    });
  });
}

// Rebuild actions with current filters
// rebuildActions now in modules/action-display.js

// rebuildSpells is now in modules/spell-display.js

// Rebuild inventory with current filters
// Note: rebuildInventory is now provided by inventory-manager.js

// getActionOptions now in modules/action-options.js

// buildActionsDisplay now in modules/action-display.js
// decrementActionUses now in modules/action-display.js


// buildSpellSlotsDisplay and adjustSpellSlot are now in modules/spell-slots.js


// ===== CARD CREATION =====
// Moved to modules/card-creator.js - using wrapper for compatibility
function createCard(title, main, sub, onClick) {
  return window.CardCreator.createCard(title, main, sub, onClick);
}


// createSpellCard, validateSpellData, getSpellOptions now in modules/spell-cards.js

// showSpellModal, handleSpellOption now in modules/spell-modals.js

// getCustomMacros, saveCustomMacros, showCustomMacroModal now in modules/spell-macros.js

// ===== SPELL CASTING =====
// castSpell, castWithSlot, useClassResource, detectClassResources, showResourceChoice, showUpcastChoice now in modules/spell-casting.js
// announceSpellDescription, announceSpellCast, getSpellcastingAbilityMod, getSpellAttackBonus now in modules/spell-casting.js

// ===== METAMAGIC SYSTEM =====
// Core logic lives in modules/action-executor.js; these are thin wrappers
// that pass the global characterData.

function getAvailableMetamagic() {
  const options = executorGetAvailableMetamagic(characterData);
  debug.log('🔮 Found metamagic options:', options.map(m => m.name));
  return options;
}

// Theme-aware modal helper
function handleLayOnHands(action) {
  const layOnHandsPool = getLayOnHandsResource();

  if (!layOnHandsPool) {
    showNotification(`❌ No Lay on Hands pool resource found`, 'error');
    return;
  }

  if (layOnHandsPool.current <= 0) {
    showNotification(`❌ No Lay on Hands points remaining!`, 'error');
    return;
  }

  // Show modal for Lay on Hands
  showLayOnHandsModal(layOnHandsPool);
}


// handleRecoverSpellSlot, recoverSpellSlot now in modules/spell-casting.js

// Legacy functions for backwards compatibility (now use structured data)
function calculateMetamagicCost(metamagicName, spellLevel) {
  return executorCalculateMetamagicCost(metamagicName, spellLevel);
}

// announceAction now in modules/action-announcements.js


// Save character data when window is about to close/refresh
// This ensures local modifications persist through browser refresh
window.addEventListener('beforeunload', () => {
  if (characterData && currentSlotId) {
    debug.log('💾 Saving character data before window closes');
    // Use sendMessage synchronously during unload
    browserAPI.runtime.sendMessage({
      action: 'storeCharacterData',
      data: characterData,
      slotId: currentSlotId  // CRITICAL: Pass slotId for proper persistence
    });
    debug.log(`✅ Saved character data: ${characterData.name} (slotId: ${currentSlotId})`);
  }
});

// ============================================================================
// COMBAT MECHANICS
// ============================================================================


/**
 * Initialize manual DiceCloud sync button in settings
 */
function initManualSyncButton() {
  const syncSection = document.getElementById('dicecloud-sync-section');
  const syncButton = document.getElementById('manual-sync-btn');
  const syncStatus = document.getElementById('sync-status');

  // Only show in experimental builds
  browserAPI.runtime.sendMessage({ action: 'getManifest' }).then(response => {
    if (response && response.success && response.manifest &&
        response.manifest.name && response.manifest.name.includes('EXPERIMENTAL')) {
      if (syncSection) {
        syncSection.style.display = 'block';
        debug.log('🧪 DiceCloud sync section shown (experimental build)');
      }
    }
  }).catch(err => {
    debug.log('📦 Not experimental build, hiding sync section');
  });

  if (syncButton) {
    syncButton.addEventListener('click', async () => {
      try {
        debug.log('🔄 Manual sync button clicked');

        // Disable button during sync
        syncButton.disabled = true;
        syncButton.textContent = '🔄 Syncing...';

        // Show status
        if (syncStatus) {
          syncStatus.style.display = 'block';
          syncStatus.style.background = 'var(--accent-info)';
          syncStatus.style.color = 'white';
          syncStatus.textContent = '⏳ Syncing to DiceCloud...';
        }

        // Collect all character data
        if (!characterData) {
          throw new Error('No character data available');
        }

        // Extract Channel Divinity from resources if it exists
        const channelDivinityResource = characterData.resources?.find(r =>
          r.name === 'Channel Divinity' ||
          r.variableName === 'channelDivinityCleric' ||
          r.variableName === 'channelDivinityPaladin' ||
          r.variableName === 'channelDivinity'
        );

        // Build comprehensive sync message
        const syncMessage = {
          type: 'characterDataUpdate',
          characterData: {
            name: characterData.name,
            hp: characterData.hitPoints.current,
            tempHp: characterData.temporaryHP || 0,
            maxHp: characterData.hitPoints.max,
            spellSlots: characterData.spellSlots || {},
            channelDivinity: channelDivinityResource ? {
              current: channelDivinityResource.current,
              max: channelDivinityResource.max
            } : undefined,
            resources: characterData.resources || [],
            actions: characterData.actions || [],
            deathSaves: characterData.deathSaves,
            inspiration: characterData.inspiration,
            lastRoll: characterData.lastRoll
          }
        };

        debug.log('🔄 Sending manual sync message:', syncMessage);

        // Send to Roll20 content script (which will forward to DiceCloud sync)
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage(syncMessage, '*');
          debug.log('✅ Sync message sent via opener');
        } else {
          // Also try posting to self (in case we're in a popup)
          window.postMessage(syncMessage, '*');
          debug.log('✅ Sync message sent to self');
        }

        // Wait a bit for sync to complete
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Show success
        if (syncStatus) {
          syncStatus.style.background = 'var(--accent-success)';
          syncStatus.textContent = '✅ Synced successfully!';
        }
        showNotification('✅ Character data synced to DiceCloud!', 'success');
        debug.log('✅ Manual sync completed');

        // Reset button
        setTimeout(() => {
          syncButton.disabled = false;
          syncButton.textContent = '🔄 Sync to DiceCloud Now';
          if (syncStatus) {
            syncStatus.style.display = 'none';
          }
        }, 2000);

      } catch (error) {
        debug.error('❌ Manual sync failed:', error);

        if (syncStatus) {
          syncStatus.style.display = 'block';
          syncStatus.style.background = 'var(--accent-danger)';
          syncStatus.style.color = 'white';
          syncStatus.textContent = '❌ Sync failed: ' + error.message;
        }
        showNotification('❌ Sync failed: ' + error.message, 'error');

        // Reset button
        syncButton.disabled = false;
        syncButton.textContent = '🔄 Sync to DiceCloud Now';
      }
    });

    debug.log('✅ Manual sync button initialized');
  } else {
    debug.warn('⚠️ Manual sync button not found in settings');
  }
}

// ===== TURN MANAGEMENT =====

/**
 * Turn state tracking
 * When false, action economy indicators should be disabled/grayed out
 */
let isMyTurn = false;

/**
 * Activate turn - enable action economy indicators
 * Called when GM panel sends 'activateTurn' message
 */
function activateTurn() {
  isMyTurn = true;
  const actionIndicators = document.querySelectorAll('.action-economy-item');

  actionIndicators.forEach(indicator => {
    indicator.style.opacity = '1';
    indicator.style.pointerEvents = 'auto';
    indicator.style.cursor = 'pointer';
  });

  debug.log('✅ Turn activated - action economy enabled');
}

/**
 * Deactivate turn - disable action economy indicators
 * Called when GM panel sends 'deactivateTurn' message
 */
function deactivateTurn() {
  isMyTurn = false;
  const actionIndicators = document.querySelectorAll('.action-economy-item');

  actionIndicators.forEach(indicator => {
    indicator.style.opacity = '0.3';
    indicator.style.pointerEvents = 'none';
    indicator.style.cursor = 'not-allowed';
  });

  debug.log('⏸️ Turn deactivated - action economy disabled');
}

// Listen for messages from GM panel (when it's your turn)
window.addEventListener('message', (event) => {
  if (event.data && event.data.action === 'activateTurn') {
    debug.log('🎯 Your turn! Activating action economy...');
    debug.log('🎯 Received activateTurn event:', event.data);

    // Activate turn state
    activateTurn();

    // Reset action economy for new turn (only reset actions, don't announce)
    const actionIndicator = document.getElementById('action-indicator');
    const bonusActionIndicator = document.getElementById('bonus-action-indicator');
    const movementIndicator = document.getElementById('movement-indicator');
    
    [actionIndicator, bonusActionIndicator, movementIndicator].forEach(indicator => {
      if (indicator) {
        indicator.dataset.used = 'false';
        debug.log(`🔄 Reset ${indicator.id} to unused`);
      }
    });
    
    debug.log('🔄 Turn reset: Action, Bonus Action, Movement restored (automatic)');

    showNotification('⚔️ Your turn!', 'success');
  } else if (event.data && event.data.action === 'deactivateTurn') {
    debug.log('⏸️ Turn ended. Deactivating action economy...');
    debug.log('⏸️ Received deactivateTurn event:', event.data);

    // Deactivate turn state
    deactivateTurn();
  } else if (event.data && event.data.action === 'rollResult') {
    // Handle roll results from content script for racial traits checking
    debug.log('🧬 Received rollResult message:', event.data);
    
    if (event.data.checkRacialTraits && (activeRacialTraits.length > 0 || activeFeatTraits.length > 0)) {
      const { rollResult, baseRoll, rollType, rollName } = event.data;
      debug.log(`🧬 Checking racial traits for roll: ${baseRoll} (${rollType}) - ${rollName}`);
      debug.log(`🧬 Active racial traits count: ${activeRacialTraits.length}`);
      debug.log(`🎖️ Active feat traits count: ${activeFeatTraits.length}`);
      debug.log(`🧬 Roll details - Total: ${rollResult}, Base: ${baseRoll}`);
      
      // Check if any racial traits trigger (use baseRoll for the actual d20 roll)
      const racialTraitTriggered = checkRacialTraits(baseRoll, rollType, rollName);
      const triggeredRacialTraits = [];
      
      // Check if any feat traits trigger (use baseRoll for the actual d20 roll)
      const featTraitTriggered = checkFeatTraits(baseRoll, rollType, rollName);
      const triggeredFeatTraits = [];
      
      // Collect triggered traits
      if (racialTraitTriggered) {
        triggeredRacialTraits.push(...activeRacialTraits.filter(trait => {
          // Check if this trait would trigger for this roll
          const testResult = trait.onRoll(baseRoll, rollType, rollName);
          return testResult === true;
        }));
        debug.log(`🧬 Racial trait triggered for roll: ${baseRoll}`);
      }
      
      if (featTraitTriggered) {
        triggeredFeatTraits.push(...activeFeatTraits.filter(trait => {
          // Check if this trait would trigger for this roll
          const testResult = trait.onRoll(baseRoll, rollType, rollName);
          return testResult === true;
        }));
        debug.log(`🎖️ Feat trait triggered for roll: ${baseRoll}`);
      }
      
      // Show appropriate popup
      if (triggeredRacialTraits.length > 0 || triggeredFeatTraits.length > 0) {
        const allTriggeredTraits = [...triggeredRacialTraits, ...triggeredFeatTraits];
        
        if (allTriggeredTraits.length === 1) {
          // Single trait triggered - show its specific popup
          const trait = allTriggeredTraits[0];
          if (trait.name === 'Halfling Luck') {
            showHalflingLuckPopup({
              rollResult: baseRoll,
              baseRoll: baseRoll,
              rollType: rollType,
              rollName: rollName
            });
          } else if (trait.name === 'Lucky') {
            const luckyResource = getLuckyResource();
            showLuckyPopup({
              rollResult: baseRoll,
              baseRoll: baseRoll,
              rollType: rollType,
              rollName: rollName,
              luckPointsRemaining: luckyResource?.current || 0
            });
          }
        } else {
          // Multiple traits triggered - show choice popup
          showTraitChoicePopup({
            rollResult: baseRoll,
            baseRoll: baseRoll,
            rollType: rollType,
            rollName: rollName,
            racialTraits: triggeredRacialTraits,
            featTraits: triggeredFeatTraits
          });
        }
      }
      
      if (!racialTraitTriggered && !featTraitTriggered) {
        debug.log(`🧬🎖️ No traits triggered for roll: ${baseRoll}`);
      }
    } else {
      debug.log(`🧬 Skipping traits check - checkRacialTraits: ${event.data.checkRacialTraits}, racialTraits: ${activeRacialTraits.length}, featTraits: ${activeFeatTraits.length}`);
    }
  } else if (event.data && event.data.action === 'showHalflingLuckPopup') {
    // Show Halfling Luck reroll popup
    showHalflingLuckPopup(event.data.rollData);
  }
});

// Initialize combat mechanics when sheet loads
setTimeout(() => {
  initConditionsManager();  // from effects-manager.js
  initConcentrationTracker();
}, 100);

// Local character cache to preserve state changes

// ============================================================================

// Check if opened from GM panel and request character data
if (window.opener && !characterData) {
  // Request character data from parent window
  window.opener.postMessage({ action: 'requestCharacterData' }, '*');
  debug.log('📋 Requested character data from parent window');
}

// Initialize macros and UI components when DOM is ready
if (domReady) {
  initCustomMacros();
  initSettingsButton();
  initStatusBarButton();
  initGMMode();
  initShowToGM();
} else {
  pendingOperations.push(initCustomMacros);
  pendingOperations.push(initSettingsButton);
  pendingOperations.push(initStatusBarButton);
  pendingOperations.push(initGMMode);
  pendingOperations.push(initShowToGM);
}
