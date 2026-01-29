debug.log('✅ Popup HTML loaded');

// Access D&D logic from window (loaded via script tags in popup-sheet.html)
// Edge case modules and action-executor.js are loaded as regular scripts before this module
const {
  // Spell edge cases
  SPELL_EDGE_CASES, isEdgeCase, getEdgeCase, applyEdgeCaseModifications, isReuseableSpell, isTooComplicatedSpell,
  // Class feature edge cases
  CLASS_FEATURE_EDGE_CASES, isClassFeatureEdgeCase, getClassFeatureEdgeCase, applyClassFeatureEdgeCaseModifications,
  // Racial feature edge cases
  RACIAL_FEATURE_EDGE_CASES, isRacialFeatureEdgeCase, getRacialFeatureEdgeCase, applyRacialFeatureEdgeCaseModifications,
  // Combat maneuver edge cases
  COMBAT_MANEUVER_EDGE_CASES, isCombatManeuverEdgeCase, getCombatManeuverEdgeCase, applyCombatManeuverEdgeCaseModifications,
  // Metamagic & resource logic
  METAMAGIC_COSTS,
  calculateMetamagicCost: executorCalculateMetamagicCost,
  getAvailableMetamagic: executorGetAvailableMetamagic,
  getSorceryPointsResource: executorGetSorceryPointsResource,
  isMagicItemSpell, isFreeSpell,
  detectClassResources: executorDetectClassResources,
  // Execution functions
  resolveSpellCast, resolveActionUse
} = window;

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
let characterData = null;

// Track current character slot ID (e.g., "slot-1") for persistence
// Track Feline Agility usage
let felineAgilityUsed = false;

// Setting: Show custom macro gear buttons on spells (disabled by default)
let showCustomMacroButtons = false;

// Track if DOM is ready
let domReady = false;

// Queue for operations waiting for DOM
let pendingOperations = [];

/**
 * Hide GM controls when opened from GM panel (read-only mode)
 */
function hideGMControls() {
  // Hide GM mode toggle
  const gmModeContainer = document.querySelector('.gm-mode-container');
  if (gmModeContainer) {
    gmModeContainer.style.display = 'none';
    debug.log('👑 Hidden GM mode toggle');
  }
  
  // Hide settings button
  const settingsBtn = document.getElementById('settings-btn');
  if (settingsBtn) {
    settingsBtn.style.display = 'none';
    debug.log('👑 Hidden settings button');
  }
  
  // Hide color picker
  const colorPickerContainer = document.querySelector('.color-picker-container');
  if (colorPickerContainer) {
    colorPickerContainer.style.display = 'none';
    debug.log('👑 Hidden color picker');
  }
  
  // Update title to indicate read-only mode
  const titleElement = document.querySelector('.char-name-section');
  if (titleElement) {
    titleElement.innerHTML = titleElement.innerHTML.replace('🎲 Character Sheet', '🎲 Character Sheet (Read Only)');
  }
}

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
    sendStatusUpdate();
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
                  <li>Go to your character on <a href="https://dicecloud.com" target="_blank" style="color: #3498db;">DiceCloud.com</a></li>
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
    }
  } catch (error) {
    debug.error('❌ Failed to load characters:', error);
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
    await browserAPI.runtime.sendMessage({
      action: 'clearCharacterData',
      characterId: slotId
    });

    showNotification(`✅ Slot ${slotNum} cleared from local storage`);

    // Reload tabs
    loadCharacterWithTabs();
  } catch (error) {
    debug.error('❌ Failed to clear slot:', error);
    showNotification('❌ Failed to clear slot', 'error');
  }
}

// Delete character from cloud AND local
async function deleteCharacterFromCloud(slotId, slotNum) {
  try {
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

    // Reload tabs
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
    console.log(`✅ Set active character: ${characterId}`);
  } catch (error) {
    console.error('❌ Failed to set active character:', error);
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
                   btn.id.includes('normal') ? '#3498db' :
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
                 state === 'normal' ? '#3498db' :
                 'var(--accent-danger)';
    activeBtn.style.background = color;
    activeBtn.style.color = 'white';
  }

  debug.log(`🎲 Advantage state set to: ${state}`);
  showNotification(`🎲 ${state === 'advantage' ? 'Advantage' : state === 'disadvantage' ? 'Disadvantage' : 'Normal'} rolls selected`);

  // Announce advantage state change to Roll20
  const stateEmoji = state === 'advantage' ? '🎯' : state === 'disadvantage' ? '🎲' : '⚖️';
  const announcement = `&{template:default} {{name=${getColoredBanner()}${characterData.name} sets roll mode}} {{${stateEmoji}=${state === 'advantage' ? 'Advantage' : state === 'disadvantage' ? 'Disadvantage' : 'Normal'} rolls selected}}`;
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

function buildSheet(data) {
  debug.log('Building character sheet...');
  debug.log('📊 Character data received:', data);
  debug.log('✨ Spell slots data:', data.spellSlots);

  // Normalize snake_case fields to camelCase (database uses snake_case, UI expects camelCase)
  debug.log('🔄 HP normalization check:', {
    has_hit_points: !!data.hit_points,
    has_hitPoints: !!data.hitPoints,
    hit_points_value: data.hit_points,
    hitPoints_value: data.hitPoints,
    hitPoints_type: typeof data.hitPoints,
    full_data_keys: Object.keys(data)
  });

  if (data.hit_points && !data.hitPoints) {
    data.hitPoints = data.hit_points;
    debug.log('✅ Normalized hit_points to hitPoints:', data.hitPoints);
  } else if (!data.hit_points && !data.hitPoints) {
    debug.warn('⚠️ No HP data found in character data! Keys available:', Object.keys(data));
  }
  if (data.character_name && !data.name) {
    data.name = data.character_name;
  }
  if (data.armor_class !== undefined && data.armorClass === undefined) {
    data.armorClass = data.armor_class;
  }
  if (data.hit_dice && !data.hitDice) {
    data.hitDice = data.hit_dice;
  }
  if (data.temporary_hp !== undefined && data.temporaryHP === undefined) {
    data.temporaryHP = data.temporary_hp;
  }
  if (data.death_saves && !data.deathSaves) {
    data.deathSaves = data.death_saves;
  }
  if (data.proficiency_bonus !== undefined && data.proficiencyBonus === undefined) {
    data.proficiencyBonus = data.proficiency_bonus;
  }
  if (data.spell_slots && !data.spellSlots) {
    data.spellSlots = data.spell_slots;
  }
  if (data.attribute_mods && !data.attributeMods) {
    data.attributeMods = data.attribute_mods;
  }
  if (data.notification_color && !data.notificationColor) {
    data.notificationColor = data.notification_color;
  }

  // DEBUG: Log actions and spells arrays
  debug.log('🔍 Actions array check:', {
    has_actions: !!data.actions,
    is_array: Array.isArray(data.actions),
    length: data.actions?.length,
    first_action: data.actions?.[0]?.name
  });
  debug.log('🔍 Spells array check:', {
    has_spells: !!data.spells,
    is_array: Array.isArray(data.spells),
    length: data.spells?.length,
    first_spell: data.spells?.[0]?.name
  });

  // Safety check: Ensure critical DOM elements exist before building
  const charNameEl = document.getElementById('char-name');
  if (!charNameEl) {
    debug.error('❌ Critical DOM elements not found! DOM may not be ready yet.');
    debug.log('⏳ Queuing buildSheet for when DOM is ready...');
    if (!domReady) {
      pendingOperations.push(() => buildSheet(data));
    } else {
      // DOM claims to be ready but elements aren't there - retry after a short delay
      debug.log('⏱️ DOM ready but elements missing - retrying in 100ms...');
      setTimeout(() => buildSheet(data), 100);
    }
    return;
  }

  // Initialize concentration from saved data
  if (data.concentration) {
    concentratingSpell = data.concentration;
    updateConcentrationDisplay();
    debug.log(`🧠 Restored concentration: ${concentratingSpell}`);
  } else {
    concentratingSpell = null;
    updateConcentrationDisplay();
  }

  // Character name
  charNameEl.textContent = data.name || 'Character';

  // Update color picker emoji in systems bar
  const currentColorEmoji = getColorEmoji(data.notificationColor || '#3498db');
  const colorEmojiEl = document.getElementById('color-emoji');
  if (colorEmojiEl) {
    colorEmojiEl.textContent = currentColorEmoji;
  }

  // Populate color palette in systems bar (but keep it hidden initially)
  const colorPaletteEl = document.getElementById('color-palette');
  if (colorPaletteEl) {
    colorPaletteEl.innerHTML = createColorPalette(data.notificationColor || '#3498db');
    colorPaletteEl.style.display = 'none'; // Start hidden - user must click to show
    colorPaletteEl.style.gridTemplateColumns = 'repeat(4, 1fr)';
    colorPaletteEl.style.gap = '10px';
    colorPaletteEl.style.width = '180px';
  }

  // Initialize hit dice if needed
  initializeHitDice();

  // Initialize temporary HP if needed
  if (data.temporaryHP === undefined) {
    data.temporaryHP = 0;
  }

  // Initialize inspiration if needed
  if (data.inspiration === undefined) {
    data.inspiration = false;
  }

  // Initialize last roll tracking for heroic inspiration
  if (data.lastRoll === undefined) {
    data.lastRoll = null;
  }

  // Capitalize race name - handle both string and object formats
  let raceName = 'Unknown';
  if (data.race) {
    if (typeof data.race === 'string') {
      raceName = data.race.charAt(0).toUpperCase() + data.race.slice(1);
    } else if (typeof data.race === 'object') {
      // If race is an object, try to extract the value from various possible properties
      let raceValue = data.race.value || data.race.name || data.race.text ||
                      data.race.variableName || data.race.displayName;

      // If still no value, try to get something useful from the object
      if (!raceValue) {
        // Check if it has a tags property that might indicate race type
        if (data.race.tags && Array.isArray(data.race.tags)) {
          const raceTags = data.race.tags.filter(tag =>
            !tag.toLowerCase().includes('class') &&
            !tag.toLowerCase().includes('level')
          );
          if (raceTags.length > 0) {
            raceValue = raceTags[0];
          }
        }

        // Last resort: look for any string property that seems like a race name
        if (!raceValue) {
          const keys = Object.keys(data.race);
          for (const key of keys) {
            if (typeof data.race[key] === 'string' && data.race[key].length > 0 && data.race[key].length < 50) {
              raceValue = data.race[key];
              break;
            }
          }
        }
      }

      // If we found something, capitalize it; otherwise use "Unknown"
      if (raceValue && typeof raceValue === 'string') {
        raceName = raceValue.charAt(0).toUpperCase() + raceValue.slice(1);
      } else {
        debug.warn('Could not extract race name from object:', data.race);
        raceName = 'Unknown Race';
      }
    }
  }

  // Layer 1: Class, Level, Race, Hit Dice
  document.getElementById('char-class').textContent = data.class || 'Unknown';
  document.getElementById('char-level').textContent = data.level || 1;
  document.getElementById('char-race').textContent = raceName;
  // Defensive initialization for hitDice
  if (!data.hitDice) {
    data.hitDice = { current: 0, max: 0, type: 'd6' };
  }
  
  document.getElementById('char-hit-dice').textContent = `${data.hitDice.current || 0}/${data.hitDice.max || 0} ${data.hitDice.type || 'd6'}`;

  // Layer 2: AC, Speed, Proficiency, Death Saves, Inspiration
  document.getElementById('char-ac').textContent = calculateTotalAC();
  document.getElementById('char-speed').textContent = `${data.speed || 30} ft`;
  document.getElementById('char-proficiency').textContent = `+${data.proficiencyBonus || 0}`;

  // Death Saves
  const deathSavesDisplay = document.getElementById('death-saves-display');
  const deathSavesValue = document.getElementById('death-saves-value');
  
  // Defensive initialization for deathSaves
  if (!data.deathSaves) {
    data.deathSaves = { successes: 0, failures: 0 };
  }
  
  deathSavesValue.innerHTML = `
    <span style="color: var(--accent-success);">✓${data.deathSaves.successes || 0}</span> /
    <span style="color: var(--accent-danger);">✗${data.deathSaves.failures || 0}</span>
  `;
  if (data.deathSaves.successes > 0 || data.deathSaves.failures > 0) {
    deathSavesDisplay.style.background = 'var(--bg-action)';
  } else {
    deathSavesDisplay.style.background = 'var(--bg-tertiary)';
  }

  // Inspiration
  const inspirationDisplay = document.getElementById('inspiration-display');
  const inspirationValue = document.getElementById('inspiration-value');
  if (data.inspiration) {
    inspirationValue.textContent = '⭐ Active';
    inspirationValue.style.color = '#f57f17';
    inspirationDisplay.style.background = '#fff9c4';
  } else {
    inspirationValue.textContent = '☆ None';
    inspirationValue.style.color = 'var(--text-muted)';
    inspirationDisplay.style.background = 'var(--bg-tertiary)';
  }

  // Layer 3: Hit Points
  const hpValue = document.getElementById('hp-value');

  // Defensive initialization for hitPoints - ensure proper structure
  debug.log('🔍 HP before defensive init:', { hitPoints: data.hitPoints, type: typeof data.hitPoints });
  if (!data.hitPoints || typeof data.hitPoints !== 'object') {
    debug.warn('⚠️ DEFENSIVE INIT TRIGGERED! Setting HP to 0/0. Original value:', data.hitPoints);
    data.hitPoints = { current: 0, max: 0 };
  }
  // Ensure current and max exist (hitPoints might be an object but missing these)
  if (data.hitPoints.current === undefined) {
    debug.warn('⚠️ HP current is undefined, setting to 0');
    data.hitPoints.current = 0;
  }
  if (data.hitPoints.max === undefined) {
    debug.warn('⚠️ HP max is undefined, setting to 0');
    data.hitPoints.max = 0;
  }

  debug.log('💚 HP display values:', { current: data.hitPoints.current, max: data.hitPoints.max, tempHP: data.temporaryHP });

  hpValue.textContent = `${data.hitPoints.current}${data.temporaryHP > 0 ? `+${data.temporaryHP}` : ''} / ${data.hitPoints.max}`;

  // Initiative
  const initiativeValue = document.getElementById('initiative-value');
  initiativeValue.textContent = `+${data.initiative || 0}`;

  // Remove old event listeners by cloning and replacing elements
  // This prevents duplicate listeners when buildSheet() is called multiple times
  const hpDisplayOld = document.getElementById('hp-display');
  const hpDisplayNew = hpDisplayOld.cloneNode(true);
  hpDisplayOld.parentNode.replaceChild(hpDisplayNew, hpDisplayOld);

  const initiativeOld = document.getElementById('initiative-button');
  const initiativeNew = initiativeOld.cloneNode(true);
  initiativeOld.parentNode.replaceChild(initiativeNew, initiativeOld);

  const deathSavesOld = document.getElementById('death-saves-display');
  const deathSavesNew = deathSavesOld.cloneNode(true);
  deathSavesOld.parentNode.replaceChild(deathSavesNew, deathSavesOld);

  const inspirationOld = document.getElementById('inspiration-display');
  const inspirationNew = inspirationOld.cloneNode(true);
  inspirationOld.parentNode.replaceChild(inspirationNew, inspirationOld);

  // Add click handler for HP display
  hpDisplayNew.addEventListener('click', showHPModal);

  // Add click handler for initiative button
  initiativeNew.addEventListener('click', () => {
    const initiativeBonus = data.initiative || 0;
    
    // Announce initiative roll
    const announcement = `&{template:default} {{name=${getColoredBanner()}${data.name} rolls for initiative!}} {{Type=Initiative}} {{Bonus=+${initiativeBonus}}}`;
    const messageData = {
      action: 'announceSpell',
      message: announcement,
      color: data.notificationColor
    };
    
    if (window.opener && !window.opener.closed) {
      try {
        window.opener.postMessage(messageData, '*');
      } catch (error) {
        debug.log('❌ Failed to send initiative announcement:', error);
      }
    }
    
    roll('Initiative', `1d20+${initiativeBonus}`);
  });

  // Add click handler for death saves display
  deathSavesNew.addEventListener('click', showDeathSavesModal);

  // Add click handler for inspiration display
  inspirationNew.addEventListener('click', toggleInspiration);

  // Update HP display color based on percentage
  const hpPercent = data.hitPoints && data.hitPoints.max > 0 ? (data.hitPoints.current / data.hitPoints.max) * 100 : 0;
  // Use the new hpDisplayNew element we just created above
  if (hpPercent > 50) {
    hpDisplayNew.style.background = 'var(--accent-success)';
  } else if (hpPercent > 25) {
    hpDisplayNew.style.background = 'var(--accent-warning)';
  } else {
    hpDisplayNew.style.background = 'var(--accent-danger)';
  }

  // Resources
  buildResourcesDisplay();

  // Spell Slots
  buildSpellSlotsDisplay();

  // Abilities
  const abilitiesGrid = document.getElementById('abilities-grid');
  abilitiesGrid.innerHTML = ''; // Clear existing
  const abilities = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'];
  abilities.forEach(ability => {
    const score = data.attributes?.[ability] || 10;
    const mod = data.attributeMods?.[ability] || 0;
    const card = createCard(ability.substring(0, 3).toUpperCase(), score, `+${mod}`, () => {
      // Announce ability check
      const announcement = `&{template:default} {{name=${getColoredBanner()}${data.name} makes a ${ability.charAt(0).toUpperCase() + ability.slice(1)} check!}} {{Type=Ability Check}} {{Bonus=+${mod}}}`;
      const messageData = {
        action: 'announceSpell',
        message: announcement,
        color: data.notificationColor
      };
      
      if (window.opener && !window.opener.closed) {
        try {
          window.opener.postMessage(messageData, '*');
        } catch (error) {
          debug.log('❌ Failed to send ability check announcement:', error);
        }
      }
      
      roll(`${ability.charAt(0).toUpperCase() + ability.slice(1)} Check`, `1d20+${mod}`);
    });
    abilitiesGrid.appendChild(card);
  });

  // Saves
  const savesGrid = document.getElementById('saves-grid');
  savesGrid.innerHTML = ''; // Clear existing
  abilities.forEach(ability => {
    const bonus = data.savingThrows?.[ability] || 0;
    const card = createCard(`${ability.substring(0, 3).toUpperCase()}`, `+${bonus}`, '', () => {
      // Announce saving throw
      const announcement = `&{template:default} {{name=${getColoredBanner()}${data.name} makes a ${ability.toUpperCase()} save!}} {{Type=Saving Throw}} {{Bonus=+${bonus}}}`;
      const messageData = {
        action: 'announceSpell',
        message: announcement,
        color: data.notificationColor
      };
      
      if (window.opener && !window.opener.closed) {
        try {
          window.opener.postMessage(messageData, '*');
        } catch (error) {
          debug.log('❌ Failed to send saving throw announcement:', error);
        }
      }
      
      roll(`${ability.toUpperCase()} Save`, `1d20+${bonus}`);
    });
    savesGrid.appendChild(card);
  });

  // Skills - deduplicate and show unique skills only
  const skillsGrid = document.getElementById('skills-grid');
  skillsGrid.innerHTML = ''; // Clear existing

  // Create a map to deduplicate skills (in case data has duplicates)
  const uniqueSkills = new Map();
  Object.entries(data.skills || {}).forEach(([skill, bonus]) => {
    const normalizedSkill = skill.toLowerCase().trim();
    // Only keep the skill if we haven't seen it, or if this bonus is higher
    if (!uniqueSkills.has(normalizedSkill) || bonus > uniqueSkills.get(normalizedSkill).bonus) {
      uniqueSkills.set(normalizedSkill, { skill, bonus });
    }
  });

  // Sort skills alphabetically and display
  const sortedSkills = Array.from(uniqueSkills.values()).sort((a, b) =>
    a.skill.localeCompare(b.skill)
  );

  sortedSkills.forEach(({ skill, bonus }) => {
    const displayName = skill.charAt(0).toUpperCase() + skill.slice(1).replace(/-/g, ' ');
    const card = createCard(displayName, `${bonus >= 0 ? '+' : ''}${bonus}`, '', () => {
      // Announce skill check
      const announcement = `&{template:default} {{name=${getColoredBanner()}${data.name} makes a ${displayName} check!}} {{Type=Skill Check}} {{Bonus=${bonus >= 0 ? '+' : ''}${bonus}}}`;
      const messageData = {
        action: 'announceSpell',
        message: announcement,
        color: data.notificationColor
      };
      
      if (window.opener && !window.opener.closed) {
        try {
          window.opener.postMessage(messageData, '*');
        } catch (error) {
          debug.log('❌ Failed to send skill check announcement:', error);
        }
      }
      
      roll(displayName, `1d20${bonus >= 0 ? '+' : ''}${bonus}`);
    });
    skillsGrid.appendChild(card);
  });

  // Actions & Attacks
  const actionsContainer = document.getElementById('actions-container');
  debug.log('🎬 Actions display check:', {
    has_actions: !!data.actions,
    is_array: Array.isArray(data.actions),
    length: data.actions?.length,
    sample_names: data.actions?.slice(0, 5).map(a => a.name)
  });
  if (data.actions && Array.isArray(data.actions) && data.actions.length > 0) {
    buildActionsDisplay(actionsContainer, data.actions);
  } else {
    actionsContainer.innerHTML = '<p style="text-align: center; color: #666;">No actions available</p>';
    debug.warn('⚠️ No actions to display - showing placeholder');
  }

  // Companions (Animal Companions, Familiars, Summons, etc.)
  if (data.companions && Array.isArray(data.companions) && data.companions.length > 0) {
    buildCompanionsDisplay(data.companions);
  } else {
    // Hide companions section if character has no companions
    const companionsSection = document.getElementById('companions-container');
    if (companionsSection) {
      companionsSection.style.display = 'none';
    }
  }

  // Inventory & Equipment
  const inventoryContainer = document.getElementById('inventory-container');
  if (data.inventory && Array.isArray(data.inventory) && data.inventory.length > 0) {
    buildInventoryDisplay(inventoryContainer, data.inventory);
  } else {
    inventoryContainer.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">No items in inventory</p>';
  }

  // Spells - organized by source then level
  const spellsContainer = document.getElementById('spells-container');
  debug.log('✨ Spells display check:', {
    has_spells: !!data.spells,
    is_array: Array.isArray(data.spells),
    length: data.spells?.length,
    sample_names: data.spells?.slice(0, 5).map(s => s.name)
  });
  if (data.spells && Array.isArray(data.spells) && data.spells.length > 0) {
    buildSpellsBySource(spellsContainer, data.spells);
    expandSectionByContainerId('spells-container');
  } else {
    spellsContainer.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">No spells prepared</p>';
    debug.warn('⚠️ No spells to display - showing placeholder');
    // Collapse the section when empty
    collapseSectionByContainerId('spells-container');
  }

  // Restore active effects from character data
  if (data.activeEffects) {
    activeBuffs = data.activeEffects.buffs || [];
    activeConditions = data.activeEffects.debuffs || [];
    debug.log('✅ Restored active effects:', { buffs: activeBuffs, debuffs: activeConditions });
  } else {
    activeBuffs = [];
    activeConditions = [];
  }
  
  // Sync conditions from Dicecloud (if any were detected as active)
  if (data.conditions && Array.isArray(data.conditions) && data.conditions.length > 0) {
    debug.log('✨ Syncing conditions from Dicecloud:', data.conditions);
    data.conditions.forEach(condition => {
      // Map Dicecloud condition names to our effect names
      const conditionName = condition.name;
      const isPositive = POSITIVE_EFFECTS.some(e => e.name === conditionName);
      const isNegative = NEGATIVE_EFFECTS.some(e => e.name === conditionName);
      
      if (isPositive && !activeBuffs.includes(conditionName)) {
        activeBuffs.push(conditionName);
        debug.log(`  ✅ Added buff from Dicecloud: ${conditionName}`);
      } else if (isNegative && !activeConditions.includes(conditionName)) {
        activeConditions.push(conditionName);
        debug.log(`  ✅ Added debuff from Dicecloud: ${conditionName}`);
      }
    });
  }
  
  updateEffectsDisplay();

  // Initialize color palette after sheet is built
  initColorPalette();

  // Initialize filter event listeners
  initializeFilters();

  debug.log('✅ Sheet built successfully');
}

// Store Sneak Attack toggle state (independent from DiceCloud - controlled only by our sheet)
let sneakAttackEnabled = false;  // Always starts unchecked - user manually enables when needed
let sneakAttackDamage = '';

// Store Elemental Weapon toggle state (independent from DiceCloud - controlled only by our sheet)
let elementalWeaponEnabled = false;  // Always starts unchecked - user manually enables when needed
let elementalWeaponDamage = '1d4';  // Default to level 3 (base damage)

// Filter state for actions
let actionFilters = {
  actionType: 'all',
  category: 'all',
  search: ''
};

// Filter state for spells
// Filter state for inventory (default to equipped only)
let inventoryFilters = {
  filter: 'equipped', // all, equipped, attuned, container
  search: ''
};

// Helper function to categorize an action
function categorizeAction(action) {
  const name = (action.name || '').toLowerCase();
  const damageType = (action.damageType || '').toLowerCase();

  // Check for healing based on damage type or name
  if (damageType.includes('heal') || name.includes('heal') || name.includes('cure')) {
    return 'healing';
  }

  // Check for damage based on actual damage formula
  if (action.damage && action.damage.includes('d')) {
    return 'damage';
  }

  // Everything else is utility
  return 'utility';
}

// Helper function to categorize a spell
// Initialize filter event listeners
function initializeFilters() {
  // Actions filters
  const actionsSearch = document.getElementById('actions-search');
  if (actionsSearch) {
    actionsSearch.addEventListener('input', (e) => {
      actionFilters.search = e.target.value.toLowerCase();
      rebuildActions();
    });
  }
  
  // Action type filters
  document.querySelectorAll('[data-type="action-type"]').forEach(btn => {
    btn.addEventListener('click', () => {
      actionFilters.actionType = btn.dataset.filter;
      document.querySelectorAll('[data-type="action-type"]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      rebuildActions();
    });
  });
  
  // Action category filters
  document.querySelectorAll('[data-type="action-category"]').forEach(btn => {
    btn.addEventListener('click', () => {
      actionFilters.category = btn.dataset.filter;
      document.querySelectorAll('[data-type="action-category"]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      rebuildActions();
    });
  });
  
  // Spells filters
  const spellsSearch = document.getElementById('spells-search');
  if (spellsSearch) {
    spellsSearch.addEventListener('input', (e) => {
      spellFilters.search = e.target.value.toLowerCase();
      rebuildSpells();
    });
  }
  
  // Spell level filters
  document.querySelectorAll('[data-type="spell-level"]').forEach(btn => {
    btn.addEventListener('click', () => {
      spellFilters.level = btn.dataset.filter;
      document.querySelectorAll('[data-type="spell-level"]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      rebuildSpells();
    });
  });
  
  // Spell category filters
  document.querySelectorAll('[data-type="spell-category"]').forEach(btn => {
    btn.addEventListener('click', () => {
      spellFilters.category = btn.dataset.filter;
      document.querySelectorAll('[data-type="spell-category"]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      rebuildSpells();
    });
  });

  // Spell casting time filters
  document.querySelectorAll('[data-type="spell-casting-time"]').forEach(btn => {
    btn.addEventListener('click', () => {
      spellFilters.castingTime = btn.dataset.filter;
      document.querySelectorAll('[data-type="spell-casting-time"]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      rebuildSpells();
    });
  });

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
function rebuildActions() {
  if (!characterData || !characterData.actions) return;
  const container = document.getElementById('actions-container');
  buildActionsDisplay(container, characterData.actions);
}

// Rebuild spells with current filters
// Rebuild inventory with current filters
function rebuildInventory() {
  if (!characterData || !characterData.inventory) return;
  const container = document.getElementById('inventory-container');
  buildInventoryDisplay(container, characterData.inventory);
}

/**
 * Get available action options (attack/damage rolls) with edge case modifications
 */
function getActionOptions(action) {
  const options = [];

  // Check for attack
  if (action.attackRoll) {
    // Convert to full formula if it's just a number (legacy data)
    let formula = action.attackRoll;
    if (typeof formula === 'number' || !formula.includes('d20')) {
      const bonus = parseInt(formula);
      formula = bonus >= 0 ? `1d20+${bonus}` : `1d20${bonus}`;
    }

    options.push({
      type: 'attack',
      label: '🎯 Attack',
      formula: formula,
      icon: '🎯',
      color: '#e74c3c'
    });
  }

  // Check for damage/healing rolls
  const isValidDiceFormula = action.damage && (/\d*d\d+/.test(action.damage) || /\d*d\d+/.test(action.damage.replace(/\s*\+\s*/g, '+')));
  debug.log(`🎲 Action "${action.name}" damage check:`, {
    damage: action.damage,
    isValid: isValidDiceFormula,
    attackRoll: action.attackRoll
  });
  if (isValidDiceFormula) {
    const isHealing = action.damageType && action.damageType.toLowerCase().includes('heal');
    const isTempHP = action.damageType && (
      action.damageType.toLowerCase() === 'temphp' ||
      action.damageType.toLowerCase() === 'temporary' ||
      action.damageType.toLowerCase().includes('temp')
    );

    // Use different text for healing vs damage vs features
    let btnText;
    if (isHealing) {
      btnText = '💚 Heal';
    } else if (action.actionType === 'feature' || !action.attackRoll) {
      btnText = '🎲 Roll';
    } else {
      btnText = '💥 Damage';
    }

    options.push({
      type: isHealing ? 'healing' : (isTempHP ? 'temphp' : 'damage'),
      label: btnText,
      formula: action.damage,
      icon: isTempHP ? '🛡️' : (isHealing ? '💚' : '💥'),
      color: isTempHP ? '#3498db' : (isHealing ? '#27ae60' : '#e67e22')
    });
  }

  // Apply edge case modifications
  let edgeCaseResult;
  
  // Check class feature edge cases first
  if (isClassFeatureEdgeCase(action.name)) {
    edgeCaseResult = applyClassFeatureEdgeCaseModifications(action, options);
    debug.log(`🔍 Edge case applied for "${action.name}": skipNormalButtons = ${edgeCaseResult.skipNormalButtons}`);
  }
  // Check racial feature edge cases
  else if (isRacialFeatureEdgeCase(action.name)) {
    edgeCaseResult = applyRacialFeatureEdgeCaseModifications(action, options);
    debug.log(`🔍 Edge case applied for "${action.name}": skipNormalButtons = ${edgeCaseResult.skipNormalButtons}`);
  }
  // Check combat maneuver edge cases
  else if (isCombatManeuverEdgeCase(action.name)) {
    edgeCaseResult = applyCombatManeuverEdgeCaseModifications(action, options);
    debug.log(`🔍 Edge case applied for "${action.name}": skipNormalButtons = ${edgeCaseResult.skipNormalButtons}`);
  }
  // Default - no edge cases
  else {
    edgeCaseResult = { options, skipNormalButtons: false };
    debug.log(`🔍 No edge case for "${action.name}": skipNormalButtons = false`);
  }

  return edgeCaseResult;
}

function buildActionsDisplay(container, actions) {
  // Clear container
  container.innerHTML = '';

  // DEBUG: Log all actions to see what we have
  debug.log('🔍 buildActionsDisplay called with actions:', actions.map(a => ({ name: a.name, damage: a.damage, actionType: a.actionType })));
  debug.log('🔍 Total actions received:', actions.length);

  // Deduplicate actions by name and combine sources (similar to spells)
  const deduplicatedActions = [];
  const actionsByName = {};

  // Sort actions by name for consistent processing
  const sortedActions = [...actions].sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  sortedActions.forEach(action => {
    const actionName = (action.name || '').trim();
    
    if (!actionName) {
      debug.log('⚠️ Skipping action with no name');
      return;
    }

    if (!actionsByName[actionName]) {
      // First occurrence of this action
      actionsByName[actionName] = action;
      deduplicatedActions.push(action);
      debug.log(`📝 First occurrence of action: "${actionName}"`);
    } else {
      // Duplicate action - combine sources and other properties
      const existingAction = actionsByName[actionName];
      
      // Combine sources if they exist
      if (action.source && !existingAction.source.includes(action.source)) {
        existingAction.source = existingAction.source 
          ? existingAction.source + '; ' + action.source 
          : action.source;
        debug.log(`📝 Combined duplicate action "${actionName}": ${existingAction.source}`);
      }
      
      // Combine descriptions if they exist and are different
      if (action.description && action.description !== existingAction.description) {
        existingAction.description = existingAction.description 
          ? existingAction.description + '\n\n' + action.description 
          : action.description;
        debug.log(`📝 Combined descriptions for "${actionName}"`);
      }
      
      // Merge other useful properties
      if (action.uses && !existingAction.uses) {
        existingAction.uses = action.uses;
        debug.log(`📝 Added uses to "${actionName}"`);
      }
      
      if (action.damage && !existingAction.damage) {
        existingAction.damage = action.damage;
        debug.log(`📝 Added damage to "${actionName}"`);
      }
      
      if (action.attackRoll && !existingAction.attackRoll) {
        existingAction.attackRoll = action.attackRoll;
        debug.log(`📝 Added attackRoll to "${actionName}"`);
      }
      
      debug.log(`🔄 Merged duplicate action: "${actionName}"`);
    }
  });

  debug.log(`📊 Deduplicated ${actions.length} actions to ${deduplicatedActions.length} unique actions`);

  // Apply filters
  let filteredActions = deduplicatedActions.filter(action => {
    const actionName = (action.name || '').toLowerCase();
    
    // Filter out duplicate Divine Smite entries - keep only the main one
    if (actionName.includes('divine smite')) {
      // Skip variants like "Divine Smite Level 1", "Divine Smite (Against Fiends, Critical) Level 1", etc.
      // Keep only the base "Divine Smite" entry
      if (actionName !== 'divine smite' && !actionName.match(/^divine smite$/)) {
        debug.log(`⏭️ Filtering out duplicate Divine Smite entry: ${action.name}`);
        return false;
      } else {
        debug.log(`✅ Keeping main Divine Smite entry: ${action.name}`);
      }
    }
    
    // Debug: Log all Lay on Hands related actions
    if (actionName.includes('lay on hands')) {
      const normalizedActionName = action.name.toLowerCase()
        .replace(/[^a-z0-9\s:]/g, '') // Remove special chars except colon and space
        .replace(/\s+/g, ' ') // Normalize spaces
        .trim();
      const normalizedSearch = 'lay on hands: heal';
      
      debug.log(`🔍 Found Lay on Hands action: "${action.name}"`);
      debug.log(`🔍 Normalized action name: "${normalizedActionName}"`);
      debug.log(`🔍 Normalized search term: "${normalizedSearch}"`);
      debug.log(`🔍 Do they match? ${normalizedActionName === normalizedSearch}`);
      debug.log(`🔍 Action object:`, action);
    }
    
    // Filter by action type
    if (actionFilters.actionType !== 'all') {
      const actionType = (action.actionType || '').toLowerCase();
      if (actionType !== actionFilters.actionType) {
        return false;
      }
    }
    
    // Filter by category
    if (actionFilters.category !== 'all') {
      const category = categorizeAction(action);
      if (category !== actionFilters.category) {
        return false;
      }
    }
    
    // Filter by search term
    if (actionFilters.search) {
      const searchLower = actionFilters.search;
      const name = (action.name || '').toLowerCase();
      const desc = (action.description || '').toLowerCase();
      if (!name.includes(searchLower) && !desc.includes(searchLower)) {
        return false;
      }
    }
    
    return true;
  });

  debug.log(`🔍 Filtered ${deduplicatedActions.length} actions to ${filteredActions.length} actions`);

  // Check if character has Sneak Attack available (from DiceCloud)
  // We only check if it EXISTS, not whether it's enabled on DiceCloud
  // The toggle state on our sheet is independent and user-controlled
  // Use flexible matching in case the name has slight variations
  const sneakAttackAction = deduplicatedActions.find(a =>
    a.name === 'Sneak Attack' ||
    a.name.toLowerCase().includes('sneak attack')
  );
  debug.log('🎯 Sneak Attack search result:', sneakAttackAction);
  if (sneakAttackAction && sneakAttackAction.damage) {
    sneakAttackDamage = sneakAttackAction.damage;

    // Resolve variables in the damage formula for display
    const resolvedDamage = resolveVariablesInFormula(sneakAttackDamage);
    debug.log(`🎯 Sneak Attack damage: "${sneakAttackDamage}" resolved to "${resolvedDamage}"`);

    // Add toggle section at the top of actions
    const toggleSection = document.createElement('div');
    toggleSection.style.cssText = 'background: #2c3e50; color: white; padding: 10px; border-radius: 5px; margin-bottom: 10px; display: flex; align-items: center; gap: 10px;';

    const toggleLabel = document.createElement('label');
    toggleLabel.style.cssText = 'display: flex; align-items: center; gap: 8px; cursor: pointer; font-weight: bold;';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = 'sneak-attack-toggle';
    checkbox.checked = sneakAttackEnabled;  // Always starts false - IGNORES DiceCloud toggle state
    checkbox.style.cssText = 'width: 18px; height: 18px; cursor: pointer;';
    checkbox.addEventListener('change', (e) => {
      sneakAttackEnabled = e.target.checked;
      debug.log(`🎯 Sneak Attack toggle on our sheet: ${sneakAttackEnabled ? 'ON' : 'OFF'} (independent of DiceCloud)`);
    });

    const labelText = document.createElement('span');
    labelText.textContent = `Add Sneak Attack (${resolvedDamage}) to weapon damage`;

    toggleLabel.appendChild(checkbox);
    toggleLabel.appendChild(labelText);
    toggleSection.appendChild(toggleLabel);
    container.appendChild(toggleSection);
  }

  // Check if character has Elemental Weapon spell prepared (check spells list)
  // We only check if it EXISTS, the toggle is user-controlled
  const hasElementalWeapon = characterData.spells && characterData.spells.some(s =>
    s.name === 'Elemental Weapon' || (s.spell && s.spell.name === 'Elemental Weapon')
  );

  if (hasElementalWeapon) {
    debug.log(`⚔️ Elemental Weapon spell found, adding toggle`);

    // Add toggle section for Elemental Weapon
    const elementalToggleSection = document.createElement('div');
    elementalToggleSection.style.cssText = 'background: #8b4513; color: white; padding: 10px; border-radius: 5px; margin-bottom: 10px; display: flex; align-items: center; gap: 10px;';

    const elementalToggleLabel = document.createElement('label');
    elementalToggleLabel.style.cssText = 'display: flex; align-items: center; gap: 8px; cursor: pointer; font-weight: bold;';

    const elementalCheckbox = document.createElement('input');
    elementalCheckbox.type = 'checkbox';
    elementalCheckbox.id = 'elemental-weapon-toggle';
    elementalCheckbox.checked = elementalWeaponEnabled;  // Always starts false
    elementalCheckbox.style.cssText = 'width: 18px; height: 18px; cursor: pointer;';
    elementalCheckbox.addEventListener('change', (e) => {
      elementalWeaponEnabled = e.target.checked;
      debug.log(`⚔️ Elemental Weapon toggle: ${elementalWeaponEnabled ? 'ON' : 'OFF'}`);
    });

    const elementalLabelText = document.createElement('span');
    elementalLabelText.textContent = `Add Elemental Weapon (${elementalWeaponDamage}) to weapon damage`;

    elementalToggleLabel.appendChild(elementalCheckbox);
    elementalToggleLabel.appendChild(elementalLabelText);
    elementalToggleSection.appendChild(elementalToggleLabel);
    container.appendChild(elementalToggleSection);
  }

  // Check if character has Lucky feat
  const hasLuckyFeat = characterData.features && characterData.features.some(f =>
    f.name && f.name.toLowerCase().includes('lucky')
  );

  if (hasLuckyFeat) {
    debug.log(`🎖️ Lucky feat found, adding action button`);

    // Add action button for Lucky feat
    const luckyActionSection = document.createElement('div');
    luckyActionSection.style.cssText = 'background: #f39c12; color: white; padding: 12px; border-radius: 5px; margin-bottom: 10px;';

    const luckyButton = document.createElement('button');
    luckyButton.id = 'lucky-action-button';
    luckyButton.style.cssText = `
      background: #e67e22;
      color: white;
      border: none;
      padding: 10px 16px;
      border-radius: 5px;
      cursor: pointer;
      font-size: 14px;
      font-weight: bold;
      width: 100%;
      transition: background 0.2s;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    `;
    luckyButton.onmouseover = () => luckyButton.style.background = '#d35400';
    luckyButton.onmouseout = () => luckyButton.style.background = '#e67e22';

    // Update button text based on available luck points
    const luckyResource = getLuckyResource();
    const luckPointsAvailable = luckyResource ? luckyResource.current : 0;
    luckyButton.innerHTML = `
      <span style="font-size: 16px;">🎖️</span>
      <span>Use Lucky Point (${luckPointsAvailable}/3)</span>
    `;

    luckyButton.addEventListener('click', () => {
      const currentLuckyResource = getLuckyResource();
      if (!currentLuckyResource || currentLuckyResource.current <= 0) {
        showNotification('❌ No luck points available!', 'error');
        return;
      }

      // Show simple Lucky modal like metamagic
      showLuckyModal();
    });

    luckyActionSection.appendChild(luckyButton);
    container.appendChild(luckyActionSection);
  }

  filteredActions.forEach((action, index) => {
    // Skip rendering standalone Sneak Attack button if it exists
    if ((action.name === 'Sneak Attack' || action.name.toLowerCase().includes('sneak attack')) && action.actionType === 'feature') {
      debug.log('⏭️ Skipping standalone Sneak Attack button (using toggle instead)');
      return;
    }

    // Clean up weapon damage to remove sneak attack if it was auto-added
    // Pattern: remove any multi-dice formulas like "+3d6", "+4d6", etc. that come after the base damage
    if (action.damage && action.attackRoll && sneakAttackDamage) {
      // Remove the sneak attack damage pattern from weapon damage
      const sneakPattern = new RegExp(`\\+?${sneakAttackDamage.replace(/[+\-]/g, '')}`, 'g');
      const cleanedDamage = action.damage.replace(sneakPattern, '');
      if (cleanedDamage !== action.damage) {
        debug.log(`🧹 Cleaned weapon damage: "${action.damage}" -> "${cleanedDamage}"`);
        action.damage = cleanedDamage;
      }
    }

    const actionCard = document.createElement('div');
    actionCard.className = 'action-card';

    const actionHeader = document.createElement('div');
    actionHeader.className = 'action-header';

    const nameDiv = document.createElement('div');
    nameDiv.className = 'action-name';

    // Show uses if available
    let nameText = action.name;

    // Rename "Recover Spell Slot" to "Harness Divine Power" (Cleric feature)
    if (nameText === 'Recover Spell Slot') {
      nameText = 'Harness Divine Power';
    }

    if (action.uses) {
      const usesTotal = action.uses.total || action.uses.value || action.uses;
      // Prefer usesLeft from DiceCloud if available, otherwise calculate from usesUsed
      const usesRemaining = action.usesLeft !== undefined ? action.usesLeft : (usesTotal - (action.usesUsed || 0));
      nameText += ` <span class="uses-badge">${usesRemaining}/${usesTotal} uses</span>`;
    }
    nameDiv.innerHTML = nameText;

    const buttonsDiv = document.createElement('div');
    buttonsDiv.className = 'action-buttons';

    // Get action options with edge case modifications
    const actionOptionsResult = getActionOptions(action);
    const actionOptions = actionOptionsResult.options;

    // Check if this is a "utility only" action that should just announce
    if (actionOptionsResult.skipNormalButtons) {
      // Create simple action button for utility-only actions
      const actionBtn = document.createElement('button');
      actionBtn.className = 'action-btn';
      actionBtn.textContent = '✨ Use';
      actionBtn.style.cssText = `
        background: #9b59b6;
        color: white;
        border: none;
        padding: 8px 12px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
        font-weight: bold;
      `;
      actionBtn.addEventListener('click', () => {
        // Check for Divine Smite special handling
        if (action.name.toLowerCase().includes('divine smite')) {
          showDivineSmiteModal(action);
          return;
        }
        
        // Check for Lay on Hands: Heal special handling
        const normalizedActionName = action.name.toLowerCase()
          .replace(/[^a-z0-9\s:]/g, '') // Remove special chars except colon and space
          .replace(/\s+/g, ' ') // Normalize spaces
          .trim();
        const normalizedSearch = 'lay on hands: heal';
        
        if (normalizedActionName === normalizedSearch) {
          debug.log(`💚 Lay on Hands: Heal action clicked: ${action.name}, showing custom modal`);
          debug.log(`💚 Normalized match: "${normalizedActionName}" === "${normalizedSearch}"`);
          const layOnHandsPool = getLayOnHandsResource();
          if (layOnHandsPool) {
            showLayOnHandsModal(layOnHandsPool);
          } else {
            showNotification('❌ No Lay on Hands pool resource found', 'error');
          }
          return;
        }
        
        // Fallback: Catch ANY Lay on Hands action for debugging
        if (action.name.toLowerCase().includes('lay on hands')) {
          debug.log(`🚨 FALLBACK: Caught Lay on Hands action: "${action.name}"`);
          debug.log(`🚨 This action didn't match 'lay on hands: heal' but contains 'lay on hands'`);
          debug.log(`🚨 Showing modal anyway for debugging`);
          const layOnHandsPool = getLayOnHandsResource();
          if (layOnHandsPool) {
            showLayOnHandsModal(layOnHandsPool);
          } else {
            showNotification('❌ No Lay on Hands pool resource found', 'error');
          }
          return;
        }
        
        // Check and decrement uses BEFORE announcing (so announcement shows correct count)
        if (action.uses && !decrementActionUses(action)) {
          return; // No uses remaining
        }

        // Check and decrement other resources
        if (!decrementActionResources(action)) {
          return; // Not enough resources
        }

        // Announce the action with description AFTER decrements
        announceAction(action);
      });
      buttonsDiv.appendChild(actionBtn);
    } else {
      // Create buttons for each action option
      let actionAnnounced = false; // Track if action has been announced
      actionOptions.forEach((option, optionIndex) => {
        const actionBtn = document.createElement('button');
        actionBtn.className = `${option.type}-btn`;

        // Add edge case note if present
        const edgeCaseNote = option.edgeCaseNote ? `<div style="font-size: 0.7em; color: #666; margin-top: 1px;">${option.edgeCaseNote}</div>` : '';
        actionBtn.innerHTML = `${option.label}${edgeCaseNote}`;

        actionBtn.style.cssText = `
          background: ${option.color};
          color: white;
          border: none;
          padding: 8px 12px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 12px;
          font-weight: bold;
          margin-right: 4px;
          margin-bottom: 4px;
        `;

        actionBtn.addEventListener('click', () => {
          // Check for Divine Smite special handling
          if (action.name.toLowerCase().includes('divine smite')) {
            showDivineSmiteModal(action);
            return;
          }
          
          // Check for Lay on Hands: Heal special handling
          const normalizedActionName = action.name.toLowerCase()
            .replace(/[^a-z0-9\s:]/g, '') // Remove special chars except colon and space
            .replace(/\s+/g, ' ') // Normalize spaces
            .trim();
          const normalizedSearch = 'lay on hands: heal';
          
          if (normalizedActionName === normalizedSearch) {
            debug.log(`💚 Lay on Hands: Heal action clicked: ${action.name}, showing custom modal`);
            debug.log(`💚 Normalized match: "${normalizedActionName}" === "${normalizedSearch}"`);
            const layOnHandsPool = getLayOnHandsResource();
            if (layOnHandsPool) {
              showLayOnHandsModal(layOnHandsPool);
            } else {
              showNotification('❌ No Lay on Hands pool resource found', 'error');
            }
            return;
          }
          
          // Fallback: Catch ANY Lay on Hands action for debugging
          if (action.name.toLowerCase().includes('lay on hands')) {
            debug.log(`🚨 FALLBACK: Caught Lay on Hands action: "${action.name}"`);
            debug.log(`🚨 This action didn't match 'lay on hands: heal' but contains 'lay on hands'`);
            debug.log(`🚨 Showing modal anyway for debugging`);
            const layOnHandsPool = getLayOnHandsResource();
            if (layOnHandsPool) {
              showLayOnHandsModal(layOnHandsPool);
            } else {
              showNotification('❌ No Lay on Hands pool resource found', 'error');
            }
            return;
          }
          
          // Announce the action on the FIRST button click only
          if (!actionAnnounced) {
            announceAction(action);
            actionAnnounced = true;
          }
          
          // Handle different option types
          if (option.type === 'attack') {
            // Mark action as used for attacks
            markActionAsUsed('action');

            // Attack roll is just the d20 + modifiers, no damage dice
            roll(`${action.name} Attack`, option.formula);
          } else if (option.type === 'healing' || option.type === 'temphp' || option.type === 'damage') {
            // Check and decrement uses before rolling
            if (action.uses && !decrementActionUses(action)) {
              return; // No uses remaining
            }

            // Check and decrement Ki points if action costs Ki
            const kiCost = getKiCostFromAction(action);
            if (kiCost > 0) {
              const kiResource = getKiPointsResource();
              if (!kiResource) {
                showNotification(`❌ No Ki Points resource found`, 'error');
                return;
              }
              if (kiResource.current < kiCost) {
                showNotification(`❌ Not enough Ki Points! Need ${kiCost}, have ${kiResource.current}`, 'error');
                return;
              }
              kiResource.current -= kiCost;
              saveCharacterData();
              debug.log(`✨ Used ${kiCost} Ki points for ${action.name}. Remaining: ${kiResource.current}/${kiResource.max}`);
              showNotification(`✨ ${action.name}! (${kiResource.current}/${kiResource.max} Ki left)`);
              buildSheet(characterData); // Refresh display
            }

            // Check and decrement Sorcery Points if action costs them
            const sorceryCost = getSorceryPointCostFromAction(action);
            if (sorceryCost > 0) {
              const sorceryResource = getSorceryPointsResource();
              if (!sorceryResource) {
                showNotification(`❌ No Sorcery Points resource found`, 'error');
                return;
              }
              if (sorceryResource.current < sorceryCost) {
                showNotification(`❌ Not enough Sorcery Points! Need ${sorceryCost}, have ${sorceryResource.current}`, 'error');
                return;
              }
              sorceryResource.current -= sorceryCost;
              saveCharacterData();
              debug.log(`✨ Used ${sorceryCost} Sorcery Points for ${action.name}. Remaining: ${sorceryResource.current}/${sorceryResource.max}`);
              showNotification(`✨ ${action.name}! (${sorceryResource.current}/${sorceryResource.max} SP left)`);
              buildSheet(characterData); // Refresh display
            }

            // Check and decrement other resources (Wild Shape, Breath Weapon, etc.)
            if (!decrementActionResources(action)) {
              return; // Not enough resources
            }

            // Roll the damage/healing
            const rollType = option.type === 'healing' ? 'Healing' : (option.type === 'temphp' ? 'Temp HP' : 'Damage');
            let damageFormula = option.formula;

            // Add Sneak Attack if toggle is enabled and this is a damage roll (not healing/temphp)
            if (option.type === 'damage' && sneakAttackEnabled && sneakAttackDamage && action.attackRoll) {
              damageFormula += `+${sneakAttackDamage}`;
              debug.log(`🎯 Adding Sneak Attack to ${action.name} damage: ${damageFormula}`);
            }

            // Add Elemental Weapon if toggle is enabled and this is a damage roll
            if (option.type === 'damage' && elementalWeaponEnabled && elementalWeaponDamage && action.attackRoll) {
              damageFormula += `+${elementalWeaponDamage}`;
              debug.log(`⚔️ Adding Elemental Weapon to ${action.name} damage: ${damageFormula}`);
            }

            roll(`${action.name} ${rollType}`, damageFormula);
          }
        });

        buttonsDiv.appendChild(actionBtn);
      });
    }

    // Add "Use" button for actions with no attack/damage options
    // Show for any action that should be usable (has description OR is a valid action type)
    if (actionOptions.length === 0 && !actionOptionsResult.skipNormalButtons) {
      const useBtn = document.createElement('button');
      useBtn.className = 'use-btn';
      useBtn.textContent = '✨ Use';
      useBtn.style.cssText = `
        background: #9b59b6;
        color: white;
        border: none;
        padding: 8px 12px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
        font-weight: bold;
      `;
      useBtn.addEventListener('click', () => {
        // Special handling for Divine Spark
        if (action.name === 'Divine Spark') {
          // Find Channel Divinity resource from the resources array
          const channelDivinityResource = characterData.resources?.find(r =>
            r.name === 'Channel Divinity' ||
            r.variableName === 'channelDivinityCleric' ||
            r.variableName === 'channelDivinityPaladin' ||
            r.variableName === 'channelDivinity'
          );

          if (!channelDivinityResource) {
            showNotification('❌ No Channel Divinity resource found', 'error');
            return;
          }

          if (channelDivinityResource.current <= 0) {
            showNotification('❌ No Channel Divinity uses remaining!', 'error');
            return;
          }

          // Show the Divine Spark choice modal
          showDivineSparkModal(action, channelDivinityResource);
          return;
        }

        // Special handling for Harness Divine Power
        if (action.name === 'Harness Divine Power' || action.name === 'Recover Spell Slot') {
          // Find Channel Divinity resource from the resources array
          const channelDivinityResource = characterData.resources?.find(r =>
            r.name === 'Channel Divinity' ||
            r.variableName === 'channelDivinityCleric' ||
            r.variableName === 'channelDivinityPaladin' ||
            r.variableName === 'channelDivinity'
          );

          if (!channelDivinityResource) {
            showNotification('❌ No Channel Divinity resource found', 'error');
            return;
          }

          if (channelDivinityResource.current <= 0) {
            showNotification('❌ No Channel Divinity uses remaining!', 'error');
            return;
          }

          // Show the Harness Divine Power choice modal
          showHarnessDivinePowerModal(action, channelDivinityResource);
          return;
        }

        // Special handling for Elemental Weapon
        if (action.name === 'Elemental Weapon') {
          // Show the Elemental Weapon choice modal
          showElementalWeaponModal(action);
          return;
        }

        // Special handling for Divine Intervention
        if (action.name === 'Divine Intervention') {
          // Show the Divine Intervention modal
          showDivineInterventionModal(action);
          return;
        }

        // Special handling for Wild Shape
        if (action.name === 'Wild Shape' || action.name === 'Combat Wild Shape') {
          // Show the Wild Shape choice modal
          showWildShapeModal(action);
          return;
        }

        // Special handling for Shapechange
        if (action.name === 'Shapechange') {
          // Show the Shapechange choice modal
          showShapechangeModal(action);
          return;
        }

        // Special handling for True Polymorph
        if (action.name === 'True Polymorph') {
          // Show the True Polymorph choice modal
          showTruePolymorphModal(action);
          return;
        }

        // Special handling for Conjure Animals/Elementals/Fey/Celestial
        if (action.name && (
          action.name.includes('Conjure Animals') ||
          action.name.includes('Conjure Elemental') ||
          action.name.includes('Conjure Fey') ||
          action.name.includes('Conjure Celestial')
        )) {
          // Show the Conjure choice modal
          showConjureModal(action);
          return;
        }

        // Special handling for Planar Binding
        if (action.name === 'Planar Binding') {
          // Show the Planar Binding choice modal
          showPlanarBindingModal(action);
          return;
        }

        // Special handling for Teleport
        if (action.name === 'Teleport') {
          // Show the Teleport choice modal
          showTeleportModal(action);
          return;
        }

        // Special handling for Word of Recall
        if (action.name === 'Word of Recall') {
          // Show the Word of Recall choice modal
          showWordOfRecallModal(action);
          return;
        }

        // Special handling for Contingency
        if (action.name === 'Contingency') {
          // Show the Contingency choice modal
          showContingencyModal(action);
          return;
        }

        // Special handling for Glyph of Warding
        if (action.name === 'Glyph of Warding') {
          // Show the Glyph of Warding choice modal
          showGlyphOfWardingModal(action);
          return;
        }

        // Special handling for Symbol
        if (action.name === 'Symbol') {
          // Show the Symbol choice modal
          showSymbolModal(action);
          return;
        }

        // Special handling for Programmed Illusion
        if (action.name === 'Programmed Illusion') {
          // Show the Programmed Illusion choice modal
          showProgrammedIllusionModal(action);
          return;
        }

        // Special handling for Sequester
        if (action.name === 'Sequester') {
          // Show the Sequester choice modal
          showSequesterModal(action);
          return;
        }

        // Special handling for Clone
        if (action.name === 'Clone') {
          // Show the Clone choice modal
          showCloneModal(action);
          return;
        }

        // Special handling for Astral Projection
        if (action.name === 'Astral Projection') {
          // Show the Astral Projection choice modal
          showAstralProjectionModal(action);
          return;
        }

        // Special handling for Etherealness
        if (action.name === 'Etherealness') {
          // Show the Etherealness choice modal
          showEtherealnessModal(action);
          return;
        }

        // Special handling for Magic Jar
        if (action.name === 'Magic Jar') {
          // Show the Magic Jar choice modal
          showMagicJarModal(action);
          return;
        }

        // Special handling for Imprisonment
        if (action.name === 'Imprisonment') {
          // Show the Imprisonment choice modal
          showImprisonmentModal(action);
          return;
        }

        // Special handling for Time Stop
        if (action.name === 'Time Stop') {
          // Show the Time Stop choice modal
          showTimeStopModal(action);
          return;
        }

        // Special handling for Mirage Arcane
        if (action.name === 'Mirage Arcane') {
          // Show the Mirage Arcane choice modal
          showMirageArcaneModal(action);
          return;
        }

        // Special handling for Forcecage
        if (action.name === 'Forcecage') {
          // Show the Forcecage choice modal
          showForcecageModal(action);
          return;
        }

        // Special handling for Maze
        if (action.name === 'Maze') {
          // Show the Maze choice modal
          showMazeModal(action);
          return;
        }

        // Special handling for Wish
        if (action.name === 'Wish') {
          // Show the Wish choice modal
          showWishModal(action);
          return;
        }

        // Special handling for Simulacrum
        if (action.name === 'Simulacrum') {
          // Show the Simulacrum choice modal
          showSimulacrumModal(action);
          return;
        }

        // Special handling for Gate
        if (action.name === 'Gate') {
          // Show the Gate choice modal
          showGateModal(action);
          return;
        }

        // Special handling for Legend Lore
        if (action.name === 'Legend Lore') {
          // Show the Legend Lore choice modal
          showLegendLoreModal(action);
          return;
        }

        // Special handling for Commune
        if (action.name === 'Commune') {
          // Show the Commune choice modal
          showCommuneModal(action);
          return;
        }

        // Special handling for Augury
        if (action.name === 'Augury') {
          // Show the Augury choice modal
          showAuguryModal(action);
          return;
        }

        // Special handling for Divination
        if (action.name === 'Divination') {
          // Show the Divination choice modal
          showDivinationModal(action);
          return;
        }

        // Special handling for Contact Other Plane
        if (action.name === 'Contact Other Plane') {
          // Show the Contact Other Plane choice modal
          showContactOtherPlaneModal(action);
          return;
        }

        // Special handling for Find the Path
        if (action.name === 'Find the Path') {
          // Show the Find the Path choice modal
          showFindThePathModal(action);
          return;
        }

        // Special handling for Speak with Dead
        if (action.name === 'Speak with Dead') {
          // Show the Speak with Dead choice modal
          showSpeakWithDeadModal(action);
          return;
        }

        // Special handling for Speak with Animals
        if (action.name === 'Speak with Animals') {
          // Show the Speak with Animals choice modal
          showSpeakWithAnimalsModal(action);
          return;
        }

        // Special handling for Speak with Plants
        if (action.name === 'Speak with Plants') {
          // Show the Speak with Plants choice modal
          showSpeakWithPlantsModal(action);
          return;
        }

        // Special handling for Zone of Truth
        if (action.name === 'Zone of Truth') {
          // Show the Zone of Truth choice modal
          showZoneOfTruthModal(action);
          return;
        }

        // Special handling for Sending
        if (action.name === 'Sending') {
          // Show the Sending choice modal
          showSendingModal(action);
          return;
        }

        // Special handling for Dream
        if (action.name === 'Dream') {
          // Show the Dream choice modal
          showDreamModal(action);
          return;
        }

        // Special handling for Scrying
        if (action.name === 'Scrying') {
          // Show the Scrying choice modal
          showScryingModal(action);
          return;
        }

        // Special handling for Dispel Evil and Good
        if (action.name === 'Dispel Evil and Good') {
          // Show the Dispel Evil and Good choice modal
          showDispelEvilAndGoodModal(action);
          return;
        }

        // Special handling for Freedom of Movement
        if (action.name === 'Freedom of Movement') {
          // Show the Freedom of Movement choice modal
          showFreedomOfMovementModal(action);
          return;
        }

        // Special handling for Nondetection
        if (action.name === 'Nondetection') {
          // Show the Nondetection choice modal
          showNondetectionModal(action);
          return;
        }

        // Special handling for Protection from Energy
        if (action.name === 'Protection from Energy') {
          // Show the Protection from Energy choice modal
          showProtectionFromEnergyModal(action);
          return;
        }

        // Special handling for Protection from Evil and Good
        if (action.name === 'Protection from Evil and Good') {
          // Show the Protection from Evil and Good choice modal
          showProtectionFromEvilAndGoodModal(action);
          return;
        }

        // Special handling for Sanctuary
        if (action.name === 'Sanctuary') {
          // Show the Sanctuary choice modal
          showSanctuaryModal(action);
          return;
        }

        // Special handling for Silence
        if (action.name === 'Silence') {
          // Show the Silence choice modal
          showSilenceModal(action);
          return;
        }

        // Special handling for Magic Circle
        if (action.name === 'Magic Circle') {
          // Show the Magic Circle choice modal
          showMagicCircleModal(action);
          return;
        }

        // Special handling for Greater Restoration
        if (action.name === 'Greater Restoration') {
          // Show the Greater Restoration choice modal
          showGreaterRestorationModal(action);
          return;
        }

        // Special handling for Remove Curse
        if (action.name === 'Remove Curse') {
          // Show the Remove Curse choice modal
          showRemoveCurseModal(action);
          return;
        }

        // Special handling for Revivify
        if (action.name === 'Revivify') {
          // Show the Revivify choice modal
          showRevivifyModal(action);
          return;
        }

        // Special handling for Raise Dead
        if (action.name === 'Raise Dead') {
          // Show the Raise Dead choice modal
          showRaiseDeadModal(action);
          return;
        }

        // Special handling for Resurrection
        if (action.name === 'Resurrection') {
          // Show the Resurrection choice modal
          showResurrectionModal(action);
          return;
        }

        // Special handling for True Resurrection
        if (action.name === 'True Resurrection') {
          // Show the True Resurrection choice modal
          showTrueResurrectionModal(action);
          return;
        }

        // Special handling for Detect Magic
        if (action.name === 'Detect Magic') {
          // Show the Detect Magic choice modal
          showDetectMagicModal(action);
          return;
        }

        // Special handling for Identify
        if (action.name === 'Identify') {
          // Show the Identify choice modal
          showIdentifyModal(action);
          return;
        }

        // Special handling for Dispel Magic
        if (action.name === 'Dispel Magic') {
          // Show the Dispel Magic choice modal
          showDispelMagicModal(action);
          return;
        }

        // Special handling for Feather Fall
        if (action.name === 'Feather Fall') {
          // Show the Feather Fall choice modal
          showFeatherFallModal(action);
          return;
        }

        // Special handling for Hellish Rebuke
        if (action.name === 'Hellish Rebuke') {
          // Show the Hellish Rebuke choice modal
          showHellishRebukeModal(action);
          return;
        }

        // Special handling for Shield
        if (action.name === 'Shield') {
          // Show the Shield choice modal
          showShieldModal(action);
          return;
        }

        // Special handling for Absorb Elements
        if (action.name === 'Absorb Elements') {
          // Show the Absorb Elements choice modal
          showAbsorbElementsModal(action);
          return;
        }

        // Special handling for Counterspell
        if (action.name === 'Counterspell') {
          // Show the Counterspell choice modal
          showCounterspellModal(action);
          return;
        }

        // Special handling for Fire Shield
        if (action.name === 'Fire Shield') {
          // Show the Fire Shield choice modal
          showFireShieldModal(action);
          return;
        }

        // Special handling for Armor of Agathys
        if (action.name === 'Armor of Agathys') {
          // Show the Armor of Agathys choice modal
          showArmorOfAgathysModal(action);
          return;
        }

        // Special handling for Meld into Stone
        if (action.name === 'Meld into Stone') {
          // Show the Meld into Stone choice modal
          showMeldIntoStoneModal(action);
          return;
        }

        // Special handling for Vampiric Touch
        if (action.name === 'Vampiric Touch') {
          // Show the Vampiric Touch choice modal
          showVampiricTouchModal(action);
          return;
        }

        // Special handling for Life Transference
        if (action.name === 'Life Transference') {
          // Show the Life Transference choice modal
          showLifeTransferenceModal(action);
          return;
        }

        // Special handling for Geas
        if (action.name === 'Geas') {
          // Show the Geas choice modal
          showGeasModal(action);
          return;
        }

        // Special handling for Symbol
        if (action.name === 'Symbol') {
          // Show the Symbol choice modal
          showSymbolModal(action);
          return;
        }

        // Special handling for Spiritual Weapon
        if (action.name === 'Spiritual Weapon') {
          // Show the Spiritual Weapon choice modal
          showSpiritualWeaponModal(action);
          return;
        }

        // Special handling for Flaming Sphere
        if (action.name === 'Flaming Sphere') {
          // Show the Flaming Sphere choice modal
          showFlamingSphereModal(action);
          return;
        }

        // Special handling for Bigby's Hand
        if (action.name === 'Bigby\'s Hand') {
          // Show the Bigby's Hand choice modal
          showBigbysHandModal(action);
          return;
        }

        // Special handling for Animate Objects
        if (action.name === 'Animate Objects') {
          // Show the Animate Objects choice modal
          showAnimateObjectsModal(action);
          return;
        }

        // Special handling for Moonbeam
        if (action.name === 'Moonbeam') {
          // Show the Moonbeam choice modal
          showMoonbeamModal(action);
          return;
        }

        // Special handling for Healing Spirit
        if (action.name === 'Healing Spirit') {
          // Show the Healing Spirit choice modal
          showHealingSpiritModal(action);
          return;
        }

        // Special handling for Bless
        if (action.name === 'Bless') {
          // Show the Bless choice modal
          showBlessModal(action);
          return;
        }

        // Special handling for Bane
        if (action.name === 'Bane') {
          // Show the Bane choice modal
          showBaneModal(action);
          return;
        }

        // Special handling for Guidance
        if (action.name === 'Guidance') {
          // Show the Guidance choice modal
          showGuidanceModal(action);
          return;
        }

        // Special handling for Resistance
        if (action.name === 'Resistance') {
          // Show the Resistance choice modal
          showResistanceModal(action);
          return;
        }

        // Special handling for Hex
        if (action.name === 'Hex') {
          // Show the Hex choice modal
          showHexModal(action);
          return;
        }

        // Special handling for Hunter's Mark
        if (action.name === 'Hunter\'s Mark') {
          // Show the Hunter's Mark choice modal
          showHuntersMarkModal(action);
          return;
        }

        // Special handling for Magic Missile
        if (action.name === 'Magic Missile') {
          // Show the Magic Missile choice modal
          showMagicMissileModal(action);
          return;
        }

        // Special handling for Scorching Ray
        if (action.name === 'Scorching Ray') {
          // Show the Scorching Ray choice modal
          showScorchingRayModal(action);
          return;
        }

        // Special handling for Aid
        if (action.name === 'Aid') {
          // Show the Aid choice modal
          showAidModal(action);
          return;
        }

        // Note: Eldritch Blast uses standard attack/damage buttons, no special modal needed

        // Special handling for Spirit Guardians
        if (action.name === 'Spirit Guardians') {
          // Show the Spirit Guardians choice modal
          showSpiritGuardiansModal(action);
          return;
        }

        // Special handling for Cloud of Daggers
        if (action.name === 'Cloud of Daggers') {
          // Show the Cloud of Daggers choice modal
          showCloudOfDaggersModal(action);
          return;
        }

        // Special handling for Spike Growth
        if (action.name === 'Spike Growth') {
          // Show the Spike Growth choice modal
          showSpikeGrowthModal(action);
          return;
        }

        // Special handling for Wall of Fire
        if (action.name === 'Wall of Fire') {
          // Show the Wall of Fire choice modal
          showWallOfFireModal(action);
          return;
        }

        // Special handling for Haste
        if (action.name === 'Haste') {
          // Show the Haste choice modal
          showHasteModal(action);
          return;
        }

        // Special handling for Booming Blade
        if (action.name === 'Booming Blade') {
          // Show the Booming Blade choice modal
          showBoomingBladeModal(action);
          return;
        }

        // Special handling for Green-Flame Blade
        if (action.name === 'Green-Flame Blade') {
          // Show the Green-Flame Blade choice modal
          showGreenFlameBladeModal(action);
          return;
        }

        // Special handling for Chromatic Orb
        if (action.name === 'Chromatic Orb') {
          // Show the Chromatic Orb choice modal
          showChromaticOrbModal(action);
          return;
        }

        // Special handling for Dragon's Breath
        if (action.name === 'Dragon\'s Breath') {
          // Show the Dragons Breath choice modal
          showDragonsBreathModal(action);
          return;
        }

        // Special handling for Chaos Bolt
        if (action.name === 'Chaos Bolt') {
          // Show the Chaos Bolt choice modal
          showChaosBoltModal(action);
          return;
        }

        // Special handling for Delayed Blast Fireball
        if (action.name === 'Delayed Blast Fireball') {
          // Show the Delayed Blast Fireball choice modal
          showDelayedBlastFireballModal(action);
          return;
        }

        // Special handling for Polymorph
        if (action.name === 'Polymorph') {
          // Show the Polymorph choice modal
          showPolymorphModal(action);
          return;
        }

        // Special handling for True Polymorph
        if (action.name === 'True Polymorph') {
          // Show the True Polymorph choice modal
          showTruePolymorphModal(action);
          return;
        }

        // Default handling for other actions

        // Check and decrement uses BEFORE announcing (so announcement shows correct count)
        if (action.uses && !decrementActionUses(action)) {
          return; // No uses remaining
        }

        // Check and decrement Ki points if action costs Ki
        const kiCost = getKiCostFromAction(action);
        if (kiCost > 0) {
          const kiResource = getKiPointsResource();
          if (!kiResource) {
            showNotification(`❌ No Ki Points resource found`, 'error');
            return;
          }
          if (kiResource.current < kiCost) {
            showNotification(`❌ Not enough Ki Points! Need ${kiCost}, have ${kiResource.current}`, 'error');
            return;
          }
          kiResource.current -= kiCost;
          saveCharacterData();
          debug.log(`✨ Used ${kiCost} Ki points for ${action.name}. Remaining: ${kiResource.current}/${kiResource.max}`);
          showNotification(`✨ ${action.name}! (${kiResource.current}/${kiResource.max} Ki left)`);
          buildSheet(characterData); // Refresh display
        }

        // Check and decrement Sorcery Points if action costs them
        const sorceryCost = getSorceryPointCostFromAction(action);
        if (sorceryCost > 0) {
          const sorceryResource = getSorceryPointsResource();
          if (!sorceryResource) {
            showNotification(`❌ No Sorcery Points resource found`, 'error');
            return;
          }
          if (sorceryResource.current < sorceryCost) {
            showNotification(`❌ Not enough Sorcery Points! Need ${sorceryCost}, have ${sorceryResource.current}`, 'error');
            return;
          }
          sorceryResource.current -= sorceryCost;
          saveCharacterData();
          debug.log(`✨ Used ${sorceryCost} Sorcery Points for ${action.name}. Remaining: ${sorceryResource.current}/${sorceryResource.max}`);
          showNotification(`✨ ${action.name}! (${sorceryResource.current}/${sorceryResource.max} SP left)`);
          buildSheet(characterData); // Refresh display
        }

        // Check and decrement other resources (Wild Shape, Breath Weapon, etc.)
        if (!decrementActionResources(action)) {
          return; // Not enough resources
        }

        // Announce the action AFTER all decrements (so announcement shows correct counts)
        announceAction(action);

        // Mark action as used based on action type
        const actionType = action.actionType || 'action';
        debug.log(`🎯 Action type for "${action.name}": "${actionType}"`);

        if (actionType === 'bonus action' || actionType === 'bonus' || actionType === 'Bonus Action' || actionType === 'Bonus') {
          markActionAsUsed('bonus action');
        } else if (actionType === 'reaction' || actionType === 'Reaction') {
          markActionAsUsed('reaction');
        } else {
          markActionAsUsed('action');
        }
      });
      buttonsDiv.appendChild(useBtn);
    }

    // Add Details button if there's a description
    if (action.description) {
      const detailsBtn = document.createElement('button');
      detailsBtn.className = 'details-btn';
      detailsBtn.textContent = '📋 Details';
      detailsBtn.style.cssText = `
        background: #34495e;
        color: white;
        border: none;
        padding: 8px 12px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
        font-weight: bold;
        margin-right: 4px;
        margin-bottom: 4px;
      `;
      detailsBtn.addEventListener('click', () => {
        const descDiv = actionCard.querySelector('.action-description');
        if (descDiv) {
          descDiv.style.display = descDiv.style.display === 'none' ? 'block' : 'none';
          detailsBtn.textContent = descDiv.style.display === 'none' ? '📋 Details' : '📋 Hide';
        }
      });
      buttonsDiv.appendChild(detailsBtn);
    }

    // Append nameDiv and buttonsDiv to actionHeader
    actionHeader.appendChild(nameDiv);
    actionHeader.appendChild(buttonsDiv);

    // Append actionHeader to actionCard
    actionCard.appendChild(actionHeader);

    // Add description if available (hidden by default, toggled by Details button)
    if (action.description) {
      const descDiv = document.createElement('div');
      descDiv.className = 'action-description';
      descDiv.style.display = 'none'; // Hidden by default
      // Resolve any variables in the description (like {bardicInspirationDie})
      const resolvedDescription = resolveVariablesInFormula(action.description);
      descDiv.innerHTML = `
        <div style="margin-top: 10px; padding: 10px; background: var(--bg-secondary, #f5f5f5); border-radius: 4px; font-size: 0.9em;">${resolvedDescription}</div>
      `;

      actionCard.appendChild(descDiv);
    }

    container.appendChild(actionCard);
  });
}

/*
// Calculate total currency from inventory items
function calculateTotalCurrency(inventory) {
  console.log('💰💰💰 calculateTotalCurrency called, inventory length:', inventory ? inventory.length : 0);

  if (!inventory || inventory.length === 0) {
    console.log('💰 No inventory, returning zeros');
    return { pp: 0, gp: 0, sp: 0, cp: 0 };
  }

  let pp = 0;
  let gp = 0;
  let sp = 0;
  let cp = 0;

  // Build a map of item IDs to names for parent lookup
  const itemMap = new Map();
  inventory.forEach(item => {
    if (item._id) {
      itemMap.set(item._id, item.name);
    }
  });

  inventory.forEach(item => {
    const itemName = (item.name || '').toLowerCase();
    const quantity = item.quantity;
    const parentId = item.parent && item.parent.id ? item.parent.id : null;
    const parentName = parentId ? itemMap.get(parentId) || 'Unknown' : 'None';

    console.log(`💰 Item: "${item.name}" | qty: ${quantity} | parent: ${parentName} (${parentId})`);

    // Skip items with no quantity or quantity of 0
    if (!quantity || quantity <= 0) {
      console.log(`💰 ❌ SKIPPED - quantity is ${quantity}`);
      return;
    }

    // Check if this is currency
    const isCurrency = (itemName.includes('platinum') || itemName.includes('gold') ||
                       itemName.includes('silver') || itemName.includes('copper')) &&
                       (itemName.includes('piece') || itemName.includes('coin'));

    if (!isCurrency) return;

    // ONLY count currency that's inside ANY container (has a parent)
    // Skip root-level currency items (no parent)
    if (!parentId) {
      console.log(`💰 ❌ SKIPPED CURRENCY - no parent (root-level item)`);
      return;
    }

    // Count currency by type (inside containers only)
    if (itemName.includes('platinum')) {
      console.log(`💰💰 ✅ MATCHED PLATINUM in "${parentName}" - adding ${quantity}`, item);
      pp += quantity;
    } else if (itemName.includes('gold')) {
      console.log(`💰💰 ✅ MATCHED GOLD in "${parentName}" - adding ${quantity}`, item);
      gp += quantity;
    } else if (itemName.includes('silver')) {
      console.log(`💰💰 ✅ MATCHED SILVER in "${parentName}" - adding ${quantity}`, item);
      sp += quantity;
    } else if (itemName.includes('copper')) {
      console.log(`💰💰 ✅ MATCHED COPPER in "${parentName}" - adding ${quantity}`, item);
      cp += quantity;
    }
  });

  console.log(`💰💰💰 FINAL CURRENCY TOTALS: pp=${pp}, gp=${gp}, sp=${sp}, cp=${cp}`);
  return { pp, gp, sp, cp };
}
*/

/*
// Update currency display in inventory section header
function updateInventoryCurrencyDisplay(inventory) {
  const headerElement = document.querySelector('#inventory-section h3');
  if (!headerElement) return;

  const currency = calculateTotalCurrency(inventory);

  // Remove existing currency display if any
  const existingDisplay = headerElement.querySelector('.currency-display');
  if (existingDisplay) {
    existingDisplay.remove();
  }

  // Create currency display
  const currencyDisplay = document.createElement('span');
  currencyDisplay.className = 'currency-display';
  currencyDisplay.style.cssText = 'margin-left: 12px; display: inline-flex; gap: 8px; font-size: 0.85em; font-weight: normal;';

  // Add currency circles (only if value > 0)
  if (currency.pp > 0) {
    const ppCircle = document.createElement('span');
    ppCircle.style.cssText = 'display: inline-flex; align-items: center; gap: 4px;';
    ppCircle.innerHTML = `<span style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: #e8e8e8; border: 1px solid #ccc;"></span><span>${currency.pp}</span>`;
    currencyDisplay.appendChild(ppCircle);
  }

  if (currency.gp > 0) {
    const gpCircle = document.createElement('span');
    gpCircle.style.cssText = 'display: inline-flex; align-items: center; gap: 4px;';
    gpCircle.innerHTML = `<span style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: #ffd700; border: 1px solid #daa520;"></span><span>${currency.gp}</span>`;
    currencyDisplay.appendChild(gpCircle);
  }

  if (currency.sp > 0) {
    const spCircle = document.createElement('span');
    spCircle.style.cssText = 'display: inline-flex; align-items: center; gap: 4px;';
    spCircle.innerHTML = `<span style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: #c0c0c0; border: 1px solid #999;"></span><span>${currency.sp}</span>`;
    currencyDisplay.appendChild(spCircle);
  }

  if (currency.cp > 0) {
    const cpCircle = document.createElement('span');
    cpCircle.style.cssText = 'display: inline-flex; align-items: center; gap: 4px;';
    cpCircle.innerHTML = `<span style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: #8b4513; border: 1px solid #654321;"></span><span>${currency.cp}</span>`;
    currencyDisplay.appendChild(cpCircle);
  }

  // Only add if there's any currency
  if (currency.pp > 0 || currency.gp > 0 || currency.sp > 0 || currency.cp > 0) {
    headerElement.appendChild(currencyDisplay);
  }
}
*/

// Build and display inventory with filtering
function buildInventoryDisplay(container, inventory) {
  // Clear container
  container.innerHTML = '';

  // Update currency display in header
  // updateInventoryCurrencyDisplay(inventory); // Commented out currency viewer

  if (!inventory || inventory.length === 0) {
    container.innerHTML = '<p style="color: var(--text-secondary); text-align: center; padding: 20px;">No items in inventory</p>';
    return;
  }

  debug.log(`🎒 Building inventory display with ${inventory.length} items`);

  // Apply filters
  let filteredInventory = inventory.filter(item => {
    // Filter out coins (currency) - they're tracked separately
    const lowerName = (item.name || '').toLowerCase();
    const coinPatterns = ['platinum piece', 'gold piece', 'silver piece', 'copper piece', 'electrum piece',
                          'platinum coin', 'gold coin', 'silver coin', 'copper coin', 'electrum coin',
                          'pp', 'gp', 'sp', 'cp', 'ep'];
    // Check for exact matches or plurals
    const isCoin = coinPatterns.some(pattern => {
      if (pattern.length <= 2) {
        // Short patterns (pp, gp, etc.) - match exactly or with quantity prefix
        return lowerName === pattern || lowerName === pattern + 's' || lowerName.match(new RegExp(`^\\d+\\s*${pattern}s?$`));
      }
      // Longer patterns - match if name contains it
      return lowerName.includes(pattern);
    });
    if (isCoin) {
      return false;
    }

    // Filter by type
    if (inventoryFilters.filter === 'equipped' && !item.equipped) {
      return false;
    }
    if (inventoryFilters.filter === 'attuned' && !item.attuned) {
      return false;
    }
    if (inventoryFilters.filter === 'container' && item.type !== 'container') {
      return false;
    }

    // Filter by search term
    if (inventoryFilters.search) {
      const searchLower = inventoryFilters.search;
      const name = (item.name || '').toLowerCase();
      const desc = (item.description || '').toLowerCase();
      const tagsString = (item.tags || []).join(' ').toLowerCase();
      if (!name.includes(searchLower) && !desc.includes(searchLower) && !tagsString.includes(searchLower)) {
        return false;
      }
    }

    return true;
  });

  if (filteredInventory.length === 0) {
    container.innerHTML = '<p style="color: var(--text-secondary); text-align: center; padding: 20px;">No items match filters</p>';
    return;
  }

  // Sort inventory: equipped first, then by name
  filteredInventory.sort((a, b) => {
    if (a.equipped && !b.equipped) return -1;
    if (!a.equipped && b.equipped) return 1;
    return (a.name || '').localeCompare(b.name || '');
  });

  // Group items by category/container
  filteredInventory.forEach(item => {
    const itemCard = createInventoryCard(item);
    container.appendChild(itemCard);
  });

  debug.log(`🎒 Displayed ${filteredInventory.length} items`);
}

// Create individual inventory item card
function createInventoryCard(item) {
  const card = document.createElement('div');
  card.className = 'action-card'; // Reuse action card styling
  card.style.cssText = `
    background: var(--bg-card);
    border-left: 4px solid ${item.equipped ? '#27ae60' : item.attuned ? '#9b59b6' : '#95a5a6'};
    padding: 15px;
    margin-bottom: 10px;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.2s;
    ${item.equipped ? 'box-shadow: 0 0 10px rgba(39, 174, 96, 0.3);' : ''}
  `;

  card.onmouseover = () => {
    card.style.background = 'var(--bg-card-hover)';
    card.style.transform = 'translateX(2px)';
  };
  card.onmouseout = () => {
    card.style.background = 'var(--bg-card)';
    card.style.transform = 'translateX(0)';
  };

  // Header with name and quantity
  const header = document.createElement('div');
  header.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;';

  const nameSection = document.createElement('div');
  nameSection.style.cssText = 'display: flex; align-items: center; gap: 8px;';

  const itemName = document.createElement('strong');
  itemName.textContent = item.name || 'Unnamed Item';
  itemName.style.cssText = 'color: var(--text-primary); font-size: 1.1em;';
  nameSection.appendChild(itemName);

  // Add badges for equipped/attuned
  if (item.equipped) {
    const equippedBadge = document.createElement('span');
    equippedBadge.textContent = '⚔️ Equipped';
    equippedBadge.style.cssText = 'background: #27ae60; color: white; padding: 2px 8px; border-radius: 12px; font-size: 0.75em; font-weight: bold;';
    nameSection.appendChild(equippedBadge);
  }

  if (item.attuned) {
    const attunedBadge = document.createElement('span');
    attunedBadge.textContent = '✨ Attuned';
    attunedBadge.style.cssText = 'background: #9b59b6; color: white; padding: 2px 8px; border-radius: 12px; font-size: 0.75em; font-weight: bold;';
    nameSection.appendChild(attunedBadge);
  }

  if (item.requiresAttunement && !item.attuned) {
    const requiresBadge = document.createElement('span');
    requiresBadge.textContent = '(Requires Attunement)';
    requiresBadge.style.cssText = 'color: var(--text-muted); font-size: 0.85em; font-style: italic;';
    nameSection.appendChild(requiresBadge);
  }

  header.appendChild(nameSection);

  // Quantity display
  const metaSection = document.createElement('div');
  metaSection.style.cssText = 'display: flex; flex-direction: column; align-items: flex-end; gap: 4px;';

  if (item.quantity > 1 || item.showIncrement) {
    const quantitySpan = document.createElement('span');
    quantitySpan.textContent = `×${item.quantity}`;
    quantitySpan.style.cssText = 'color: var(--text-secondary); font-weight: bold; font-size: 1.1em;';
    metaSection.appendChild(quantitySpan);
  }

  header.appendChild(metaSection);
  card.appendChild(header);

  // Weight
  if (item.weight && item.weight > 0) {
    const weightDiv = document.createElement('div');
    const totalWeight = item.weight * item.quantity;
    weightDiv.textContent = `⚖️ ${totalWeight} lb${totalWeight !== 1 ? 's' : ''}`;
    weightDiv.style.cssText = 'color: var(--text-secondary); font-size: 0.85em; margin-bottom: 4px;';
    card.appendChild(weightDiv);
  }

  // Tags
  if (item.tags && item.tags.length > 0) {
    const tagsDiv = document.createElement('div');
    tagsDiv.style.cssText = 'display: flex; gap: 6px; flex-wrap: wrap; margin: 6px 0;';
    item.tags.forEach(tag => {
      const tagSpan = document.createElement('span');
      tagSpan.textContent = tag;
      tagSpan.style.cssText = 'background: var(--bg-tertiary); color: var(--text-secondary); padding: 2px 6px; border-radius: 8px; font-size: 0.75em;';
      tagsDiv.appendChild(tagSpan);
    });
    card.appendChild(tagsDiv);
  }

  // Description (collapsed by default, click to expand)
  if (item.description && item.description.trim()) {
    const descDiv = document.createElement('div');
    descDiv.style.cssText = 'color: var(--text-secondary); font-size: 0.9em; margin-top: 8px; border-top: 1px solid var(--border-color); padding-top: 8px; line-height: 1.4; max-height: 0; overflow: hidden; transition: max-height 0.3s;';
    descDiv.innerHTML = item.description.replace(/\n/g, '<br>');

    card.addEventListener('click', () => {
      if (descDiv.style.maxHeight === '0px' || !descDiv.style.maxHeight) {
        descDiv.style.maxHeight = '500px';
        descDiv.style.paddingTop = '8px';
      } else {
        descDiv.style.maxHeight = '0px';
        descDiv.style.paddingTop = '0px';
      }
    });

    card.appendChild(descDiv);
  }

  return card;
}

function buildCompanionsDisplay(companions) {
  const container = document.getElementById('companions-container');
  const section = document.getElementById('companions-section');

  // Show the companions section
  section.style.display = 'block';

  container.innerHTML = '';

  companions.forEach(companion => {
    debug.log('🔍 DEBUG: Companion object in popup:', companion);
    debug.log('🔍 DEBUG: Companion abilities:', companion.abilities);
    debug.log('🔍 DEBUG: Companion abilities keys:', Object.keys(companion.abilities));

    const companionCard = document.createElement('div');
    companionCard.className = 'action-card';
    companionCard.style.background = 'var(--bg-card)';
    companionCard.style.borderColor = 'var(--border-card)';

    // Header with name and basic info
    const header = document.createElement('div');
    header.className = 'action-header';
    header.style.cursor = 'pointer';

    const nameDiv = document.createElement('div');
    nameDiv.innerHTML = `
      <div class="action-name">🐾 ${companion.name}</div>
      <div style="font-size: 0.85em; color: var(--text-secondary); font-style: italic;">
        ${companion.size} ${companion.type}${companion.alignment ? ', ' + companion.alignment : ''}
      </div>
    `;

    header.appendChild(nameDiv);
    companionCard.appendChild(header);

    // Stats block
    const statsDiv = document.createElement('div');
    statsDiv.className = 'action-description expanded';
    statsDiv.style.display = 'block';
    statsDiv.style.background = 'var(--bg-secondary)';
    statsDiv.style.padding = '12px';
    statsDiv.style.borderRadius = '4px';
    statsDiv.style.marginTop = '10px';

    let statsHTML = '<div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 10px;">';

    // AC, HP, Speed
    if (companion.ac) statsHTML += `<div><strong>AC:</strong> ${companion.ac}</div>`;
    if (companion.hp) statsHTML += `<div><strong>HP:</strong> ${companion.hp}</div>`;
    if (companion.speed) statsHTML += `<div style="grid-column: span 3;"><strong>Speed:</strong> ${companion.speed}</div>`;

    statsHTML += '</div>';

    // Abilities
    if (Object.keys(companion.abilities).length > 0) {
      statsHTML += '<div style="display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; text-align: center; margin: 10px 0; padding: 8px; background: var(--bg-tertiary); border-radius: 4px;">';
      ['str', 'dex', 'con', 'int', 'wis', 'cha'].forEach(ability => {
        if (companion.abilities[ability]) {
          const abil = companion.abilities[ability];
          statsHTML += `
            <div>
              <div style="font-weight: bold; font-size: 0.75em; color: var(--text-secondary);">${ability.toUpperCase()}</div>
              <div style="font-size: 1.1em; color: var(--text-primary);">${abil.score}</div>
              <div style="font-size: 0.9em; color: var(--accent-success);">(${abil.modifier >= 0 ? '+' : ''}${abil.modifier})</div>
            </div>
          `;
        }
      });
      statsHTML += '</div>';
    }

    // Senses, Languages, PB
    if (companion.senses) statsHTML += `<div style="margin: 5px 0; color: var(--text-primary);"><strong>Senses:</strong> ${companion.senses}</div>`;
    if (companion.languages) statsHTML += `<div style="margin: 5px 0; color: var(--text-primary);"><strong>Languages:</strong> ${companion.languages}</div>`;
    if (companion.proficiencyBonus) statsHTML += `<div style="margin: 5px 0; color: var(--text-primary);"><strong>Proficiency Bonus:</strong> +${companion.proficiencyBonus}</div>`;

    // Features
    if (companion.features && companion.features.length > 0) {
      statsHTML += '<div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--border-color);">';
      companion.features.forEach(feature => {
        statsHTML += `<div style="margin: 8px 0; color: var(--text-primary);"><strong>${feature.name}.</strong> ${feature.description}</div>`;
      });
      statsHTML += '</div>';
    }

    // Actions with attack buttons
    if (companion.actions && companion.actions.length > 0) {
      statsHTML += '<div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--border-color); color: var(--text-primary);"><strong>Actions</strong></div>';
      companion.actions.forEach(action => {
        statsHTML += `
          <div style="margin: 10px 0; padding: 8px; background: var(--bg-action); border: 1px solid var(--accent-danger); border-radius: 4px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <div style="color: var(--text-primary);">
                <strong>${action.name}.</strong> Melee Weapon Attack: +${action.attackBonus} to hit, ${action.reach}. <em>Hit:</em> ${action.damage}
              </div>
              <div style="display: flex; gap: 8px;">
                <button class="attack-btn companion-attack-btn" data-name="${companion.name} - ${action.name}" data-bonus="${action.attackBonus}">⚔️ Attack</button>
                <button class="damage-btn companion-damage-btn" data-name="${companion.name} - ${action.name}" data-damage="${action.damage}">💥 Damage</button>
              </div>
            </div>
          </div>
        `;
      });
    }

    statsDiv.innerHTML = statsHTML;
    companionCard.appendChild(statsDiv);

    // Add event listeners for attack/damage buttons
    companionCard.querySelectorAll('.companion-attack-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const name = btn.dataset.name;
        const bonus = parseInt(btn.dataset.bonus);
        
        // Announce companion attack
        const announcement = `&{template:default} {{name=${getColoredBanner()}${characterData.name}'s ${name} attacks!}} {{Type=Companion Attack}}`;
        const messageData = {
          action: 'announceSpell',
          message: announcement,
          color: characterData.notificationColor
        };
        
        if (window.opener && !window.opener.closed) {
          try {
            window.opener.postMessage(messageData, '*');
          } catch (error) {
            debug.log('❌ Failed to send companion attack announcement:', error);
          }
        }
        
        roll(`${name} - Attack`, `1d20+${bonus}`);
      });
    });

    companionCard.querySelectorAll('.companion-damage-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const name = btn.dataset.name;
        const damage = btn.dataset.damage;
        
        // Announce companion damage
        const announcement = `&{template:default} {{name=${getColoredBanner()}${characterData.name}'s ${name} deals damage!}} {{Type=Companion Damage}}`;
        const messageData = {
          action: 'announceSpell',
          message: announcement,
          color: characterData.notificationColor
        };
        
        if (window.opener && !window.opener.closed) {
          try {
            window.opener.postMessage(messageData, '*');
          } catch (error) {
            debug.log('❌ Failed to send companion damage announcement:', error);
          }
        }
        
        roll(`${name} - Damage`, damage);
      });
    });

    container.appendChild(companionCard);
  });
}

function decrementActionUses(action) {
  if (!action.uses) {
    return true; // No uses to track, allow action
  }

  const usesTotal = action.uses.total || action.uses.value || action.uses;
  const usesUsed = action.usesUsed || 0;
  const usesRemaining = action.usesLeft !== undefined ? action.usesLeft : (usesTotal - usesUsed);

  if (usesRemaining <= 0) {
    showNotification(`❌ No uses remaining for ${action.name}`, 'error');
    return false;
  }

  // Increment usesUsed and decrement usesLeft
  action.usesUsed = usesUsed + 1;
  if (action.usesLeft !== undefined) {
    action.usesLeft = usesRemaining - 1;
  }
  const newRemaining = action.usesLeft !== undefined ? action.usesLeft : (usesTotal - action.usesUsed);

  // Update character data and save
  saveCharacterData();

  // Show notification
  showNotification(`✅ Used ${action.name} (${newRemaining}/${usesTotal} remaining)`);

  // Rebuild the actions display to show updated count
  const actionsContainer = document.getElementById('actions-container');
  buildActionsDisplay(actionsContainer, characterData.actions);

  return true;
}

/**
 * Show modal for Divine Spark choice (Heal, Necrotic, or Radiant)
 * @param {Object} action - The Divine Spark action
 * @param {Object} channelDivinityResource - The Channel Divinity resource
 */
function showDivineSparkModal(action, channelDivinityResource) {
  // Create modal overlay
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
  `;

  // Get cleric level for damage calculation
  const clericLevel = characterData.otherVariables?.clericLevel || characterData.otherVariables?.cleric?.level || 1;
  const wisdomMod = characterData.abilityScores?.wisdom?.modifier || 0;

  // Calculate number of d8 dice based on cleric level
  const diceArray = [1,1,1,1,1,1,2,2,2,2,2,2,3,3,3,3,3,4,4,4];
  const numDice = diceArray[Math.min(clericLevel, 20) - 1] || 1;

  // Create modal content
  const modalContent = document.createElement('div');
  modalContent.style.cssText = `
    background: #2a2a2a;
    border-radius: 8px;
    padding: 24px;
    max-width: 400px;
    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.5);
    color: #fff;
  `;

  modalContent.innerHTML = `
    <h3 style="margin-top: 0; margin-bottom: 16px; color: #ffd700; text-align: center;">
      ✨ Divine Spark
    </h3>
    <p style="margin-bottom: 8px; text-align: center; color: #ccc;">
      Roll: ${numDice}d8 + ${wisdomMod}
    </p>
    <p style="margin-bottom: 20px; text-align: center; font-size: 14px; color: #aaa;">
      Channel Divinity: ${channelDivinityResource.current}/${channelDivinityResource.max}
    </p>
    <p style="margin-bottom: 20px; text-align: center; color: #fff;">
      Choose the effect:
    </p>
    <div style="display: flex; flex-direction: column; gap: 12px;">
      <button id="divine-spark-heal" style="
        padding: 12px 20px;
        font-size: 16px;
        border: 2px solid #4ade80;
        background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);
        color: white;
        border-radius: 6px;
        cursor: pointer;
        font-weight: bold;
        transition: all 0.2s;
      ">💚 Heal Target</button>
      <button id="divine-spark-necrotic" style="
        padding: 12px 20px;
        font-size: 16px;
        border: 2px solid #a78bfa;
        background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%);
        color: white;
        border-radius: 6px;
        cursor: pointer;
        font-weight: bold;
        transition: all 0.2s;
      ">🖤 Necrotic Damage</button>
      <button id="divine-spark-radiant" style="
        padding: 12px 20px;
        font-size: 16px;
        border: 2px solid #fbbf24;
        background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
        color: white;
        border-radius: 6px;
        cursor: pointer;
        font-weight: bold;
        transition: all 0.2s;
      ">✨ Radiant Damage</button>
      <button id="divine-spark-cancel" style="
        padding: 10px 20px;
        font-size: 14px;
        background: #444;
        color: white;
        border: 1px solid #666;
        border-radius: 6px;
        cursor: pointer;
        margin-top: 8px;
      ">Cancel</button>
    </div>
  `;

  modal.appendChild(modalContent);

  // Add hover effects
  const buttons = modalContent.querySelectorAll('button:not(#divine-spark-cancel)');
  buttons.forEach(btn => {
    btn.addEventListener('mouseenter', () => {
      btn.style.transform = 'scale(1.05)';
      btn.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.3)';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.transform = 'scale(1)';
      btn.style.boxShadow = 'none';
    });
  });

  // Helper function to execute Divine Spark
  const executeDivineSpark = (type, color, damageType = null) => {
    // Consume Channel Divinity use
    channelDivinityResource.current -= 1;
    saveCharacterData();

    // Set the Divine Spark Choice variable in DiceCloud
    const choiceValue = type === 'heal' ? 1 : (type === 'necrotic' ? 2 : 3);
    if (characterData.otherVariables) {
      characterData.otherVariables.divineSparkChoice = choiceValue;
    }

    // Build the roll formula
    const rollFormula = `${numDice}d8 + ${wisdomMod}`;

    // Create roll description
    const effectText = type === 'heal' ? 'Healing' : `${damageType} Damage`;
    const colorBanner = `<span style="color: ${color}; font-weight: bold;">`;

    // Send the roll to Roll20
    const messageData = {
      action: 'sendRoll20Message',
      message: `&{template:default} {{name=${colorBanner}${characterData.name} uses Divine Spark}} {{Effect=${effectText}}} {{Roll=[[${rollFormula}]]}} {{Channel Divinity=${channelDivinityResource.current}/${channelDivinityResource.max}}}`,
      color: color
    };

    if (window.opener && !window.opener.closed) {
      try {
        window.opener.postMessage(messageData, '*');
      } catch (error) {
        debug.warn('⚠️ Could not send via window.opener:', error.message);
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

    // Show notification
    showNotification(`✨ Divine Spark (${effectText})! Channel Divinity: ${channelDivinityResource.current}/${channelDivinityResource.max}`, 'success');
    debug.log(`✨ Divine Spark used: ${effectText}`);

    // Rebuild sheet to show updated Channel Divinity count
    buildSheet(characterData);

    // Remove modal
    modal.remove();
  };

  // Add button click handlers
  document.getElementById('divine-spark-heal')?.addEventListener('click', () => {
    executeDivineSpark('heal', '#22c55e');
  });

  document.getElementById('divine-spark-necrotic')?.addEventListener('click', () => {
    executeDivineSpark('necrotic', '#8b5cf6', 'Necrotic');
  });

  document.getElementById('divine-spark-radiant')?.addEventListener('click', () => {
    executeDivineSpark('radiant', '#f59e0b', 'Radiant');
  });

  document.getElementById('divine-spark-cancel')?.addEventListener('click', () => {
    modal.remove();
  });

  // Close on overlay click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });

  // Add to document
  document.body.appendChild(modal);

  // Wait for modal to be in DOM before adding event listeners
  requestAnimationFrame(() => {
    const healBtn = document.getElementById('divine-spark-heal');
    const necroticBtn = document.getElementById('divine-spark-necrotic');
    const radiantBtn = document.getElementById('divine-spark-radiant');
    const cancelBtn = document.getElementById('divine-spark-cancel');

    healBtn?.addEventListener('click', () => executeDivineSpark('heal', '#22c55e'));
    necroticBtn?.addEventListener('click', () => executeDivineSpark('necrotic', '#8b5cf6', 'Necrotic'));
    radiantBtn?.addEventListener('click', () => executeDivineSpark('radiant', '#f59e0b', 'Radiant'));
    cancelBtn?.addEventListener('click', () => modal.remove());
  });
}

function showHPModal() {
  // Create modal overlay
  const modal = document.createElement('div');
  modal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; z-index: 10000;';

  // Create modal content
  const modalContent = document.createElement('div');
  modalContent.style.cssText = 'background: var(--bg-secondary); color: var(--text-primary); padding: 30px; border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,0.3); min-width: 300px;';

  const currentHP = characterData.hitPoints.current;
  const maxHP = characterData.hitPoints.max;
  const tempHP = characterData.temporaryHP || 0;

  modalContent.innerHTML = `
    <h3 style="margin: 0 0 20px 0; color: var(--text-primary); text-align: center;">Adjust Hit Points</h3>
    <div style="text-align: center; font-size: 1.2em; margin-bottom: 20px; color: var(--text-secondary);">
      Current: <strong>${currentHP}${tempHP > 0 ? `+${tempHP}` : ''} / ${maxHP}</strong>
    </div>

    <div style="margin-bottom: 20px;">
      <label style="display: block; margin-bottom: 10px; font-weight: bold; color: var(--text-primary);">Amount:</label>
      <input type="number" id="hp-amount" min="1" value="1" style="width: 100%; padding: 10px; font-size: 1.1em; border: 2px solid var(--border-color); border-radius: 6px; box-sizing: border-box; background: var(--bg-tertiary); color: var(--text-primary);">
    </div>

    <div style="margin-bottom: 25px;">
      <label style="display: block; margin-bottom: 10px; font-weight: bold; color: var(--text-primary);">Action:</label>
      <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px;">
        <button id="hp-toggle-heal" style="padding: 12px; font-size: 0.9em; font-weight: bold; border: 2px solid #27ae60; background: #27ae60; color: white; border-radius: 6px; cursor: pointer; transition: all 0.2s;">
          💚 Heal
        </button>
        <button id="hp-toggle-damage" style="padding: 12px; font-size: 0.9em; font-weight: bold; border: 2px solid var(--border-color); background: var(--bg-tertiary); color: var(--text-secondary); border-radius: 6px; cursor: pointer; transition: all 0.2s;">
          💔 Damage
        </button>
        <button id="hp-toggle-temp" style="padding: 12px; font-size: 0.9em; font-weight: bold; border: 2px solid var(--border-color); background: var(--bg-tertiary); color: var(--text-secondary); border-radius: 6px; cursor: pointer; transition: all 0.2s;">
          🛡️ Temp HP
        </button>
      </div>
    </div>

    <div style="display: flex; gap: 10px;">
      <button id="hp-cancel" style="flex: 1; padding: 12px; font-size: 1em; background: #95a5a6; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold;">
        Cancel
      </button>
      <button id="hp-confirm" style="flex: 1; padding: 12px; font-size: 1em; background: #3498db; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold;">
        Confirm
      </button>
    </div>
  `;

  modal.appendChild(modalContent);
  document.body.appendChild(modal);

  // Toggle state: 'heal', 'damage', or 'temp'
  let actionType = 'heal';

  const healBtn = document.getElementById('hp-toggle-heal');
  const damageBtn = document.getElementById('hp-toggle-damage');
  const tempBtn = document.getElementById('hp-toggle-temp');
  const amountInput = document.getElementById('hp-amount');

  // Helper function to reset all buttons
  const resetButtons = () => {
    healBtn.style.background = 'var(--bg-tertiary)';
    healBtn.style.color = '#7f8c8d';
    healBtn.style.borderColor = '#bdc3c7';
    damageBtn.style.background = 'var(--bg-tertiary)';
    damageBtn.style.color = '#7f8c8d';
    damageBtn.style.borderColor = '#bdc3c7';
    tempBtn.style.background = 'var(--bg-tertiary)';
    tempBtn.style.color = '#7f8c8d';
    tempBtn.style.borderColor = '#bdc3c7';
  };

  // Toggle button handlers
  healBtn.addEventListener('click', () => {
    actionType = 'heal';
    resetButtons();
    healBtn.style.background = '#27ae60';
    healBtn.style.color = 'white';
    healBtn.style.borderColor = '#27ae60';
  });

  damageBtn.addEventListener('click', () => {
    actionType = 'damage';
    resetButtons();
    damageBtn.style.background = '#e74c3c';
    damageBtn.style.color = 'white';
    damageBtn.style.borderColor = '#e74c3c';
  });

  tempBtn.addEventListener('click', () => {
    actionType = 'temp';
    resetButtons();
    tempBtn.style.background = '#3498db';
    tempBtn.style.color = 'white';
    tempBtn.style.borderColor = '#3498db';
  });

  // Cancel button
  document.getElementById('hp-cancel').addEventListener('click', () => {
    modal.remove();
  });

  // Confirm button
  document.getElementById('hp-confirm').addEventListener('click', () => {
    const amount = parseInt(amountInput.value);

    if (isNaN(amount) || amount <= 0) {
      showNotification('❌ Please enter a valid amount', 'error');
      return;
    }

    const oldHP = characterData.hitPoints.current;
    const oldTempHP = characterData.temporaryHP || 0;
    const colorBanner = getColoredBanner();
    let messageData;

    if (actionType === 'heal') {
      // Healing: increase current HP (up to max), doesn't affect temp HP (RAW)
      characterData.hitPoints.current = Math.min(currentHP + amount, maxHP);
      const actualHealing = characterData.hitPoints.current - oldHP;

      // Reset death saves on healing
      if (actualHealing > 0 && characterData.deathSaves && (characterData.deathSaves.successes > 0 || characterData.deathSaves.failures > 0)) {
        characterData.deathSaves.successes = 0;
        characterData.deathSaves.failures = 0;
        debug.log('♻️ Death saves reset due to healing');
      }

      showNotification(`💚 Healed ${actualHealing} HP! (${characterData.hitPoints.current}${characterData.temporaryHP > 0 ? `+${characterData.temporaryHP}` : ''}/${maxHP})`);

      messageData = {
        action: 'announceSpell',
        message: `&{template:default} {{name=${colorBanner}${characterData.name} regains HP}} {{💚 Healing=${actualHealing} HP}} {{Current HP=${characterData.hitPoints.current}${characterData.temporaryHP > 0 ? `+${characterData.temporaryHP}` : ''}/${maxHP}}}`,
        color: characterData.notificationColor
      };
    } else if (actionType === 'damage') {
      // Damage: deplete temp HP first, then current HP (RAW)
      let remainingDamage = amount;
      let tempHPLost = 0;
      let actualDamage = 0;

      if (characterData.temporaryHP > 0) {
        tempHPLost = Math.min(characterData.temporaryHP, remainingDamage);
        characterData.temporaryHP -= tempHPLost;
        remainingDamage -= tempHPLost;
      }

      if (remainingDamage > 0) {
        characterData.hitPoints.current = Math.max(currentHP - remainingDamage, 0);
        actualDamage = oldHP - characterData.hitPoints.current;
      }

      const damageMsg = tempHPLost > 0
        ? `💔 Took ${amount} damage! (${tempHPLost} temp HP${actualDamage > 0 ? ` + ${actualDamage} HP` : ''})`
        : `💔 Took ${actualDamage} damage!`;

      showNotification(`${damageMsg} (${characterData.hitPoints.current}${characterData.temporaryHP > 0 ? `+${characterData.temporaryHP}` : ''}/${maxHP})`);

      const damageDetails = tempHPLost > 0
        ? `{{Temp HP Lost=${tempHPLost}}}${actualDamage > 0 ? ` {{HP Lost=${actualDamage}}}` : ''}`
        : `{{HP Lost=${actualDamage}}}`;

      messageData = {
        action: 'announceSpell',
        message: `&{template:default} {{name=${colorBanner}${characterData.name} takes damage}} {{💔 Total Damage=${amount}}} ${damageDetails} {{Current HP=${characterData.hitPoints.current}${characterData.temporaryHP > 0 ? `+${characterData.temporaryHP}` : ''}/${maxHP}}}`,
        color: characterData.notificationColor
      };
    } else if (actionType === 'temp') {
      // Temp HP: RAW rules - new temp HP replaces old if higher, otherwise keep old
      const newTempHP = amount;
      if (newTempHP > oldTempHP) {
        characterData.temporaryHP = newTempHP;
        showNotification(`🛡️ Gained ${newTempHP} temp HP! (${characterData.hitPoints.current}+${characterData.temporaryHP}/${maxHP})`);

        messageData = {
          action: 'announceSpell',
          message: `&{template:default} {{name=${colorBanner}${characterData.name} gains temp HP}} {{🛡️ Temp HP=${newTempHP}}} {{Current HP=${characterData.hitPoints.current}+${characterData.temporaryHP}/${maxHP}}}`,
          color: characterData.notificationColor
        };
      } else {
        showNotification(`⚠️ Kept ${oldTempHP} temp HP (higher than ${newTempHP})`);
        modal.remove();
        return; // Don't send message if temp HP wasn't gained
      }
    }

    // Send message to Roll20
    if (messageData) {
      // Try window.opener first (Chrome)
      if (window.opener && !window.opener.closed) {
        try {
          window.opener.postMessage(messageData, '*');
        } catch (error) {
          debug.warn('⚠️ Could not send via window.opener:', error.message);
          // Fallback to background script relay
          browserAPI.runtime.sendMessage({
            action: 'relayRollToRoll20',
            roll: messageData
          });
        }
      } else {
        // Fallback: Use background script to relay to Roll20 (Firefox)
        browserAPI.runtime.sendMessage({
          action: 'relayRollToRoll20',
          roll: messageData
        });
      }
    }

    saveCharacterData();
    buildSheet(characterData);
    modal.remove();
  });

  // Focus on input
  amountInput.focus();
  amountInput.select();

  // Allow Enter key to confirm
  amountInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      document.getElementById('hp-confirm').click();
    }
  });

  // Click outside to close
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });
}

function showDeathSavesModal() {
  // Create modal overlay
  const modal = document.createElement('div');
  modal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; z-index: 10000;';

  // Create modal content
  const modalContent = document.createElement('div');
  modalContent.style.cssText = 'background: var(--bg-secondary); color: var(--text-primary); padding: 30px; border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,0.3); min-width: 300px;';

  // Defensive initialization for death saves
  const deathSaves = characterData.deathSaves || { successes: 0, failures: 0 };
  const successes = deathSaves.successes || 0;
  const failures = deathSaves.failures || 0;

  modalContent.innerHTML = `
    <h3 style="margin: 0 0 20px 0; color: var(--text-primary); text-align: center;">Death Saves</h3>
    <div style="text-align: center; font-size: 1.2em; margin-bottom: 20px;">
      <div style="margin-bottom: 10px;">
        <span style="color: #27ae60; font-weight: bold;">Successes: ${successes}/3</span>
      </div>
      <div>
        <span style="color: #e74c3c; font-weight: bold;">Failures: ${failures}/3</span>
      </div>
    </div>

    <div style="margin-bottom: 20px;">
      <button id="roll-death-save" style="width: 100%; padding: 15px; font-size: 1.1em; background: #3498db; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; margin-bottom: 15px;">
        🎲 Roll Death Save
      </button>
    </div>

    <div style="margin-bottom: 20px; border-top: 1px solid #ecf0f1; padding-top: 20px;">
      <label style="display: block; margin-bottom: 10px; font-weight: bold; color: var(--text-primary);">Manual Adjustment:</label>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 15px;">
        <button id="add-success" style="padding: 10px; background: #27ae60; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold;">
          + Success
        </button>
        <button id="add-failure" style="padding: 10px; background: #e74c3c; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold;">
          + Failure
        </button>
      </div>
      <button id="reset-death-saves" style="width: 100%; padding: 10px; background: #95a5a6; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold;">
        Reset All
      </button>
    </div>

    <button id="close-modal" style="width: 100%; padding: 12px; font-size: 1em; background: #7f8c8d; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold;">
      Close
    </button>
  `;

  modal.appendChild(modalContent);
  document.body.appendChild(modal);

  // Roll death save button
  document.getElementById('roll-death-save').addEventListener('click', () => {
    // Roll 1d20 locally to determine outcome
    const rollResult = Math.floor(Math.random() * 20) + 1;
    debug.log(`🎲 Death Save rolled: ${rollResult}`);

    // Determine outcome based on D&D 5e rules
    let message = '';
    let isSuccess = false;

    if (rollResult === 20) {
      // Natural 20: regain 1 HP (represented as 2 successes in death saves)
      if (!characterData.deathSaves) characterData.deathSaves = { successes: 0, failures: 0 };
      if (characterData.deathSaves.successes < 3) {
        characterData.deathSaves.successes += 2;
        if (characterData.deathSaves.successes > 3) characterData.deathSaves.successes = 3;
      }
      message = `💚 NAT 20! Death Save Success x2 (${characterData.deathSaves.successes}/3)`;
      isSuccess = true;
    } else if (rollResult === 1) {
      // Natural 1: counts as 2 failures
      if (!characterData.deathSaves) characterData.deathSaves = { successes: 0, failures: 0 };
      if (characterData.deathSaves.failures < 3) {
        characterData.deathSaves.failures += 2;
        if (characterData.deathSaves.failures > 3) characterData.deathSaves.failures = 3;
      }
      message = `💀 NAT 1! Death Save Failure x2 (${characterData.deathSaves.failures}/3)`;
    } else if (rollResult >= 10) {
      // Success
      if (!characterData.deathSaves) characterData.deathSaves = { successes: 0, failures: 0 };
      if (characterData.deathSaves.successes < 3) {
        characterData.deathSaves.successes++;
      }
      message = `✓ Death Save Success (${characterData.deathSaves.successes}/3)`;
      isSuccess = true;
    } else {
      // Failure
      if (!characterData.deathSaves) characterData.deathSaves = { successes: 0, failures: 0 };
      if (characterData.deathSaves.failures < 3) {
        characterData.deathSaves.failures++;
      }
      message = `✗ Death Save Failure (${characterData.deathSaves.failures}/3)`;
    }

    // Save updated death saves
    saveCharacterData();
    showNotification(message);

    // Send roll result to Roll20 (show result in name since we rolled locally)
    roll(`Death Save: ${rollResult}`, '1d20', rollResult);

    // Rebuild sheet to show updated death saves
    buildSheet(characterData);
    modal.remove();
  });

  // Add success button
  document.getElementById('add-success').addEventListener('click', () => {
    if (!characterData.deathSaves) characterData.deathSaves = { successes: 0, failures: 0 };
    if (characterData.deathSaves.successes < 3) {
      characterData.deathSaves.successes++;
      saveCharacterData();
      showNotification(`✓ Death Save Success (${characterData.deathSaves.successes}/3)`);
      buildSheet(characterData);
      modal.remove();
    }
  });

  // Add failure button
  document.getElementById('add-failure').addEventListener('click', () => {
    if (!characterData.deathSaves) characterData.deathSaves = { successes: 0, failures: 0 };
    if (characterData.deathSaves.failures < 3) {
      characterData.deathSaves.failures++;
      saveCharacterData();
      showNotification(`✗ Death Save Failure (${characterData.deathSaves.failures}/3)`);
      buildSheet(characterData);
      modal.remove();
    }
  });

  // Reset button
  document.getElementById('reset-death-saves').addEventListener('click', () => {
    characterData.deathSaves = { successes: 0, failures: 0 };
    saveCharacterData();
    showNotification('♻️ Death saves reset');
    buildSheet(characterData);
    modal.remove();
  });

  // Close button
  document.getElementById('close-modal').addEventListener('click', () => {
    modal.remove();
  });

  // Click outside to close
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });
}

// ===== CARD CREATION =====
// Moved to modules/card-creator.js - using wrapper for compatibility
function createCard(title, main, sub, onClick) {
  return window.CardCreator.createCard(title, main, sub, onClick);
}

// ===== COLOR UTILITIES =====
// Moved to modules/color-utils.js - using wrapper functions for compatibility
function getColorEmoji(color) {
  return window.ColorUtils.getColorEmoji(color);
}

function getColoredBanner() {
  return window.ColorUtils.getColoredBanner(characterData);
}

function getColorName(hexColor) {
  return window.ColorUtils.getColorName(hexColor);
}

// Get the spellcasting ability modifier based on character class
// Calculate spell attack bonus
// Calculate total AC including active effects
function calculateTotalAC() {
  const baseAC = characterData.armorClass || 10;
  let totalAC = baseAC;

  // Combine all active effects
  const allEffects = [
    ...activeBuffs.map(name => ({ ...POSITIVE_EFFECTS.find(e => e.name === name), type: 'buff' })),
    ...activeConditions.map(name => ({ ...NEGATIVE_EFFECTS.find(e => e.name === name), type: 'debuff' }))
  ].filter(e => e && e.autoApply && e.modifier && e.modifier.ac);

  // Apply AC modifiers from active effects
  for (const effect of allEffects) {
    const acMod = effect.modifier.ac;
    if (typeof acMod === 'number') {
      totalAC += acMod;
      debug.log(`🛡️ Applied AC modifier: ${acMod} from ${effect.name} (${effect.type})`);
    }
  }

  debug.log(`🛡️ Total AC calculation: ${baseAC} (base) + modifiers = ${totalAC}`);
  return totalAC;
}

/**
 * Announce spell description to chat
 * Called immediately when Cast button is clicked, before any modal
 */
/**
 * Legacy function kept for backward compatibility with utility spells
 * For attack/damage spells, use announceSpellDescription() instead
 */
// ===== METAMAGIC SYSTEM =====
// Core logic lives in modules/action-executor.js; these are thin wrappers
// that pass the global characterData.

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

// Helper function to find resources with flexible Channel Divinity matching
// Legacy functions for backwards compatibility (now use structured data)
function calculateMetamagicCost(metamagicName, spellLevel) {
  return executorCalculateMetamagicCost(metamagicName, spellLevel);
}

function announceAction(action) {
  // Announce the use of an action (bonus action, reaction, etc.) to Roll20 chat
  const colorBanner = getColoredBanner();

  // Determine action type emoji
  const actionTypeEmoji = {
    'bonus': '⚡',
    'reaction': '🛡️',
    'action': '⚔️',
    'free': '💨',
    'legendary': '👑',
    'lair': '🏰',
    'other': '✨'
  };

  const emoji = actionTypeEmoji[action.actionType?.toLowerCase()] || '✨';
  const actionTypeText = action.actionType ? ` (${action.actionType})` : '';

  let message = `&{template:default} {{name=${colorBanner}${characterData.name}}} {{${emoji} Action=${action.name}}} {{Type=${action.actionType || 'action'}}}`;

  // Add summary if available
  if (action.summary) {
    const resolvedSummary = resolveVariablesInFormula(action.summary);
    message += ` {{Summary=${resolvedSummary}}}`;
  }

  // Add description (resolve variables first)
  if (action.description) {
    const resolvedDescription = resolveVariablesInFormula(action.description);
    message += ` {{Description=${resolvedDescription}}}`;
  }

  // Add uses if available
  if (action.uses) {
    const usesUsed = action.usesUsed || 0;
    const usesTotal = action.uses.total || action.uses.value || action.uses;
    // Prefer usesLeft from DiceCloud if available, otherwise calculate from usesUsed
    const usesRemaining = action.usesLeft !== undefined ? action.usesLeft : (usesTotal - usesUsed);
    const usesText = `${usesRemaining} / ${usesTotal}`;
    message += ` {{Uses=${usesText}}}`;
  }

  // Send to Roll20 chat
  const messageData = {
    action: 'announceSpell',
    message: message,
    color: characterData.notificationColor
  };

  // Try window.opener first (Chrome)
  if (window.opener && !window.opener.closed) {
    try {
      window.opener.postMessage(messageData, '*');
      showNotification(`✨ ${action.name} used!`);
      debug.log('✅ Action announcement sent via window.opener');
      return;
    } catch (error) {
      debug.warn('⚠️ Could not send via window.opener:', error.message);
    }
  }

  // Fallback: Use background script to relay to Roll20 (Firefox)
  debug.log('📡 Using background script to relay action announcement to Roll20...');
  browserAPI.runtime.sendMessage({
    action: 'relayRollToRoll20',
    roll: messageData
  }, (response) => {
    if (browserAPI.runtime.lastError) {
      debug.error('❌ Error relaying action announcement:', browserAPI.runtime.lastError);
      showNotification('❌ Failed to announce action');
    } else if (response && response.success) {
      debug.log('✅ Action announcement relayed to Roll20');
      showNotification(`✨ ${action.name} used!`);
    }
  });
}

function createColorPalette(selectedColor) {
  const colors = [
    { name: 'Blue', value: '#3498db', emoji: '🔵' },
    { name: 'Red', value: '#e74c3c', emoji: '🔴' },
    { name: 'Green', value: '#27ae60', emoji: '🟢' },
    { name: 'Purple', value: '#9b59b6', emoji: '🟣' },
    { name: 'Orange', value: '#e67e22', emoji: '🟠' },
    { name: 'Teal', value: '#1abc9c', emoji: '💠' },
    { name: 'Pink', value: '#e91e63', emoji: '💖' },
    { name: 'Yellow', value: '#f1c40f', emoji: '🟡' },
    { name: 'Grey', value: '#95a5a6', emoji: '⚪' },
    { name: 'Black', value: '#34495e', emoji: '⚫' },
    { name: 'Brown', value: '#8b4513', emoji: '🟤' }
  ];

  return colors.map(color => {
    const isSelected = color.value === selectedColor;
    return `
      <div class="color-swatch"
           data-color="${color.value}"
           style="font-size: 1.5em; cursor: pointer; transition: all 0.2s; opacity: ${isSelected ? '1' : '0.85'}; transform: ${isSelected ? 'scale(1.15)' : 'scale(1)'}; filter: ${isSelected ? 'drop-shadow(0 0 4px white)' : 'none'}; text-align: center;"
           title="${color.name}">${color.emoji}</div>
    `;
  }).join('');
}

// Global flag to track if document-level click listener has been added
let colorPaletteDocumentListenerAdded = false;

function initColorPalette() {
  // Set default color if not set
  if (!characterData.notificationColor) {
    characterData.notificationColor = '#3498db';
  }

  const toggleBtnOld = document.getElementById('color-toggle');
  const palette = document.getElementById('color-palette');

  if (!toggleBtnOld || !palette) return;

  // Clone and replace toggle button to remove old listeners
  const toggleBtn = toggleBtnOld.cloneNode(true);
  toggleBtnOld.parentNode.replaceChild(toggleBtn, toggleBtnOld);

  // Toggle palette visibility
  toggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isVisible = palette.style.display === 'grid';
    palette.style.display = isVisible ? 'none' : 'grid';
  });

  // Add document-level click listener only once
  if (!colorPaletteDocumentListenerAdded) {
    // Close palette when clicking outside
    document.addEventListener('click', (e) => {
      const currentToggleBtn = document.getElementById('color-toggle');
      const currentPalette = document.getElementById('color-palette');
      if (currentPalette && currentToggleBtn) {
        if (!currentPalette.contains(e.target) && e.target !== currentToggleBtn && !currentToggleBtn.contains(e.target)) {
          currentPalette.style.display = 'none';
        }
      }
    });
    colorPaletteDocumentListenerAdded = true;
    debug.log('🎨 Added document-level color palette click listener');
  }

  // Add click handlers to color swatches
  document.querySelectorAll('.color-swatch').forEach(swatch => {
    swatch.addEventListener('click', (e) => {
      const newColor = e.target.dataset.color;
      const oldColor = characterData.notificationColor;
      characterData.notificationColor = newColor;

      // Update all swatches appearance
      document.querySelectorAll('.color-swatch').forEach(s => {
        const isSelected = s.dataset.color === newColor;
        s.style.opacity = isSelected ? '1' : '0.6';
        s.style.transform = isSelected ? 'scale(1.2)' : 'scale(1)';
        s.style.filter = isSelected ? 'drop-shadow(0 0 4px white)' : 'none';
      });

      // Update the toggle button emoji (using current element in DOM)
      const newEmoji = getColorEmoji(newColor);
      const colorEmojiEl = document.getElementById('color-emoji');
      if (colorEmojiEl) {
        colorEmojiEl.textContent = newEmoji;
      }

      // Close the palette
      palette.style.display = 'none';

      // Save to storage
      saveCharacterData();
      
      // Sync to Supabase if available
      syncColorToSupabase(newColor);
      
      showNotification(`🎨 Notification color changed to ${e.target.title}!`);
    });
  });
}

// Sync color selection to Supabase
async function syncColorToSupabase(color) {
  try {
    // Send message to background script to sync to Supabase
    const response = await browserAPI.runtime.sendMessage({
      action: 'syncCharacterColor',
      characterId: characterData.id,
      color: color
    });
    
    if (response && response.success) {
      debug.log('🎨 Color synced to Supabase successfully');
    } else {
      debug.warn('⚠️ Failed to sync color to Supabase:', response?.error);
    }
  } catch (error) {
    debug.warn('⚠️ Error syncing color to Supabase:', error);
  }
}

// Debounce timer for sync messages
function resolveVariablesInFormula(formula) {
  if (!formula || typeof formula !== 'string') {
    return formula;
  }

  debug.log(`🔧 resolveVariablesInFormula called with: "${formula}"`);

  // Check if characterData has otherVariables
  if (!characterData.otherVariables || typeof characterData.otherVariables !== 'object') {
    debug.log('⚠️ No otherVariables available for formula resolution');
    return formula;
  }

  let resolvedFormula = formula;
  let variablesResolved = [];

  // Pattern 0: Check if the entire formula is just a bare variable name (e.g., "breathWeaponDamage")
  // This must be checked BEFORE other patterns to handle cases like action.damage = "breathWeaponDamage"
  const bareVariablePattern = /^[a-zA-Z_][a-zA-Z0-9_.]*$/;
  if (bareVariablePattern.test(formula.trim())) {
    const varName = formula.trim();
    if (characterData.otherVariables.hasOwnProperty(varName)) {
      const variableValue = characterData.otherVariables[varName];

      // Extract the value
      let value = null;
      if (typeof variableValue === 'number') {
        value = variableValue;
      } else if (typeof variableValue === 'string') {
        value = variableValue;
      } else if (typeof variableValue === 'object' && variableValue.value !== undefined) {
        value = variableValue.value;
      }

      if (value !== null && value !== undefined) {
        debug.log(`✅ Resolved bare variable: ${varName} = ${value}`);
        return String(value);
      }
    }
    debug.log(`⚠️ Bare variable not found in otherVariables: ${varName}`);
  }

  // Helper function to get variable value (handles dot notation like "bard.level")
  const getVariableValue = (varPath) => {
    // Strip # prefix if present (DiceCloud reference notation)
    const cleanPath = varPath.startsWith('#') ? varPath.substring(1) : varPath;

    // Handle attribute modifiers like "strength.modifier", "wisdom.modifier"
    if (cleanPath.includes('.modifier')) {
      const attrName = cleanPath.replace('.modifier', '');
      if (characterData.attributeMods && characterData.attributeMods[attrName] !== undefined) {
        const modifier = characterData.attributeMods[attrName];
        debug.log(`✅ Resolved attribute modifier: ${cleanPath} = ${modifier}`);
        return modifier;
      }
    }

    // Handle attribute scores like "strength", "wisdom"
    if (characterData.attributes && characterData.attributes[cleanPath] !== undefined) {
      const score = characterData.attributes[cleanPath];
      debug.log(`✅ Resolved attribute score: ${cleanPath} = ${score}`);
      return score;
    }

    // Handle proficiency bonus
    if (cleanPath === 'proficiencyBonus' && characterData.proficiencyBonus !== undefined) {
      const profBonus = characterData.proficiencyBonus;
      debug.log(`✅ Resolved proficiency bonus: ${cleanPath} = ${profBonus}`);
      return profBonus;
    }

    // Handle special DiceCloud spell references (e.g., "spellList.abilityMod")
    // These reference the spellcasting ability modifier for the character's class
    if (cleanPath === 'spellList.abilityMod' || cleanPath === 'spellList.ability') {
      // Determine spellcasting ability based on character class
      const charClass = (characterData.class || '').toLowerCase();
      let spellcastingAbility = null;

      // Map classes to their spellcasting abilities
      if (charClass.includes('cleric') || charClass.includes('druid') || charClass.includes('ranger')) {
        spellcastingAbility = 'wisdom';
      } else if (charClass.includes('wizard') || charClass.includes('artificer')) {
        spellcastingAbility = 'intelligence';
      } else if (charClass.includes('bard') || charClass.includes('paladin') || charClass.includes('sorcerer') || charClass.includes('warlock')) {
        spellcastingAbility = 'charisma';
      }

      // Return the modifier for the spellcasting ability
      if (spellcastingAbility && characterData.attributeMods && characterData.attributeMods[spellcastingAbility] !== undefined) {
        const modifier = characterData.attributeMods[spellcastingAbility];
        debug.log(`✅ Resolved ${cleanPath} to ${spellcastingAbility} modifier: ${modifier}`);
        return modifier;
      }
    }

    // Handle spellList.dc (spell save DC)
    if (cleanPath === 'spellList.dc') {
      // Spell Save DC = 8 + proficiency bonus + spellcasting ability modifier
      const profBonus = characterData.proficiencyBonus || 0;
      const spellMod = getVariableValue('#spellList.abilityMod');
      if (spellMod !== null) {
        const spellDC = 8 + profBonus + spellMod;
        debug.log(`✅ Calculated spell DC: 8 + ${profBonus} + ${spellMod} = ${spellDC}`);
        return spellDC;
      }
    }

    // Handle spellList.attackBonus (spell attack bonus)
    if (cleanPath === 'spellList.attackBonus') {
      // Spell Attack Bonus = proficiency bonus + spellcasting ability modifier
      const profBonus = characterData.proficiencyBonus || 0;
      const spellMod = getVariableValue('#spellList.abilityMod');
      if (spellMod !== null) {
        const attackBonus = profBonus + spellMod;
        debug.log(`✅ Calculated spell attack bonus: ${profBonus} + ${spellMod} = ${attackBonus}`);
        return attackBonus;
      }
    }

    // Try direct lookup first
    if (characterData.otherVariables.hasOwnProperty(cleanPath)) {
      const val = characterData.otherVariables[cleanPath];
      if (typeof val === 'number') return val;
      if (typeof val === 'boolean') return val;
      if (typeof val === 'object' && val.value !== undefined) return val.value;
      if (typeof val === 'string') return val;
    }

    // Try converting dot notation (e.g., "bard.level" -> "bardLevel")
    const camelCase = cleanPath.replace(/\.([a-z])/g, (_, letter) => letter.toUpperCase());
    if (characterData.otherVariables.hasOwnProperty(camelCase)) {
      const val = characterData.otherVariables[camelCase];
      if (typeof val === 'number') return val;
      if (typeof val === 'boolean') return val;
      if (typeof val === 'object' && val.value !== undefined) return val.value;
    }

    // Try other common patterns
    const alternatives = [
      cleanPath.replace(/\./g, ''), // Remove dots
      cleanPath.split('.').pop(), // Just the last part
      cleanPath.replace(/\./g, '_') // Underscores instead
    ];

    for (const alt of alternatives) {
      if (characterData.otherVariables.hasOwnProperty(alt)) {
        const val = characterData.otherVariables[alt];
        if (typeof val === 'number') return val;
        if (typeof val === 'boolean') return val;
        if (typeof val === 'object' && val.value !== undefined) return val.value;
      }
    }

    return null;
  };

  // Pattern 1a: Find DiceCloud references in parentheses like (#spellList.abilityMod)
  const diceCloudRefPattern = /\((#[a-zA-Z_][a-zA-Z0-9_.]*)\)/g;
  let match;

  while ((match = diceCloudRefPattern.exec(formula)) !== null) {
    const varRef = match[1]; // e.g., "#spellList.abilityMod"
    const fullMatch = match[0]; // e.g., "(#spellList.abilityMod)"

    // Use getVariableValue which handles # prefix and dot notation
    const value = getVariableValue(varRef);

    if (value !== null && typeof value === 'number') {
      resolvedFormula = resolvedFormula.replace(fullMatch, value);
      variablesResolved.push(`${varRef}=${value}`);
      debug.log(`✅ Resolved DiceCloud reference: ${varRef} = ${value}`);
    } else {
      debug.log(`⚠️ Could not resolve DiceCloud reference: ${varRef}, value: ${value}`);
    }
  }

  // Pattern 1b: Find simple variables in parentheses like (variableName)
  const parenthesesPattern = /\(([a-zA-Z_][a-zA-Z0-9_]*)\)/g;

  while ((match = parenthesesPattern.exec(formula)) !== null) {
    const variableName = match[1];
    const fullMatch = match[0]; // e.g., "(sneakAttackDieAmount)"

    // Look up the variable value
    if (characterData.otherVariables.hasOwnProperty(variableName)) {
      const variableValue = characterData.otherVariables[variableName];

      // Extract numeric value
      let numericValue = null;
      if (typeof variableValue === 'number') {
        numericValue = variableValue;
      } else if (typeof variableValue === 'object' && variableValue.value !== undefined) {
        numericValue = variableValue.value;
      }

      if (numericValue !== null) {
        resolvedFormula = resolvedFormula.replace(fullMatch, numericValue);
        variablesResolved.push(`${variableName}=${numericValue}`);
        debug.log(`✅ Resolved variable: ${variableName} = ${numericValue}`);
      } else {
        debug.log(`⚠️ Could not extract numeric value from variable: ${variableName}`, variableValue);
      }
    } else {
      debug.log(`⚠️ Variable not found in otherVariables: ${variableName}`);
    }
  }

  // Pattern 2: Handle math functions like ceil{expression}, floor{expression}, etc.
  const mathFuncPattern = /(ceil|floor|round|abs)\{([^}]+)\}/gi;

  while ((match = mathFuncPattern.exec(resolvedFormula)) !== null) {
    const funcName = match[1].toLowerCase();
    const expression = match[2];
    const fullMatch = match[0]; // e.g., "ceil{proficiencyBonus/2}"

    // Replace variables in the expression
    let evalExpression = expression;
    for (const varName in characterData.otherVariables) {
      if (evalExpression.includes(varName)) {
        const variableValue = characterData.otherVariables[varName];
        let value = null;

        if (typeof variableValue === 'number') {
          value = variableValue;
        } else if (typeof variableValue === 'object' && variableValue.value !== undefined) {
          value = variableValue.value;
        }

        if (value !== null && typeof value === 'number') {
          evalExpression = evalExpression.replace(new RegExp(varName, 'g'), value);
        }
      }
    }

    // Evaluate the expression with the appropriate math function using safeMathEval
    try {
      if (/^[\d\s+\-*/().]+$/.test(evalExpression)) {
        const evalResult = safeMathEval(evalExpression);
        let result;

        switch (funcName) {
          case 'ceil':
            result = Math.ceil(evalResult);
            break;
          case 'floor':
            result = Math.floor(evalResult);
            break;
          case 'round':
            result = Math.round(evalResult);
            break;
          case 'abs':
            result = Math.abs(evalResult);
            break;
          default:
            result = evalResult;
        }

        resolvedFormula = resolvedFormula.replace(fullMatch, result);
        variablesResolved.push(`${funcName}{${expression}}=${result}`);
        debug.log(`✅ Resolved math function: ${funcName}{${expression}} = ${result}`);
      }
    } catch (e) {
      debug.log(`⚠️ Failed to evaluate ${funcName}{${expression}}`, e);
    }
  }

  // Pattern 2.5: Handle max/min functions outside of curly braces (e.g., "1d6+max(strengthModifier, dexterityModifier)")
  // Helper function to find matching closing parenthesis
  function findMatchingParen(str, startIndex) {
    let depth = 1;
    for (let i = startIndex; i < str.length; i++) {
      if (str[i] === '(') depth++;
      else if (str[i] === ')') {
        depth--;
        if (depth === 0) return i;
      }
    }
    return -1;
  }

  // Helper function to split arguments respecting nested parentheses
  function splitArgs(argsString) {
    const args = [];
    let currentArg = '';
    let depth = 0;

    for (let i = 0; i < argsString.length; i++) {
      const char = argsString[i];
      if (char === '(') {
        depth++;
        currentArg += char;
      } else if (char === ')') {
        depth--;
        currentArg += char;
      } else if (char === ',' && depth === 0) {
        args.push(currentArg.trim());
        currentArg = '';
      } else {
        currentArg += char;
      }
    }

    if (currentArg) {
      args.push(currentArg.trim());
    }

    return args;
  }

  debug.log(`🔍 Looking for max/min in formula: "${resolvedFormula}"`);

  const maxMinPattern = /(max|min)\(/gi;

  while ((match = maxMinPattern.exec(resolvedFormula)) !== null) {
    const func = match[1].toLowerCase();
    const funcStart = match.index;
    const argsStart = funcStart + match[0].length;

    // Find the matching closing parenthesis
    const closingParen = findMatchingParen(resolvedFormula, argsStart);
    if (closingParen === -1) {
      debug.log(`⚠️ No matching closing parenthesis for ${func} at position ${funcStart}`);
      continue;
    }

    const argsString = resolvedFormula.substring(argsStart, closingParen);
    const fullMatch = resolvedFormula.substring(funcStart, closingParen + 1);
    debug.log(`🔍 Found max/min match: ${func}(${argsString})`)

    try {
      const args = splitArgs(argsString).map(arg => {
        const trimmed = arg;
        debug.log(`🔍 Resolving arg: "${trimmed}"`);

        // Try to parse as number first
        const num = parseFloat(trimmed);
        if (!isNaN(num)) {
          debug.log(`  ✅ Parsed as number: ${num}`);
          return num;
        }

        // Try to resolve as simple variable
        const varVal = getVariableValue(trimmed);
        debug.log(`  🔍 Variable lookup result: ${varVal}`);
        if (varVal !== null && typeof varVal === 'number') {
          debug.log(`  ✅ Resolved as variable: ${varVal}`);
          return varVal;
        }

        // Try to evaluate as expression (e.g., "strength.modifier")
        let evalExpression = trimmed;
        const varPattern = /[a-zA-Z_][a-zA-Z0-9_.]*/g;
        let varMatch;
        const replacements = [];

        while ((varMatch = varPattern.exec(trimmed)) !== null) {
          const varName = varMatch[0];
          const value = getVariableValue(varName);
          if (value !== null && typeof value === 'number') {
            replacements.push({ name: varName, value: value });
          }
        }

        // Sort by length (longest first) to avoid partial replacements
        replacements.sort((a, b) => b.name.length - a.name.length);

        for (const {name, value} of replacements) {
          evalExpression = evalExpression.replace(new RegExp(name.replace(/\./g, '\\.'), 'g'), value);
        }

        // Handle math functions (ceil, floor, round, abs) in the expression
        evalExpression = evalExpression.replace(/ceil\(/g, 'Math.ceil(');
        evalExpression = evalExpression.replace(/floor\(/g, 'Math.floor(');
        evalExpression = evalExpression.replace(/round\(/g, 'Math.round(');
        evalExpression = evalExpression.replace(/abs\(/g, 'Math.abs(');

        // Try to evaluate
        try {
          if (/^[\d\s+\-*/().Math]+$/.test(evalExpression)) {
            const result = eval(evalExpression);
            debug.log(`  ✅ Evaluated expression "${trimmed}" = ${result}`);
            return result;
          }
        } catch (e) {
          debug.log(`  ❌ Failed to evaluate: "${trimmed}"`, e);
        }

        debug.log(`  ❌ Could not resolve: "${trimmed}"`);
        return null;
      }).filter(v => v !== null);

      if (args.length > 0) {
        const result = func === 'max' ? Math.max(...args) : Math.min(...args);
        resolvedFormula = resolvedFormula.replace(fullMatch, result);
        variablesResolved.push(`${func}(...)=${result}`);
        debug.log(`✅ Resolved ${func} function: ${fullMatch} = ${result}`);
        // Reset regex lastIndex since we modified the string
        maxMinPattern.lastIndex = 0;
      }
    } catch (e) {
      debug.log(`⚠️ Failed to resolve ${func} function: ${fullMatch}`, e);
    }
  }

  // Pattern 2.5: Handle ternary conditionals in parentheses for dice formulas like (condition?value1:value2)d6
  const parenTernaryPattern = /\(([^)]+\?[^)]+:[^)]+)\)/g;

  while ((match = parenTernaryPattern.exec(resolvedFormula)) !== null) {
    const expression = match[1];
    const fullMatch = match[0];

    // Check if this is a ternary conditional
    if (expression.includes('?') && expression.includes(':')) {
      const ternaryParts = expression.match(/^(.+?)\s*\?\s*(.+?)\s*:\s*(.+?)$/);
      if (ternaryParts) {
        const condition = ternaryParts[1].trim();
        const trueValue = ternaryParts[2].trim();
        const falseValue = ternaryParts[3].trim();

        // Evaluate the condition
        let conditionResult = false;
        const varValue = getVariableValue(condition);
        if (varValue !== null) {
          conditionResult = Boolean(varValue);
          debug.log(`✅ Evaluated parentheses ternary condition: ${condition} = ${conditionResult}`);
        }

        // Choose the appropriate value
        const chosenValue = conditionResult ? trueValue : falseValue;

        // Replace the entire match with the chosen value
        resolvedFormula = resolvedFormula.replace(fullMatch, chosenValue);
        variablesResolved.push(`(${condition}?${trueValue}:${falseValue}) = ${chosenValue}`);
        debug.log(`✅ Resolved parentheses ternary: (${expression}) => ${chosenValue}`);

        // Reset regex lastIndex since we modified the string
        parenTernaryPattern.lastIndex = 0;
      }
    }
  }

  // Pattern 3: Find variables/expressions in curly braces like {variableName} or {3*cleric.level}
  const bracesPattern = /\{([^}]+)\}/g;

  while ((match = bracesPattern.exec(resolvedFormula)) !== null) {
    const expression = match[1];
    const fullMatch = match[0];

    // Strip markdown formatting
    let cleanExpr = expression.replace(/\*\*/g, '');

    // Handle ternary operators: {condition ? trueValue : falseValue}
    // First try complex ternary with concatenation and functions: level >= 5 ? "+ " + floor((level+1)/6) + "d8" : ""
    const complexTernaryPattern = /^(.+?)\s*\?\s*(.+?)\s*:\s*(.+?)$/;
    const complexTernaryMatch = cleanExpr.match(complexTernaryPattern);
    if (complexTernaryMatch && cleanExpr.includes('?') && cleanExpr.includes(':')) {
      const condition = complexTernaryMatch[1].trim();
      const trueBranch = complexTernaryMatch[2].trim();
      const falseBranch = complexTernaryMatch[3].trim();

      // Evaluate the condition
      let conditionResult = false;
      try {
        // Check if condition is just a simple variable name
        const simpleVarPattern = /^[a-zA-Z_][a-zA-Z0-9_.]*$/;
        if (simpleVarPattern.test(condition.trim())) {
          const varValue = getVariableValue(condition.trim());
          if (varValue !== null) {
            // Convert to boolean: numbers, strings, booleans
            conditionResult = Boolean(varValue);
          } else {
            // Variable doesn't exist, treat as false
            conditionResult = false;
          }
          debug.log(`✅ Evaluated simple variable condition: ${condition} = ${conditionResult}`);
        } else {
          // Complex condition with operators
          // Replace variables in condition
          let evalCondition = condition;
          const varPattern = /[a-zA-Z_][a-zA-Z0-9_.]*/g;
          let varMatch;
          const replacements = [];

          while ((varMatch = varPattern.exec(condition)) !== null) {
            const varName = varMatch[0];
            // Skip reserved words
            if (['true', 'false', 'null', 'undefined'].includes(varName.toLowerCase())) {
              continue;
            }
            const value = getVariableValue(varName);
            if (value !== null) {
              // Handle numbers, strings, and booleans
              if (typeof value === 'number') {
                replacements.push({ name: varName, value: value });
              } else if (typeof value === 'boolean') {
                replacements.push({ name: varName, value: value });
              } else if (typeof value === 'string') {
                // Convert string to boolean for condition evaluation
                const boolValue = value !== '' && value !== '0' && value.toLowerCase() !== 'false';
                replacements.push({ name: varName, value: boolValue });
              }
            } else {
              // Variable doesn't exist, replace with false
              replacements.push({ name: varName, value: false });
            }
          }

          // Sort by length (longest first) to avoid partial replacements
          replacements.sort((a, b) => b.name.length - a.name.length);

          for (const {name, value} of replacements) {
            evalCondition = evalCondition.replace(new RegExp(name.replace(/\./g, '\\.'), 'g'), value);
          }

          // Evaluate condition
          if (/^[\w\s+\-*/><=!&|()\.]+$/.test(evalCondition)) {
            conditionResult = eval(evalCondition);
          }
        }
      } catch (e) {
        debug.log(`⚠️ Failed to evaluate ternary condition: ${condition}`, e);
      }

      // Evaluate the chosen branch
      const chosenBranch = conditionResult ? trueBranch : falseBranch;
      let result = '';

      try {
        // Handle string concatenation with + operator
        // Pattern: "string" + expression + "string"
        if (chosenBranch.includes('+')) {
          const parts = [];
          let current = '';
          let inString = false;
          let i = 0;

          while (i < chosenBranch.length) {
            const char = chosenBranch[i];

            if (char === '"') {
              if (inString) {
                // End of string
                parts.push({ type: 'string', value: current });
                current = '';
                inString = false;
              } else {
                // Start of string
                inString = true;
              }
              i++;
            } else if (char === '+' && !inString) {
              // Operator outside string
              if (current.trim()) {
                parts.push({ type: 'expr', value: current.trim() });
                current = '';
              }
              i++;
            } else {
              current += char;
              i++;
            }
          }

          // Add remaining part
          if (current.trim()) {
            if (inString) {
              parts.push({ type: 'string', value: current });
            } else {
              parts.push({ type: 'expr', value: current.trim() });
            }
          }

          // Evaluate each part and concatenate
          for (const part of parts) {
            if (part.type === 'string') {
              result += part.value;
            } else {
              // Evaluate expression (may contain floor(), variables, etc.)
              let exprResult = part.value;

              // Handle floor() function
              const floorMatch = exprResult.match(/floor\(([^)]+)\)/);
              if (floorMatch) {
                const floorExpr = floorMatch[1];
                // Resolve variables in floor expression
                let evalExpr = floorExpr;
                const varPattern = /[a-zA-Z_][a-zA-Z0-9_.]*/g;
                let varMatch;
                const replacements = [];

                while ((varMatch = varPattern.exec(floorExpr)) !== null) {
                  const varName = varMatch[0];
                  const value = getVariableValue(varName);
                  if (value !== null && typeof value === 'number') {
                    replacements.push({ name: varName, value: value });
                  }
                }

                replacements.sort((a, b) => b.name.length - a.name.length);
                for (const {name, value} of replacements) {
                  evalExpr = evalExpr.replace(new RegExp(name.replace(/\./g, '\\.'), 'g'), value);
                }

                if (/^[\d\s+\-*/().]+$/.test(evalExpr)) {
                  const floorResult = Math.floor(eval(evalExpr));
                  exprResult = exprResult.replace(floorMatch[0], floorResult);
                }
              }

              // Try to resolve as variable or evaluate
              const varValue = getVariableValue(exprResult);
              if (varValue !== null) {
                result += varValue;
              } else if (/^[\d\s+\-*/().]+$/.test(exprResult)) {
                result += eval(exprResult);
              } else {
                result += exprResult;
              }
            }
          }
        } else if (chosenBranch.startsWith('"') && chosenBranch.endsWith('"')) {
          // Simple quoted string
          result = chosenBranch.slice(1, -1);
        } else {
          // Try to evaluate as expression
          result = chosenBranch;
        }

        resolvedFormula = resolvedFormula.replace(fullMatch, result);
        variablesResolved.push(`${condition} ? ... : ... = "${result}"`);
        debug.log(`✅ Resolved complex ternary: ${condition} (${conditionResult}) => "${result}"`);
        continue;
      } catch (e) {
        debug.log(`⚠️ Failed to resolve ternary expression: ${cleanExpr}`, e);
      }
    }

    // Try as simple variable first
    let simpleValue = getVariableValue(cleanExpr);
    if (simpleValue !== null) {
      resolvedFormula = resolvedFormula.replace(fullMatch, simpleValue);
      variablesResolved.push(`${cleanExpr}=${simpleValue}`);
      debug.log(`✅ Resolved variable: ${cleanExpr} = ${simpleValue}`);
      continue;
    }

    // Handle array indexing: [array][index]
    const arrayPattern = /^\[([^\]]+)\]\[([^\]]+)\]$/;
    const arrayMatch = cleanExpr.match(arrayPattern);
    if (arrayMatch) {
      try {
        const arrayPart = arrayMatch[1];
        const indexPart = arrayMatch[2];

        // Parse array (handle both numbers and string values like "N/A")
        const arrayValues = arrayPart.split(',').map(v => {
          const trimmed = v.trim();
          // Remove quotes if present
          const unquoted = trimmed.replace(/^["']|["']$/g, '');
          // Try to parse as number, otherwise keep as string
          const num = parseFloat(unquoted);
          return isNaN(num) ? unquoted : num;
        });

        // Resolve index variable
        let indexValue = getVariableValue(indexPart);

        if (indexValue !== null && !isNaN(indexValue)) {
          // Try direct index first
          let result = arrayValues[indexValue];

          // If out of bounds and index > 0, try index-1 (for 1-based level arrays)
          if (result === undefined && indexValue > 0) {
            result = arrayValues[indexValue - 1];
            if (result !== undefined) {
              debug.log(`📊 Array index ${indexValue} out of bounds, using ${indexValue - 1} instead`);
              indexValue = indexValue - 1;
            }
          }

          if (result !== undefined) {
            resolvedFormula = resolvedFormula.replace(fullMatch, result);
            variablesResolved.push(`array[${indexValue}]=${result}`);
            debug.log(`✅ Resolved array indexing: ${cleanExpr} = ${result}`);
            continue;
          } else {
            debug.log(`⚠️ Array index ${indexValue} out of bounds (array length: ${arrayValues.length})`);
          }
        } else {
          debug.log(`⚠️ Could not resolve index variable: ${indexPart}`);
        }
      } catch (e) {
        debug.log(`⚠️ Failed to resolve array indexing: ${cleanExpr}`, e);
      }
    }

    // Handle max/min functions (can be standalone or part of larger expression)
    const maxMinPattern = /^(max|min)\(([^)]+)\)$/i;
    const maxMinMatch = cleanExpr.match(maxMinPattern);
    if (maxMinMatch) {
      try {
        const func = maxMinMatch[1].toLowerCase();
        const args = maxMinMatch[2].split(',').map(arg => {
          const trimmed = arg.trim();
          // Try to parse as number first
          const num = parseFloat(trimmed);
          if (!isNaN(num)) return num;

          // Try to resolve as variable
          const varVal = getVariableValue(trimmed);
          if (varVal !== null) return varVal;

          return null;
        }).filter(v => v !== null);

        if (args.length > 0) {
          const result = func === 'max' ? Math.max(...args) : Math.min(...args);
          resolvedFormula = resolvedFormula.replace(fullMatch, result);
          variablesResolved.push(`${func}(...)=${result}`);
          debug.log(`✅ Resolved ${func} function: ${cleanExpr} = ${result}`);
          continue;
        }
      } catch (e) {
        debug.log(`⚠️ Failed to resolve ${cleanExpr}`, e);
      }
    }

    // Handle ceil/floor/round/abs functions with parentheses: ceil(expr), floor(expr), etc.
    const mathFuncParenPattern = /^(ceil|floor|round|abs)\(([^)]+)\)$/i;
    const mathFuncParenMatch = cleanExpr.match(mathFuncParenPattern);
    if (mathFuncParenMatch) {
      try {
        const funcName = mathFuncParenMatch[1].toLowerCase();
        const expression = mathFuncParenMatch[2];

        // Replace variables in the expression
        let evalExpression = expression;
        const varPattern = /[a-zA-Z_][a-zA-Z0-9_.]*/g;
        let varMatch;
        const replacements = [];

        while ((varMatch = varPattern.exec(expression)) !== null) {
          const varName = varMatch[0];
          const value = getVariableValue(varName);
          if (value !== null && typeof value === 'number') {
            replacements.push({ name: varName, value: value });
          }
        }

        // Sort by length (longest first) to avoid partial replacements
        replacements.sort((a, b) => b.name.length - a.name.length);

        for (const {name, value} of replacements) {
          evalExpression = evalExpression.replace(new RegExp(name.replace(/\./g, '\\.'), 'g'), value);
        }

        // Evaluate the expression using safeMathEval
        if (/^[\d\s+\-*/().]+$/.test(evalExpression)) {
          const evalResult = safeMathEval(evalExpression);
          let result;

          switch (funcName) {
            case 'ceil':
              result = Math.ceil(evalResult);
              break;
            case 'floor':
              result = Math.floor(evalResult);
              break;
            case 'round':
              result = Math.round(evalResult);
              break;
            case 'abs':
              result = Math.abs(evalResult);
              break;
            default:
              result = evalResult;
          }

          resolvedFormula = resolvedFormula.replace(fullMatch, result);
          variablesResolved.push(`${funcName}(${expression})=${result}`);
          debug.log(`✅ Resolved math function: ${funcName}(${expression}) = ${result}`);
          continue;
        }
      } catch (e) {
        debug.log(`⚠️ Failed to resolve ${cleanExpr}`, e);
      }
    }

    // Try to evaluate as math expression
    let evalExpression = cleanExpr;

    // Replace all variable names with their values (sorted by length to avoid partial matches)
    const varPattern = /[a-zA-Z_][a-zA-Z0-9_.]*/g;
    let varMatch;
    const replacements = [];

    while ((varMatch = varPattern.exec(cleanExpr)) !== null) {
      const varName = varMatch[0];
      const value = getVariableValue(varName);
      if (value !== null && typeof value === 'number') {
        replacements.push({ name: varName, value: value });
      }
    }

    // Sort by length (longest first) to avoid partial replacements
    replacements.sort((a, b) => b.name.length - a.name.length);

    for (const {name, value} of replacements) {
      evalExpression = evalExpression.replace(new RegExp(name.replace(/\./g, '\\.'), 'g'), value);
    }

    // Try to evaluate the expression using safeMathEval
    try {
      if (/^[\d\s+\-*/().]+$/.test(evalExpression)) {
        const result = safeMathEval(evalExpression);
        resolvedFormula = resolvedFormula.replace(fullMatch, Math.floor(result));
        variablesResolved.push(`${cleanExpr}=${Math.floor(result)}`);
        debug.log(`✅ Resolved expression: ${cleanExpr} = ${Math.floor(result)}`);
      } else {
        debug.log(`⚠️ Could not resolve expression: ${cleanExpr} (eval: ${evalExpression})`);
      }
    } catch (e) {
      debug.log(`⚠️ Failed to evaluate expression: ${cleanExpr}`, e);
    }
  }

  if (variablesResolved.length > 0) {
    debug.log(`🔧 Formula resolution: "${formula}" -> "${resolvedFormula}" (${variablesResolved.join(', ')})`);
  }

  // Strip remaining markdown formatting
  resolvedFormula = resolvedFormula.replace(/\*\*/g, ''); // Remove bold markers

  // Parse inline calculations in curly braces {expression}
  // DiceCloud uses {varName} or {varName + 2} syntax in text
  const inlineCalcPattern = /\{([^}]+)\}/g;
  resolvedFormula = resolvedFormula.replace(inlineCalcPattern, (fullMatch, expression) => {
    try {
      // First try to resolve variables in the expression
      let resolvedExpr = expression;

      // Replace variable names with their values
      const varPattern = /[a-zA-Z_][a-zA-Z0-9_.]*/g;
      resolvedExpr = resolvedExpr.replace(varPattern, (varName) => {
        const value = getVariableValue(varName);
        return value !== null ? value : varName;
      });

      // Try to evaluate as math expression using safeMathEval
      // Only if it contains operators or is a number
      if (/[\d+\-*\/()]/.test(resolvedExpr)) {
        try {
          // Use safeMathEval for CSP-compliant evaluation
          const result = safeMathEval(resolvedExpr);
          debug.log(`✅ Evaluated inline calculation: {${expression}} = ${result}`);
          return result;
        } catch (e) {
          debug.log(`⚠️ Failed to evaluate inline calculation: {${expression}}`, e);
        }
      }

      // If it's just a variable lookup that was resolved, return it
      if (resolvedExpr !== expression && !/[a-zA-Z_]/.test(resolvedExpr)) {
        return resolvedExpr;
      }
    } catch (e) {
      debug.log(`⚠️ Error processing inline calculation: {${expression}}`, e);
    }

    // Return original if we couldn't resolve
    return fullMatch;
  });

  return resolvedFormula;
}

/**
 * Safe math expression evaluator that doesn't use eval() or Function()
 * CSP-compliant parser for basic arithmetic and Math functions
 */
function safeMathEval(expr) {
  // Tokenize the expression
  const tokens = [];
  let i = 0;
  expr = expr.replace(/\s+/g, ''); // Remove whitespace

  while (i < expr.length) {
    // Check for Math functions and max/min
    if (expr.substr(i, 10) === 'Math.floor') {
      tokens.push({ type: 'function', value: 'floor' });
      i += 10;
    } else if (expr.substr(i, 9) === 'Math.ceil') {
      tokens.push({ type: 'function', value: 'ceil' });
      i += 9;
    } else if (expr.substr(i, 10) === 'Math.round') {
      tokens.push({ type: 'function', value: 'round' });
      i += 10;
    } else if (expr.substr(i, 3) === 'max') {
      tokens.push({ type: 'function', value: 'max' });
      i += 3;
    } else if (expr.substr(i, 3) === 'min') {
      tokens.push({ type: 'function', value: 'min' });
      i += 3;
    } else if (expr[i] >= '0' && expr[i] <= '9' || expr[i] === '.') {
      // Parse number
      let num = '';
      while (i < expr.length && (expr[i] >= '0' && expr[i] <= '9' || expr[i] === '.')) {
        num += expr[i];
        i++;
      }
      tokens.push({ type: 'number', value: parseFloat(num) });
    } else if ('+-*/(),'.includes(expr[i])) {
      tokens.push({ type: 'operator', value: expr[i] });
      i++;
    } else {
      throw new Error(`Unexpected character: ${expr[i]}`);
    }
  }

  // Parse and evaluate using recursive descent
  let pos = 0;

  function parseExpression() {
    let left = parseTerm();

    while (pos < tokens.length && tokens[pos].type === 'operator' && (tokens[pos].value === '+' || tokens[pos].value === '-')) {
      const op = tokens[pos].value;
      pos++;
      const right = parseTerm();
      left = op === '+' ? left + right : left - right;
    }

    return left;
  }

  function parseTerm() {
    let left = parseFactor();

    while (pos < tokens.length && tokens[pos].type === 'operator' && (tokens[pos].value === '*' || tokens[pos].value === '/')) {
      const op = tokens[pos].value;
      pos++;
      const right = parseFactor();
      left = op === '*' ? left * right : left / right;
    }

    return left;
  }

  function parseFactor() {
    const token = tokens[pos];

    // Handle numbers
    if (token.type === 'number') {
      pos++;
      return token.value;
    }

    // Handle Math functions
    if (token.type === 'function') {
      const funcName = token.value;
      pos++;
      if (pos >= tokens.length || tokens[pos].value !== '(') {
        throw new Error('Expected ( after function name');
      }
      pos++; // Skip (
      
      // Handle multiple arguments for max/min functions
      const args = [];
      if (funcName === 'max' || funcName === 'min') {
        // Parse comma-separated arguments
        args.push(parseExpression());
        while (pos < tokens.length && tokens[pos].value === ',') {
          pos++; // Skip comma
          args.push(parseExpression());
        }
      } else {
        // Single argument for other functions
        args.push(parseExpression());
      }
      
      if (pos >= tokens.length || tokens[pos].value !== ')') {
        throw new Error('Expected ) after function argument');
      }
      pos++; // Skip )

      if (funcName === 'floor') return Math.floor(args[0]);
      if (funcName === 'ceil') return Math.ceil(args[0]);
      if (funcName === 'round') return Math.round(args[0]);
      if (funcName === 'max') return Math.max(...args);
      if (funcName === 'min') return Math.min(...args);
      throw new Error(`Unknown function: ${funcName}`);
    }

    // Handle parentheses
    if (token.type === 'operator' && token.value === '(') {
      pos++;
      const result = parseExpression();
      if (pos >= tokens.length || tokens[pos].value !== ')') {
        throw new Error('Mismatched parentheses');
      }
      pos++;
      return result;
    }

    // Handle unary minus
    if (token.type === 'operator' && token.value === '-') {
      pos++;
      return -parseFactor();
    }

    throw new Error(`Unexpected token: ${JSON.stringify(token)}`);
  }

  return parseExpression();
}

/**
 * Evaluate simple mathematical expressions in formulas
 * Converts things like "5*5" to "25" before sending to Roll20
 * CSP-compliant - does not use eval() or Function() constructor
 */
function evaluateMathInFormula(formula) {
  if (!formula || typeof formula !== 'string') {
    return formula;
  }

  let currentFormula = formula;
  let previousFormula = null;
  let iterations = 0;
  const maxIterations = 10; // Prevent infinite loops

  // Keep simplifying until formula doesn't change or max iterations reached
  while (currentFormula !== previousFormula && iterations < maxIterations) {
    previousFormula = currentFormula;
    iterations++;

    // Replace floor() with Math.floor() for parsing
    let processedFormula = currentFormula.replace(/floor\(/g, 'Math.floor(');
    processedFormula = processedFormula.replace(/ceil\(/g, 'Math.ceil(');
    processedFormula = processedFormula.replace(/round\(/g, 'Math.round(');

    // Check if the formula is just a simple math expression (no dice)
    // Pattern: numbers and operators only (e.g., "5*5", "10+5", "20/4")
    const simpleMathPattern = /^[\d\s+\-*/().]+$/;

    if (simpleMathPattern.test(processedFormula)) {
      try {
        const result = safeMathEval(processedFormula);
        if (typeof result === 'number' && !isNaN(result)) {
          debug.log(`✅ Evaluated simple math: ${currentFormula} = ${result} (iteration ${iterations})`);
          currentFormula = String(result);
          continue;
        }
      } catch (e) {
        debug.log(`⚠️ Could not evaluate math expression: ${currentFormula}`, e);
      }
    }

    // Handle formulas with dice notation like "(floor((9 + 1) / 6) + 1)d8" or "(3 * 1)d6"
    // Extract math before the dice, evaluate it, then reconstruct
    const dicePattern = /^(.+?)(d\d+.*)$/i;
    const match = processedFormula.match(dicePattern);

    if (match) {
      const mathPart = match[1]; // e.g., "(Math.floor((9 + 1) / 6) + 1)" or "(3 * 1)"
      const dicePart = match[2]; // e.g., "d8" or "d6"

      // Check if the math part is evaluable (allows numbers, operators, parens, and Math functions)
      const mathOnlyPattern = /^[\d\s+\-*/().\w]+$/;
      if (mathOnlyPattern.test(mathPart)) {
        try {
          const result = safeMathEval(mathPart);
          if (typeof result === 'number' && !isNaN(result)) {
            debug.log(`✅ Evaluated dice formula math: ${mathPart} = ${result} (iteration ${iterations})`);
            currentFormula = String(result) + dicePart;
            continue;
          }
        } catch (e) {
          debug.log(`⚠️ Could not evaluate dice formula math: ${mathPart}`, e);
        }
      }
    }
  }

  if (iterations > 1) {
    debug.log(`🔄 Formula simplified in ${iterations} iterations: "${formula}" -> "${currentFormula}"`);
  }

  return currentFormula;
}

/**
 * Apply active effect modifiers to a roll
 * @param {string} rollName - Name of the roll (e.g., "Attack", "Perception", "Strength Save")
 * @param {string} formula - Original formula
 * @returns {object} - { modifiedFormula, effectNotes }
 */
function applyEffectModifiers(rollName, formula) {
  const rollLower = rollName.toLowerCase();
  let modifiedFormula = formula;
  const effectNotes = [];

  // Combine all active effects
  const allEffects = [
    ...activeBuffs.map(name => ({ ...POSITIVE_EFFECTS.find(e => e.name === name), type: 'buff' })),
    ...activeConditions.map(name => ({ ...NEGATIVE_EFFECTS.find(e => e.name === name), type: 'debuff' }))
  ].filter(e => e && e.autoApply);

  debug.log(`🎲 Checking effects for roll: ${rollName}`, allEffects);

  for (const effect of allEffects) {
    if (!effect.modifier) continue;

    let applied = false;

    // Check for attack roll modifiers
    if (rollLower.includes('attack') && effect.modifier.attack) {
      const mod = effect.modifier.attack;
      if (mod === 'advantage') {
        effectNotes.push(`[${effect.icon} ${effect.name}: Advantage]`);
        applied = true;
      } else if (mod === 'disadvantage') {
        effectNotes.push(`[${effect.icon} ${effect.name}: Disadvantage]`);
        applied = true;
      } else {
        modifiedFormula += ` + ${mod}`;
        effectNotes.push(`[${effect.icon} ${effect.name}: ${mod}]`);
        applied = true;
      }
    }

    // Check for saving throw modifiers
    if (rollLower.includes('save') && (effect.modifier.save || effect.modifier.strSave || effect.modifier.dexSave)) {
      const mod = effect.modifier.save ||
                 (rollLower.includes('strength') && effect.modifier.strSave) ||
                 (rollLower.includes('dexterity') && effect.modifier.dexSave);

      if (mod === 'advantage') {
        effectNotes.push(`[${effect.icon} ${effect.name}: Advantage]`);
        applied = true;
      } else if (mod === 'disadvantage') {
        effectNotes.push(`[${effect.icon} ${effect.name}: Disadvantage]`);
        applied = true;
      } else if (mod === 'fail') {
        effectNotes.push(`[${effect.icon} ${effect.name}: Auto-fail]`);
        applied = true;
      } else if (mod) {
        modifiedFormula += ` + ${mod}`;
        effectNotes.push(`[${effect.icon} ${effect.name}: ${mod}]`);
        applied = true;
      }
    }

    // Check for skill check modifiers
    if ((rollLower.includes('check') || rollLower.includes('perception') ||
         rollLower.includes('stealth') || rollLower.includes('investigation') ||
         rollLower.includes('insight') || rollLower.includes('persuasion') ||
         rollLower.includes('deception') || rollLower.includes('intimidation') ||
         rollLower.includes('athletics') || rollLower.includes('acrobatics')) &&
        effect.modifier.skill) {
      const mod = effect.modifier.skill;
      if (mod === 'advantage') {
        effectNotes.push(`[${effect.icon} ${effect.name}: Advantage]`);
        applied = true;
      } else if (mod === 'disadvantage') {
        effectNotes.push(`[${effect.icon} ${effect.name}: Disadvantage]`);
        applied = true;
      } else {
        modifiedFormula += ` + ${mod}`;
        effectNotes.push(`[${effect.icon} ${effect.name}: ${mod}]`);
        applied = true;
      }
    }

    // Check for damage modifiers
    if (rollLower.includes('damage') && effect.modifier.damage) {
      modifiedFormula += ` + ${effect.modifier.damage}`;
      effectNotes.push(`[${effect.icon} ${effect.name}: +${effect.modifier.damage}]`);
      applied = true;
    }

    if (applied) {
      debug.log(`✅ Applied ${effect.name} (${effect.type}) to ${rollName}`);
    }
  }

  return { modifiedFormula, effectNotes };
}

/**
 * Check for optional effects that could apply to a roll and show popup if found
 * @param {string} rollName - Name of the roll
 * @param {string} formula - Original formula
 * @param {function} onApply - Callback function to apply the effect
 */
function checkOptionalEffects(rollName, formula, onApply) {
  const rollLower = rollName.toLowerCase();

  // Combine all active effects that are NOT autoApply
  const optionalEffects = [
    ...activeBuffs.map(name => ({ ...POSITIVE_EFFECTS.find(e => e.name === name), type: 'buff' })),
    ...activeConditions.map(name => ({ ...NEGATIVE_EFFECTS.find(e => e.name === name), type: 'debuff' }))
  ].filter(e => e && !e.autoApply && e.modifier);

  if (optionalEffects.length === 0) return;

  debug.log(`🎲 Checking optional effects for roll: ${rollName}`, optionalEffects);

  const applicableEffects = [];

  for (const effect of optionalEffects) {
    let applicable = false;

    // Check for skill check modifiers (for Guidance) - ALL skills
    const isSkillCheck = rollLower.includes('check') || 
                        rollLower.includes('acrobatics') || rollLower.includes('animal') ||
                        rollLower.includes('arcana') || rollLower.includes('athletics') ||
                        rollLower.includes('deception') || rollLower.includes('history') ||
                        rollLower.includes('insight') || rollLower.includes('intimidation') ||
                        rollLower.includes('investigation') || rollLower.includes('medicine') ||
                        rollLower.includes('nature') || rollLower.includes('perception') ||
                        rollLower.includes('performance') || rollLower.includes('persuasion') ||
                        rollLower.includes('religion') || rollLower.includes('sleight') ||
                        rollLower.includes('stealth') || rollLower.includes('survival');
    
    if (isSkillCheck && effect.modifier.skill) {
      applicable = true;
    }

    // Check for attack roll modifiers
    if (rollLower.includes('attack') && effect.modifier.attack) {
      applicable = true;
    }

    // Check for saving throw modifiers
    if (rollLower.includes('save') && effect.modifier.save) {
      applicable = true;
    }

    // Special handling for Bardic Inspiration - applies to checks, attacks, and saves
    if (effect.name.startsWith('Bardic Inspiration')) {
      if (rollLower.includes('check') || rollLower.includes('perception') ||
          rollLower.includes('stealth') || rollLower.includes('investigation') ||
          rollLower.includes('insight') || rollLower.includes('persuasion') ||
          rollLower.includes('deception') || rollLower.includes('intimidation') ||
          rollLower.includes('athletics') || rollLower.includes('acrobatics') ||
          rollLower.includes('attack') || rollLower.includes('save')) {
        applicable = true;
      }
    }

    if (applicable) {
      applicableEffects.push(effect);
    }
  }

  if (applicableEffects.length > 0) {
    showOptionalEffectPopup(applicableEffects, rollName, formula, onApply);
  }
}

/**
 * Show popup for optional effects
 */
function showOptionalEffectPopup(effects, rollName, formula, onApply) {
  debug.log('🎯 Showing optional effect popup for:', effects);

  if (!document.body) {
    debug.error('❌ document.body not available for optional effect popup');
    return;
  }

  // Get theme-aware colors
  const colors = getPopupThemeColors();

  // Create modal overlay
  const popupOverlay = document.createElement('div');
  popupOverlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(2px);
    z-index: 10000;
    display: flex;
    align-items: center;
    justify-content: center;
  `;

  // Create popup content
  const popupContent = document.createElement('div');
  popupContent.style.cssText = `
    background: ${colors.background};
    border-radius: 12px;
    padding: 24px;
    max-width: 400px;
    width: 90%;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
    text-align: center;
    border: 2px solid var(--accent-primary);
  `;

  // Build effects list
  const effectsList = effects.map(effect => `
    <div style="margin: 12px 0; padding: 12px; background: ${effect.color}20; border: 2px solid ${effect.color}; border-radius: 8px; cursor: pointer; transition: all 0.2s;" 
         onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 4px 12px rgba(0,0,0,0.15)'"
         onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='none'"
         data-effect="${effect.name}" data-type="${effect.type}">
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="font-size: 1.2em;">${effect.icon}</span>
        <div style="flex: 1; text-align: left;">
          <div style="font-weight: bold; color: var(--text-primary);">${effect.name}</div>
          <div style="font-size: 0.85em; color: var(--text-secondary); margin-top: 2px;">${effect.description}</div>
        </div>
      </div>
    </div>
  `).join('');

  popupContent.innerHTML = `
    <div style="font-size: 24px; margin-bottom: 16px;">🎯</div>
    <h2 style="margin: 0 0 8px 0; color: ${colors.heading};">Optional Effect Available!</h2>
    <p style="margin: 0 0 16px 0; color: ${colors.text};">
      You can apply an optional effect to your <strong>${rollName}</strong> roll:
    </p>
    ${effectsList}
    <div style="margin-top: 20px; display: flex; gap: 10px; justify-content: center;">
      <button id="skip-effect" style="background: var(--bg-tertiary); color: var(--text-primary); border: 1px solid var(--border-color); padding: 8px 16px; border-radius: 6px; cursor: pointer; font-weight: 600;">
        Skip
      </button>
    </div>
  `;

  popupOverlay.appendChild(popupContent);
  document.body.appendChild(popupOverlay);

  // Add click handlers for effect options
  popupContent.querySelectorAll('[data-effect]').forEach(effectDiv => {
    effectDiv.addEventListener('click', () => {
      const effectName = effectDiv.dataset.effect;
      const effectType = effectDiv.dataset.type;
      const effect = effects.find(e => e.name === effectName);
      
      if (effect && onApply) {
        onApply(effect);
      }
      
      document.body.removeChild(popupOverlay);
    });
  });

  // Skip button
  document.getElementById('skip-effect').addEventListener('click', () => {
    document.body.removeChild(popupOverlay);
  });

  // Close on overlay click
  popupOverlay.addEventListener('click', (e) => {
    if (e.target === popupOverlay) {
      document.body.removeChild(popupOverlay);
    }
  });

  debug.log('🎯 Optional effect popup displayed');
}

function roll(name, formula, prerolledResult = null) {
  debug.log('🎲 Rolling:', name, formula, prerolledResult ? `(prerolled: ${prerolledResult})` : '');

  // Resolve any variables in the formula
  let resolvedFormula = resolveVariablesInFormula(formula);

  // Check if there are any optional effects that could apply to this roll
  const rollLower = name.toLowerCase();
  const optionalEffects = [
    ...activeBuffs.map(name => ({ ...POSITIVE_EFFECTS.find(e => e.name === name), type: 'buff' })),
    ...activeConditions.map(name => ({ ...NEGATIVE_EFFECTS.find(e => e.name === name), type: 'debuff' }))
  ].filter(e => e && !e.autoApply && e.modifier);

  const hasApplicableOptionalEffects = optionalEffects.some(effect => {
    // Check if this is a skill check (any skill name or the word "check")
    const isSkillCheck = rollLower.includes('check') || 
                        rollLower.includes('acrobatics') || rollLower.includes('animal') ||
                        rollLower.includes('arcana') || rollLower.includes('athletics') ||
                        rollLower.includes('deception') || rollLower.includes('history') ||
                        rollLower.includes('insight') || rollLower.includes('intimidation') ||
                        rollLower.includes('investigation') || rollLower.includes('medicine') ||
                        rollLower.includes('nature') || rollLower.includes('perception') ||
                        rollLower.includes('performance') || rollLower.includes('persuasion') ||
                        rollLower.includes('religion') || rollLower.includes('sleight') ||
                        rollLower.includes('stealth') || rollLower.includes('survival');
    
    return (isSkillCheck && effect.modifier.skill) ||
           (rollLower.includes('attack') && effect.modifier.attack);
  });

  // If there are applicable optional effects, show popup and wait for user choice
  if (hasApplicableOptionalEffects) {
    debug.log('🎯 Found applicable optional effects, showing popup...');
    checkOptionalEffects(name, resolvedFormula, (chosenEffect) => {
      // Apply the chosen effect and then roll
      const { modifiedFormula, effectNotes } = applyEffectModifiers(name, resolvedFormula);
      let finalFormula = modifiedFormula;

      // Check if this is a skill/ability check (same logic as popup detection)
      const isSkillOrAbilityCheck = rollLower.includes('check') ||
                        rollLower.includes('acrobatics') || rollLower.includes('animal') ||
                        rollLower.includes('arcana') || rollLower.includes('athletics') ||
                        rollLower.includes('deception') || rollLower.includes('history') ||
                        rollLower.includes('insight') || rollLower.includes('intimidation') ||
                        rollLower.includes('investigation') || rollLower.includes('medicine') ||
                        rollLower.includes('nature') || rollLower.includes('perception') ||
                        rollLower.includes('performance') || rollLower.includes('persuasion') ||
                        rollLower.includes('religion') || rollLower.includes('sleight') ||
                        rollLower.includes('stealth') || rollLower.includes('survival') ||
                        rollLower.includes('strength') || rollLower.includes('dexterity') ||
                        rollLower.includes('constitution') || rollLower.includes('intelligence') ||
                        rollLower.includes('wisdom') || rollLower.includes('charisma');

      debug.log(`🎯 Applying chosen effect: ${chosenEffect.name}`, {
        modifier: chosenEffect.modifier,
        rollLower: rollLower,
        hasSkillMod: !!chosenEffect.modifier?.skill,
        isSkillOrAbilityCheck: isSkillOrAbilityCheck,
        formulaBefore: finalFormula
      });

      // Add the chosen effect's modifier
      if (chosenEffect.modifier?.skill && isSkillOrAbilityCheck) {
        finalFormula += ` + ${chosenEffect.modifier.skill}`;
        effectNotes.push(`[${chosenEffect.icon} ${chosenEffect.name}: ${chosenEffect.modifier.skill}]`);
        debug.log(`✅ Added skill modifier: ${chosenEffect.modifier.skill}, formula now: ${finalFormula}`);
      } else if (chosenEffect.modifier?.attack && rollLower.includes('attack')) {
        finalFormula += ` + ${chosenEffect.modifier.attack}`;
        effectNotes.push(`[${chosenEffect.icon} ${chosenEffect.name}: ${chosenEffect.modifier.attack}]`);
        debug.log(`✅ Added attack modifier: ${chosenEffect.modifier.attack}, formula now: ${finalFormula}`);
      } else {
        debug.log(`⚠️ No modifier applied - skill: ${chosenEffect.modifier?.skill}, check: ${rollLower.includes('check')}, attack: ${chosenEffect.modifier?.attack}`);
      }
      
      // Remove the chosen effect from active effects since it's been used
      if (chosenEffect.type === 'buff') {
        activeBuffs = activeBuffs.filter(e => e !== chosenEffect.name);
        debug.log(`🗑️ Removed buff: ${chosenEffect.name}`);
      } else if (chosenEffect.type === 'debuff') {
        activeConditions = activeConditions.filter(e => e !== chosenEffect.name);
        debug.log(`🗑️ Removed debuff: ${chosenEffect.name}`);
      }
      updateEffectsDisplay();

      // Apply advantage/disadvantage state
      const formulaWithAdvantage = applyAdvantageToFormula(finalFormula, effectNotes);

      // Proceed with the roll
      executeRoll(name, formulaWithAdvantage, effectNotes, prerolledResult);
    });
    // Return early - don't execute the roll yet, wait for popup response
    return;
  }

  // No optional effects, proceed with normal roll
  const { modifiedFormula, effectNotes } = applyEffectModifiers(name, resolvedFormula);

  // Apply advantage/disadvantage state
  const formulaWithAdvantage = applyAdvantageToFormula(modifiedFormula, effectNotes);

  executeRoll(name, formulaWithAdvantage, effectNotes, prerolledResult);
}

/**
 * Apply advantage/disadvantage state to dice formula
 */
function applyAdvantageToFormula(formula, effectNotes) {
  if (advantageState === 'normal') {
    return formula;
  }

  // Check if this is a d20 roll
  if (!formula.includes('1d20') && !formula.includes('d20')) {
    return formula; // Not a d20 roll, don't modify
  }

  let modifiedFormula = formula;

  if (advantageState === 'advantage') {
    // Replace 1d20 with 2d20kh1 (keep highest)
    modifiedFormula = modifiedFormula.replace(/1d20/g, '2d20kh1');
    modifiedFormula = modifiedFormula.replace(/(?<!\d)d20/g, '2d20kh1');
    effectNotes.push('[⚡ Advantage]');
    debug.log('⚡ Applied advantage to roll');
  } else if (advantageState === 'disadvantage') {
    // Replace 1d20 with 2d20kl1 (keep lowest)
    modifiedFormula = modifiedFormula.replace(/1d20/g, '2d20kl1');
    modifiedFormula = modifiedFormula.replace(/(?<!\d)d20/g, '2d20kl1');
    effectNotes.push('[⚠️ Disadvantage]');
    debug.log('⚠️ Applied disadvantage to roll');
  }

  // Reset advantage state after use
  setTimeout(() => setAdvantageState('normal'), 100);

  return modifiedFormula;
}

/**
 * Execute the roll after optional effects have been handled
 */
function executeRoll(name, formula, effectNotes, prerolledResult = null) {
  const colorBanner = getColoredBanner();
  // Format: "🔵 CharacterName rolls Initiative"
  let rollName = `${colorBanner}${characterData.name} rolls ${name}`;

  // Add effect notes to roll name if any
  if (effectNotes.length > 0) {
    rollName += ` ${effectNotes.join(' ')}`;
  }

  // Save this as the character's last roll (for heroic inspiration reroll)
  if (characterData) {
    characterData.lastRoll = {
      name: name,
      formula: formula,
      effectNotes: effectNotes
    };
    saveCharacterData();
  }

  // If we have a prerolled result (e.g., from death saves), include it
  const messageData = {
    action: 'rollFromPopout',
    name: rollName,
    formula: formula,
    color: characterData.notificationColor,
    characterName: characterData.name
  };

  if (prerolledResult !== null) {
    messageData.prerolledResult = prerolledResult;
  }

  // Try window.opener first (Chrome)
  if (window.opener && !window.opener.closed) {
    try {
      window.opener.postMessage(messageData, '*');
      showNotification(`🎲 Rolling ${name}...`);
      debug.log('✅ Roll sent via window.opener');
      return;
    } catch (error) {
      debug.warn('⚠️ Could not send via window.opener:', error.message);
    }
  }

  // Fallback: Use background script to relay to Roll20 (Firefox)
  debug.log('📡 Using background script to relay roll to Roll20...');
  browserAPI.runtime.sendMessage({
    action: 'relayRollToRoll20',
    roll: messageData
  }, (response) => {
    if (browserAPI.runtime.lastError) {
      debug.error('❌ Error relaying roll:', browserAPI.runtime.lastError);
      showNotification('Failed to send roll. Please try from Roll20 page.', 'error');
    } else if (response && response.success) {
      debug.log('✅ Roll relayed to Roll20 via background script');
      showNotification(`🎲 Rolling ${name}...`);
    } else {
      debug.error('❌ Failed to relay roll:', response?.error);
      showNotification('Failed to send roll. Make sure Roll20 tab is open.', 'error');
    }
  });
}

function getHitDieType() {
  // Determine hit die based on class (D&D 5e)
  const className = (characterData.class || '').toLowerCase();

  const hitDiceMap = {
    'barbarian': 'd12',
    'fighter': 'd10',
    'paladin': 'd10',
    'ranger': 'd10',
    'bard': 'd8',
    'cleric': 'd8',
    'druid': 'd8',
    'monk': 'd8',
    'rogue': 'd8',
    'warlock': 'd8',
    'sorcerer': 'd6',
    'wizard': 'd6'
  };

  for (const [classKey, die] of Object.entries(hitDiceMap)) {
    if (className.includes(classKey)) {
      return die;
    }
  }

  // Default to d8 if class not found
  return 'd8';
}

function initializeHitDice() {
  // Initialize hit dice if not already set
  if (characterData.hitDice === undefined) {
    const level = characterData.level || 1;
    characterData.hitDice = {
      current: level,
      max: level,
      type: getHitDieType()
    };
  }
}

// Initialize collapsible sections
function initCollapsibleSections() {
  const sections = document.querySelectorAll('.section h3');

  sections.forEach(header => {
    header.addEventListener('click', function() {
      const section = this.parentElement;
      const content = section.querySelector('.section-content');

      // Toggle collapsed class
      this.classList.toggle('collapsed');
      content.classList.toggle('collapsed');
    });
  });
}

// Helper function to collapse a section by its container ID
function collapseSectionByContainerId(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const section = container.closest('.section');
  if (!section) return;

  const header = section.querySelector('h3');
  const content = section.querySelector('.section-content');

  if (header && content) {
    header.classList.add('collapsed');
    content.classList.add('collapsed');
  }
}

// Helper function to expand a section by its container ID
function expandSectionByContainerId(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const section = container.closest('.section');
  if (!section) return;

  const header = section.querySelector('h3');
  const content = section.querySelector('.section-content');

  if (header && content) {
    header.classList.remove('collapsed');
    content.classList.remove('collapsed');
  }
}

// Call collapsible initialization when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initCollapsibleSections);
} else {
  initCollapsibleSections();
}

// Add close button event listener (CSP-compliant, no inline onclick)
function initCloseButton() {
  const closeBtn = document.getElementById('close-btn');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      window.close();
    });
  }
}

// Initialize close button when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initCloseButton);
} else {
  initCloseButton();
}

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
 * Initialize combat mechanics (action economy, conditions, concentration)
 */
function initCombatMechanics() {
  debug.log('🎮 Initializing combat mechanics...');

  // Initialize action economy trackers
  initActionEconomy();

  // Initialize conditions manager
  initConditionsManager();

  // Initialize concentration tracker
  initConcentrationTracker();

  // Initialize GM mode toggle
  initGMMode();

  debug.log('✅ Combat mechanics initialized');
}

/**
 * Mark action as used based on casting time
 * This handles the action economy tracking for spells and abilities
 */
function postActionToChat(actionLabel, state) {
  const emoji = state === 'used' ? '❌' : '✅';
  const message = `${emoji} ${characterData.name} ${state === 'used' ? 'uses' : 'restores'} ${actionLabel}`;
  postToChatIfOpener(message);

  // Also post to Discord
  postActionEconomyToDiscord();
}


function showEffectsModal() {
  // Create modal overlay
  const modal = document.createElement('div');
  modal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; z-index: 10000;';

  // Create modal content
  const modalContent = document.createElement('div');
  modalContent.style.cssText = 'background: var(--bg-secondary); color: var(--text-primary); border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,0.3); width: 90%; max-width: 600px; max-height: 80vh; display: flex; flex-direction: column; overflow: hidden;';

  // Modal header
  const header = document.createElement('div');
  header.style.cssText = 'padding: 20px; border-bottom: 2px solid #ecf0f1; background: #f8f9fa;';
  header.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center;">
      <h3 style="margin: 0; color: var(--text-primary);">🎭 Effects & Conditions</h3>
      <button id="effects-modal-close" style="background: #e74c3c; color: white; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-weight: bold;">✕</button>
    </div>
  `;

  // Tab navigation
  const tabNav = document.createElement('div');
  tabNav.style.cssText = 'display: flex; background: #ecf0f1; border-bottom: 2px solid #bdc3c7;';
  tabNav.innerHTML = `
    <button class="effects-tab-btn" data-tab="buffs" style="flex: 1; padding: 15px; background: var(--bg-tertiary); border: none; border-bottom: 3px solid #27ae60; cursor: pointer; font-weight: bold; font-size: 1em; color: #27ae60; transition: all 0.2s;">✨ Buffs</button>
    <button class="effects-tab-btn" data-tab="debuffs" style="flex: 1; padding: 15px; background: transparent; border: none; border-bottom: 3px solid transparent; cursor: pointer; font-weight: bold; font-size: 1em; color: var(--text-secondary); transition: all 0.2s;">💀 Debuffs</button>
  `;

  // Tab content container
  const tabContent = document.createElement('div');
  tabContent.style.cssText = 'padding: 20px; overflow-y: auto; flex: 1;';

  // Buffs tab
  const buffsTab = document.createElement('div');
  buffsTab.className = 'effects-tab-content';
  buffsTab.dataset.tab = 'buffs';
  buffsTab.style.display = 'block';
  buffsTab.innerHTML = POSITIVE_EFFECTS.map(effect => `
    <div class="effect-option" data-effect="${effect.name}" data-type="positive" style="padding: 12px; margin-bottom: 10px; border: 2px solid ${effect.color}40; border-radius: 8px; cursor: pointer; transition: all 0.2s; background: var(--bg-secondary);">
      <div style="display: flex; align-items: center; gap: 12px;">
        <span class="effect-icon" style="font-size: 1.5em;">${effect.icon}</span>
        <div style="flex: 1;">
          <div class="effect-name" style="font-weight: bold; color: var(--text-primary); margin-bottom: 4px;">${effect.name}</div>
          <div class="effect-description" style="font-size: 0.85em; color: var(--text-secondary);">${effect.description}</div>
        </div>
      </div>
    </div>
  `).join('');

  // Debuffs tab
  const debuffsTab = document.createElement('div');
  debuffsTab.className = 'effects-tab-content';
  debuffsTab.dataset.tab = 'debuffs';
  debuffsTab.style.display = 'none';
  debuffsTab.innerHTML = NEGATIVE_EFFECTS.map(effect => `
    <div class="effect-option" data-effect="${effect.name}" data-type="negative" style="padding: 12px; margin-bottom: 10px; border: 2px solid ${effect.color}40; border-radius: 8px; cursor: pointer; transition: all 0.2s; background: var(--bg-secondary);">
      <div style="display: flex; align-items: center; gap: 12px;">
        <span class="effect-icon" style="font-size: 1.5em;">${effect.icon}</span>
        <div style="flex: 1;">
          <div class="effect-name" style="font-weight: bold; color: var(--text-primary); margin-bottom: 4px;">${effect.name}</div>
          <div class="effect-description" style="font-size: 0.85em; color: var(--text-secondary);">${effect.description}</div>
        </div>
      </div>
    </div>
  `).join('');

  tabContent.appendChild(buffsTab);
  tabContent.appendChild(debuffsTab);

  // Assemble modal
  modalContent.appendChild(header);
  modalContent.appendChild(tabNav);
  modalContent.appendChild(tabContent);
  modal.appendChild(modalContent);
  document.body.appendChild(modal);

  // Tab switching
  const tabButtons = tabNav.querySelectorAll('.effects-tab-btn');
  const tabContents = modalContent.querySelectorAll('.effects-tab-content');

  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.dataset.tab;

      // Update button styles
      tabButtons.forEach(b => {
        if (b.dataset.tab === targetTab) {
          b.style.background = 'var(--bg-tertiary)';
          b.style.color = targetTab === 'buffs' ? '#27ae60' : '#e74c3c';
          b.style.borderBottom = `3px solid ${targetTab === 'buffs' ? '#27ae60' : '#e74c3c'}`;
        } else {
          b.style.background = 'transparent';
          b.style.color = '#7f8c8d';
          b.style.borderBottom = '3px solid transparent';
        }
      });

      // Show target tab content
      tabContents.forEach(content => {
        content.style.display = content.dataset.tab === targetTab ? 'block' : 'none';
      });
    });
  });

  // Add hover effects
  modalContent.querySelectorAll('.effect-option').forEach(option => {
    option.addEventListener('mouseenter', () => {
      option.style.transform = 'translateX(5px)';
      option.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
    });
    option.addEventListener('mouseleave', () => {
      option.style.transform = 'translateX(0)';
      option.style.boxShadow = 'none';
    });
  });

  // Add effect when clicking option
  modalContent.querySelectorAll('.effect-option').forEach(option => {
    option.addEventListener('click', () => {
      const effectName = option.dataset.effect;
      const type = option.dataset.type === 'positive' ? 'positive' : 'negative';
      addEffect(effectName, type);
      modal.remove();
    });
  });

  // Close button
  const closeBtn = modalContent.querySelector('#effects-modal-close');
  closeBtn.addEventListener('click', () => modal.remove());

  // Click outside to close
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });
}

function addEffect(effectName, type) {
  const effectsList = type === 'positive' ? POSITIVE_EFFECTS : NEGATIVE_EFFECTS;
  const activeList = type === 'positive' ? activeBuffs : activeConditions;

  // Don't add if already active
  if (activeList.includes(effectName)) {
    showNotification(`⚠️ ${effectName} already active`);
    return;
  }

  const effect = effectsList.find(e => e.name === effectName);
  activeList.push(effectName);

  // Update the correct array reference
  if (type === 'positive') {
    activeBuffs = activeList;
  } else {
    activeConditions = activeList;
  }

  updateEffectsDisplay();
  showNotification(`${effect.icon} ${effectName} applied!`);
  debug.log(`✅ Effect added: ${effectName} (${type})`);

  // Announce to Roll20 chat
  const message = type === 'positive'
    ? `${effect.icon} ${characterData.name} gains ${effectName}!`
    : `${effect.icon} ${characterData.name} is now ${effectName}!`;
  postToChatIfOpener(message);

  // Save to character data
  if (!characterData.activeEffects) {
    characterData.activeEffects = { buffs: [], debuffs: [] };
  }
  if (type === 'positive') {
    characterData.activeEffects.buffs = activeBuffs;
  } else {
    characterData.activeEffects.debuffs = activeConditions;
  }
  saveCharacterData();
}

// Legacy function for backwards compatibility
function addCondition(conditionName) {
  addEffect(conditionName, 'negative');
}

function removeCondition(conditionName) {
  removeEffect(conditionName, 'negative');
}

function updateEffectsDisplay() {
  const container = document.getElementById('active-conditions');
  if (!container) return;

  let html = '';

  // Show buffs section
  if (activeBuffs.length > 0) {
    html += '<div style="margin-bottom: 15px;">';
    html += '<div style="font-size: 0.85em; font-weight: bold; color: #27ae60; margin-bottom: 8px; display: flex; align-items: center; gap: 6px;"><span>✨</span> BUFFS</div>';
    html += activeBuffs.map(effectName => {
      const effect = POSITIVE_EFFECTS.find(e => e.name === effectName);
      return `
        <div class="effect-badge" data-effect="${effectName}" data-type="positive" title="${effect.description} - Click to remove" style="background: ${effect.color}20; border: 2px solid ${effect.color}; cursor: pointer; padding: 8px 12px; border-radius: 6px; margin-bottom: 8px; transition: all 0.2s;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="effect-badge-icon" style="font-size: 1.2em;">${effect.icon}</span>
            <div style="flex: 1;">
              <div style="font-weight: bold; color: var(--text-primary);">${effect.name}</div>
              <div style="font-size: 0.75em; color: var(--text-secondary); margin-top: 2px;">${effect.description}</div>
            </div>
            <span class="effect-badge-remove" style="font-weight: bold; opacity: 0.7; color: #e74c3c;">✕</span>
          </div>
        </div>
      `;
    }).join('');
    html += '</div>';
  }

  // Show debuffs section
  if (activeConditions.length > 0) {
    html += '<div style="margin-bottom: 15px;">';
    html += '<div style="font-size: 0.85em; font-weight: bold; color: #e74c3c; margin-bottom: 8px; display: flex; align-items: center; gap: 6px;"><span>💀</span> DEBUFFS</div>';
    html += activeConditions.map(effectName => {
      const effect = NEGATIVE_EFFECTS.find(e => e.name === effectName);
      return `
        <div class="effect-badge" data-effect="${effectName}" data-type="negative" title="${effect.description} - Click to remove" style="background: ${effect.color}20; border: 2px solid ${effect.color}; cursor: pointer; padding: 8px 12px; border-radius: 6px; margin-bottom: 8px; transition: all 0.2s;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="effect-badge-icon" style="font-size: 1.2em;">${effect.icon}</span>
            <div style="flex: 1;">
              <div style="font-weight: bold; color: var(--text-primary);">${effect.name}</div>
              <div style="font-size: 0.75em; color: var(--text-secondary); margin-top: 2px;">${effect.description}</div>
            </div>
            <span class="effect-badge-remove" style="font-weight: bold; opacity: 0.7; color: #e74c3c;">✕</span>
          </div>
        </div>
      `;
    }).join('');
    html += '</div>';
  }

  // Show empty state if no effects
  if (activeBuffs.length === 0 && activeConditions.length === 0) {
    html = '<div style="text-align: center; color: #888; padding: 15px; font-size: 0.9em;">No active effects</div>';
  }

  container.innerHTML = html;

  // Update AC display to reflect any changes
  const acElement = document.getElementById('char-ac');
  if (acElement) {
    acElement.textContent = calculateTotalAC();
  }

  // Add click handlers to remove effects
  container.querySelectorAll('.effect-badge').forEach(badge => {
    const effectName = badge.dataset.effect;
    const type = badge.dataset.type;

    // Add hover effect
    badge.addEventListener('mouseenter', () => {
      badge.style.transform = 'translateX(3px)';
      badge.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)';
    });
    badge.addEventListener('mouseleave', () => {
      badge.style.transform = 'translateX(0)';
      badge.style.boxShadow = 'none';
    });

    // Remove on click
    badge.addEventListener('click', () => {
      removeEffect(effectName, type);
    });
  });
}

// Legacy function for backwards compatibility
function updateConditionsDisplay() {
  updateEffectsDisplay();
}

/**
 * GM Mode Toggle
 */
function initGMMode() {
  const gmModeToggle = document.getElementById('gm-mode-toggle');

  if (gmModeToggle) {
    gmModeToggle.addEventListener('click', () => {
      const isActive = gmModeToggle.classList.contains('active');

      // Send message to Roll20 content script to toggle GM panel
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage({
          action: 'toggleGMMode',
          enabled: !isActive
        }, '*');
        debug.log(`👑 GM Mode ${!isActive ? 'enabled' : 'disabled'}`);
      } else {
        // Try via background script
        browserAPI.runtime.sendMessage({
          action: 'toggleGMMode',
          enabled: !isActive
        });
      }

      // Toggle active state
      gmModeToggle.classList.toggle('active');
      showNotification(isActive ? '👑 GM Mode disabled' : '👑 GM Mode enabled!');
    });

    debug.log('✅ GM Mode toggle initialized');
  }
}

/**
 * Show to GM Button - Broadcasts character data to GM
 */
function initShowToGM() {
  const showToGMBtn = document.getElementById('show-to-gm-btn');

  if (showToGMBtn) {
    showToGMBtn.addEventListener('click', () => {
      if (!characterData) {
        showNotification('⚠️ No character data to share', 'warning');
        return;
      }

      try {
        // Create character broadcast message with ENTIRE sheet data
        const broadcastData = {
          type: 'ROLLCLOUD_CHARACTER_BROADCAST',
          character: characterData,
          // Include ALL character data for complete sheet
          fullSheet: {
            ...characterData,
            // Ensure all sections are included
            attributes: characterData.attributes || {},
            skills: characterData.skills || [],
            savingThrows: characterData.savingThrows || {},
            actions: characterData.actions || [],
            spells: characterData.spells || [],
            features: characterData.features || [],
            equipment: characterData.equipment || [],
            inventory: characterData.inventory || {},
            resources: characterData.resources || {},
            spellSlots: characterData.spellSlots || {},
            companions: characterData.companions || [],
            conditions: characterData.conditions || [],
            notes: characterData.notes || '',
            background: characterData.background || '',
            personality: characterData.personality || {},
            proficiencies: characterData.proficiencies || [],
            languages: characterData.languages || [],
            // Add simplified properties for popout compatibility
            hp: characterData.hitPoints?.current || characterData.hp || 0,
            maxHp: characterData.hitPoints?.max || characterData.maxHp || 0,
            ac: characterData.armorClass || characterData.ac || 10,
            initiative: characterData.initiative || 0,
            passivePerception: characterData.passivePerception || 10,
            proficiency: characterData.proficiencyBonus || characterData.proficiency || 0,
            speed: characterData.speed || '30 ft'
          },
          timestamp: new Date().toISOString()
        };

        // Encode the data for safe transmission (handle UTF-8 properly)
        const jsonString = JSON.stringify(broadcastData);
        const encodedData = btoa(unescape(encodeURIComponent(jsonString)));
        const broadcastMessage = `👑[ROLLCLOUD:CHARACTER:${encodedData}]👑`;

        // Send to Roll20 chat via parent window
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage({
            action: 'postChatMessageFromPopup',
            message: broadcastMessage
          }, '*');
          
          showNotification(`👑 ${characterData.name} shared with GM!`, 'success');
          debug.log('👑 Character broadcast sent to GM:', characterData.name);
        } else {
          // Try via background script
          browserAPI.runtime.sendMessage({
            action: 'postChatMessageFromPopup',
            message: broadcastMessage
          }).then(() => {
            showNotification(`👑 ${characterData.name} shared with GM!`, 'success');
            debug.log('👑 Character broadcast sent via background script:', characterData.name);
          }).catch(err => {
            debug.error('❌ Failed to send character broadcast:', err);
            showNotification('❌ Failed to share with GM', 'error');
          });
        }
      } catch (error) {
        debug.error('❌ Error creating character broadcast:', error);
        showNotification('❌ Failed to prepare character data', 'error');
      }
    });

    debug.log('✅ Show to GM button initialized in settings');
  } else {
    debug.warn('⚠️ Show to GM button not found in settings');
  }
}

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
  initCombatMechanics();
}, 100);

// Local character cache to preserve state changes
// Initialize racial traits and feats
let activeRacialTraits = [];
let activeFeatTraits = [];

function initRacialTraits() {
  debug.log('🧬 Initializing racial traits...');
  debug.log('🧬 Character data:', characterData);
  debug.log('🧬 Character race:', characterData?.race);

  // Reset racial traits
  activeRacialTraits = [];

  if (!characterData || !characterData.race) {
    debug.log('🧬 No race data available');
    return;
  }

  const race = characterData.race.toLowerCase();

  // Halfling Luck
  if (race.includes('halfling')) {
    debug.log('🧬 Halfling detected, adding Halfling Luck trait');
    activeRacialTraits.push(HalflingLuck);
  }

  // Elven Accuracy (check for feat in features)
  if (characterData.features && characterData.features.some(f =>
    f.name && f.name.toLowerCase().includes('elven accuracy')
  )) {
    debug.log('🧝 Elven Accuracy feat detected');
    activeRacialTraits.push(ElvenAccuracy);
  }

  // Dwarven Resilience
  if (race.includes('dwarf')) {
    debug.log('⛏️ Dwarf detected, adding Dwarven Resilience trait');
    activeRacialTraits.push(DwarvenResilience);
  }

  // Gnome Cunning
  if (race.includes('gnome')) {
    debug.log('🎩 Gnome detected, adding Gnome Cunning trait');
    activeRacialTraits.push(GnomeCunning);
  }

  debug.log(`🧬 Initialized ${activeRacialTraits.length} racial traits`);
}

function initFeatTraits() {
  debug.log('🎖️ Initializing feat traits...');
  debug.log('🎖️ Character features:', characterData?.features);

  // Reset feat traits
  activeFeatTraits = [];

  if (!characterData || !characterData.features) {
    debug.log('🎖️ No features data available');
    return;
  }

  // Lucky feat is now handled as an action, not a trait
  debug.log('🎖️ Lucky feat will be available as an action button');

  debug.log(`🎖️ Initialized ${activeFeatTraits.length} feat traits`);
}

function initClassFeatures() {
  debug.log('⚔️ Initializing class features...');
  debug.log('⚔️ Character class:', characterData?.class);
  debug.log('⚔️ Character level:', characterData?.level);

  if (!characterData) {
    debug.log('⚔️ No character data available');
    return;
  }

  const characterClass = (characterData.class || '').toLowerCase();
  const level = characterData.level || 1;

  // Reliable Talent (Rogue 11+)
  if (characterClass.includes('rogue') && level >= 11) {
    debug.log('🎯 Rogue 11+ detected, adding Reliable Talent');
    activeFeatTraits.push(ReliableTalent);
  }

  // Bardic Inspiration (Bard)
  if (characterClass.includes('bard') && level >= 1) {
    debug.log('🎵 Bard detected, adding Bardic Inspiration');
    activeFeatTraits.push(BardicInspiration);
  }

  // Jack of All Trades (Bard)
  if (characterClass.includes('bard') && level >= 2) {
    debug.log('🎵 Bard detected, adding Jack of All Trades');
    activeFeatTraits.push(JackOfAllTrades);
  }

  // Rage Damage Bonus (Barbarian)
  if (characterClass.includes('barbarian')) {
    debug.log('😡 Barbarian detected, adding Rage Damage Bonus');
    activeFeatTraits.push(RageDamageBonus);
  }

  // Brutal Critical (Barbarian 9+)
  if (characterClass.includes('barbarian') && level >= 9) {
    debug.log('💥 Barbarian 9+ detected, adding Brutal Critical');
    activeFeatTraits.push(BrutalCritical);
  }

  // Portent (Divination Wizard 2+)
  if (characterClass.includes('wizard') && level >= 2) {
    // Check for Divination subclass in features
    const isDivination = characterData.features && characterData.features.some(f =>
      f.name && (f.name.toLowerCase().includes('divination') || f.name.toLowerCase().includes('portent'))
    );
    if (isDivination) {
      debug.log('🔮 Divination Wizard detected, adding Portent');
      activeFeatTraits.push(PortentDice);
      // Auto-roll portent dice
      PortentDice.rollPortentDice();
    }
  }

  // Wild Magic Surge (Wild Magic Sorcerer)
  if (characterClass.includes('sorcerer')) {
    // Check for Wild Magic subclass in features
    const isWildMagic = characterData.features && characterData.features.some(f =>
      f.name && f.name.toLowerCase().includes('wild magic')
    );
    if (isWildMagic) {
      debug.log('🌀 Wild Magic Sorcerer detected, adding Wild Magic Surge');
      activeFeatTraits.push(WildMagicSurge);
    }
  }

  debug.log(`⚔️ Initialized ${activeFeatTraits.length} class feature traits`);
}

function checkRacialTraits(rollResult, rollType, rollName) {
  debug.log(`🧬 Checking racial traits for roll: ${rollResult} (${rollType}) - ${rollName}`);
  debug.log(`🧬 Active racial traits count: ${activeRacialTraits.length}`);
  
  let traitTriggered = false;
  
  for (const trait of activeRacialTraits) {
    if (trait.onRoll && typeof trait.onRoll === 'function') {
      const result = trait.onRoll(rollResult, rollType, rollName);
      if (result) {
        traitTriggered = true;
        debug.log(`🧬 ${trait.name} triggered!`);
      }
    }
  }
  
  return traitTriggered;
}

function checkFeatTraits(rollResult, rollType, rollName) {
  debug.log(`🎖️ Checking feat traits for roll: ${rollResult} (${rollType}) - ${rollName}`);
  debug.log(`🎖️ Active feat traits count: ${activeFeatTraits.length}`);
  
  let traitTriggered = false;
  
  for (const trait of activeFeatTraits) {
    if (trait.onRoll && typeof trait.onRoll === 'function') {
      const result = trait.onRoll(rollResult, rollType, rollName);
      if (result) {
        traitTriggered = true;
        debug.log(`🎖️ ${trait.name} triggered!`);
      }
    }
  }
  
  return traitTriggered;
}

debug.log('✅ Popup script fully loaded');

// Helper function to get theme-aware popup colors
function getPopupThemeColors() {
  const isDarkMode = document.documentElement.classList.contains('theme-dark') ||
                     document.documentElement.getAttribute('data-theme') === 'dark';

  return {
    background: isDarkMode ? '#2d2d2d' : '#ffffff',
    text: isDarkMode ? '#e0e0e0' : '#333333',
    heading: isDarkMode ? '#ffffff' : '#2D8B83',
    border: isDarkMode ? '#444444' : '#f0f8ff',
    borderAccent: isDarkMode ? '#2D8B83' : '#2D8B83',
    infoBox: isDarkMode ? '#1a1a1a' : '#f0f8ff',
    infoText: isDarkMode ? '#b0b0b0' : '#666666'
  };
}

// Halfling Luck Popup Functions
function showHalflingLuckPopup(rollData) {
  debug.log('🍀 Halfling Luck popup called with:', rollData);

  // Check if document.body exists
  if (!document.body) {
    debug.error('❌ document.body not available for Halfling Luck popup');
    showNotification('🍀 Halfling Luck triggered! (Popup failed to display)', 'info');
    return;
  }

  debug.log('🍀 Creating popup overlay...');

  // Get theme-aware colors
  const colors = getPopupThemeColors();

  // Create popup overlay
  const popupOverlay = document.createElement('div');
  popupOverlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.8);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  `;

  // Create popup content
  const popupContent = document.createElement('div');
  popupContent.style.cssText = `
    background: ${colors.background};
    border-radius: 12px;
    padding: 24px;
    max-width: 400px;
    width: 90%;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
    text-align: center;
  `;

  debug.log('🍀 Setting popup content HTML...');

  popupContent.innerHTML = `
    <div style="font-size: 24px; margin-bottom: 16px;">🍀</div>
    <h2 style="margin: 0 0 8px 0; color: ${colors.heading};">Halfling Luck!</h2>
    <p style="margin: 0 0 16px 0; color: ${colors.text};">
      You rolled a natural 1! As a Halfling, you can reroll this d20.
    </p>
    <div style="margin: 0 0 16px 0; padding: 12px; background: ${colors.infoBox}; border-radius: 8px; border-left: 4px solid ${colors.borderAccent}; color: ${colors.text};">
      <strong>Original Roll:</strong> ${rollData.rollName}<br>
      <strong>Result:</strong> ${rollData.baseRoll} (natural 1)<br>
      <strong>Total:</strong> ${rollData.rollResult}
    </div>
    <div style="display: flex; gap: 12px; justify-content: center;">
      <button id="halflingRerollBtn" style="
        background: #2D8B83;
        color: white;
        border: none;
        padding: 12px 24px;
        border-radius: 8px;
        cursor: pointer;
        font-weight: bold;
        font-size: 14px;
      ">🎲 Reroll</button>
      <button id="halflingKeepBtn" style="
        background: #e74c3c;
        color: white;
        border: none;
        padding: 12px 24px;
        border-radius: 8px;
        cursor: pointer;
        font-weight: bold;
        font-size: 14px;
      ">Keep Roll</button>
    </div>
  `;

  debug.log('🍀 Appending popup to document.body...');

  popupOverlay.appendChild(popupContent);
  document.body.appendChild(popupOverlay);
  
  // Add event listeners
  document.getElementById('halflingRerollBtn').addEventListener('click', () => {
    debug.log('🍀 User chose to reroll');
    performHalflingReroll(rollData);
    document.body.removeChild(popupOverlay);
  });
  
  document.getElementById('halflingKeepBtn').addEventListener('click', () => {
    debug.log('🍀 User chose to keep roll');
    document.body.removeChild(popupOverlay);
  });
  
  // Close on overlay click
  popupOverlay.addEventListener('click', (e) => {
    if (e.target === popupOverlay) {
      debug.log('🍀 User closed popup');
      document.body.removeChild(popupOverlay);
    }
  });
  
  debug.log('🍀 Halfling Luck popup displayed');
}

// Lucky Feat Popup Functions
function showLuckyPopup(rollData) {
  debug.log('🎖️ Lucky popup called with:', rollData);

  // Check if document.body exists
  if (!document.body) {
    debug.error('❌ document.body not available for Lucky popup');
    showNotification('🎖️ Lucky triggered! (Popup failed to display)', 'info');
    return;
  }

  debug.log('🎖️ Creating Lucky popup overlay...');

  // Get theme-aware colors
  const colors = getPopupThemeColors();

  // Create popup overlay
  const popupOverlay = document.createElement('div');
  popupOverlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.8);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  `;

  // Create popup content
  const popupContent = document.createElement('div');
  popupContent.style.cssText = `
    background: ${colors.background};
    border-radius: 12px;
    padding: 24px;
    max-width: 400px;
    width: 90%;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
    text-align: center;
  `;

  debug.log('🎖️ Setting Lucky popup content HTML...');

  popupContent.innerHTML = `
    <div style="font-size: 24px; margin-bottom: 16px;">🎖️</div>
    <h2 style="margin: 0 0 8px 0; color: #f39c12;">Lucky Feat!</h2>
    <p style="margin: 0 0 16px 0; color: ${colors.text};">
      You rolled a ${rollData.baseRoll}! You have ${rollData.luckPointsRemaining} luck points remaining.
    </p>
    <div style="margin: 0 0 16px 0; padding: 12px; background: ${colors.infoBox}; border-radius: 8px; border-left: 4px solid #f39c12; color: ${colors.text};">
      <strong>Original Roll:</strong> ${rollData.rollName}<br>
      <strong>Result:</strong> ${rollData.baseRoll}<br>
      <strong>Luck Points:</strong> ${rollData.luckPointsRemaining}/3
    </div>
    <div style="display: flex; gap: 12px; justify-content: center;">
      <button id="luckyRerollBtn" style="
        background: #f39c12;
        color: white;
        border: none;
        padding: 12px 24px;
        border-radius: 8px;
        cursor: pointer;
        font-size: 16px;
        font-weight: bold;
        transition: background 0.2s;
      ">
        🎲 Reroll (Use Luck Point)
      </button>
      <button id="luckyKeepBtn" style="
        background: #95a5a6;
        color: white;
        border: none;
        padding: 12px 24px;
        border-radius: 8px;
        cursor: pointer;
        font-size: 16px;
        font-weight: bold;
        transition: background 0.2s;
      ">
        Keep Roll
      </button>
    </div>
  `;

  popupOverlay.appendChild(popupContent);
  document.body.appendChild(popupOverlay);

  debug.log('🎖️ Appending Lucky popup to document.body...');

  // Add event listeners
  const rerollBtn = document.getElementById('luckyRerollBtn');
  const keepBtn = document.getElementById('luckyKeepBtn');

  // Add hover effects via event listeners (CSP-compliant)
  rerollBtn.addEventListener('mouseenter', () => rerollBtn.style.background = '#e67e22');
  rerollBtn.addEventListener('mouseleave', () => rerollBtn.style.background = '#f39c12');
  keepBtn.addEventListener('mouseenter', () => keepBtn.style.background = '#7f8c8d');
  keepBtn.addEventListener('mouseleave', () => keepBtn.style.background = '#95a5a6');

  rerollBtn.addEventListener('click', () => {
    if (useLuckyPoint()) {
      performLuckyReroll(rollData);
      popupOverlay.remove();
    } else {
      alert('No luck points available!');
    }
  });

  keepBtn.addEventListener('click', () => {
    popupOverlay.remove();
  });

  // Close on overlay click
  popupOverlay.addEventListener('click', (e) => {
    if (e.target === popupOverlay) {
      popupOverlay.remove();
    }
  });

  debug.log('🎖️ Lucky popup displayed');
}

function performLuckyReroll(originalRollData) {
  debug.log('🎖️ Performing Lucky reroll for:', originalRollData);
  
  // Extract base formula (remove modifiers for the reroll)
  const baseFormula = originalRollData.rollType.replace(/[+-]\d+$/i, '');
  
  // Create a new roll with just the d20
  const rerollData = {
    name: `🎖️ ${originalRollData.rollName} (Lucky Reroll)`,
    formula: baseFormula,
    color: '#f39c12',
    characterName: characterData.name
  };

  // Send the reroll request
  if (window.opener && !window.opener.closed) {
    window.opener.postMessage({
      action: 'rollFromPopout',
      ...rerollData
    }, '*');
    debug.log('🎖️ Lucky reroll sent via window.opener');
  } else {
    // Fallback: send directly to Roll20 via background script
    browserAPI.runtime.sendMessage({
      action: 'relayRollToRoll20',
      roll: rerollData
    });
  }
  
  showNotification('🎖️ Lucky reroll initiated!', 'success');
}

// Unified Trait Choice Popup
function showTraitChoicePopup(rollData) {
  debug.log('🎯 Trait choice popup called with:', rollData);

  // Check if document.body exists
  if (!document.body) {
    debug.error('❌ document.body not available for trait choice popup');
    showNotification('🎯 Trait choice triggered! (Popup failed to display)', 'info');
    return;
  }

  debug.log('🎯 Creating trait choice overlay...');

  // Get theme-aware colors
  const colors = getPopupThemeColors();

  // Create popup overlay
  const popupOverlay = document.createElement('div');
  popupOverlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.8);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  `;

  // Create popup content
  const popupContent = document.createElement('div');
  popupContent.style.cssText = `
    background: ${colors.background};
    border-radius: 12px;
    padding: 24px;
    max-width: 450px;
    width: 90%;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
    text-align: center;
  `;

  // Build trait options HTML
  let traitOptionsHTML = '';
  const allTraits = [...rollData.racialTraits, ...rollData.featTraits];
  
  allTraits.forEach((trait, index) => {
    let icon = '';
    let color = '';
    let description = '';
    
    if (trait.name === 'Halfling Luck') {
      icon = '🍀';
      color = '#2D8B83';
      description = 'Reroll natural 1s (must use new roll)';
    } else if (trait.name === 'Lucky') {
      icon = '🎖️';
      color = '#f39c12';
      const luckyResource = getLuckyResource();
      description = `Reroll any roll (${luckyResource?.current || 0}/3 points left)`;
    }
    
    traitOptionsHTML += `
      <button class="trait-option-btn" data-trait-index="${index}" data-trait-color="${color}" style="
        background: ${color};
        color: white;
        border: none;
        padding: 16px;
        border-radius: 8px;
        cursor: pointer;
        font-size: 16px;
        font-weight: bold;
        margin: 8px 0;
        transition: transform 0.2s, background 0.2s;
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 12px;
      ">
        <span style="font-size: 20px;">${icon}</span>
        <div style="text-align: left;">
          <div style="font-weight: bold;">${trait.name}</div>
          <div style="font-size: 12px; opacity: 0.9;">${description}</div>
        </div>
      </button>
    `;
  });

  debug.log('🎯 Setting trait choice popup content HTML...');

  popupContent.innerHTML = `
    <div style="font-size: 24px; margin-bottom: 16px;">🎯</div>
    <h2 style="margin: 0 0 8px 0; color: ${colors.heading};">Multiple Traits Available!</h2>
    <p style="margin: 0 0 16px 0; color: ${colors.text};">
      You rolled a ${rollData.baseRoll}! Choose which trait to use:
    </p>
    <div style="margin: 0 0 16px 0; padding: 12px; background: ${colors.infoBox}; border-radius: 8px; border-left: 4px solid #3498db; color: ${colors.text};">
      <strong>Original Roll:</strong> ${rollData.rollName}<br>
      <strong>Result:</strong> ${rollData.baseRoll}<br>
      <strong>Total:</strong> ${rollData.rollResult}
    </div>
    <div style="display: flex; flex-direction: column; gap: 8px;">
      ${traitOptionsHTML}
    </div>
    <button id="cancelTraitBtn" style="
      background: #95a5a6;
      color: white;
      border: none;
      padding: 12px 24px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 14px;
      font-weight: bold;
      margin-top: 8px;
      transition: background 0.2s;
    ">
      Keep Original Roll
    </button>
  `;

  popupOverlay.appendChild(popupContent);
  document.body.appendChild(popupOverlay);

  debug.log('🎯 Appending trait choice popup to document.body...');

  // Add event listeners
  const traitButtons = document.querySelectorAll('.trait-option-btn');
  const cancelBtn = document.getElementById('cancelTraitBtn');

  // Add hover effects for trait buttons (CSP-compliant)
  traitButtons.forEach((btn, index) => {
    const originalColor = btn.dataset.traitColor;

    btn.addEventListener('mouseenter', () => {
      btn.style.transform = 'translateY(-2px)';
      btn.style.background = originalColor + 'dd';
    });

    btn.addEventListener('mouseleave', () => {
      btn.style.transform = 'translateY(0)';
      btn.style.background = originalColor;
    });

    btn.addEventListener('click', () => {
      const trait = allTraits[index];
      debug.log(`🎯 User chose trait: ${trait.name}`);

      popupOverlay.remove();

      // Execute the chosen trait's action
      if (trait.name === 'Halfling Luck') {
        showHalflingLuckPopup({
          rollResult: rollData.baseRoll,
          baseRoll: rollData.baseRoll,
          rollType: rollData.rollType,
          rollName: rollData.rollName
        });
      } else if (trait.name === 'Lucky') {
        const luckyResource = getLuckyResource();
        showLuckyPopup({
          rollResult: rollData.baseRoll,
          baseRoll: rollData.baseRoll,
          rollType: rollData.rollType,
          rollName: rollData.rollName,
          luckPointsRemaining: luckyResource?.current || 0
        });
      }
    });
  });

  // Add hover effects for cancel button (CSP-compliant)
  cancelBtn.addEventListener('mouseenter', () => cancelBtn.style.background = '#7f8c8d');
  cancelBtn.addEventListener('mouseleave', () => cancelBtn.style.background = '#95a5a6');

  cancelBtn.addEventListener('click', () => {
    popupOverlay.remove();
  });

  // Close on overlay click
  popupOverlay.addEventListener('click', (e) => {
    if (e.target === popupOverlay) {
      popupOverlay.remove();
    }
  });

  debug.log('🎯 Trait choice popup displayed');
}

// Wild Magic Surge Popup
function showWildMagicSurgePopup(d100Roll, effect) {
  debug.log('🌀 Wild Magic Surge popup called with:', d100Roll, effect);

  if (!document.body) {
    debug.error('❌ document.body not available for Wild Magic Surge popup');
    showNotification(`🌀 Wild Magic Surge! d100: ${d100Roll}`, 'warning');
    return;
  }

  const colors = getPopupThemeColors();

  // Create popup overlay
  const popupOverlay = document.createElement('div');
  popupOverlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.8);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  `;

  // Create popup content
  const popupContent = document.createElement('div');
  popupContent.style.cssText = `
    background: ${colors.background};
    border-radius: 12px;
    padding: 24px;
    max-width: 500px;
    width: 90%;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
    text-align: center;
  `;

  popupContent.innerHTML = `
    <div style="font-size: 32px; margin-bottom: 16px;">🌀</div>
    <h2 style="margin: 0 0 8px 0; color: #9b59b6;">Wild Magic Surge!</h2>
    <p style="margin: 0 0 16px 0; color: ${colors.text};">
      Your spell triggers a wild magic surge!
    </p>
    <div style="margin: 0 0 16px 0; padding: 16px; background: ${colors.infoBox}; border-radius: 8px; border-left: 4px solid #9b59b6; color: ${colors.text}; text-align: left;">
      <div style="text-align: center; font-weight: bold; font-size: 18px; margin-bottom: 12px; color: #9b59b6;">
        d100 Roll: ${d100Roll}
      </div>
      <div style="font-size: 14px; line-height: 1.6;">
        ${effect}
      </div>
    </div>
    <button id="closeWildMagicBtn" style="
      background: #9b59b6;
      color: white;
      border: none;
      padding: 12px 32px;
      border-radius: 8px;
      cursor: pointer;
      font-weight: bold;
      font-size: 14px;
      transition: background 0.2s;
    ">Got it!</button>
  `;

  popupOverlay.appendChild(popupContent);
  document.body.appendChild(popupOverlay);

  // Add event listeners
  const closeBtn = document.getElementById('closeWildMagicBtn');

  closeBtn.addEventListener('mouseenter', () => closeBtn.style.background = '#8e44ad');
  closeBtn.addEventListener('mouseleave', () => closeBtn.style.background = '#9b59b6');

  closeBtn.addEventListener('click', () => {
    document.body.removeChild(popupOverlay);
  });

  // Close on overlay click
  popupOverlay.addEventListener('click', (e) => {
    if (e.target === popupOverlay) {
      document.body.removeChild(popupOverlay);
    }
  });

  // Also announce to Roll20 chat
  const colorBanner = getColoredBanner();
  const message = `&{template:default} {{name=${colorBanner}${characterData.name} - Wild Magic Surge! 🌀}} {{d100 Roll=${d100Roll}}} {{Effect=${effect}}}`;

  if (window.opener && !window.opener.closed) {
    window.opener.postMessage({
      action: 'announceSpell',
      message: message
    }, '*');
  }

  debug.log('🌀 Wild Magic Surge popup displayed');
}

// Bardic Inspiration Popup Functions
function showBardicInspirationPopup(rollData) {
  debug.log('🎵 Bardic Inspiration popup called with:', rollData);

  // Check if document.body exists
  if (!document.body) {
    debug.error('❌ document.body not available for Bardic Inspiration popup');
    showNotification('🎵 Bardic Inspiration available! (Popup failed to display)', 'info');
    return;
  }

  debug.log('🎵 Creating Bardic Inspiration popup overlay...');

  // Get theme-aware colors
  const colors = getPopupThemeColors();

  // Create popup overlay
  const popupOverlay = document.createElement('div');
  popupOverlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.8);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  `;

  // Create popup content
  const popupContent = document.createElement('div');
  popupContent.style.cssText = `
    background: ${colors.background};
    border-radius: 12px;
    padding: 24px;
    max-width: 450px;
    width: 90%;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
    text-align: center;
  `;

  debug.log('🎵 Setting Bardic Inspiration popup content HTML...');

  popupContent.innerHTML = `
    <div style="font-size: 32px; margin-bottom: 16px;">🎵</div>
    <h2 style="margin: 0 0 8px 0; color: ${colors.heading};">Bardic Inspiration!</h2>
    <p style="margin: 0 0 16px 0; color: ${colors.text};">
      Add a <strong>${rollData.inspirationDie}</strong> to this roll?
    </p>
    <div style="margin: 0 0 16px 0; padding: 12px; background: ${colors.infoBox}; border-radius: 8px; border-left: 4px solid #9b59b6; color: ${colors.text};">
      <strong>Current Roll:</strong> ${rollData.rollName}<br>
      <strong>Base Result:</strong> ${rollData.baseRoll}<br>
      <strong>Inspiration Die:</strong> ${rollData.inspirationDie}<br>
      <strong>Uses Left:</strong> ${rollData.usesRemaining}
    </div>
    <div style="margin-bottom: 16px; padding: 12px; background: ${colors.infoBox}; border-radius: 8px; color: ${colors.text}; font-size: 13px; text-align: left;">
      <strong>💡 How it works:</strong><br>
      • Roll the inspiration die and add it to your total<br>
      • Can be used on ability checks, attack rolls, or saves<br>
      • Only one inspiration die can be used per roll
    </div>
    <div style="display: flex; gap: 12px; justify-content: center;">
      <button id="bardicUseBtn" style="
        background: #9b59b6;
        color: white;
        border: none;
        padding: 12px 24px;
        border-radius: 8px;
        cursor: pointer;
        font-weight: bold;
        font-size: 14px;
        transition: background 0.2s;
      ">🎲 Use Inspiration</button>
      <button id="bardicDeclineBtn" style="
        background: #7f8c8d;
        color: white;
        border: none;
        padding: 12px 24px;
        border-radius: 8px;
        cursor: pointer;
        font-weight: bold;
        font-size: 14px;
        transition: background 0.2s;
      ">Decline</button>
    </div>
  `;

  debug.log('🎵 Appending Bardic Inspiration popup to document.body...');

  popupOverlay.appendChild(popupContent);
  document.body.appendChild(popupOverlay);

  // Add hover effects
  const useBtn = document.getElementById('bardicUseBtn');
  const declineBtn = document.getElementById('bardicDeclineBtn');

  useBtn.addEventListener('mouseenter', () => {
    useBtn.style.background = '#8e44ad';
  });
  useBtn.addEventListener('mouseleave', () => {
    useBtn.style.background = '#9b59b6';
  });

  declineBtn.addEventListener('mouseenter', () => {
    declineBtn.style.background = '#95a5a6';
  });
  declineBtn.addEventListener('mouseleave', () => {
    declineBtn.style.background = '#7f8c8d';
  });

  // Add event listeners
  useBtn.addEventListener('click', () => {
    debug.log('🎵 User chose to use Bardic Inspiration');
    performBardicInspirationRoll(rollData);
    document.body.removeChild(popupOverlay);
  });

  declineBtn.addEventListener('click', () => {
    debug.log('🎵 User declined Bardic Inspiration');
    showNotification('Bardic Inspiration declined', 'info');
    document.body.removeChild(popupOverlay);
  });

  // Close on overlay click
  popupOverlay.addEventListener('click', (e) => {
    if (e.target === popupOverlay) {
      debug.log('🎵 User closed Bardic Inspiration popup');
      document.body.removeChild(popupOverlay);
    }
  });

  debug.log('🎵 Bardic Inspiration popup displayed');
}

function performBardicInspirationRoll(rollData) {
  debug.log('🎵 Performing Bardic Inspiration roll with data:', rollData);

  // Use one Bardic Inspiration use
  const success = useBardicInspiration();
  if (!success) {
    debug.error('❌ Failed to use Bardic Inspiration (no uses left?)');
    showNotification('❌ Failed to use Bardic Inspiration', 'error');
    return;
  }

  // Roll the inspiration die
  const dieSize = parseInt(rollData.inspirationDie.substring(1)); // "d6" -> 6
  const inspirationRoll = Math.floor(Math.random() * dieSize) + 1;

  debug.log(`🎵 Rolled ${rollData.inspirationDie}: ${inspirationRoll}`);

  // Create the roll message
  const inspirationMessage = `/roll ${rollData.inspirationDie}`;
  const chatMessage = `🎵 Bardic Inspiration for ${rollData.rollName}: [[${inspirationRoll}]] (${rollData.inspirationDie})`;

  // Show notification
  showNotification(`🎵 Bardic Inspiration: +${inspirationRoll}!`, 'success');

  // Post to Roll20 chat
  browserAPI.runtime.sendMessage({
    action: 'rollDice',
    rollData: {
      message: chatMessage,
      characterName: characterData.name || 'Character'
    }
  });

  debug.log('🎵 Bardic Inspiration roll complete');
}

// Elven Accuracy Popup
function showElvenAccuracyPopup(rollData) {
  debug.log('🧝 Elven Accuracy popup called with:', rollData);

  if (!document.body) {
    debug.error('❌ document.body not available for Elven Accuracy popup');
    showNotification('🧝 Elven Accuracy triggered!', 'info');
    return;
  }

  const colors = getPopupThemeColors();

  // Create popup overlay
  const popupOverlay = document.createElement('div');
  popupOverlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.8);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  `;

  // Create popup content
  const popupContent = document.createElement('div');
  popupContent.style.cssText = `
    background: ${colors.background};
    border-radius: 12px;
    padding: 24px;
    max-width: 400px;
    width: 90%;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
    text-align: center;
  `;

  popupContent.innerHTML = `
    <div style="font-size: 24px; margin-bottom: 16px;">🧝</div>
    <h2 style="margin: 0 0 8px 0; color: #27ae60;">Elven Accuracy!</h2>
    <p style="margin: 0 0 16px 0; color: ${colors.text};">
      You have advantage! Would you like to reroll the lower die?
    </p>
    <div style="margin: 0 0 16px 0; padding: 12px; background: ${colors.infoBox}; border-radius: 8px; border-left: 4px solid #27ae60; color: ${colors.text};">
      <strong>Roll:</strong> ${rollData.rollName}<br>
      <strong>Type:</strong> Advantage attack roll
    </div>
    <div style="display: flex; gap: 12px; justify-content: center;">
      <button id="elvenRerollBtn" style="
        background: #27ae60;
        color: white;
        border: none;
        padding: 12px 24px;
        border-radius: 8px;
        cursor: pointer;
        font-weight: bold;
        font-size: 14px;
      ">🎲 Reroll Lower Die</button>
      <button id="elvenKeepBtn" style="
        background: #95a5a6;
        color: white;
        border: none;
        padding: 12px 24px;
        border-radius: 8px;
        cursor: pointer;
        font-weight: bold;
        font-size: 14px;
      ">Keep Rolls</button>
    </div>
  `;

  popupOverlay.appendChild(popupContent);
  document.body.appendChild(popupOverlay);

  // Add event listeners
  const rerollBtn = document.getElementById('elvenRerollBtn');
  const keepBtn = document.getElementById('elvenKeepBtn');

  rerollBtn.addEventListener('mouseenter', () => rerollBtn.style.background = '#229954');
  rerollBtn.addEventListener('mouseleave', () => rerollBtn.style.background = '#27ae60');
  keepBtn.addEventListener('mouseenter', () => keepBtn.style.background = '#7f8c8d');
  keepBtn.addEventListener('mouseleave', () => keepBtn.style.background = '#95a5a6');

  rerollBtn.addEventListener('click', () => {
    debug.log('🧝 User chose to reroll with Elven Accuracy');
    performElvenAccuracyReroll(rollData);
    document.body.removeChild(popupOverlay);
  });

  keepBtn.addEventListener('click', () => {
    debug.log('🧝 User chose to keep original advantage rolls');
    document.body.removeChild(popupOverlay);
  });

  // Close on overlay click
  popupOverlay.addEventListener('click', (e) => {
    if (e.target === popupOverlay) {
      document.body.removeChild(popupOverlay);
    }
  });

  debug.log('🧝 Elven Accuracy popup displayed');
}

function performElvenAccuracyReroll(originalRollData) {
  debug.log('🧝 Performing Elven Accuracy reroll for:', originalRollData);

  // Roll a third d20
  const thirdRoll = Math.floor(Math.random() * 20) + 1;

  // Create reroll announcement
  const rerollData = {
    name: `🧝 ${originalRollData.rollName} (Elven Accuracy - 3rd die)`,
    formula: '1d20',
    color: '#27ae60',
    characterName: characterData.name
  };

  debug.log('🧝 Third die roll:', thirdRoll);

  // Announce the third die roll to Roll20
  const colorBanner = getColoredBanner();
  const message = `&{template:default} {{name=${colorBanner}${characterData.name} uses Elven Accuracy! 🧝}} {{Action=Reroll lower die}} {{Third d20=${thirdRoll}}} {{=Choose the highest of all three rolls!}}`;

  if (window.opener && !window.opener.closed) {
    window.opener.postMessage({
      action: 'announceSpell',
      message: message
    }, '*');
  } else {
    // Fallback: send directly to Roll20 via background script
    browserAPI.runtime.sendMessage({
      action: 'relayRollToRoll20',
      roll: { ...rerollData, result: thirdRoll }
    });
  }

  showNotification(`🧝 Elven Accuracy! Third die: ${thirdRoll}`, 'success');
}

// Lucky Modal (simple like metamagic)
function performHalflingReroll(originalRollData) {
  debug.log('🍀 Performing Halfling reroll for:', originalRollData);
  
  // Extract the base formula (remove any modifiers)
  const formula = originalRollData.rollType;
  const baseFormula = formula.split('+')[0]; // Get just the d20 part
  
  // Create a new roll with just the d20
  const rerollData = {
    name: `🍀 ${originalRollData.rollName} (Halfling Luck)`,
    formula: baseFormula,
    color: '#2D8B83',
    characterName: characterData.name
  };
  
  debug.log('🍀 Reroll data:', rerollData);
  
  // Send the reroll request
  if (window.opener && !window.opener.closed) {
    // Send via popup window opener (Roll20 content script)
    window.opener.postMessage({
      action: 'rollFromPopout',
      ...rerollData
    }, '*');
  } else {
    // Fallback: send directly to Roll20 via background script
    browserAPI.runtime.sendMessage({
      action: 'relayRollToRoll20',
      roll: rerollData
    });
  }
  
  showNotification('🍀 Halfling Luck reroll initiated!', 'success');
}

// Halfling Luck Racial Trait
const HalflingLuck = {
  name: 'Halfling Luck',
  description: 'When you roll a 1 on an attack roll, ability check, or saving throw, you can reroll the die and must use the new roll.',
  
  onRoll: function(rollResult, rollType, rollName) {
    debug.log(`🧬 Halfling Luck onRoll called with: ${rollResult}, ${rollType}, ${rollName}`);
    debug.log(`🧬 Halfling Luck DEBUG - rollType exists: ${!!rollType}, includes d20: ${rollType && rollType.includes('d20')}, rollResult === 1: ${parseInt(rollResult) === 1}`);

    // Convert rollResult to number for comparison
    const numericRollResult = parseInt(rollResult);
    
    // Check if it's a d20 roll and the result is 1
    if (rollType && rollType.includes('d20') && numericRollResult === 1) {
      debug.log(`🧬 Halfling Luck: TRIGGERED! Roll was ${numericRollResult}`);

      // Show the popup with error handling
      try {
        showHalflingLuckPopup({
          rollResult: numericRollResult,
          baseRoll: numericRollResult,
          rollType: rollType,
          rollName: rollName
        });
      } catch (error) {
        debug.error('❌ Error showing Halfling Luck popup:', error);
        // Fallback notification
        showNotification('🍀 Halfling Luck triggered! Check console for details.', 'info');
      }

      return true; // Trait triggered
    }

    debug.log(`🧬 Halfling Luck: No trigger - Roll: ${numericRollResult}, Type: ${rollType}`);
    return false; // No trigger
  }
};

// Lucky Feat Trait
const LuckyFeat = {
  name: 'Lucky',
  description: 'You have 3 luck points. When you make an attack roll, ability check, or saving throw, you can spend one luck point to roll an additional d20. You can then choose which of the d20 rolls to use.',
  
  onRoll: function(rollResult, rollType, rollName) {
    debug.log(`🎖️ Lucky feat onRoll called with: ${rollResult}, ${rollType}, ${rollName}`);
    
    // Convert rollResult to number for comparison
    const numericRollResult = parseInt(rollResult);
    
    // Check if it's a d20 roll (attack, ability check, or saving throw)
    if (rollType && rollType.includes('d20')) {
      debug.log(`🎖️ Lucky: Checking if we should offer reroll for ${numericRollResult}`);
      
      // Check if character has luck points available
      const luckyResource = getLuckyResource();
      if (!luckyResource || luckyResource.current <= 0) {
        debug.log(`🎖️ Lucky: No luck points available (${luckyResource?.current || 0})`);
        return false;
      }
      
      debug.log(`🎖️ Lucky: Has ${luckyResource.current} luck points available`);
      
      // For Lucky feat, we offer reroll on any roll (not just 1s)
      // But we should prioritize low rolls
      if (numericRollResult <= 10) { // Offer reroll on rolls of 10 or less
        debug.log(`🎖️ Lucky: TRIGGERED! Offering reroll for roll ${numericRollResult}`);
        
        // Show the Lucky popup with error handling
        try {
          showLuckyPopup({
            rollResult: numericRollResult,
            baseRoll: numericRollResult,
            rollType: rollType,
            rollName: rollName,
            luckPointsRemaining: luckyResource.current
          });
        } catch (error) {
          debug.error('❌ Error showing Lucky popup:', error);
          // Fallback notification
          showNotification('🎖️ Lucky triggered! Check console for details.', 'info');
        }
        
        return true; // Trait triggered
      }
    }

    debug.log(`🎖️ Lucky: No trigger - Roll: ${numericRollResult}, Type: ${rollType}`);
    return false; // No trigger
  }
};

// ============================================================================
// RACIAL TRAITS - ADDITIONAL
// ============================================================================

// Elven Accuracy
const ElvenAccuracy = {
  name: 'Elven Accuracy',
  description: 'Whenever you have advantage on an attack roll using Dexterity, Intelligence, Wisdom, or Charisma, you can reroll one of the dice once.',

  onRoll: function(rollResult, rollType, rollName) {
    debug.log(`🧝 Elven Accuracy onRoll called with: ${rollResult}, ${rollType}, ${rollName}`);

    // Check if it's an attack roll with advantage using DEX/INT/WIS/CHA
    // The rollType should contain "advantage" and the roll should be an attack
    if (rollType && rollType.includes('advantage') && rollType.includes('attack')) {
      debug.log(`🧝 Elven Accuracy: TRIGGERED! Offering to reroll lower die`);

      // Show popup asking if they want to reroll
      showElvenAccuracyPopup({
        rollName: rollName,
        rollType: rollType,
        rollResult: rollResult
      });

      return true;
    }

    return false;
  }
};

// Dwarven Resilience
const DwarvenResilience = {
  name: 'Dwarven Resilience',
  description: 'You have advantage on saving throws against poison.',

  onRoll: function(rollResult, rollType, rollName) {
    debug.log(`⛏️ Dwarven Resilience onRoll called with: ${rollResult}, ${rollType}, ${rollName}`);

    // Check if it's a poison save
    const lowerRollName = rollName.toLowerCase();
    if (rollType && rollType.includes('save') && lowerRollName.includes('poison')) {
      debug.log(`⛏️ Dwarven Resilience: TRIGGERED! Auto-applying advantage`);
      showNotification('⛏️ Dwarven Resilience: Advantage on poison saves!', 'success');
      return true;
    }

    return false;
  }
};

// Gnome Cunning
const GnomeCunning = {
  name: 'Gnome Cunning',
  description: 'You have advantage on all Intelligence, Wisdom, and Charisma saving throws against magic.',

  onRoll: function(rollResult, rollType, rollName) {
    debug.log(`🎩 Gnome Cunning onRoll called with: ${rollResult}, ${rollType}, ${rollName}`);

    // Check if it's an INT/WIS/CHA save against magic
    const lowerRollName = rollName.toLowerCase();
    const isMentalSave = lowerRollName.includes('intelligence') ||
                         lowerRollName.includes('wisdom') ||
                         lowerRollName.includes('charisma') ||
                         lowerRollName.includes('int save') ||
                         lowerRollName.includes('wis save') ||
                         lowerRollName.includes('cha save');

    const isMagic = lowerRollName.includes('spell') ||
                    lowerRollName.includes('magic') ||
                    lowerRollName.includes('charm') ||
                    lowerRollName.includes('illusion');

    if (rollType && rollType.includes('save') && isMentalSave && isMagic) {
      debug.log(`🎩 Gnome Cunning: TRIGGERED! Auto-applying advantage`);
      showNotification('🎩 Gnome Cunning: Advantage on mental saves vs magic!', 'success');
      return true;
    }

    return false;
  }
};

// ============================================================================
// CLASS FEATURES
// ============================================================================

// Reliable Talent (Rogue 11+)
const ReliableTalent = {
  name: 'Reliable Talent',
  description: 'Whenever you make an ability check that lets you add your proficiency bonus, you treat a d20 roll of 9 or lower as a 10.',

  onRoll: function(rollResult, rollType, rollName) {
    debug.log(`🎯 Reliable Talent onRoll called with: ${rollResult}, ${rollType}, ${rollName}`);

    const numericRollResult = parseInt(rollResult);

    // Check if it's a skill check (proficient skills would be marked somehow)
    if (rollType && rollType.includes('skill') && numericRollResult < 10) {
      debug.log(`🎯 Reliable Talent: TRIGGERED! Minimum roll is 10`);
      showNotification(`🎯 Reliable Talent: ${numericRollResult} becomes 10!`, 'success');
      return true;
    }

    return false;
  }
};

// Jack of All Trades (Bard)
const JackOfAllTrades = {
  name: 'Jack of All Trades',
  description: 'You can add half your proficiency bonus (rounded down) to any ability check you make that doesn\'t already include your proficiency bonus.',

  onRoll: function(rollResult, rollType, rollName) {
    debug.log(`🎵 Jack of All Trades onRoll called with: ${rollResult}, ${rollType}, ${rollName}`);

    // This would need to check if the skill is non-proficient
    // For now, we'll show a reminder
    if (rollType && rollType.includes('skill')) {
      const profBonus = characterData.proficiencyBonus || 2;
      const halfProf = Math.floor(profBonus / 2);
      debug.log(`🎵 Jack of All Trades: Reminder to add +${halfProf} if non-proficient`);
      showNotification(`🎵 Jack: Add +${halfProf} if non-proficient`, 'info');
      return true;
    }

    return false;
  }
};

// Rage Damage Bonus (Barbarian)
const RageDamageBonus = {
  name: 'Rage',
  description: 'While raging, you gain bonus damage on melee weapon attacks using Strength.',

  onRoll: function(rollResult, rollType, rollName) {
    debug.log(`😡 Rage Damage onRoll called with: ${rollResult}, ${rollType}, ${rollName}`);

    // Check if character is raging (would need rage tracking)
    const isRaging = characterData.conditions && characterData.conditions.some(c =>
      c.toLowerCase().includes('rage') || c.toLowerCase().includes('raging')
    );

    if (isRaging && rollType && rollType.includes('attack')) {
      const level = characterData.level || 1;
      const rageDamage = level < 9 ? 2 : level < 16 ? 3 : 4;
      debug.log(`😡 Rage Damage: TRIGGERED! Adding +${rageDamage} damage`);
      showNotification(`😡 Rage: Add +${rageDamage} damage!`, 'success');
      return true;
    }

    return false;
  }
};

// Brutal Critical (Barbarian)
const BrutalCritical = {
  name: 'Brutal Critical',
  description: 'You can roll one additional weapon damage die when determining the extra damage for a critical hit with a melee attack.',

  onRoll: function(rollResult, rollType, rollName) {
    debug.log(`💥 Brutal Critical onRoll called with: ${rollResult}, ${rollType}, ${rollName}`);

    const numericRollResult = parseInt(rollResult);

    // Check for natural 20 on melee attack
    if (rollType && rollType.includes('attack') && numericRollResult === 20) {
      const level = characterData.level || 1;
      const extraDice = level < 13 ? 1 : level < 17 ? 2 : 3;
      debug.log(`💥 Brutal Critical: TRIGGERED! Roll ${extraDice} extra weapon die/dice`);
      showNotification(`💥 Brutal Critical: Roll ${extraDice} extra weapon die!`, 'success');
      return true;
    }

    return false;
  }
};

// Portent Dice (Divination Wizard)
const PortentDice = {
  name: 'Portent',
  description: 'Roll two d20s and record the numbers. You can replace any attack roll, saving throw, or ability check made by you or a creature you can see with one of these rolls.',

  portentRolls: [], // Store portent rolls for the day

  rollPortentDice: function() {
    const roll1 = Math.floor(Math.random() * 20) + 1;
    const roll2 = Math.floor(Math.random() * 20) + 1;
    this.portentRolls = [roll1, roll2];
    debug.log(`🔮 Portent: Rolled ${roll1} and ${roll2}`);
    showNotification(`🔮 Portent: You rolled ${roll1} and ${roll2}`, 'info');
    return this.portentRolls;
  },

  usePortentRoll: function(index) {
    if (index >= 0 && index < this.portentRolls.length) {
      const roll = this.portentRolls.splice(index, 1)[0];
      debug.log(`🔮 Portent: Used portent roll ${roll}`);
      showNotification(`🔮 Portent: Applied roll of ${roll}`, 'success');
      return roll;
    }
    return null;
  },

  onRoll: function(rollResult, rollType, rollName) {
    // Portent is applied manually, not automatically triggered
    if (this.portentRolls.length > 0) {
      showNotification(`🔮 ${this.portentRolls.length} Portent dice available`, 'info');
    }
    return false;
  }
};

// Wild Magic Surge Table (d100)
const WILD_MAGIC_EFFECTS = [
  "Roll on this table at the start of each of your turns for the next minute, ignoring this result on subsequent rolls.",
  "Roll on this table at the start of each of your turns for the next minute, ignoring this result on subsequent rolls.",
  "For the next minute, you can see any invisible creature if you have line of sight to it.",
  "For the next minute, you can see any invisible creature if you have line of sight to it.",
  "A modron chosen and controlled by the DM appears in an unoccupied space within 5 feet of you, then disappears 1 minute later.",
  "A modron chosen and controlled by the DM appears in an unoccupied space within 5 feet of you, then disappears 1 minute later.",
  "You cast Fireball as a 3rd-level spell centered on yourself.",
  "You cast Fireball as a 3rd-level spell centered on yourself.",
  "You cast Magic Missile as a 5th-level spell.",
  "You cast Magic Missile as a 5th-level spell.",
  "Roll a d10. Your height changes by a number of inches equal to the roll. If the roll is odd, you shrink. If the roll is even, you grow.",
  "Roll a d10. Your height changes by a number of inches equal to the roll. If the roll is odd, you shrink. If the roll is even, you grow.",
  "You cast Confusion centered on yourself.",
  "You cast Confusion centered on yourself.",
  "For the next minute, you regain 5 hit points at the start of each of your turns.",
  "For the next minute, you regain 5 hit points at the start of each of your turns.",
  "You grow a long beard made of feathers that remains until you sneeze, at which point the feathers explode out from your face.",
  "You grow a long beard made of feathers that remains until you sneeze, at which point the feathers explode out from your face.",
  "You cast Grease centered on yourself.",
  "You cast Grease centered on yourself.",
  "Creatures have disadvantage on saving throws against the next spell you cast in the next minute that involves a saving throw.",
  "Creatures have disadvantage on saving throws against the next spell you cast in the next minute that involves a saving throw.",
  "Your skin turns a vibrant shade of blue. A Remove Curse spell can end this effect.",
  "Your skin turns a vibrant shade of blue. A Remove Curse spell can end this effect.",
  "An eye appears on your forehead for the next minute. During that time, you have advantage on Wisdom (Perception) checks that rely on sight.",
  "An eye appears on your forehead for the next minute. During that time, you have advantage on Wisdom (Perception) checks that rely on sight.",
  "For the next minute, all your spells with a casting time of 1 action have a casting time of 1 bonus action.",
  "For the next minute, all your spells with a casting time of 1 action have a casting time of 1 bonus action.",
  "You teleport up to 60 feet to an unoccupied space of your choice that you can see.",
  "You teleport up to 60 feet to an unoccupied space of your choice that you can see.",
  "You are transported to the Astral Plane until the end of your next turn, after which time you return to the space you previously occupied or the nearest unoccupied space if that space is occupied.",
  "You are transported to the Astral Plane until the end of your next turn, after which time you return to the space you previously occupied or the nearest unoccupied space if that space is occupied.",
  "Maximize the damage of the next damaging spell you cast within the next minute.",
  "Maximize the damage of the next damaging spell you cast within the next minute.",
  "Roll a d10. Your age changes by a number of years equal to the roll. If the roll is odd, you get younger (minimum 1 year old). If the roll is even, you get older.",
  "Roll a d10. Your age changes by a number of years equal to the roll. If the roll is odd, you get younger (minimum 1 year old). If the roll is even, you get older.",
  "1d6 flumphs controlled by the DM appear in unoccupied spaces within 60 feet of you and are frightened of you. They vanish after 1 minute.",
  "1d6 flumphs controlled by the DM appear in unoccupied spaces within 60 feet of you and are frightened of you. They vanish after 1 minute.",
  "You regain 2d10 hit points.",
  "You regain 2d10 hit points.",
  "You turn into a potted plant until the start of your next turn. While a plant, you are incapacitated and have vulnerability to all damage. If you drop to 0 hit points, your pot breaks, and your form reverts.",
  "You turn into a potted plant until the start of your next turn. While a plant, you are incapacitated and have vulnerability to all damage. If you drop to 0 hit points, your pot breaks, and your form reverts.",
  "For the next minute, you can teleport up to 20 feet as a bonus action on each of your turns.",
  "For the next minute, you can teleport up to 20 feet as a bonus action on each of your turns.",
  "You cast Levitate on yourself.",
  "You cast Levitate on yourself.",
  "A unicorn controlled by the DM appears in a space within 5 feet of you, then disappears 1 minute later.",
  "A unicorn controlled by the DM appears in a space within 5 feet of you, then disappears 1 minute later.",
  "You can't speak for the next minute. Whenever you try, pink bubbles float out of your mouth.",
  "You can't speak for the next minute. Whenever you try, pink bubbles float out of your mouth.",
  "A spectral shield hovers near you for the next minute, granting you a +2 bonus to AC and immunity to Magic Missile.",
  "A spectral shield hovers near you for the next minute, granting you a +2 bonus to AC and immunity to Magic Missile.",
  "You are immune to being intoxicated by alcohol for the next 5d6 days.",
  "You are immune to being intoxicated by alcohol for the next 5d6 days.",
  "Your hair falls out but grows back within 24 hours.",
  "Your hair falls out but grows back within 24 hours.",
  "For the next minute, any flammable object you touch that isn't being worn or carried by another creature bursts into flame.",
  "For the next minute, any flammable object you touch that isn't being worn or carried by another creature bursts into flame.",
  "You regain your lowest-level expended spell slot.",
  "You regain your lowest-level expended spell slot.",
  "For the next minute, you must shout when you speak.",
  "For the next minute, you must shout when you speak.",
  "You cast Fog Cloud centered on yourself.",
  "You cast Fog Cloud centered on yourself.",
  "Up to three creatures you choose within 30 feet of you take 4d10 lightning damage.",
  "Up to three creatures you choose within 30 feet of you take 4d10 lightning damage.",
  "You are frightened by the nearest creature until the end of your next turn.",
  "You are frightened by the nearest creature until the end of your next turn.",
  "Each creature within 30 feet of you becomes invisible for the next minute. The invisibility ends on a creature when it attacks or casts a spell.",
  "Each creature within 30 feet of you becomes invisible for the next minute. The invisibility ends on a creature when it attacks or casts a spell.",
  "You gain resistance to all damage for the next minute.",
  "You gain resistance to all damage for the next minute.",
  "A random creature within 60 feet of you becomes poisoned for 1d4 hours.",
  "A random creature within 60 feet of you becomes poisoned for 1d4 hours.",
  "You glow with bright light in a 30-foot radius for the next minute. Any creature that ends its turn within 5 feet of you is blinded until the end of its next turn.",
  "You glow with bright light in a 30-foot radius for the next minute. Any creature that ends its turn within 5 feet of you is blinded until the end of its next turn.",
  "You cast Polymorph on yourself. If you fail the saving throw, you turn into a sheep for the spell's duration.",
  "You cast Polymorph on yourself. If you fail the saving throw, you turn into a sheep for the spell's duration.",
  "Illusory butterflies and flower petals flutter in the air within 10 feet of you for the next minute.",
  "Illusory butterflies and flower petals flutter in the air within 10 feet of you for the next minute.",
  "You can take one additional action immediately.",
  "You can take one additional action immediately.",
  "Each creature within 30 feet of you takes 1d10 necrotic damage. You regain hit points equal to the sum of the necrotic damage dealt.",
  "Each creature within 30 feet of you takes 1d10 necrotic damage. You regain hit points equal to the sum of the necrotic damage dealt.",
  "You cast Mirror Image.",
  "You cast Mirror Image.",
  "You cast Fly on a random creature within 60 feet of you.",
  "You cast Fly on a random creature within 60 feet of you.",
  "You become invisible for the next minute. During that time, other creatures can't hear you. The invisibility ends if you attack or cast a spell.",
  "You become invisible for the next minute. During that time, other creatures can't hear you. The invisibility ends if you attack or cast a spell.",
  "If you die within the next minute, you immediately come back to life as if by the Reincarnate spell.",
  "If you die within the next minute, you immediately come back to life as if by the Reincarnate spell.",
  "Your size increases by one size category for the next minute.",
  "Your size increases by one size category for the next minute.",
  "You and all creatures within 30 feet of you gain vulnerability to piercing damage for the next minute.",
  "You and all creatures within 30 feet of you gain vulnerability to piercing damage for the next minute.",
  "You are surrounded by faint, ethereal music for the next minute.",
  "You are surrounded by faint, ethereal music for the next minute.",
  "You regain all expended sorcery points.",
  "You regain all expended sorcery points."
];

// Wild Magic Surge (Wild Magic Sorcerer)
const WildMagicSurge = {
  name: 'Wild Magic Surge',
  description: 'Immediately after you cast a sorcerer spell of 1st level or higher, the DM can have you roll a d20. If you roll a 1, roll on the Wild Magic Surge table.',

  onSpellCast: function(spellLevel) {
    if (spellLevel >= 1) {
      const surgeRoll = Math.floor(Math.random() * 20) + 1;
      debug.log(`🌀 Wild Magic: Rolled ${surgeRoll} for surge check`);

      if (surgeRoll === 1) {
        const surgeTableRoll = Math.floor(Math.random() * 100) + 1;
        const effect = WILD_MAGIC_EFFECTS[surgeTableRoll - 1];
        debug.log(`🌀 Wild Magic: SURGE! d100 = ${surgeTableRoll}: ${effect}`);
        showWildMagicSurgePopup(surgeTableRoll, effect);
        return true;
      } else {
        showNotification(`🌀 Wild Magic check: ${surgeRoll} (no surge)`, 'info');
      }
    }
    return false;
  },

  onRoll: function(rollResult, rollType, rollName) {
    // Wild Magic is triggered on spell cast, not regular rolls
    return false;
  }
};

// Bardic Inspiration (Bard)
const BardicInspiration = {
  name: 'Bardic Inspiration',
  description: 'You can inspire others through stirring words or music. As a bonus action, grant an ally a Bardic Inspiration die they can add to an ability check, attack roll, or saving throw.',

  onRoll: function(rollResult, rollType, rollName) {
    debug.log(`🎵 Bardic Inspiration onRoll called with: ${rollResult}, ${rollType}, ${rollName}`);

    // Check if it's a d20 roll (ability check, attack, or save)
    if (rollType && rollType.includes('d20')) {
      debug.log(`🎵 Bardic Inspiration: Checking if we should offer inspiration for ${rollName}`);

      // Check if character has Bardic Inspiration uses available
      const inspirationResource = getBardicInspirationResource();
      if (!inspirationResource || inspirationResource.current <= 0) {
        debug.log(`🎵 Bardic Inspiration: No uses available (${inspirationResource?.current || 0})`);
        return false;
      }

      debug.log(`🎵 Bardic Inspiration: Has ${inspirationResource.current} uses available`);

      // Get the inspiration die size based on bard level
      const level = characterData.level || 1;
      const inspirationDie = level < 5 ? 'd6' : level < 10 ? 'd8' : level < 15 ? 'd10' : 'd12';

      // Offer Bardic Inspiration on any d20 roll
      debug.log(`🎵 Bardic Inspiration: TRIGGERED! Offering ${inspirationDie}`);

      // Show the Bardic Inspiration popup with error handling
      try {
        showBardicInspirationPopup({
          rollResult: parseInt(rollResult),
          baseRoll: parseInt(rollResult),
          rollType: rollType,
          rollName: rollName,
          inspirationDie: inspirationDie,
          usesRemaining: inspirationResource.current
        });
      } catch (error) {
        debug.error('❌ Error showing Bardic Inspiration popup:', error);
        // Fallback notification
        showNotification(`🎵 Bardic Inspiration available! (${inspirationDie})`, 'info');
      }

      return true; // Trait triggered
    }

    debug.log(`🎵 Bardic Inspiration: No trigger - Type: ${rollType}`);
    return false; // No trigger
  }
};

function getBardicInspirationResource() {
  if (!characterData || !characterData.resources) {
    debug.log('🎵 No characterData or resources for Bardic Inspiration detection');
    return null;
  }

  // Find Bardic Inspiration in resources (flexible matching)
  const inspirationResource = characterData.resources.find(r => {
    const lowerName = r.name.toLowerCase().trim();
    return (
      lowerName.includes('bardic inspiration') ||
      lowerName === 'bardic inspiration' ||
      lowerName === 'inspiration' ||
      lowerName.includes('inspiration die') ||
      lowerName.includes('inspiration dice')
    );
  });

  if (inspirationResource) {
    debug.log(`🎵 Found Bardic Inspiration resource: ${inspirationResource.name} (${inspirationResource.current}/${inspirationResource.max})`);
  } else {
    debug.log('🎵 No Bardic Inspiration resource found in character data');
  }

  return inspirationResource;
}

function useBardicInspiration() {
  debug.log('🎵 useBardicInspiration called');
  const inspirationResource = getBardicInspirationResource();
  debug.log('🎵 Bardic Inspiration resource found:', inspirationResource);

  if (!inspirationResource) {
    debug.error('❌ No Bardic Inspiration resource found');
    return false;
  }

  if (inspirationResource.current <= 0) {
    debug.error(`❌ No Bardic Inspiration uses available (current: ${inspirationResource.current})`);
    return false;
  }

  // Decrement Bardic Inspiration uses
  const oldCurrent = inspirationResource.current;
  inspirationResource.current--;

  debug.log(`✅ Used Bardic Inspiration (${oldCurrent} → ${inspirationResource.current})`);

  // Save to storage
  browserAPI.storage.local.set({ characterData: characterData });

  // Refresh resources display
  buildResourcesDisplay();

  return true;
}

function updateLuckyButtonText() {
  const luckyButton = document.querySelector('#lucky-action-button');
  if (luckyButton) {
    const luckyResource = getLuckyResource();
    const luckPointsAvailable = luckyResource ? luckyResource.current : 0;
    luckyButton.innerHTML = `
      <span style="font-size: 16px;">🎖️</span>
      <span>Use Lucky Point (${luckPointsAvailable}/3)</span>
    `;
    debug.log(`🎖️ Lucky button updated to show ${luckPointsAvailable}/3`);
  }
}

// ============================================================================
// WINDOW SIZE PERSISTENCE
// ============================================================================

/**
 * Save current window dimensions to storage
 */
function saveWindowSize() {
  const width = window.outerWidth;
  const height = window.outerHeight;
  
  browserAPI.storage.local.set({
    popupWindowSize: { width, height }
  });
  
  debug.log(`💾 Saved window size: ${width}x${height}`);
}

/**
 * Load and apply saved window dimensions
 */
async function loadWindowSize() {
  try {
    const result = await browserAPI.storage.local.get(['popupWindowSize']);
    if (result.popupWindowSize) {
      const { width, height } = result.popupWindowSize;
      window.resizeTo(width, height);
      debug.log(`📐 Restored window size: ${width}x${height}`);
    }
  } catch (error) {
    debug.warn('⚠️ Could not restore window size:', error);
  }
}

/**
 * Initialize window size tracking
 */
function initWindowSizeTracking() {
  // Load saved size on startup
  loadWindowSize();
  
  // Save size when window is resized
  let resizeTimeout;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      saveWindowSize();
    }, 500); // Debounce to avoid excessive saves
  });
  
  debug.log('📐 Window size tracking initialized');
}

// Initialize window size tracking when DOM is ready
if (domReady) {
  initWindowSizeTracking();
} else {
  pendingOperations.push(initWindowSizeTracking);
}

// ============================================================================
// CUSTOM ROLL MACROS
// ============================================================================

let customMacros = [];

/**
 * Load custom macros from storage
 */
async function loadCustomMacros() {
  try {
    const result = await browserAPI.storage.local.get(['customMacros']);
    customMacros = result.customMacros || [];
    debug.log(`🎲 Loaded ${customMacros.length} custom macros`);
    updateMacrosDisplay();
  } catch (error) {
    debug.error('❌ Failed to load custom macros:', error);
  }
}

/**
 * Save all custom macros to storage
 */
function saveAllCustomMacros() {
  browserAPI.storage.local.set({ customMacros });
  debug.log(`💾 Saved ${customMacros.length} custom macros`);
}

/**
 * Add a new custom macro
 */
function addCustomMacro(name, formula, description = '') {
  const macro = {
    id: Date.now().toString(),
    name,
    formula,
    description,
    createdAt: Date.now()
  };
  
  customMacros.push(macro);
  saveAllCustomMacros();
  updateMacrosDisplay();
  
  debug.log(`✅ Added custom macro: ${name} (${formula})`);
  return macro;
}

/**
 * Delete a custom macro
 */
function deleteCustomMacro(macroId) {
  customMacros = customMacros.filter(m => m.id !== macroId);
  saveAllCustomMacros();
  updateMacrosDisplay();
  debug.log(`🗑️ Deleted macro: ${macroId}`);
}

/**
 * Execute a custom macro (roll the formula)
 */
function executeMacro(macro) {
  debug.log(`🎲 Executing macro: ${macro.name} (${macro.formula})`);
  
  // Use the existing roll announcement system
  announceAction(
    macro.name,
    macro.formula,
    '',
    macro.description || `Custom macro: ${macro.formula}`
  );
}

/**
 * Update the macros display in the UI
 */
function updateMacrosDisplay() {
  const container = document.getElementById('custom-macros-container');
  if (!container) return;
  
  if (customMacros.length === 0) {
    container.innerHTML = '<p style="text-align: center; color: #888; padding: 15px;">No custom macros yet. Click "Add Macro" to create one.</p>';
    return;
  }
  
  container.innerHTML = customMacros.map(macro => `
    <div class="macro-item" style="
      background: var(--bg-secondary);
      border: 2px solid var(--border-color);
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 10px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      transition: all 0.2s;
    ">
      <div style="flex: 1;">
        <div style="font-weight: bold; color: var(--text-primary); margin-bottom: 4px;">
          ${macro.name}
        </div>
        <div style="font-family: monospace; color: var(--accent-info); font-size: 0.9em; margin-bottom: 4px;">
          ${macro.formula}
        </div>
        ${macro.description ? `<div style="font-size: 0.85em; color: var(--text-secondary);">${macro.description}</div>` : ''}
      </div>
      <div style="display: flex; gap: 8px;">
        <button class="macro-roll-btn" data-macro-id="${macro.id}" style="
          background: var(--accent-primary);
          color: white;
          border: none;
          padding: 8px 16px;
          border-radius: 6px;
          cursor: pointer;
          font-weight: bold;
          transition: all 0.2s;
        ">
          🎲 Roll
        </button>
        <button class="macro-delete-btn" data-macro-id="${macro.id}" style="
          background: var(--accent-danger);
          color: white;
          border: none;
          padding: 8px 12px;
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.2s;
        ">
          🗑️
        </button>
      </div>
    </div>
  `).join('');
  
  // Add event listeners
  container.querySelectorAll('.macro-roll-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const macroId = btn.dataset.macroId;
      const macro = customMacros.find(m => m.id === macroId);
      if (macro) executeMacro(macro);
    });
  });
  
  container.querySelectorAll('.macro-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const macroId = btn.dataset.macroId;
      const macro = customMacros.find(m => m.id === macroId);
      if (macro && confirm(`Delete macro "${macro.name}"?`)) {
        deleteCustomMacro(macroId);
      }
    });
  });
}

/**
 * Show settings modal with tabs
 */
function showSettingsModal() {
  // Remove existing modal if any
  const existingModal = document.getElementById('settings-modal');
  if (existingModal) {
    document.body.removeChild(existingModal);
  }
  
  const modal = document.createElement('div');
  modal.id = 'settings-modal';
  modal.style.cssText = `
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
  
  modal.innerHTML = `
    <div style="
      background: var(--bg-secondary);
      border: 2px solid var(--border-color);
      border-radius: 12px;
      max-width: 700px;
      width: 90%;
      max-height: 80vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    ">
      <!-- Header -->
      <div style="
        padding: 20px;
        border-bottom: 2px solid var(--border-color);
        display: flex;
        justify-content: space-between;
        align-items: center;
      ">
        <h3 style="margin: 0; color: var(--text-primary);">⚙️ Settings</h3>
        <button id="settings-close-btn" style="
          background: var(--accent-danger);
          color: white;
          border: none;
          padding: 6px 12px;
          border-radius: 6px;
          cursor: pointer;
          font-weight: bold;
        ">✕</button>
      </div>
      
      <!-- Tabs -->
      <div style="
        display: flex;
        border-bottom: 2px solid var(--border-color);
        background: var(--bg-tertiary);
      ">
        <button class="settings-tab active" data-tab="theme" style="
          flex: 1;
          padding: 12px;
          background: transparent;
          border: none;
          cursor: pointer;
          font-weight: bold;
          color: var(--text-secondary);
          transition: all 0.2s;
        ">🎨 Theme</button>
        <button class="settings-tab" data-tab="macros" style="
          flex: 1;
          padding: 12px;
          background: transparent;
          border: none;
          cursor: pointer;
          font-weight: bold;
          color: var(--text-secondary);
          transition: all 0.2s;
        ">🎲 Custom Macros</button>
        <button class="settings-tab" data-tab="gm" style="
          flex: 1;
          padding: 12px;
          background: transparent;
          border: none;
          cursor: pointer;
          font-weight: bold;
          color: var(--text-secondary);
          transition: all 0.2s;
        ">👑 GM Integration</button>
      </div>
      
      <!-- Content -->
      <div style="
        flex: 1;
        overflow-y: auto;
        padding: 20px;
      ">
        <!-- Theme Tab -->
        <div id="theme-tab-content" class="settings-tab-content">
          <h4 style="margin: 0 0 15px 0; color: var(--text-primary);">Choose Theme</h4>
          <div style="display: flex; gap: 15px; margin-bottom: 20px;">
            <button class="theme-option" data-theme="light" style="
              flex: 1;
              padding: 20px;
              background: var(--bg-primary);
              border: 3px solid var(--border-color);
              border-radius: 8px;
              cursor: pointer;
              transition: all 0.2s;
              display: flex;
              flex-direction: column;
              align-items: center;
              gap: 8px;
            ">
              <span style="font-size: 2em;">☀️</span>
              <span style="font-weight: bold; color: var(--text-primary);">Light</span>
            </button>
            <button class="theme-option" data-theme="dark" style="
              flex: 1;
              padding: 20px;
              background: var(--bg-primary);
              border: 3px solid var(--border-color);
              border-radius: 8px;
              cursor: pointer;
              transition: all 0.2s;
              display: flex;
              flex-direction: column;
              align-items: center;
              gap: 8px;
            ">
              <span style="font-size: 2em;">🌙</span>
              <span style="font-weight: bold; color: var(--text-primary);">Dark</span>
            </button>
            <button class="theme-option active" data-theme="system" style="
              flex: 1;
              padding: 20px;
              background: var(--bg-primary);
              border: 3px solid var(--accent-primary);
              border-radius: 8px;
              cursor: pointer;
              transition: all 0.2s;
              display: flex;
              flex-direction: column;
              align-items: center;
              gap: 8px;
            ">
              <span style="font-size: 2em;">💻</span>
              <span style="font-weight: bold; color: var(--text-primary);">System</span>
            </button>
          </div>
          <p style="color: var(--text-secondary); font-size: 0.9em; margin: 0;">
            System theme automatically matches your operating system's appearance settings.
          </p>
        </div>
        
        <!-- Macros Tab -->
        <div id="macros-tab-content" class="settings-tab-content" style="display: none;">
          <!-- Setting: Show gear buttons on spells -->
          <div style="background: var(--bg-tertiary); padding: 12px; border-radius: 8px; margin-bottom: 15px;">
            <label style="display: flex; align-items: center; gap: 10px; cursor: pointer;">
              <input type="checkbox" id="show-macro-buttons-setting" style="width: 18px; height: 18px;" ${showCustomMacroButtons ? 'checked' : ''}>
              <span style="color: var(--text-primary); font-weight: bold;">Show ⚙️ macro buttons on spells</span>
            </label>
            <p style="margin: 8px 0 0 28px; color: var(--text-secondary); font-size: 0.85em;">
              When enabled, shows a gear button on each spell to configure custom Roll20 macros.
            </p>
          </div>

          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
            <h4 style="margin: 0; color: var(--text-primary);">Your Custom Macros</h4>
            <button id="add-macro-btn-settings" style="
              padding: 8px 16px;
              background: var(--accent-primary);
              color: white;
              border: none;
              border-radius: 6px;
              cursor: pointer;
              font-weight: bold;
            ">➕ Add Macro</button>
          </div>
          <div id="custom-macros-container-settings"></div>
        </div>
        
        <!-- GM Integration Tab -->
        <div id="gm-tab-content" class="settings-tab-content" style="display: none;">
          <h4 style="margin: 0 0 15px 0; color: var(--text-primary);">👑 GM Integration</h4>

          <!-- DiceCloud Sync Section -->
          <div id="dicecloud-sync-section" style="background: var(--bg-tertiary); padding: 16px; border-radius: 8px; margin-bottom: 20px; display: none;">
            <h5 style="margin: 0 0 10px 0; color: var(--text-primary);">🔄 DiceCloud Sync</h5>
            <p style="margin: 0 0 15px 0; color: var(--text-secondary); font-size: 0.9em;">
              Manually sync all character data to DiceCloud. This updates HP, spell slots, Channel Divinity, class resources, and all other tracked values.
            </p>
            <button id="manual-sync-btn" style="
              background: linear-gradient(135deg, #3498db 0%, #2980b9 100%);
              color: white;
              border: none;
              border-radius: 8px;
              padding: 12px 24px;
              font-size: 1em;
              font-weight: bold;
              cursor: pointer;
              transition: all 0.3s ease;
              box-shadow: 0 2px 4px rgba(0,0,0,0.2);
              width: 100%;
            ">
              🔄 Sync to DiceCloud Now
            </button>
            <div id="sync-status" style="margin-top: 10px; padding: 8px; border-radius: 6px; font-size: 0.9em; display: none;"></div>
          </div>

          <div style="background: var(--bg-tertiary); padding: 16px; border-radius: 8px; margin-bottom: 20px;">
            <h5 style="margin: 0 0 10px 0; color: var(--text-primary);">Share Character with GM</h5>
            <p style="margin: 0 0 15px 0; color: var(--text-secondary); font-size: 0.9em;">
              Share your complete character sheet with the Game Master. This sends all your character data including abilities, skills, actions, spells, and equipment.
            </p>
            <button id="show-to-gm-btn" class="show-to-gm-btn" style="
              background: linear-gradient(135deg, #f39c12 0%, #e67e22 100%);
              color: white;
              border: none;
              border-radius: 8px;
              padding: 12px 24px;
              font-size: 1em;
              font-weight: bold;
              cursor: pointer;
              transition: all 0.3s ease;
              box-shadow: 0 2px 4px rgba(0,0,0,0.2);
              width: 100%;
            ">
              👑 Share Character with GM
            </button>
          </div>
          
          <div style="background: var(--bg-tertiary); padding: 16px; border-radius: 8px; margin-bottom: 20px;">
            <h5 style="margin: 0 0 10px 0; color: var(--text-primary);">How It Works</h5>
            <ul style="margin: 0; padding-left: 20px; color: var(--text-secondary); font-size: 0.9em;">
              <li>Click the button above to share your character</li>
              <li>Your character data appears in the Roll20 chat</li>
              <li>The GM receives your complete character sheet</li>
              <li>GM can view your stats, actions, and spells</li>
              <li>Helps GM track party composition and abilities</li>
            </ul>
          </div>
          
          <div style="background: var(--bg-tertiary); padding: 16px; border-radius: 8px;">
            <h5 style="margin: 0 0 10px 0; color: var(--text-primary);">Privacy Note</h5>
            <p style="margin: 0; color: var(--text-secondary); font-size: 0.9em;">
              Only share character data when requested by your GM. The shared data includes your complete character sheet for game management purposes.
            </p>
          </div>
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Set up tab switching
  modal.querySelectorAll('.settings-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const tabName = tab.dataset.tab;
      
      // Update tab buttons
      modal.querySelectorAll('.settings-tab').forEach(t => {
        t.classList.remove('active');
        t.style.color = 'var(--text-secondary)';
        t.style.background = 'transparent';
      });
      tab.classList.add('active');
      tab.style.color = 'var(--text-primary)';
      tab.style.background = 'var(--bg-secondary)';
      
      // Update content
      modal.querySelectorAll('.settings-tab-content').forEach(content => {
        content.style.display = 'none';
      });
      modal.querySelector(`#${tabName}-tab-content`).style.display = 'block';
    });
  });
  
  // Set up theme options
  const currentTheme = ThemeManager.getCurrentTheme();
  modal.querySelectorAll('.theme-option').forEach(option => {
    if (option.dataset.theme === currentTheme) {
      option.style.borderColor = 'var(--accent-primary)';
      option.classList.add('active');
    }
    
    option.addEventListener('click', () => {
      const theme = option.dataset.theme;
      ThemeManager.setTheme(theme);
      
      // Update active state
      modal.querySelectorAll('.theme-option').forEach(opt => {
        opt.style.borderColor = 'var(--border-color)';
        opt.classList.remove('active');
      });
      option.style.borderColor = 'var(--accent-primary)';
      option.classList.add('active');
    });
  });
  
  // Load macros into settings
  updateMacrosDisplayInSettings();
  
  // Initialize Show to GM button in settings
  initShowToGM();

  // Initialize manual DiceCloud sync button (experimental builds only)
  initManualSyncButton();

  // Set up add macro button
  modal.querySelector('#add-macro-btn-settings').addEventListener('click', () => {
    showAddMacroModal();
  });

  // Set up show macro buttons checkbox
  const macroButtonsCheckbox = modal.querySelector('#show-macro-buttons-setting');
  if (macroButtonsCheckbox) {
    macroButtonsCheckbox.addEventListener('change', (e) => {
      showCustomMacroButtons = e.target.checked;
      localStorage.setItem('showCustomMacroButtons', showCustomMacroButtons ? 'true' : 'false');
      debug.log(`⚙️ Custom macro buttons ${showCustomMacroButtons ? 'enabled' : 'disabled'}`);
      // Rebuild spells to show/hide gear buttons
      rebuildSpells();
    });
  }

  // Close button
  modal.querySelector('#settings-close-btn').addEventListener('click', () => {
    document.body.removeChild(modal);
  });
  
  // Close on background click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      document.body.removeChild(modal);
    }
  });
}

/**
 * Show add macro modal (simplified version for settings)
 */
function showAddMacroModal() {
  const modal = document.createElement('div');
  modal.id = 'add-macro-modal';
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.8);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10001;
  `;
  
  modal.innerHTML = `
    <div style="
      background: var(--bg-secondary);
      border: 2px solid var(--border-color);
      border-radius: 12px;
      padding: 24px;
      max-width: 500px;
      width: 90%;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    ">
      <h3 style="margin: 0 0 20px 0; color: var(--text-primary);">🎲 Add Custom Macro</h3>
      
      <div style="margin-bottom: 16px;">
        <label style="display: block; margin-bottom: 6px; font-weight: bold; color: var(--text-primary);">
          Macro Name
        </label>
        <input type="text" id="macro-name-input" placeholder="e.g., Sneak Attack" style="
          width: 100%;
          padding: 10px;
          border: 2px solid var(--border-color);
          border-radius: 6px;
          font-size: 14px;
          background: var(--bg-primary);
          color: var(--text-primary);
        ">
      </div>
      
      <div style="margin-bottom: 16px;">
        <label style="display: block; margin-bottom: 6px; font-weight: bold; color: var(--text-primary);">
          Roll Formula
        </label>
        <input type="text" id="macro-formula-input" placeholder="e.g., 3d6" style="
          width: 100%;
          padding: 10px;
          border: 2px solid var(--border-color);
          border-radius: 6px;
          font-size: 14px;
          font-family: monospace;
          background: var(--bg-primary);
          color: var(--text-primary);
        ">
        <small style="color: var(--text-secondary); font-size: 0.85em;">
          Examples: 1d20+5, 2d6+3, 8d6, 1d20+dexterity.modifier
        </small>
      </div>
      
      <div style="margin-bottom: 20px;">
        <label style="display: block; margin-bottom: 6px; font-weight: bold; color: var(--text-primary);">
          Description (optional)
        </label>
        <input type="text" id="macro-description-input" placeholder="e.g., Extra damage on hit" style="
          width: 100%;
          padding: 10px;
          border: 2px solid var(--border-color);
          border-radius: 6px;
          font-size: 14px;
          background: var(--bg-primary);
          color: var(--text-primary);
        ">
      </div>
      
      <div style="display: flex; gap: 10px; justify-content: flex-end;">
        <button id="macro-cancel-btn" style="
          padding: 10px 20px;
          background: var(--bg-tertiary);
          color: var(--text-primary);
          border: 2px solid var(--border-color);
          border-radius: 6px;
          cursor: pointer;
          font-weight: bold;
        ">
          Cancel
        </button>
        <button id="macro-save-btn" style="
          padding: 10px 20px;
          background: var(--accent-primary);
          color: white;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-weight: bold;
        ">
          Save Macro
        </button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  document.getElementById('macro-name-input').focus();
  
  document.getElementById('macro-cancel-btn').addEventListener('click', () => {
    document.body.removeChild(modal);
  });
  
  document.getElementById('macro-save-btn').addEventListener('click', () => {
    const name = document.getElementById('macro-name-input').value.trim();
    const formula = document.getElementById('macro-formula-input').value.trim();
    const description = document.getElementById('macro-description-input').value.trim();
    
    if (!name || !formula) {
      alert('Please enter both a name and formula for the macro.');
      return;
    }
    
    addCustomMacro(name, formula, description);
    document.body.removeChild(modal);
    updateMacrosDisplayInSettings();
  });
  
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      document.body.removeChild(modal);
    }
  });
}

/**
 * Update macros display in settings modal
 */
function updateMacrosDisplayInSettings() {
  const container = document.getElementById('custom-macros-container-settings');
  if (!container) return;
  
  if (customMacros.length === 0) {
    container.innerHTML = '<p style="text-align: center; color: #888; padding: 15px;">No custom macros yet. Click "Add Macro" to create one.</p>';
    return;
  }
  
  container.innerHTML = customMacros.map(macro => `
    <div class="macro-item" style="
      background: var(--bg-primary);
      border: 2px solid var(--border-color);
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 10px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      transition: all 0.2s;
    ">
      <div style="flex: 1;">
        <div style="font-weight: bold; color: var(--text-primary); margin-bottom: 4px;">
          ${macro.name}
        </div>
        <div style="font-family: monospace; color: var(--accent-info); font-size: 0.9em; margin-bottom: 4px;">
          ${macro.formula}
        </div>
        ${macro.description ? `<div style="font-size: 0.85em; color: var(--text-secondary);">${macro.description}</div>` : ''}
      </div>
      <div style="display: flex; gap: 8px;">
        <button class="macro-roll-btn" data-macro-id="${macro.id}" style="
          background: var(--accent-primary);
          color: white;
          border: none;
          padding: 8px 16px;
          border-radius: 6px;
          cursor: pointer;
          font-weight: bold;
          transition: all 0.2s;
        ">
          🎲 Roll
        </button>
        <button class="macro-delete-btn" data-macro-id="${macro.id}" style="
          background: var(--accent-danger);
          color: white;
          border: none;
          padding: 8px 12px;
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.2s;
        ">
          🗑️
        </button>
      </div>
    </div>
  `).join('');
  
  container.querySelectorAll('.macro-roll-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const macroId = btn.dataset.macroId;
      const macro = customMacros.find(m => m.id === macroId);
      if (macro) {
        executeMacro(macro);
        // Close settings modal after rolling
        const settingsModal = document.getElementById('settings-modal');
        if (settingsModal) {
          document.body.removeChild(settingsModal);
        }
      }
    });
  });
  
  container.querySelectorAll('.macro-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const macroId = btn.dataset.macroId;
      const macro = customMacros.find(m => m.id === macroId);
      if (macro && confirm(`Delete macro "${macro.name}"?`)) {
        deleteCustomMacro(macroId);
        updateMacrosDisplayInSettings();
      }
    });
  });
}

/**
 * Initialize custom macros system
 */
function initCustomMacros() {
  loadCustomMacros();

  // Load custom macro button setting (default: disabled)
  const savedSetting = localStorage.getItem('showCustomMacroButtons');
  showCustomMacroButtons = savedSetting === 'true';
  debug.log(`⚙️ Custom macro buttons setting: ${showCustomMacroButtons ? 'enabled' : 'disabled'}`);

  debug.log('🎲 Custom macros system initialized');
}

/**
 * Initialize settings button
 */
function initSettingsButton() {
  const settingsBtn = document.getElementById('settings-btn');
  if (settingsBtn) {
    settingsBtn.addEventListener('click', showSettingsModal);
    debug.log('⚙️ Settings button initialized');
  }
}

/**
 * Initialize status bar button
 */
let statusBarWindow = null;

function initStatusBarButton() {
  const statusBarBtn = document.getElementById('status-bar-btn');
  if (statusBarBtn) {
    statusBarBtn.addEventListener('click', () => {
      // Open status bar window
      const width = 350;
      const height = 500;
      const left = window.screenX + window.outerWidth - width - 50;
      const top = window.screenY + 50;

      statusBarWindow = window.open(
        browserAPI.runtime.getURL('src/status-bar.html'),
        'status-bar',
        `width=${width},height=${height},left=${left},top=${top},scrollbars=no,resizable=yes`
      );

      if (!statusBarWindow) {
        showNotification('❌ Failed to open status bar - please allow popups', 'error');
        return;
      }

      debug.log('📊 Status bar opened');

      // Send initial data after a short delay
      setTimeout(() => {
        sendStatusUpdate();
      }, 500);
    });
    debug.log('✅ Status bar button initialized');
  }
}

/**
 * Send status update to status bar window
 */
function sendStatusUpdate() {
  if (!statusBarWindow || statusBarWindow.closed) return;

  const statusData = {
    action: 'updateStatusData',
    data: {
      name: characterData.name || characterData.character_name,
      hitPoints: characterData.hitPoints || characterData.hit_points,
      concentrating: characterData.concentrating || false,
      concentrationSpell: characterData.concentrationSpell || '',
      activeBuffs: characterData.activeBuffs || [],
      activeDebuffs: characterData.activeDebuffs || [],
      spellSlots: characterData.spellSlots || {}
    }
  };

  statusBarWindow.postMessage(statusData, '*');
  debug.log('📊 Sent status update to status bar');
}

// Check if opened from GM panel and request character data
if (window.opener && !characterData) {
  // Request character data from parent window
  window.opener.postMessage({ action: 'requestCharacterData' }, '*');
  debug.log('📋 Requested character data from parent window');
}

// Initialize macros when DOM is ready
if (domReady) {
  initCustomMacros();
  initSettingsButton();
  initStatusBarButton();
} else {
  pendingOperations.push(initCustomMacros);
  pendingOperations.push(initSettingsButton);
  pendingOperations.push(initStatusBarButton);
}
