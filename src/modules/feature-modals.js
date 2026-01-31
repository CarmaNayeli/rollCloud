/**
 * Feature Modals Module
 *
 * Handles special feature modals (Inspiration, Divine Smite, Lay on Hands, Lucky).
 * Loaded as a plain script (no ES6 modules) to export to globalThis.
 *
 * Functions exported to globalThis:
 * - toggleInspiration()
 * - showGainInspirationModal()
 * - showUseInspirationModal()
 * - showDivineSmiteModal(spell)
 * - showLayOnHandsModal(layOnHandsPool)
 * - showLuckyModal()
 * - rollLuckyDie(type)
 * - getLuckyResource()
 * - useLuckyPoint()
 * - getLayOnHandsResource()
 * - createThemedModal()
 */

(function() {
  'use strict';

  // ===== HELPER FUNCTIONS =====

  /**
   * Create a theme-aware modal
   */
  function createThemedModal() {
    const modal = document.createElement('div');
    modal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; z-index: 10000;';

    const modalContent = document.createElement('div');
    modalContent.className = 'rollcloud-modal-content';

    // Check for system theme preference
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const isDarkTheme = document.body.classList.contains('dark-theme') ||
                        document.body.classList.contains('theme-dark') ||
                        prefersDark;

    // Apply theme class
    if (isDarkTheme) {
      modalContent.classList.add('theme-dark');
    } else {
      modalContent.classList.add('theme-light');
    }

    // Base styling (theme-specific colors will be in CSS)
    modalContent.style.cssText = 'padding: 30px; border-radius: 12px; max-width: 500px; width: 90%; text-align: center; box-shadow: 0 10px 30px rgba(0,0,0,0.3); border: 1px solid #e1e8ed;';

    return { modal, modalContent, isDarkTheme };
  }

  /**
   * Get Lay on Hands resource from character data
   */
  function getLayOnHandsResource() {
    // Requires characterData to be available from global scope
    if (typeof characterData === 'undefined' || !characterData || !characterData.resources) return null;

    // Find Lay on Hands pool in resources
    const layOnHandsResource = characterData.resources.find(r => {
      const lowerName = r.name.toLowerCase();
      return lowerName.includes('lay on hands') || lowerName === 'lay on hands pool';
    });

    return layOnHandsResource || null;
  }

  /**
   * Get Lucky resource from character data
   */
  function getLuckyResource() {
    // Requires characterData to be available from global scope
    if (typeof characterData === 'undefined' || !characterData || !characterData.resources) {
      debug.log('🎖️ No characterData or resources for Lucky detection');
      return null;
    }

    // Find Lucky points in resources (flexible matching)
    const luckyResource = characterData.resources.find(r => {
      const lowerName = r.name.toLowerCase().trim();
      return (
        lowerName.includes('lucky point') ||
        lowerName.includes('luck point') ||
        lowerName === 'lucky points' ||
        lowerName === 'lucky'
      );
    });

    if (luckyResource) {
      debug.log(`🎖️ Found Lucky resource: ${luckyResource.name} (${luckyResource.current}/${luckyResource.max})`);
    } else {
      debug.log('🎖️ No Lucky resource found in character data');
    }

    return luckyResource;
  }

  /**
   * Use a Lucky point
   */
  function useLuckyPoint() {
    debug.log('🎖️ useLuckyPoint called');
    const luckyResource = getLuckyResource();
    debug.log('🎖️ Lucky resource found:', luckyResource);

    if (!luckyResource) {
      debug.error('❌ No Lucky resource found');
      return false;
    }

    if (luckyResource.current <= 0) {
      debug.error(`❌ No Lucky points available (current: ${luckyResource.current})`);
      return false;
    }

    // Decrement Lucky points
    const oldCurrent = luckyResource.current;
    luckyResource.current--;
    debug.log(`🎖️ Used Lucky point. ${oldCurrent} → ${luckyResource.current}/${luckyResource.max}`);

    // Save character data to preserve state when switching characters
    if (typeof saveCharacterData !== 'undefined') {
      saveCharacterData();
    }

    // Update display (buildResourcesDisplay and updateLuckyButtonText should be available from global scope)
    if (typeof buildResourcesDisplay !== 'undefined') {
      buildResourcesDisplay();
    }
    if (typeof updateLuckyButtonText !== 'undefined') {
      updateLuckyButtonText();
    }

    debug.log('🎖️ Lucky button updated and character data saved');

    return true;
  }

  // ===== INSPIRATION MODALS =====

  /**
   * Toggle inspiration (gain or use based on current state)
   */
  function toggleInspiration() {
    // Requires characterData to be available from global scope
    if (typeof characterData === 'undefined' || !characterData) return;

    if (!characterData.inspiration) {
      // Show modal to gain inspiration
      showGainInspirationModal();
    } else {
      // Show modal to choose how to use inspiration (2014 vs 2024)
      showUseInspirationModal();
    }
  }

  /**
   * Show modal for gaining inspiration
   */
  function showGainInspirationModal() {
    // Requires characterData to be available from global scope
    if (typeof characterData === 'undefined' || !characterData) return;

    // Create modal overlay
    const modal = document.createElement('div');
    modal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; z-index: 10000;';

    // Create modal content
    const modalContent = document.createElement('div');
    modalContent.style.cssText = 'background: var(--bg-secondary); color: var(--text-primary); padding: 30px; border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,0.3); min-width: 350px; max-width: 450px;';

    modalContent.innerHTML = `
      <h3 style="margin: 0 0 20px 0; color: var(--text-primary); text-align: center;">⭐ Gain Inspiration</h3>
      <p style="text-align: center; margin-bottom: 25px; color: #555;">
        You're about to gain Inspiration! This can be used for:
      </p>
      <div style="margin-bottom: 25px; padding: 15px; background: #f8f9fa; border-radius: 8px;">
        <div style="margin-bottom: 12px;">
          <strong style="color: #3498db;">📖 D&D 2014:</strong> Gain advantage on an attack roll, saving throw, or ability check
        </div>
        <div>
          <strong style="color: #e74c3c;">📖 D&D 2024:</strong> Reroll any die immediately after rolling it
        </div>
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
        <button id="gain-inspiration" style="padding: 15px; background: #c2185b; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold;">
          ⭐ Gain It
        </button>
        <button id="cancel-modal" style="padding: 15px; background: #95a5a6; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold;">
          Cancel
        </button>
      </div>
    `;

    modal.appendChild(modalContent);
    document.body.appendChild(modal);

    // Gain inspiration button
    document.getElementById('gain-inspiration').addEventListener('click', () => {
      characterData.inspiration = true;
      const emoji = '⭐';

      debug.log(`${emoji} Inspiration gained`);
      if (typeof showNotification !== 'undefined') {
        showNotification(`${emoji} Inspiration gained!`);
      }

      // Announce to Roll20
      const colorBanner = typeof getColoredBanner !== 'undefined' ? getColoredBanner(characterData) : '';
      const messageData = {
        action: 'announceSpell',
        message: `&{template:default} {{name=${colorBanner}${characterData.name} gains Inspiration}} {{${emoji}=You now have Inspiration!}}`,
        color: characterData.notificationColor
      };

      // Send to Roll20
      if (window.opener && !window.opener.closed) {
        try {
          window.opener.postMessage(messageData, '*');
        } catch (error) {
          debug.warn('⚠️ Could not send via window.opener:', error.message);
          if (typeof browserAPI !== 'undefined') {
            browserAPI.runtime.sendMessage({
              action: 'relayRollToRoll20',
              roll: messageData
            });
          }
        }
      } else {
        if (typeof browserAPI !== 'undefined') {
          browserAPI.runtime.sendMessage({
            action: 'relayRollToRoll20',
            roll: messageData
          });
        }
      }

      if (typeof saveCharacterData !== 'undefined') saveCharacterData();
      if (typeof buildSheet !== 'undefined') buildSheet(characterData);
      modal.remove();
    });

    // Cancel button
    document.getElementById('cancel-modal').addEventListener('click', () => {
      modal.remove();
    });

    // Click outside to close
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.remove();
      }
    });
  }

  /**
   * Show modal for using inspiration (2014 vs 2024 rules)
   */
  function showUseInspirationModal() {
    // Requires characterData to be available from global scope
    if (typeof characterData === 'undefined' || !characterData) return;

    // Create modal overlay
    const modal = document.createElement('div');
    modal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; z-index: 10000;';

    // Create modal content
    const modalContent = document.createElement('div');
    modalContent.style.cssText = 'background: var(--bg-secondary); color: var(--text-primary); padding: 30px; border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,0.3); min-width: 400px; max-width: 500px;';

    const lastRollInfo = characterData.lastRoll
      ? `<div style="margin-bottom: 20px; padding: 12px; background: #e8f5e9; border-left: 4px solid #c2185b; border-radius: 4px;">
           <strong>Last Roll:</strong> ${characterData.lastRoll.name}
         </div>`
      : `<div style="margin-bottom: 20px; padding: 12px; background: #ffebee; border-left: 4px solid #e74c3c; border-radius: 4px;">
           <strong>⚠️ No previous roll to reroll</strong>
         </div>`;

    modalContent.innerHTML = `
      <h3 style="margin: 0 0 20px 0; color: var(--text-primary); text-align: center;">✨ Use Inspiration</h3>
      <p style="text-align: center; margin-bottom: 20px; color: #555;">
        How do you want to use your Inspiration?
      </p>
      ${lastRollInfo}
      <div style="display: grid; gap: 12px; margin-bottom: 20px;">
        <button id="use-2014" style="padding: 18px; background: #3498db; color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: bold; text-align: left;">
          <div style="font-size: 1.1em; margin-bottom: 5px;">📖 D&D 2014 - Advantage</div>
          <div style="font-size: 0.85em; opacity: 0.9;">Gain advantage on your next attack roll, saving throw, or ability check</div>
        </button>
        <button id="use-2024" ${!characterData.lastRoll ? 'disabled' : ''} style="padding: 18px; background: ${!characterData.lastRoll ? '#95a5a6' : '#e74c3c'}; color: white; border: none; border-radius: 8px; cursor: ${!characterData.lastRoll ? 'not-allowed' : 'pointer'}; font-weight: bold; text-align: left;">
          <div style="font-size: 1.1em; margin-bottom: 5px;">📖 D&D 2024 - Reroll</div>
          <div style="font-size: 0.85em; opacity: 0.9;">Reroll your last roll and use the new result</div>
        </button>
      </div>
      <button id="cancel-use-modal" style="width: 100%; padding: 12px; background: #7f8c8d; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold;">
        Cancel
      </button>
    `;

    modal.appendChild(modalContent);
    document.body.appendChild(modal);

    // 2014 Advantage button
    document.getElementById('use-2014').addEventListener('click', () => {
      characterData.inspiration = false;
      const emoji = '✨';

      debug.log(`${emoji} Inspiration spent (2014 - Advantage)`);
      if (typeof showNotification !== 'undefined') {
        showNotification(`${emoji} Inspiration used! Gain advantage on your next roll.`);
      }

      // Announce to Roll20
      const colorBanner = typeof getColoredBanner !== 'undefined' ? getColoredBanner(characterData) : '';
      const messageData = {
        action: 'announceSpell',
        message: `&{template:default} {{name=${colorBanner}${characterData.name} uses Inspiration (2014)}} {{${emoji}=Gain advantage on your next attack roll, saving throw, or ability check!}}`,
        color: characterData.notificationColor
      };

      // Send to Roll20
      if (window.opener && !window.opener.closed) {
        try {
          window.opener.postMessage(messageData, '*');
        } catch (error) {
          debug.warn('⚠️ Could not send via window.opener:', error.message);
          if (typeof browserAPI !== 'undefined') {
            browserAPI.runtime.sendMessage({
              action: 'relayRollToRoll20',
              roll: messageData
            });
          }
        }
      } else {
        if (typeof browserAPI !== 'undefined') {
          browserAPI.runtime.sendMessage({
            action: 'relayRollToRoll20',
            roll: messageData
          });
        }
      }

      if (typeof saveCharacterData !== 'undefined') saveCharacterData();
      if (typeof buildSheet !== 'undefined') buildSheet(characterData);
      modal.remove();
    });

    // 2024 Reroll button
    if (characterData.lastRoll) {
      document.getElementById('use-2024').addEventListener('click', () => {
        characterData.inspiration = false;
        const emoji = '✨';

        debug.log(`${emoji} Inspiration spent (2024 - Reroll): ${characterData.lastRoll.name}`);
        if (typeof showNotification !== 'undefined') {
          showNotification(`${emoji} Inspiration used! Rerolling ${characterData.lastRoll.name}...`);
        }

        // Announce to Roll20
        const colorBanner = typeof getColoredBanner !== 'undefined' ? getColoredBanner(characterData) : '';
        const messageData = {
          action: 'announceSpell',
          message: `&{template:default} {{name=${colorBanner}${characterData.name} uses Inspiration (2024)}} {{${emoji}=Rerolling: ${characterData.lastRoll.name}}}`,
          color: characterData.notificationColor
        };

        // Send to Roll20
        if (window.opener && !window.opener.closed) {
          try {
            window.opener.postMessage(messageData, '*');
          } catch (error) {
            debug.warn('⚠️ Could not send via window.opener:', error.message);
            if (typeof browserAPI !== 'undefined') {
              browserAPI.runtime.sendMessage({
                action: 'relayRollToRoll20',
                roll: messageData
              });
            }
          }
        } else {
          if (typeof browserAPI !== 'undefined') {
            browserAPI.runtime.sendMessage({
              action: 'relayRollToRoll20',
              roll: messageData
            });
          }
        }

        // Trigger reroll
        if (typeof roll !== 'undefined' && characterData.lastRoll) {
          roll(characterData.lastRoll.name, characterData.lastRoll.formula);
        }

        if (typeof saveCharacterData !== 'undefined') saveCharacterData();
        if (typeof buildSheet !== 'undefined') buildSheet(characterData);
        modal.remove();
      });
    }

    // Cancel button
    document.getElementById('cancel-use-modal').addEventListener('click', () => {
      modal.remove();
    });

    // Click outside to close
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.remove();
      }
    });
  }

  // ===== DIVINE SMITE MODAL =====

  /**
   * Show Divine Smite modal for selecting spell slot and modifiers
   */
  function showDivineSmiteModal(spell) {
    // Requires characterData to be available from global scope
    if (typeof characterData === 'undefined' || !characterData) return;

    // Get all available spell slots (like upcast modal)
    const availableSlots = [];

    // Helper to extract numeric value from DiceCloud objects
    const extractNum = (val) => {
      if (val === null || val === undefined) return 0;
      if (typeof val === 'number') return val;
      if (typeof val === 'object') {
        return val.value ?? val.total ?? val.currentValue ?? 0;
      }
      return parseInt(val) || 0;
    };

    // Check for Pact Magic slots (Warlock) - these are SEPARATE from regular spell slots
    const rawPactLevel = characterData.spellSlots?.pactMagicSlotLevel ||
                         characterData.otherVariables?.pactMagicSlotLevel ||
                         characterData.otherVariables?.pactSlotLevelVisible ||
                         characterData.otherVariables?.pactSlotLevel;
    const rawPactSlots = characterData.spellSlots?.pactMagicSlots ??
                         characterData.otherVariables?.pactMagicSlots ??
                         characterData.otherVariables?.pactSlot;
    const rawPactSlotsMax = characterData.spellSlots?.pactMagicSlotsMax ??
                            characterData.otherVariables?.pactMagicSlotsMax;

    // Extract numeric values (DiceCloud stores these as objects like {value: 2})
    const pactMagicSlots = extractNum(rawPactSlots);
    const pactMagicSlotsMax = extractNum(rawPactSlotsMax);
    const effectivePactLevel = extractNum(rawPactLevel) || (pactMagicSlotsMax > 0 ? 5 : 0);

    debug.log('🔮 Pact Magic detection for Divine Smite:', { rawPactLevel, rawPactSlots, rawPactSlotsMax, pactMagicSlots, pactMagicSlotsMax, effectivePactLevel });

    // Add Pact Magic slots first if available
    if (pactMagicSlotsMax > 0) {
      availableSlots.push({
        level: effectivePactLevel,
        current: pactMagicSlots,
        max: pactMagicSlotsMax,
        slotVar: 'pactMagicSlots',
        slotMaxVar: 'pactMagicSlotsMax',
        isPactMagic: true,
        label: `Level ${effectivePactLevel} - Pact Magic (${pactMagicSlots}/${pactMagicSlotsMax})`
      });
      debug.log(`🔮 Added Pact Magic to Divine Smite options: Level ${effectivePactLevel} (${pactMagicSlots}/${pactMagicSlotsMax})`);
    }

    // Then check regular spell slots - Divine Smite only works up to 5th level
    for (let level = 1; level <= 5; level++) {
      const slotVar = `level${level}SpellSlots`;
      const slotMaxVar = `level${level}SpellSlotsMax`;
      let current = characterData.spellSlots?.[slotVar] || 0;
      let max = characterData.spellSlots?.[slotMaxVar] || 0;

      // Skip if this level's slots are actually Pact Magic slots (avoid duplicates)
      if (pactMagicSlotsMax > 0 && level === effectivePactLevel) {
        continue;
      }

      // Show slot level if character has access to it (max > 0), even if depleted
      if (max > 0) {
        availableSlots.push({
          level,
          current,
          max,
          slotVar,
          slotMaxVar,
          isPactMagic: false,
          label: `Level ${level} (${current}/${max})`
        });
        debug.log(`🔮 Added Level ${level} to Divine Smite options: ${current}/${max}`);
      }
    }

    debug.log('🔮 Available slots for Divine Smite:', availableSlots);

    // Sort by level (lowest first)
    availableSlots.sort((a, b) => a.level - b.level);

    // Create theme-aware modal
    const { modal, modalContent, isDarkTheme } = createThemedModal();

    // Generate slot options
    const slotOptions = availableSlots.map((slot, index) =>
      `<option value="${index}" ${slot.current <= 0 ? 'disabled' : ''}>
        ${slot.label} ${slot.current <= 0 ? '(No slots remaining)' : ''}
      </option>`
    ).join('');

    modalContent.innerHTML = `
      <h2 style="margin: 0 0 20px 0; font-size: 1.5em;">⚡ Divine Smite</h2>
      <p style="margin: 0 0 20px 0; font-size: 0.95em;">
        Expend a spell slot to deal extra radiant damage on a melee weapon hit
      </p>

      <div style="margin: 20px 0;">
        <label style="display: block; margin-bottom: 8px; font-size: 0.95em;">Choose Spell Slot:</label>
        <select id="spellSlotSelect" style="width: 100%; padding: 8px; font-size: 1em; border: 2px solid var(--accent-info); border-radius: 6px;">
          ${slotOptions}
        </select>
      </div>

      <div style="margin: 20px 0; text-align: left;">
        <h3 style="margin: 0 0 15px 0; font-size: 1.1em;">Damage Options:</h3>

        <label style="display: flex; align-items: center; margin: 10px 0; cursor: pointer;">
          <input type="checkbox" id="critCheckbox" style="margin-right: 10px; width: 18px; height: 18px;">
          <span>Critical Hit (double damage dice)</span>
        </label>

        <label style="display: flex; align-items: center; margin: 10px 0; cursor: pointer;">
          <input type="checkbox" id="fiendCheckbox" style="margin-right: 10px; width: 18px; height: 18px;">
          <span>Against Fiend or Undead (+1d8)</span>
        </label>
      </div>

      <div id="damagePreview" style="margin: 15px 0; padding: 10px; border-radius: 6px; font-weight: bold; display: none;">
        <!-- Hidden - damage shown only on button -->
      </div>

      <div style="margin-top: 25px; display: flex; gap: 10px; justify-content: center;">
        <button id="confirmDivineSmite" style="padding: 12px 24px; font-size: 1em; font-weight: bold; background: var(--accent-warning); color: white; border: none; border-radius: 6px; cursor: pointer;" disabled>
          Select Slot
        </button>
        <button id="cancelDivineSmite" style="padding: 12px 24px; font-size: 1em; font-weight: bold; background: var(--accent-danger); color: white; border: none; border-radius: 6px; cursor: pointer;">
          Cancel
        </button>
      </div>
    `;

    modal.appendChild(modalContent);
    document.body.appendChild(modal);

    // Get elements
    const critCheckbox = document.getElementById('critCheckbox');
    const fiendCheckbox = document.getElementById('fiendCheckbox');
    const slotSelect = document.getElementById('spellSlotSelect');
    const confirmBtn = document.getElementById('confirmDivineSmite');
    const cancelBtn = document.getElementById('cancelDivineSmite');

    // Update button text when options change
    function updateDamagePreview() {
      const selectedIndex = parseInt(slotSelect.value);
      if (isNaN(selectedIndex) || !availableSlots[selectedIndex]) {
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Select Slot';
        return;
      }

      const slot = availableSlots[selectedIndex];
      if (slot.current <= 0) {
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'No Slots';
        return;
      }

      const level = slot.level;
      const baseDice = 1 + level; // 2d8 at level 1, +1d8 per level above
      let damageFormula = `${baseDice}d8`;

      // Add +1d8 for fiends/undead
      if (fiendCheckbox.checked) {
        damageFormula += ` + 1d8`;
      }

      // Apply critical hit doubling
      if (critCheckbox.checked) {
        damageFormula = `(${damageFormula}) * 2`;
      }

      // Update confirm button
      let buttonText = '⚡ ';
      let modifiers = [];

      if (damageFormula.includes('* 2')) {
        buttonText += `${baseDice}d8`;
        modifiers.push('(CRIT)');
      } else {
        buttonText += `${baseDice}d8`;
      }

      if (damageFormula.includes('+ 1d8')) {
        modifiers.unshift('+1d8');
      }

      if (modifiers.length > 0) {
        buttonText += ' ' + modifiers.join(' ');
      }

      buttonText += ` Damage (Lvl ${slot.level})`;

      confirmBtn.innerHTML = buttonText;
      confirmBtn.disabled = false;
    }

    critCheckbox.addEventListener('change', updateDamagePreview);
    fiendCheckbox.addEventListener('change', updateDamagePreview);
    slotSelect.addEventListener('change', updateDamagePreview);

    // Handle confirm
    confirmBtn.addEventListener('click', () => {
      const selectedIndex = parseInt(slotSelect.value);
      const slot = availableSlots[selectedIndex];

      if (slot.current <= 0) {
        if (typeof showNotification !== 'undefined') {
          showNotification(`❌ No Level ${slot.level} spell slot available!`, 'error');
        }
        return;
      }

      // Calculate damage
      const level = slot.level;
      const baseDice = 1 + level;
      let damageFormula = `${baseDice}d8`;

      // Add +1d8 for fiends/undead
      if (fiendCheckbox.checked) {
        damageFormula += ` + 1d8`;
      }

      // Apply critical hit doubling
      if (critCheckbox.checked) {
        damageFormula = `(${damageFormula}) * 2`;
      }

      // Consume the spell slot
      if (slot.isPactMagic) {
        characterData.spellSlots[slot.slotVar] = Math.max(0, characterData.spellSlots[slot.slotVar] - 1);
      } else {
        characterData.spellSlots[slot.slotVar] = Math.max(0, characterData.spellSlots[slot.slotVar] - 1);
      }
      if (typeof saveCharacterData !== 'undefined') saveCharacterData();

      // Build description
      let description = `Divine Smite (Level ${level}`;
      if (critCheckbox.checked) description += ', Critical';
      if (fiendCheckbox.checked) description += ', vs Fiend/Undead';
      description += ')';

      // Announce and roll the damage
      if (typeof announceAction !== 'undefined') {
        announceAction({
          name: 'Divine Smite',
          description: description
        });
      }

      if (typeof roll !== 'undefined') {
        roll('Divine Smite', damageFormula);
      }

      // Show notification
      const remaining = slot.isPactMagic ?
        characterData.spellSlots[slot.slotVar] :
        characterData.spellSlots[slot.slotVar];
      if (typeof showNotification !== 'undefined') {
        showNotification(`⚡ Divine Smite! Used Level ${slot.level} slot (${remaining}/${slot.max} left)`);
      }

      // Remove modal and refresh display
      document.body.removeChild(modal);
      if (typeof buildSheet !== 'undefined') buildSheet(characterData);
    });

    // Handle cancel
    cancelBtn.addEventListener('click', () => {
      document.body.removeChild(modal);
    });

    // Handle escape key
    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        document.body.removeChild(modal);
        document.removeEventListener('keydown', handleEscape);
      }
    };
    document.addEventListener('keydown', handleEscape);

    // Initialize the damage preview
    updateDamagePreview();
  }

  // ===== LAY ON HANDS MODAL =====

  /**
   * Show Lay on Hands modal for spending healing points
   */
  function showLayOnHandsModal(layOnHandsPool) {
    // Requires characterData to be available from global scope
    if (typeof characterData === 'undefined' || !characterData) return;

    // Create theme-aware modal
    const { modal, modalContent, isDarkTheme } = createThemedModal();

    modalContent.innerHTML = `
      <h2 style="margin: 0 0 20px 0; font-size: 1.5em;">💚 Lay on Hands</h2>
      <p style="margin: 0 0 15px 0; font-size: 1.1em;">
        Available Points: <strong>${layOnHandsPool.current}/${layOnHandsPool.max}</strong>
      </p>
      <p style="margin: 0 0 20px 0; font-size: 0.95em;">
        How many points do you want to spend?
      </p>
      <div style="margin: 20px 0;">
        <input type="number" id="layOnHandsAmount" min="1" max="${layOnHandsPool.current}" value="1"
               style="width: 80px; padding: 8px; font-size: 1.1em; text-align: center; border: 2px solid var(--accent-info); border-radius: 6px;">
        <span style="margin-left: 10px; font-weight: bold;" id="healingDisplay">1 HP healed</span>
      </div>
      <div style="margin-top: 25px; display: flex; gap: 10px; justify-content: center;">
        <button id="confirmLayOnHands" style="padding: 12px 24px; font-size: 1em; font-weight: bold; background: var(--accent-success); color: white; border: none; border-radius: 6px; cursor: pointer;">
          Heal
        </button>
        <button id="cancelLayOnHands" style="padding: 12px 24px; font-size: 1em; font-weight: bold; background: var(--accent-danger); color: white; border: none; border-radius: 6px; cursor: pointer;">
          Cancel
        </button>
      </div>
    `;

    modal.appendChild(modalContent);
    document.body.appendChild(modal);

    // Get elements
    const amountInput = document.getElementById('layOnHandsAmount');
    const healingDisplay = document.getElementById('healingDisplay');
    const confirmBtn = document.getElementById('confirmLayOnHands');
    const cancelBtn = document.getElementById('cancelLayOnHands');

    // Update healing display when amount changes
    function updateHealingDisplay() {
      const amount = parseInt(amountInput.value) || 0;
      healingDisplay.textContent = `${amount} HP healed`;
      healingDisplay.style.color = '#3498db';
    }

    amountInput.addEventListener('input', updateHealingDisplay);

    // Handle confirm
    confirmBtn.addEventListener('click', () => {
      const amount = parseInt(amountInput.value);

      if (isNaN(amount) || amount < 1 || amount > layOnHandsPool.current) {
        if (typeof showNotification !== 'undefined') {
          showNotification(`❌ Please enter a number between 1 and ${layOnHandsPool.current}`, 'error');
        }
        return;
      }

      // Deduct points
      layOnHandsPool.current -= amount;
      if (typeof saveCharacterData !== 'undefined') saveCharacterData();

      // Announce the healing
      debug.log(`💚 Used ${amount} Lay on Hands points. Remaining: ${layOnHandsPool.current}/${layOnHandsPool.max}`);

      if (amount === 5) {
        if (typeof announceAction !== 'undefined') {
          announceAction({
            name: 'Lay on Hands',
            description: `Cured disease/poison`
          });
        }
        if (typeof showNotification !== 'undefined') {
          showNotification(`💚 Lay on Hands: Cured disease/poison (${layOnHandsPool.current}/${layOnHandsPool.max} points left)`);
        }
      } else {
        if (typeof announceAction !== 'undefined') {
          announceAction({
            name: 'Lay on Hands',
            description: `Restored ${amount} HP`
          });
        }
        if (typeof showNotification !== 'undefined') {
          showNotification(`💚 Lay on Hands: Restored ${amount} HP (${layOnHandsPool.current}/${layOnHandsPool.max} points left)`);
        }
      }

      // Remove modal and refresh display
      document.body.removeChild(modal);
      if (typeof buildSheet !== 'undefined') buildSheet(characterData);
    });

    // Handle cancel
    cancelBtn.addEventListener('click', () => {
      document.body.removeChild(modal);
    });

    // Handle escape key
    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        document.body.removeChild(modal);
        document.removeEventListener('keydown', handleEscape);
      }
    };
    document.addEventListener('keydown', handleEscape);

    // Focus input
    amountInput.focus();
    amountInput.select();
  }

  // ===== LUCKY FEAT MODAL =====

  /**
   * Show Lucky feat modal for using luck points
   */
  function showLuckyModal() {
    debug.log('🎖️ Lucky modal called');

    const luckyResource = getLuckyResource();
    if (!luckyResource || luckyResource.current <= 0) {
      if (typeof showNotification !== 'undefined') {
        showNotification('❌ No luck points available!', 'error');
      }
      return;
    }

    // Create modal overlay
    const modal = document.createElement('div');
    modal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; z-index: 10000;';

    // Create modal content
    const modalContent = document.createElement('div');
    modalContent.style.cssText = 'background: var(--bg-secondary); color: var(--text-primary); border-radius: 8px; padding: 20px; max-width: 400px; width: 90%; box-shadow: 0 4px 20px rgba(0,0,0,0.3);';

    modalContent.innerHTML = `
      <h3 style="margin: 0 0 15px 0; color: #f39c12;">🎖️ Use Lucky Point</h3>
      <p style="margin: 0 0 15px 0; color: #666;">Choose what to use Lucky for:</p>
      <div style="margin-bottom: 15px; padding: 10px; background: #f8f9fa; border-radius: 4px;">
        <strong>Luck Points:</strong> ${luckyResource.current}/${luckyResource.max}
      </div>
      <div style="display: flex; flex-direction: column; gap: 8px;">
        <button id="luckyOffensive" style="padding: 10px; background: #3498db; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">⚔️ Attack/Check/Saving Throw</button>
        <button id="luckyDefensive" style="padding: 10px; background: #e74c3c; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">🛡️ Against Attack on You</button>
        <button id="luckyCancel" style="padding: 10px; background: #95a5a6; color: white; border: none; border-radius: 4px; cursor: pointer;">Cancel</button>
      </div>
    `;

    modal.appendChild(modalContent);
    document.body.appendChild(modal);

    // Add event listeners
    document.getElementById('luckyOffensive').addEventListener('click', () => {
      if (useLuckyPoint()) {
        modal.remove();
        // Roll a d20 for Lucky
        rollLuckyDie('offensive');
      }
    });

    document.getElementById('luckyDefensive').addEventListener('click', () => {
      if (useLuckyPoint()) {
        modal.remove();
        // Roll a d20 for Lucky defense
        rollLuckyDie('defensive');
      }
    });

    document.getElementById('luckyCancel').addEventListener('click', () => {
      modal.remove();
    });

    // Close on overlay click
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });

    debug.log('🎖️ Lucky modal displayed');
  }

  /**
   * Roll Lucky d20 die
   */
  function rollLuckyDie(type) {
    // Requires characterData to be available from global scope
    if (typeof characterData === 'undefined' || !characterData) return;

    debug.log(`🎖️ Rolling Lucky d20 for ${type}`);

    // Roll a d20
    const luckyRoll = Math.floor(Math.random() * 20) + 1;

    // Send the Lucky roll to Roll20 chat
    const rollData = {
      name: `🎖️ ${characterData.name} uses Lucky`,
      formula: '1d20',
      characterName: characterData.name
    };

    // Send the roll to Roll20
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage({
        action: 'rollFromPopout',
        ...rollData
      }, '*');
      debug.log('🎖️ Lucky roll sent via window.opener');
    } else {
      // Fallback: send directly to Roll20 via background script
      if (typeof browserAPI !== 'undefined') {
        browserAPI.runtime.sendMessage({
          action: 'relayRollToRoll20',
          roll: rollData
        });
      }
    }

    if (type === 'offensive') {
      if (typeof showNotification !== 'undefined') {
        showNotification(`🎖️ Lucky roll: ${luckyRoll}! Use this instead of your next d20 roll.`, 'success');
      }
    } else {
      if (typeof showNotification !== 'undefined') {
        showNotification(`🎖️ Lucky defense roll: ${luckyRoll}! Compare against attacker's roll.`, 'success');
      }
    }

    debug.log(`🎖️ Lucky d20 result: ${luckyRoll} - sent to chat`);
  }

  // ===== DIVINE SPARK (CLERIC CHANNEL DIVINITY) =====

  /**
   * Show Divine Spark modal (Cleric Channel Divinity feature)
   * @param {object} action - Action object
   * @param {object} channelDivinityResource - Channel Divinity resource
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
      if (typeof saveCharacterData !== 'undefined') {
        saveCharacterData();
      }

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
          if (typeof browserAPI !== 'undefined') {
            browserAPI.runtime.sendMessage({
              action: 'relayRollToRoll20',
              roll: messageData
            });
          }
        }
      } else {
        if (typeof browserAPI !== 'undefined') {
          browserAPI.runtime.sendMessage({
            action: 'relayRollToRoll20',
            roll: messageData
          });
        }
      }

      // Show notification
      if (typeof showNotification !== 'undefined') {
        showNotification(`✨ Divine Spark (${effectText})! Channel Divinity: ${channelDivinityResource.current}/${channelDivinityResource.max}`, 'success');
      }
      debug.log(`✨ Divine Spark used: ${effectText}`);

      // Rebuild sheet to show updated Channel Divinity count
      if (typeof buildSheet !== 'undefined') {
        buildSheet(characterData);
      }

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

  // ===== EXPORTS =====

  globalThis.toggleInspiration = toggleInspiration;
  globalThis.showGainInspirationModal = showGainInspirationModal;
  globalThis.showUseInspirationModal = showUseInspirationModal;
  globalThis.showDivineSmiteModal = showDivineSmiteModal;
  globalThis.showLayOnHandsModal = showLayOnHandsModal;
  globalThis.showDivineSparkModal = showDivineSparkModal;
  globalThis.showLuckyModal = showLuckyModal;
  globalThis.rollLuckyDie = rollLuckyDie;
  globalThis.getLuckyResource = getLuckyResource;
  globalThis.useLuckyPoint = useLuckyPoint;
  globalThis.getLayOnHandsResource = getLayOnHandsResource;
  globalThis.createThemedModal = createThemedModal;

})();
