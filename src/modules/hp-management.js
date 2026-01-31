/**
 * HP Management Module
 *
 * Handles hit points, temporary HP, healing, damage, and resting.
 * Loaded as a plain script (no ES6 modules) to export to globalThis.
 *
 * Functions exported to globalThis:
 * - showHPModal()
 * - takeShortRest()
 * - takeLongRest()
 * - getHitDieType()
 * - initializeHitDice()
 * - spendHitDice()
 */

(function() {
  'use strict';

  /**
   * Show HP adjustment modal (heal, damage, temp HP)
   */
  function showHPModal() {
    // characterData should be available from global scope
    if (typeof characterData === 'undefined' || !characterData) {
      if (typeof showNotification !== 'undefined') {
        showNotification('❌ Character data not available', 'error');
      }
      return;
    }

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
          <button id="hp-toggle-heal" style="padding: 12px; font-size: 0.9em; font-weight: bold; border: 2px solid #c2185b; background: #c2185b; color: white; border-radius: 6px; cursor: pointer; transition: all 0.2s;">
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
      healBtn.style.background = '#c2185b';
      healBtn.style.color = 'white';
      healBtn.style.borderColor = '#c2185b';
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
        if (typeof showNotification !== 'undefined') {
          showNotification('❌ Please enter a valid amount', 'error');
        }
        return;
      }

      const oldHP = characterData.hitPoints.current;
      const oldTempHP = characterData.temporaryHP || 0;
      const colorBanner = typeof getColoredBanner !== 'undefined' ? getColoredBanner(characterData) : '';
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

        if (typeof showNotification !== 'undefined') {
          showNotification(`💚 Healed ${actualHealing} HP! (${characterData.hitPoints.current}${characterData.temporaryHP > 0 ? `+${characterData.temporaryHP}` : ''}/${maxHP})`);
        }

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

        if (typeof showNotification !== 'undefined') {
          showNotification(`${damageMsg} (${characterData.hitPoints.current}${characterData.temporaryHP > 0 ? `+${characterData.temporaryHP}` : ''}/${maxHP})`);
        }

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
          if (typeof showNotification !== 'undefined') {
            showNotification(`🛡️ Gained ${newTempHP} temp HP! (${characterData.hitPoints.current}+${characterData.temporaryHP}/${maxHP})`);
          }

          messageData = {
            action: 'announceSpell',
            message: `&{template:default} {{name=${colorBanner}${characterData.name} gains temp HP}} {{🛡️ Temp HP=${newTempHP}}} {{Current HP=${characterData.hitPoints.current}+${characterData.temporaryHP}/${maxHP}}}`,
            color: characterData.notificationColor
          };
        } else {
          if (typeof showNotification !== 'undefined') {
            showNotification(`⚠️ Kept ${oldTempHP} temp HP (higher than ${newTempHP})`);
          }
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
            if (typeof browserAPI !== 'undefined') {
              browserAPI.runtime.sendMessage({
                action: 'relayRollToRoll20',
                roll: messageData
              });
            }
          }
        } else {
          // Fallback: Use background script to relay to Roll20 (Firefox)
          if (typeof browserAPI !== 'undefined') {
            browserAPI.runtime.sendMessage({
              action: 'relayRollToRoll20',
              roll: messageData
            });
          }
        }
      }

      // Save and rebuild sheet
      if (typeof saveCharacterData !== 'undefined') {
        saveCharacterData();
      }
      if (typeof buildSheet !== 'undefined') {
        buildSheet(characterData);
      }
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

  /**
   * Get hit die type based on character class
   */
  function getHitDieType() {
    // characterData should be available from global scope
    if (typeof characterData === 'undefined' || !characterData) return 'd8';

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

  /**
   * Initialize hit dice if not already set
   */
  function initializeHitDice() {
    if (typeof characterData === 'undefined' || !characterData) return;

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

  /**
   * Spend hit dice to restore HP (used during short rest)
   */
  function spendHitDice() {
    if (typeof characterData === 'undefined' || !characterData) return;

    initializeHitDice();

    const conMod = characterData.attributeMods?.constitution || 0;
    const hitDie = characterData.hitDice.type;
    const maxDice = parseInt(hitDie.substring(1)); // Extract number from "d8" -> 8

    if (characterData.hitDice.current <= 0) {
      alert('You have no Hit Dice remaining to spend!');
      return;
    }

    let totalHealed = 0;
    let diceSpent = 0;

    while (characterData.hitDice.current > 0 && characterData.hitPoints.current < characterData.hitPoints.max) {
      const spend = confirm(
        `Spend a Hit Die? (${characterData.hitDice.current}/${characterData.hitDice.max} remaining)\n\n` +
        `Hit Die: ${hitDie}\n` +
        `CON Modifier: ${conMod >= 0 ? '+' : ''}${conMod}\n` +
        `Current HP: ${characterData.hitPoints.current}/${characterData.hitPoints.max}\n` +
        `HP Healed so far: ${totalHealed}`
      );

      if (!spend) break;

      // Roll the hit die
      const roll = Math.floor(Math.random() * maxDice) + 1;
      const healing = Math.max(1, roll + conMod); // Minimum 1 HP restored

      characterData.hitDice.current--;
      diceSpent++;

      const oldHP = characterData.hitPoints.current;
      characterData.hitPoints.current = Math.min(
        characterData.hitPoints.current + healing,
        characterData.hitPoints.max
      );
      const actualHealing = characterData.hitPoints.current - oldHP;
      totalHealed += actualHealing;

      debug.log(`🎲 Rolled ${hitDie}: ${roll} + ${conMod} = ${healing} HP (restored ${actualHealing})`);

      // Announce the roll with fancy formatting
      if (window.opener && !window.opener.closed) {
        const colorBanner = typeof getColoredBanner !== 'undefined' ? getColoredBanner(characterData) : '';
        window.opener.postMessage({
          action: 'announceSpell',
          message: `&{template:default} {{name=${colorBanner}${characterData.name} spends hit dice}} {{Roll=🎲 ${hitDie}: ${roll} + ${conMod} CON}} {{HP Restored=${healing}}} {{Current HP=${characterData.hitPoints.current}/${characterData.hitPoints.max}}}`,
          color: characterData.notificationColor
        }, '*');
      }
    }

    if (diceSpent > 0) {
      if (typeof showNotification !== 'undefined') {
        showNotification(`🎲 Spent ${diceSpent} Hit Dice and restored ${totalHealed} HP!`);
      }
    } else {
      if (typeof showNotification !== 'undefined') {
        showNotification('No Hit Dice spent.');
      }
    }

    // Announce short rest completion to Roll20
    const colorBanner = typeof getColoredBanner !== 'undefined' ? getColoredBanner(characterData) : '';
    const announcement = `&{template:default} {{name=${colorBanner}${characterData.name} takes a Short Rest!}} {{Type=Short Rest}} {{HP=${characterData.hitPoints.current}/${characterData.hitPoints.max}}}`;
    const messageData = {
      action: 'announceSpell',
      message: announcement,
      color: characterData.notificationColor
    };

    if (window.opener && !window.opener.closed) {
      try {
        window.opener.postMessage(messageData, '*');
      } catch (error) {
        debug.log('❌ Failed to send short rest announcement:', error);
      }
    }
  }

  /**
   * Take a short rest - restores some resources and allows spending hit dice
   */
  function takeShortRest() {
    if (typeof characterData === 'undefined' || !characterData) {
      if (typeof showNotification !== 'undefined') {
        showNotification('❌ Character data not available', 'error');
      }
      return;
    }

    const confirmed = confirm('Take a Short Rest?\n\nThis will:\n- Allow you to spend Hit Dice to restore HP\n- Restore Warlock spell slots\n- Restore some class features');

    if (!confirmed) return;

    debug.log('☕ Taking short rest...');

    // Clear temporary HP (RAW: temp HP doesn't persist through rest)
    if (characterData.temporaryHP > 0) {
      characterData.temporaryHP = 0;
      debug.log('✅ Cleared temporary HP');
    }

    // Note: Inspiration is NOT restored on short rest (DM grants it)
    debug.log(`ℹ️ Inspiration status unchanged (${characterData.inspiration ? 'active' : 'none'})`);

    // Restore Warlock Pact Magic slots (they recharge on short rest)
    // Check both spellSlots and otherVariables for Pact Magic
    if (characterData.spellSlots && characterData.spellSlots.pactMagicSlotsMax !== undefined) {
      characterData.spellSlots.pactMagicSlots = characterData.spellSlots.pactMagicSlotsMax;
      debug.log(`✅ Restored Pact Magic slots (spellSlots): ${characterData.spellSlots.pactMagicSlots}/${characterData.spellSlots.pactMagicSlotsMax}`);
    }
    if (characterData.otherVariables) {
      if (characterData.otherVariables.pactMagicSlotsMax !== undefined) {
        characterData.otherVariables.pactMagicSlots = characterData.otherVariables.pactMagicSlotsMax;
        debug.log('✅ Restored Pact Magic slots (otherVariables)');
      }

      // Restore Ki points for Monk (short rest feature)
      if (characterData.otherVariables.kiMax !== undefined) {
        characterData.otherVariables.ki = characterData.otherVariables.kiMax;
        debug.log('✅ Restored Ki points');
      } else if (characterData.otherVariables.kiPointsMax !== undefined) {
        characterData.otherVariables.kiPoints = characterData.otherVariables.kiPointsMax;
        debug.log('✅ Restored Ki points');
      }

      // Restore Action Surge, Second Wind (short rest features)
      if (characterData.otherVariables.actionSurgeMax !== undefined) {
        characterData.otherVariables.actionSurge = characterData.otherVariables.actionSurgeMax;
      }
      if (characterData.otherVariables.secondWindMax !== undefined) {
        characterData.otherVariables.secondWind = characterData.otherVariables.secondWindMax;
      }
    }

    // Handle Hit Dice spending for HP restoration
    spendHitDice();

    // Restore class resources that recharge on short rest
    // Most resources restore on short rest (Ki, Channel Divinity, Action Surge, etc.)
    // Notable exceptions: Sorcery Points and Rage restore on long rest only
    if (characterData.resources && characterData.resources.length > 0) {
      characterData.resources.forEach(resource => {
        const lowerName = resource.name.toLowerCase();

        // Long rest only resources
        if (lowerName.includes('sorcery') || lowerName.includes('rage')) {
          debug.log(`⏭️ Skipping ${resource.name} (long rest only)`);
          return;
        }

        // Restore all other resources
        resource.current = resource.max;

        // Also update otherVariables to keep data in sync
        if (characterData.otherVariables && resource.varName) {
          characterData.otherVariables[resource.varName] = resource.current;
        }

        debug.log(`✅ Restored ${resource.name} (${resource.current}/${resource.max})`);
      });
    }

    // Reset limited uses for short rest abilities
    if (characterData.actions) {
      characterData.actions.forEach(action => {
        if (action.uses) {
          // Check if this ability resets on short rest
          // DiceCloud uses 'reset' property with values: 'shortRest', 'longRest', etc.
          const resetType = action.reset || action.uses?.reset;
          const resetsOnShortRest =
            resetType === 'shortRest' ||
            resetType === 'short_rest' ||
            resetType === 'short rest' ||
            resetType === 'shortOrLongRest';

          if (!resetsOnShortRest) {
            debug.log(`⏭️ Skipping ${action.name} (does not reset on short rest, reset=${resetType})`);
            return;
          }

          // Handle usesUsed pattern (older/local data)
          if (action.usesUsed !== undefined && action.usesUsed > 0) {
            action.usesUsed = 0;
            debug.log(`✅ Reset uses for ${action.name}`);
          }

          // Handle usesLeft pattern (2024 D&D features, database data)
          if (action.usesLeft !== undefined) {
            const usesTotal = action.uses.total || action.uses.value || action.uses;
            action.usesLeft = usesTotal;
            debug.log(`✅ Restored ${action.name} (${action.usesLeft}/${usesTotal} uses)`);
          }
        }
      });
    }

    // Save and rebuild sheet
    if (typeof saveCharacterData !== 'undefined') {
      saveCharacterData();
    }
    if (typeof buildSheet !== 'undefined') {
      buildSheet(characterData);
    }

    if (typeof showNotification !== 'undefined') {
      showNotification('☕ Short Rest complete! Resources recharged.');
    }
    debug.log('✅ Short rest complete');

    // Announce to Roll20 with fancy formatting
    const colorBanner = typeof getColoredBanner !== 'undefined' ? getColoredBanner(characterData) : '';
    const messageData = {
      action: 'announceSpell',
      message: `&{template:default} {{name=${colorBanner}${characterData.name} takes a short rest}} {{=☕ Short rest complete. Resources recharged!}}`,
      color: characterData.notificationColor
    };

    // Try window.opener first (Chrome)
    if (window.opener && !window.opener.closed) {
      try {
        window.opener.postMessage(messageData, '*');
      } catch (error) {
        debug.warn('⚠️ Could not send via window.opener:', error.message);
        // Fallback to background script relay
        if (typeof browserAPI !== 'undefined') {
          browserAPI.runtime.sendMessage({
            action: 'relayRollToRoll20',
            roll: messageData
          });
        }
      }
    } else {
      // Fallback: Use background script to relay to Roll20 (Firefox)
      if (typeof browserAPI !== 'undefined') {
        browserAPI.runtime.sendMessage({
          action: 'relayRollToRoll20',
          roll: messageData
        });
      }
    }
  }

  /**
   * Take a long rest - fully restores HP, spell slots, and all resources
   */
  function takeLongRest() {
    if (typeof characterData === 'undefined' || !characterData) {
      if (typeof showNotification !== 'undefined') {
        showNotification('❌ Character data not available', 'error');
      }
      return;
    }

    const confirmed = confirm('Take a Long Rest?\n\nThis will:\n- Fully restore HP\n- Restore all spell slots\n- Restore all class features\n- Restore half your hit dice (minimum 1)');

    if (!confirmed) return;

    debug.log('🌙 Taking long rest...');

    // Initialize hit dice if needed
    initializeHitDice();

    // Restore all HP
    characterData.hitPoints.current = characterData.hitPoints.max;
    debug.log('✅ Restored HP to max');

    // Clear temporary HP (RAW: temp HP doesn't persist through rest)
    if (characterData.temporaryHP > 0) {
      characterData.temporaryHP = 0;
      debug.log('✅ Cleared temporary HP');
    }

    // Note: Inspiration is NOT automatically restored on long rest
    // It must be granted by the DM, so we don't touch it here
    debug.log(`ℹ️ Inspiration status unchanged (${characterData.inspiration ? 'active' : 'none'})`);

    // Restore hit dice (half of max, minimum 1)
    const hitDiceRestored = Math.max(1, Math.floor(characterData.hitDice.max / 2));
    const oldHitDice = characterData.hitDice.current;
    characterData.hitDice.current = Math.min(
      characterData.hitDice.current + hitDiceRestored,
      characterData.hitDice.max
    );
    debug.log(`✅ Restored ${characterData.hitDice.current - oldHitDice} hit dice (${characterData.hitDice.current}/${characterData.hitDice.max})`);

    // Restore all spell slots
    if (characterData.spellSlots) {
      // Restore regular spell slots (levels 1-9)
      for (let level = 1; level <= 9; level++) {
        const slotVar = `level${level}SpellSlots`;
        const slotMaxVar = `level${level}SpellSlotsMax`;

        if (characterData.spellSlots[slotMaxVar] !== undefined) {
          characterData.spellSlots[slotVar] = characterData.spellSlots[slotMaxVar];
          debug.log(`✅ Restored level ${level} spell slots`);
        }
      }

      // Also restore Pact Magic slots (Warlock)
      if (characterData.spellSlots.pactMagicSlotsMax !== undefined) {
        characterData.spellSlots.pactMagicSlots = characterData.spellSlots.pactMagicSlotsMax;
        debug.log(`✅ Restored Pact Magic slots: ${characterData.spellSlots.pactMagicSlots}/${characterData.spellSlots.pactMagicSlotsMax}`);
      }
    }

    // Restore all class resources (Ki, Sorcery Points, Rage, etc.)
    // But NOT exhaustion (exhaustion only reduces by 1 level on long rest)
    if (characterData.resources && characterData.resources.length > 0) {
      characterData.resources.forEach(resource => {
        const lowerName = resource.name.toLowerCase();

        // Skip exhaustion - it has special rules (reduces by 1 level, doesn't reset)
        if (lowerName.includes('exhaustion') || lowerName.includes('fatigue')) {
          debug.log(`⏭️ Skipping ${resource.name} (exhaustion has special long rest rules)`);
          return;
        }

        resource.current = resource.max;

        // Also update otherVariables to keep data in sync
        if (characterData.otherVariables && resource.varName) {
          characterData.otherVariables[resource.varName] = resource.current;
        }

        debug.log(`✅ Restored ${resource.name} (${resource.current}/${resource.max})`);
      });
    }

    // Restore all class resources
    if (characterData.otherVariables) {
      Object.keys(characterData.otherVariables).forEach(key => {
        // If there's a Max variant, restore to max
        if (key.endsWith('Max')) {
          const baseKey = key.replace('Max', '');
          if (characterData.otherVariables[baseKey] !== undefined) {
            characterData.otherVariables[baseKey] = characterData.otherVariables[key];
            debug.log(`✅ Restored ${baseKey}`);
          }
        }
      });

      // Also restore specific resources that might not follow the Max pattern
      if (characterData.otherVariables.kiMax !== undefined) {
        characterData.otherVariables.ki = characterData.otherVariables.kiMax;
      } else if (characterData.otherVariables.kiPointsMax !== undefined) {
        characterData.otherVariables.kiPoints = characterData.otherVariables.kiPointsMax;
      }

      if (characterData.otherVariables.sorceryPointsMax !== undefined) {
        characterData.otherVariables.sorceryPoints = characterData.otherVariables.sorceryPointsMax;
      }

      if (characterData.otherVariables.pactMagicSlotsMax !== undefined) {
        characterData.otherVariables.pactMagicSlots = characterData.otherVariables.pactMagicSlotsMax;
      }

      // Restore Channel Divinity (try all possible variable names)
      if (characterData.otherVariables.channelDivinityClericMax !== undefined) {
        characterData.otherVariables.channelDivinityCleric = characterData.otherVariables.channelDivinityClericMax;
      } else if (characterData.otherVariables.channelDivinityPaladinMax !== undefined) {
        characterData.otherVariables.channelDivinityPaladin = characterData.otherVariables.channelDivinityPaladinMax;
      } else if (characterData.otherVariables.channelDivinityMax !== undefined) {
        characterData.otherVariables.channelDivinity = characterData.otherVariables.channelDivinityMax;
      }
    }

    // Reset limited uses for long rest abilities
    if (characterData.actions) {
      characterData.actions.forEach(action => {
        if (action.uses) {
          // Check if this ability resets on long rest
          // DiceCloud uses 'reset' property with values: 'shortRest', 'longRest', 'special', etc.
          const resetType = action.reset || action.uses?.reset;

          // Long rest resets both short rest and long rest abilities, but NOT special reset abilities
          const resetsOnLongRest =
            resetType === 'longRest' ||
            resetType === 'long_rest' ||
            resetType === 'long rest' ||
            resetType === 'shortRest' ||
            resetType === 'short_rest' ||
            resetType === 'short rest' ||
            resetType === 'shortOrLongRest';

          // Check for special reset conditions (like Feline Agility which resets when not moving)
          const isSpecialReset =
            resetType === 'special' ||
            resetType === 'custom' ||
            (typeof resetType === 'string' && resetType.toLowerCase().includes('agility'));

          if (isSpecialReset) {
            debug.log(`⏭️ Skipping ${action.name} (special reset condition, reset=${resetType})`);
            return;
          }

          if (!resetsOnLongRest) {
            debug.log(`⏭️ Skipping ${action.name} (does not reset on long rest, reset=${resetType})`);
            return;
          }

          // Handle usesUsed pattern (older/local data)
          if (action.usesUsed !== undefined && action.usesUsed > 0) {
            action.usesUsed = 0;
            debug.log(`✅ Reset uses for ${action.name}`);
          }

          // Handle usesLeft pattern (2024 D&D features, database data)
          if (action.usesLeft !== undefined) {
            const usesTotal = action.uses.total || action.uses.value || action.uses;
            action.usesLeft = usesTotal;
            debug.log(`✅ Restored ${action.name} (${action.usesLeft}/${usesTotal} uses)`);
          }
        }
      });
    }

    // Save and rebuild sheet
    if (typeof saveCharacterData !== 'undefined') {
      saveCharacterData();
    }
    if (typeof buildSheet !== 'undefined') {
      buildSheet(characterData);
    }

    if (typeof showNotification !== 'undefined') {
      showNotification('🌙 Long Rest complete! All resources restored.');
    }
    debug.log('✅ Long rest complete');

    // Announce to Roll20 with fancy formatting
    const colorBanner = typeof getColoredBanner !== 'undefined' ? getColoredBanner(characterData) : '';
    const messageData = {
      action: 'announceSpell',
      message: `&{template:default} {{name=${colorBanner}${characterData.name} takes a long rest}} {{=🌙 Long rest complete!}} {{HP=${characterData.hitPoints.current}/${characterData.hitPoints.max} (Fully Restored)}} {{=All spell slots and resources restored!}}`,
      color: characterData.notificationColor
    };

    // Try window.opener first (Chrome)
    if (window.opener && !window.opener.closed) {
      try {
        window.opener.postMessage(messageData, '*');
      } catch (error) {
        debug.warn('⚠️ Could not send via window.opener:', error.message);
        // Fallback to background script relay
        if (typeof browserAPI !== 'undefined') {
          browserAPI.runtime.sendMessage({
            action: 'relayRollToRoll20',
            roll: messageData
          });
        }
      }
    } else {
      // Fallback: Use background script to relay to Roll20 (Firefox)
      if (typeof browserAPI !== 'undefined') {
        browserAPI.runtime.sendMessage({
          action: 'relayRollToRoll20',
          roll: messageData
        });
      }
    }
  }

  // ===== EXPORTS =====

  globalThis.showHPModal = showHPModal;
  globalThis.takeShortRest = takeShortRest;
  globalThis.takeLongRest = takeLongRest;
  globalThis.getHitDieType = getHitDieType;
  globalThis.initializeHitDice = initializeHitDice;
  globalThis.spendHitDice = spendHitDice;

})();
