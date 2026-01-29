/**
 * Combat Tracker Module
 *
 * Handles action economy tracking, turn management, and concentration.
 * Loaded as a plain script (no ES6 modules) to export to globalThis.
 *
 * Functions exported to globalThis:
 * - initActionEconomy()
 * - activateTurn()
 * - deactivateTurn()
 * - markActionAsUsed(castingTime)
 * - getActionEconomyState()
 * - postActionEconomyToDiscord()
 * - updateActionEconomyAvailability()
 * - initConcentrationTracker()
 * - setConcentration(spellName)
 * - dropConcentration()
 * - updateConcentrationDisplay()
 * - postToChatIfOpener(message)
 * - isMyTurn (variable)
 * - concentratingSpell (variable)
 */

(function() {
  'use strict';

  // ===== STATE VARIABLES =====

  let isMyTurn = true; // Default true, greyed out when combat starts and not your turn
  let concentratingSpell = null;

  // ===== ACTION ECONOMY FUNCTIONS =====

  /**
   * Initialize action economy tracker
   */
  function initActionEconomy() {
    const actionIndicator = document.getElementById('action-indicator');
    const bonusActionIndicator = document.getElementById('bonus-action-indicator');
    const movementIndicator = document.getElementById('movement-indicator');
    const reactionIndicator = document.getElementById('reaction-indicator');
    const turnResetBtn = document.getElementById('turn-reset-btn');
    const roundResetBtn = document.getElementById('round-reset-btn');

    if (!actionIndicator) {
      debug.warn('⚠️ Action economy elements not found');
      return;
    }

    // Set initial state
    updateActionEconomyAvailability();

    // Click to toggle used state (can only mark as used, not restore manually)
    [actionIndicator, bonusActionIndicator, movementIndicator, reactionIndicator].forEach(indicator => {
      if (indicator) {
        indicator.addEventListener('click', () => {
          // Check if action is disabled (not your turn)
          if (indicator.dataset.disabled === 'true') {
            if (typeof showNotification !== 'undefined') {
              showNotification('⚠️ Only reactions available when it\'s not your turn!');
            }
            return;
          }

          const isUsed = indicator.dataset.used === 'true';
          const actionLabel = indicator.querySelector('.action-label').textContent;

          // Can only mark as used, not restore manually
          if (!isUsed) {
            indicator.dataset.used = 'true';
            debug.log(`🎯 ${actionLabel} used`);
            postActionToChat(actionLabel, 'used');
          } else {
            if (typeof showNotification !== 'undefined') {
              showNotification(`⚠️ Use Turn/Round Reset to restore ${actionLabel}`);
            }
          }
        });
      }
    });

    // Turn reset (Action, Bonus Action, Movement)
    if (turnResetBtn) {
      turnResetBtn.addEventListener('click', () => {
        [actionIndicator, bonusActionIndicator, movementIndicator].forEach(indicator => {
          if (indicator) indicator.dataset.used = 'false';
        });
        debug.log('🔄 Turn reset: Action, Bonus Action, Movement restored');
        if (typeof showNotification !== 'undefined') {
          showNotification('🔄 Turn reset!');
        }

        // Announce to Roll20 chat (characterData should be available from global scope)
        if (typeof characterData !== 'undefined') {
          postToChatIfOpener(`🔄 ${characterData.name} resets turn actions!`);
        }

        // Update Discord
        postActionEconomyToDiscord();
      });
    }

    // Round reset (includes Reaction)
    if (roundResetBtn) {
      roundResetBtn.addEventListener('click', () => {
        [actionIndicator, bonusActionIndicator, movementIndicator, reactionIndicator].forEach(indicator => {
          if (indicator) indicator.dataset.used = 'false';
        });
        debug.log('🔄 Round reset: All actions restored');
        if (typeof showNotification !== 'undefined') {
          showNotification('🔄 Round reset!');
        }

        // Announce to Roll20 chat
        if (typeof characterData !== 'undefined') {
          postToChatIfOpener(`🔄 ${characterData.name} resets all actions!`);
        }

        // Update Discord
        postActionEconomyToDiscord();
      });
    }

    debug.log('✅ Action economy initialized');
  }

  /**
   * Update action economy availability based on turn state
   */
  function updateActionEconomyAvailability() {
    const actionIndicator = document.getElementById('action-indicator');
    const bonusActionIndicator = document.getElementById('bonus-action-indicator');
    const movementIndicator = document.getElementById('movement-indicator');
    const reactionIndicator = document.getElementById('reaction-indicator');

    const turnBasedActions = [actionIndicator, bonusActionIndicator, movementIndicator];

    if (isMyTurn) {
      // Enable all actions on your turn - remove ALL inline styles to let CSS control everything
      [...turnBasedActions, reactionIndicator].forEach(indicator => {
        if (indicator) {
          indicator.dataset.disabled = 'false';
          // Remove all inline styles - let CSS [data-used] attribute fully control appearance
          indicator.style.removeProperty('opacity');
          indicator.style.removeProperty('cursor');
          indicator.style.removeProperty('pointer-events');
        }
      });
    } else {
      // Disable turn-based actions, keep reaction available
      turnBasedActions.forEach(indicator => {
        if (indicator) {
          indicator.dataset.disabled = 'true';
          // Force disabled appearance with inline styles (overrides CSS)
          indicator.style.opacity = '0.3';
          indicator.style.cursor = 'not-allowed';
          indicator.style.pointerEvents = 'auto'; // Still clickable for warning
        }
      });

      // Keep reaction enabled
      if (reactionIndicator) {
        reactionIndicator.dataset.disabled = 'false';
        // Remove all inline styles for reaction
        reactionIndicator.style.removeProperty('opacity');
        reactionIndicator.style.removeProperty('cursor');
        reactionIndicator.style.removeProperty('pointer-events');
      }
    }

    debug.log(`🔄 Action economy updated: isMyTurn=${isMyTurn}, actions=${turnBasedActions.length > 0 ? 'enabled' : 'disabled'}, reaction=${reactionIndicator ? 'enabled' : 'N/A'}`);
  }

  /**
   * Activate turn for this character
   */
  function activateTurn() {
    debug.log('⚔️ Activating turn - setting isMyTurn = true');
    isMyTurn = true;

    // Reset reaction at the start of your turn (one reaction per round)
    const reactionIndicator = document.getElementById('reaction-indicator');
    if (reactionIndicator) {
      reactionIndicator.dataset.used = 'false';
      debug.log('🔄 Reaction restored (one per round limit)');
    }

    updateActionEconomyAvailability();

    // Add visual highlight effect
    const actionEconomy = document.querySelector('.action-economy');
    if (actionEconomy) {
      actionEconomy.style.boxShadow = '0 0 20px rgba(78, 205, 196, 0.6)';
      actionEconomy.style.border = '2px solid #4ECDC4';
      debug.log('⚔️ Added visual highlight to action economy');
    }

    // Send action economy state to Discord (with fresh actions available)
    setTimeout(() => postActionEconomyToDiscord(), 100);

    debug.log('⚔️ Turn activated! All actions available.');
  }

  /**
   * Deactivate turn for this character
   */
  function deactivateTurn() {
    isMyTurn = false;
    updateActionEconomyAvailability();

    // Remove visual highlight
    const actionEconomy = document.querySelector('.action-economy');
    if (actionEconomy) {
      actionEconomy.style.boxShadow = '';
      actionEconomy.style.border = '';
    }

    debug.log('⏸️ Turn ended. Only reaction available.');
  }

  /**
   * Mark action as used based on casting time
   */
  function markActionAsUsed(castingTime) {
    if (!castingTime) {
      debug.warn('⚠️ No casting time provided to markActionAsUsed');
      return;
    }

    const actionIndicator = document.getElementById('action-indicator');
    const bonusActionIndicator = document.getElementById('bonus-action-indicator');
    const movementIndicator = document.getElementById('movement-indicator');
    const reactionIndicator = document.getElementById('reaction-indicator');

    // Normalize casting time for comparison (case insensitive)
    const normalizedTime = castingTime.toLowerCase().trim();

    debug.log(`🎯 Marking action as used for casting time: "${castingTime}" (normalized: "${normalizedTime}")`);
    debug.log(`🎯 Available indicators: Action=${!!actionIndicator}, Bonus=${!!bonusActionIndicator}, Movement=${!!movementIndicator}, Reaction=${!!reactionIndicator}`);

    // Mark appropriate action as used based on casting time
    if (normalizedTime.includes('bonus')) {
      if (bonusActionIndicator && bonusActionIndicator.dataset.used !== 'true') {
        bonusActionIndicator.dataset.used = 'true';
        debug.log(`🎯 Bonus Action used for casting`);
      } else {
        debug.log(`⚠️ Bonus Action indicator not found or already used`);
      }
    } else if (normalizedTime.includes('movement') || normalizedTime.includes('move')) {
      if (movementIndicator && movementIndicator.dataset.used !== 'true') {
        movementIndicator.dataset.used = 'true';
        debug.log(`🎯 Movement used for casting`);
      } else {
        debug.log(`⚠️ Movement indicator not found or already used`);
      }
    } else if (normalizedTime.includes('reaction')) {
      // Reactions are limited to one per round
      if (reactionIndicator && reactionIndicator.dataset.used !== 'true') {
        reactionIndicator.dataset.used = 'true';
        debug.log(`🎯 Reaction used for casting (one per round limit)`);
      } else {
        debug.log(`⚠️ Reaction indicator not found or already used this round`);
      }
    } else {
      // Default to action for anything else
      if (actionIndicator && actionIndicator.dataset.used !== 'true') {
        actionIndicator.dataset.used = 'true';
        debug.log(`🎯 Action used for casting`);
      } else {
        debug.log(`⚠️ Action indicator not found or already used`);
      }
    }

    // Update visual state
    updateActionEconomyAvailability();
  }

  /**
   * Get current action economy state
   */
  function getActionEconomyState() {
    const actionIndicator = document.getElementById('action-indicator');
    const bonusActionIndicator = document.getElementById('bonus-action-indicator');
    const movementIndicator = document.getElementById('movement-indicator');
    const reactionIndicator = document.getElementById('reaction-indicator');

    return {
      action: actionIndicator?.dataset.used === 'true',
      bonus: bonusActionIndicator?.dataset.used === 'true',
      movement: movementIndicator?.dataset.used === 'true',
      reaction: reactionIndicator?.dataset.used === 'true'
    };
  }

  /**
   * Post action economy state to Discord webhook
   */
  function postActionEconomyToDiscord() {
    // characterData should be available from global scope
    if (typeof characterData === 'undefined' || !characterData || !characterData.name) return;

    const actions = getActionEconomyState();

    // Send via the opener (Roll20 content script) which has access to browserAPI
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage({
        action: 'postToDiscordFromPopup',
        payload: {
          type: 'actionUpdate',
          characterName: characterData.name,
          actions: actions
        }
      }, '*');
      debug.log(`🎮 Discord: Posted action economy update for ${characterData.name}`);
    }
  }

  /**
   * Post action usage to chat
   */
  function postActionToChat(actionLabel, state) {
    if (typeof characterData === 'undefined') return;

    const emoji = state === 'used' ? '❌' : '✅';
    const message = `${emoji} ${characterData.name} ${state === 'used' ? 'uses' : 'restores'} ${actionLabel}`;
    postToChatIfOpener(message);

    // Also post to Discord
    postActionEconomyToDiscord();
  }

  /**
   * Post a message to Roll20 chat if opener exists
   */
  function postToChatIfOpener(message) {
    try {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage({
          action: 'postChatMessageFromPopup',
          message: message
        }, '*');
        debug.log(`📤 Posted to chat: ${message}`);
      }
    } catch (error) {
      debug.warn('⚠️ Could not post to chat:', error);
    }
  }

  // ===== CONCENTRATION TRACKING FUNCTIONS =====

  /**
   * Initialize concentration tracker
   */
  function initConcentrationTracker() {
    const dropConcentrationBtn = document.getElementById('drop-concentration-btn');

    if (dropConcentrationBtn) {
      dropConcentrationBtn.addEventListener('click', () => {
        dropConcentration();
      });
    }

    debug.log('✅ Concentration tracker initialized');
  }

  /**
   * Set concentration on a spell
   */
  function setConcentration(spellName) {
    concentratingSpell = spellName;
    if (typeof characterData !== 'undefined' && characterData) {
      characterData.concentration = spellName;
      // saveCharacterData should be available from global scope
      if (typeof saveCharacterData !== 'undefined') {
        saveCharacterData();
      }
    }
    updateConcentrationDisplay();
    if (typeof showNotification !== 'undefined') {
      showNotification(`🧠 Concentrating on: ${spellName}`);
    }
    debug.log(`🧠 Concentration set: ${spellName}`);
  }

  /**
   * Drop current concentration
   */
  function dropConcentration() {
    if (!concentratingSpell) return;

    const spellName = concentratingSpell;
    concentratingSpell = null;
    if (typeof characterData !== 'undefined' && characterData) {
      characterData.concentration = null;
      if (typeof saveCharacterData !== 'undefined') {
        saveCharacterData();
      }
    }
    updateConcentrationDisplay();
    if (typeof showNotification !== 'undefined') {
      showNotification(`✅ Dropped concentration on ${spellName}`);
    }
    debug.log(`🗑️ Concentration dropped: ${spellName}`);
  }

  /**
   * Update concentration display
   */
  function updateConcentrationDisplay() {
    const concentrationIndicator = document.getElementById('concentration-indicator');
    const concentrationSpell = document.getElementById('concentration-spell');

    if (!concentrationIndicator) return;

    if (concentratingSpell) {
      concentrationIndicator.style.display = 'flex';
      if (concentrationSpell) {
        concentrationSpell.textContent = concentratingSpell;
      }
    } else {
      concentrationIndicator.style.display = 'none';
    }
  }

  // ===== EXPORTS =====

  globalThis.initActionEconomy = initActionEconomy;
  globalThis.activateTurn = activateTurn;
  globalThis.deactivateTurn = deactivateTurn;
  globalThis.markActionAsUsed = markActionAsUsed;
  globalThis.getActionEconomyState = getActionEconomyState;
  globalThis.postActionEconomyToDiscord = postActionEconomyToDiscord;
  globalThis.updateActionEconomyAvailability = updateActionEconomyAvailability;
  globalThis.postToChatIfOpener = postToChatIfOpener;

  globalThis.initConcentrationTracker = initConcentrationTracker;
  globalThis.setConcentration = setConcentration;
  globalThis.dropConcentration = dropConcentration;
  globalThis.updateConcentrationDisplay = updateConcentrationDisplay;

  // Export state variables
  Object.defineProperty(globalThis, 'isMyTurn', {
    get: () => isMyTurn,
    set: (value) => { isMyTurn = value; }
  });

  Object.defineProperty(globalThis, 'concentratingSpell', {
    get: () => concentratingSpell,
    set: (value) => { concentratingSpell = value; }
  });

})();
