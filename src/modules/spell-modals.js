/**
 * Spell Modals Module
 *
 * Handles spell modal UI for casting and custom macro configuration.
 * Loaded as a plain script (no ES6 modules) to export to globalThis.
 *
 * Functions exported to globalThis:
 * - showSpellModal(spell, spellIndex, options, descriptionAnnounced)
 * - showCustomMacroModal(spell, spellIndex)
 */

(function() {
  'use strict';

  // ===== SPELL CASTING MODAL =====

  /**
   * Show modal for casting a spell with options
   * @param {Object} spell - The spell data
   * @param {number} spellIndex - The index of the spell in the spells array
   * @param {Array} options - Array of spell options (attack, damage, healing, etc.)
   * @param {boolean} descriptionAnnounced - Whether spell description was already announced
   */
  function showSpellModal(spell, spellIndex, options, descriptionAnnounced = false) {
    // Get theme-aware colors
    const colors = typeof getPopupThemeColors !== 'undefined' ? getPopupThemeColors() : {
      background: '#fff',
      text: '#333',
      heading: '#2c3e50',
      infoText: '#666',
      infoBox: '#f0f8ff',
      border: '#ddd'
    };

    // Check for custom macros
    const customMacros = typeof getCustomMacros !== 'undefined' ? getCustomMacros(spell.name) : null;
    const hasCustomMacros = customMacros && customMacros.buttons && customMacros.buttons.length > 0;

    // Create modal overlay
    const overlay = document.createElement('div');
    overlay.className = 'spell-modal-overlay';
    overlay.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; z-index: 10000;';

    // Create modal content
    const modal = document.createElement('div');
    modal.className = 'spell-modal';
    modal.style.cssText = `background: ${colors.background}; padding: 24px; border-radius: 8px; max-width: 500px; width: 90%; max-height: 80vh; overflow-y: auto; box-shadow: 0 4px 20px rgba(0,0,0,0.3);`;

    // Modal header
    const header = document.createElement('div');
    header.style.cssText = `margin-bottom: 16px; padding-bottom: 12px; border-bottom: 2px solid ${colors.border};`;

    // Format spell level text
    let levelText = '';
    if (spell.level === 0) {
      levelText = `<div style="color: ${colors.infoText}; font-size: 14px;">Cantrip</div>`;
    } else if (spell.level) {
      levelText = `<div style="color: ${colors.infoText}; font-size: 14px;">Level ${spell.level} Spell</div>`;
    }

    header.innerHTML = `
      <h2 style="margin: 0 0 8px 0; color: ${colors.heading};">Cast ${spell.name}</h2>
      ${levelText}
    `;

    modal.appendChild(header);

    // Slot selection (for leveled spells)
    let slotSelect = null;
    if (spell.level && spell.level > 0) {
      const slotSection = document.createElement('div');
      slotSection.style.cssText = `margin-bottom: 16px; padding: 12px; background: ${colors.infoBox}; border-radius: 6px;`;

      const slotLabel = document.createElement('label');
      slotLabel.style.cssText = `display: block; margin-bottom: 8px; font-weight: bold; color: ${colors.text};`;
      slotLabel.textContent = 'Cast at level:';

      slotSelect = document.createElement('select');
      slotSelect.style.cssText = `width: 100%; padding: 8px; border: 2px solid ${colors.border}; border-radius: 4px; font-size: 14px; background: ${colors.background}; color: ${colors.text};`;

      // Check for Pact Magic slots (Warlock) - these are SEPARATE from regular spell slots
      // Check both spellSlots and otherVariables since data may come from either source
      // DiceCloud uses various variable names: pactSlot, pactMagicSlots, pactSlotLevelVisible, etc.
      const pactMagicSlotLevel = characterData.spellSlots?.pactMagicSlotLevel ||
                                 characterData.otherVariables?.pactMagicSlotLevel ||
                                 characterData.otherVariables?.pactSlotLevelVisible ||
                                 characterData.otherVariables?.pactSlotLevel ||
                                 characterData.otherVariables?.slotLevel;
      const pactMagicSlots = characterData.spellSlots?.pactMagicSlots ??
                             characterData.otherVariables?.pactMagicSlots ??
                             characterData.otherVariables?.pactSlot ?? 0;
      const pactMagicSlotsMax = characterData.spellSlots?.pactMagicSlotsMax ??
                                characterData.otherVariables?.pactMagicSlotsMax ??
                                characterData.otherVariables?.pactSlotMax ?? 0;
      const hasPactMagic = pactMagicSlotsMax > 0;
      // Default slot level to 5 (max pact level) if we have slots but couldn't detect level
      const effectivePactLevel = pactMagicSlotLevel || (hasPactMagic ? 5 : 0);

      if (typeof debug !== 'undefined') {
        debug.log(`🔮 Pact Magic check: level=${pactMagicSlotLevel} (effective=${effectivePactLevel}), slots=${pactMagicSlots}/${pactMagicSlotsMax}, hasPact=${hasPactMagic}`);
      }

      // Add options for available spell slots (spell level and higher)
      let hasAnySlots = false;
      let hasRegularSlots = false;
      let firstValidOption = null;

      // First, add Pact Magic slots if available and spell level is compatible
      // Pact Magic slots can cast any spell from level 1 up to the pact slot level
      if (hasPactMagic && spell.level <= effectivePactLevel) {
        hasAnySlots = true;
        const option = document.createElement('option');
        option.value = `pact:${effectivePactLevel}`; // Special format to identify pact slots
        option.textContent = `Level ${effectivePactLevel} - Pact Magic (${pactMagicSlots}/${pactMagicSlotsMax})`;
        option.disabled = pactMagicSlots === 0;
        slotSelect.appendChild(option);
        if (!option.disabled && !firstValidOption) {
          firstValidOption = option;
        }
        if (typeof debug !== 'undefined') {
          debug.log(`🔮 Added Pact Magic slot option: Level ${effectivePactLevel} (${pactMagicSlots}/${pactMagicSlotsMax})`);
        }
      }

      // Then add regular spell slots (excluding the pact magic level to avoid duplicates)
      for (let level = spell.level; level <= 9; level++) {
        const slotsProp = `level${level}SpellSlots`;
        const maxSlotsProp = `level${level}SpellSlotsMax`;
        let available = characterData.spellSlots?.[slotsProp] || characterData[slotsProp] || 0;
        let max = characterData.spellSlots?.[maxSlotsProp] || characterData[maxSlotsProp] || 0;

        // If this level has Pact Magic, subtract pact slots from the total (they're counted separately)
        if (hasPactMagic && level === effectivePactLevel) {
          available = Math.max(0, available - pactMagicSlots);
          max = Math.max(0, max - pactMagicSlotsMax);
        }

        if (max > 0) {
          hasAnySlots = true;
          hasRegularSlots = true;
          const option = document.createElement('option');
          option.value = level; // Regular level number for normal slots
          option.textContent = `Level ${level} (${available}/${max} slots)`;
          option.disabled = available === 0;
          slotSelect.appendChild(option);
          if (!option.disabled && !firstValidOption) {
            firstValidOption = option;
          }
        }
      }

      // Select the first valid (non-disabled) option
      if (firstValidOption) {
        firstValidOption.selected = true;
      }

      // If no slots available at all, show a message
      if (!hasAnySlots) {
        const noSlotsOption = document.createElement('option');
        noSlotsOption.value = spell.level;
        noSlotsOption.textContent = 'No spell slots available';
        noSlotsOption.disabled = true;
        noSlotsOption.selected = true;
        slotSelect.appendChild(noSlotsOption);
      }

      // If ONLY Pact Magic slots exist (no regular spell slots), don't show the dropdown
      // Instead, automatically use the Pact Magic slot level
      if (hasPactMagic && !hasRegularSlots && spell.level <= effectivePactLevel) {
        // Store the auto-selected Pact Magic level on the modal for button handlers to use
        modal.dataset.autoSlotLevel = `pact:${effectivePactLevel}`;
        if (typeof debug !== 'undefined') {
          debug.log(`🔮 Auto-selecting Pact Magic level ${effectivePactLevel} (no regular slots available)`);
        }
        // Don't append the slot selection UI - it's not needed
      } else {
        // Show the dropdown since there are multiple slot options
        slotSection.appendChild(slotLabel);
        slotSection.appendChild(slotSelect);
        modal.appendChild(slotSection);

        // Store reference to update button labels later
        // (will be set after buttons are created)
        slotSelect.updateButtonLabels = null;
      }
    }

    // Concentration spell recast option OR special spells that allow reuse without slots
    // (if already concentrating on this spell, or for spells like Spiritual Weapon, Meld into Stone)
    // NOTE: Cantrips (level 0) never use slots, so don't show this checkbox for them
    let skipSlotCheckbox = null;
    const isCantrip = spell.level === 0;
    const isConcentrationRecast = spell.concentration && typeof concentratingSpell !== 'undefined' && concentratingSpell === spell.name;

    // Spells that allow repeated use without consuming slots (non-concentration)
    // Exclude cantrips since they never use slots anyway
    const isReuseableSpellType = !isCantrip && typeof isReuseableSpell !== 'undefined' && isReuseableSpell(spell.name, characterData);

    // Check if this spell was already cast (stored in localStorage or session)
    const castSpellsKey = `castSpells_${characterData.name}`;
    const castSpells = JSON.parse(localStorage.getItem(castSpellsKey) || '[]');
    const wasAlreadyCast = castSpells.includes(spell.name);

    // Show checkbox for concentration recasts OR for all reuseable spells (even on first cast)
    // But NOT for cantrips since they never consume slots
    if (!isCantrip && (isConcentrationRecast || isReuseableSpellType)) {
      const recastSection = document.createElement('div');
      recastSection.style.cssText = 'margin-bottom: 16px; padding: 12px; background: #fff3cd; border-radius: 6px; border: 2px solid #f39c12;';

      const checkboxContainer = document.createElement('label');
      checkboxContainer.style.cssText = 'display: flex; align-items: center; gap: 8px; cursor: pointer;';

      skipSlotCheckbox = document.createElement('input');
      skipSlotCheckbox.type = 'checkbox';
      // Default checked if concentration recast OR if reuseable spell was already cast
      skipSlotCheckbox.checked = isConcentrationRecast || wasAlreadyCast;
      skipSlotCheckbox.style.cssText = 'width: 20px; height: 20px;';

      const checkboxLabel = document.createElement('span');
      checkboxLabel.style.cssText = 'font-weight: bold; color: #856404;';
      if (isConcentrationRecast) {
        checkboxLabel.textContent = '🧠 Already concentrating - don\'t consume spell slot';
      } else if (wasAlreadyCast) {
        checkboxLabel.textContent = '⚔️ Spell already active - don\'t consume spell slot';
      } else {
        checkboxLabel.textContent = '⚔️ Reuse spell effect without consuming slot (first cast required)';
      }

      checkboxContainer.appendChild(skipSlotCheckbox);
      checkboxContainer.appendChild(checkboxLabel);
      recastSection.appendChild(checkboxContainer);

      const helpText = document.createElement('div');
      helpText.style.cssText = 'font-size: 0.85em; color: #856404; margin-top: 6px; margin-left: 28px;';
      if (isConcentrationRecast) {
        helpText.textContent = 'You can use this spell\'s effect again while concentrating on it without recasting.';
      } else {
        helpText.textContent = 'You can use this spell\'s effect again while it\'s active without recasting.';
      }
      recastSection.appendChild(helpText);

      modal.appendChild(recastSection);

      // If skip slot is checked, disable slot selection
      skipSlotCheckbox.addEventListener('change', () => {
        if (slotSelect) {
          slotSelect.disabled = skipSlotCheckbox.checked;
          slotSelect.style.opacity = skipSlotCheckbox.checked ? '0.5' : '1';
        }
      });

      // Initialize disabled state
      if (slotSelect && skipSlotCheckbox.checked) {
        slotSelect.disabled = true;
        slotSelect.style.opacity = '0.5';
      }
    }

    // Metamagic options (if character has metamagic features)
    // Only the 8 official Sorcerer metamagic options from PHB
    const metamagicCheckboxes = [];
    const validMetamagicNames = [
      'Careful Spell',
      'Distant Spell',
      'Empowered Spell',
      'Extended Spell',
      'Heightened Spell',
      'Quickened Spell',
      'Subtle Spell',
      'Twinned Spell'
    ];
    const metamagicFeatures = characterData.features ? characterData.features.filter(f =>
      f.name && validMetamagicNames.includes(f.name)
    ) : [];

    if (metamagicFeatures.length > 0) {
      const metamagicSection = document.createElement('div');
      metamagicSection.style.cssText = `margin-bottom: 16px; padding: 12px; background: ${colors.infoBox}; border-radius: 6px; border: 1px solid ${colors.border};`;

      const metamagicTitle = document.createElement('div');
      metamagicTitle.style.cssText = `font-weight: bold; margin-bottom: 8px; color: ${colors.text};`;
      metamagicTitle.textContent = 'Metamagic:';
      metamagicSection.appendChild(metamagicTitle);

      metamagicFeatures.forEach(feature => {
        const checkboxContainer = document.createElement('label');
        checkboxContainer.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-bottom: 4px; cursor: pointer;';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = feature.name;
        checkbox.style.cssText = 'width: 18px; height: 18px;';

        const label = document.createElement('span');
        label.textContent = feature.name;
        label.style.cssText = `font-size: 14px; color: ${colors.infoText};`;

        checkboxContainer.appendChild(checkbox);
        checkboxContainer.appendChild(label);
        metamagicSection.appendChild(checkboxContainer);

        metamagicCheckboxes.push(checkbox);
      });

      modal.appendChild(metamagicSection);
    }

    // Track whether spell has been cast (for attack spells)
    let spellCast = false;
    let usedSlot = null;

    // Check if spell has both attack and damage options
    const hasAttack = options.some(opt => opt.type === 'attack');
    const hasDamage = options.some(opt => opt.type === 'damage' || opt.type === 'healing');

    // Options container (spell action buttons)
    const optionsContainer = document.createElement('div');
    optionsContainer.style.cssText = 'display: flex; flex-direction: column; gap: 12px;';

    // Helper function to get resolved label for an option based on slot level
    function getResolvedLabel(option, selectedSlotLevel) {
      if (option.type === 'attack') {
        return option.label; // Attack doesn't change with slot level
      }

      // Get the formula for this option
      let formula = option.type === 'lifesteal' ? option.damageFormula : option.formula;
      if (typeof debug !== 'undefined') {
        debug.log(`🏷️ getResolvedLabel called with formula: "${formula}", slotLevel: ${selectedSlotLevel}`);
      }

      // Replace slotLevel with actual slot level (check for null/undefined, but allow 0)
      // Use case-insensitive regex to handle slotLevel, slotlevel, SlotLevel, etc.
      if (selectedSlotLevel != null && formula && /slotlevel/i.test(formula)) {
        const originalFormula = formula;
        formula = formula.replace(/slotlevel/gi, String(selectedSlotLevel));
        if (typeof debug !== 'undefined') {
          debug.log(`  ✅ Replaced slotLevel: "${originalFormula}" -> "${formula}"`);
        }
      }

      // Replace ~target.level with character level
      if (formula && formula.includes('~target.level') && characterData.level) {
        formula = formula.replace(/~target\.level/g, characterData.level);
      }

      // Resolve variables and evaluate math
      if (typeof resolveVariablesInFormula !== 'undefined') {
        formula = resolveVariablesInFormula(formula);
      }
      if (typeof evaluateMathInFormula !== 'undefined') {
        formula = evaluateMathInFormula(formula);
      }
      if (typeof debug !== 'undefined') {
        debug.log(`  📊 Final resolved formula: "${formula}"`);
      }

      // Build label based on option type
      if (option.type === 'lifesteal') {
        let damageTypeLabel = '';
        if (option.damageType && option.damageType !== 'untyped') {
          damageTypeLabel = option.damageType.charAt(0).toUpperCase() + option.damageType.slice(1);
        }
        return `${formula} ${damageTypeLabel} + Heal (${option.healingRatio})`;
      } else if (option.type === 'damage' || option.type === 'healing' || option.type === 'temphp') {
        let damageTypeLabel = '';
        if (option.damageType && option.damageType !== 'untyped') {
          damageTypeLabel = option.damageType.charAt(0).toUpperCase() + option.damageType.slice(1);
        }
        return damageTypeLabel ? `${formula} ${damageTypeLabel}` : formula;
      }

      return option.label;
    }

    // Add buttons for each option
    const optionButtons = []; // Store buttons so we can update them when slot changes

    // Add custom macro buttons if configured
    if (hasCustomMacros) {
      customMacros.buttons.forEach((customBtn, index) => {
        const btn = document.createElement('button');
        btn.className = 'spell-custom-macro-btn';
        btn.style.cssText = `
          padding: 12px 16px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          border: 2px solid rgba(255,255,255,0.3);
          border-radius: 6px;
          cursor: pointer;
          font-weight: bold;
          font-size: 16px;
          text-align: left;
          transition: opacity 0.2s, transform 0.2s;
          box-shadow: 0 4px 8px rgba(0,0,0,0.3);
        `;
        btn.innerHTML = customBtn.label;

        btn.addEventListener('mouseenter', () => {
          btn.style.opacity = '0.9';
          btn.style.transform = 'translateY(-2px)';
        });
        btn.addEventListener('mouseleave', () => {
          btn.style.opacity = '1';
          btn.style.transform = 'translateY(0)';
        });

        btn.addEventListener('click', () => {
          // Send custom macro to chat
          const colorBanner = typeof getColoredBanner !== 'undefined' ? getColoredBanner() : '';
          const message = customBtn.macro;

          const messageData = {
            action: 'announceSpell',
            message: message,
            color: characterData.notificationColor
          };

          if (window.opener && !window.opener.closed) {
            try {
              window.opener.postMessage(messageData, '*');
              if (typeof debug !== 'undefined') {
                debug.log('✅ Custom macro sent via window.opener');
              }
            } catch (error) {
              if (typeof debug !== 'undefined') {
                debug.warn('⚠️ Could not send via window.opener:', error.message);
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

          if (typeof showNotification !== 'undefined') {
            showNotification(`✨ ${spell.name} - Custom Macro Sent!`, 'success');
          }
          document.body.removeChild(overlay);
        });

        optionsContainer.appendChild(btn);
      });

      // If skipNormalButtons is true, don't add normal spell option buttons
      if (customMacros.skipNormalButtons) {
        if (typeof debug !== 'undefined') {
          debug.log(`⚙️ Skipping normal spell buttons for "${spell.name}" (custom macros only)`);
        }
        // Skip the normal options.forEach below
        options = [];
      }
    }

    options.forEach(option => {
      const btn = document.createElement('button');
      btn.className = `spell-option-btn-${option.type}`;

      // Special styling for lifesteal buttons to make them more visually distinct
      const isLifesteal = option.type === 'lifesteal';
      const boxShadow = isLifesteal ? 'box-shadow: 0 4px 8px rgba(0,0,0,0.3), inset 0 -2px 4px rgba(0,0,0,0.2);' : '';
      const border = isLifesteal ? 'border: 2px solid rgba(255,255,255,0.3);' : 'border: none;';

      btn.style.cssText = `
        padding: 12px 16px;
        background: ${option.color};
        color: white;
        ${border}
        border-radius: 6px;
        cursor: pointer;
        font-weight: bold;
        font-size: 16px;
        text-align: left;
        transition: opacity 0.2s, transform 0.2s;
        ${boxShadow}
      `;

      // Set initial label (with default slot level)
      const initialSlotLevel = spell.level || null;
      const resolvedLabel = getResolvedLabel(option, initialSlotLevel);
      const edgeCaseNote = option.edgeCaseNote ? `<div style="font-size: 0.8em; color: #666; margin-top: 2px;">${option.edgeCaseNote}</div>` : '';
      btn.innerHTML = `${option.icon} ${resolvedLabel}${edgeCaseNote}`;
      btn.dataset.optionIndex = optionButtons.length; // Store index for later updates

      btn.addEventListener('mouseenter', () => {
        btn.style.opacity = '0.9';
        if (isLifesteal) btn.style.transform = 'translateY(-2px)';
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.opacity = '1';
        if (isLifesteal) btn.style.transform = 'translateY(0)';
      });

      optionButtons.push({ button: btn, option: option });

      btn.addEventListener('click', () => {
        // Get selected slot level - keep in "pact:X" format for castSpell to detect Pact Magic
        let selectedSlotLevel = spell.level || null;

        // Check if slot level was auto-selected (Pact Magic only, no dropdown shown)
        if (modal.dataset.autoSlotLevel) {
          selectedSlotLevel = modal.dataset.autoSlotLevel; // Keep as "pact:X" string
        } else if (slotSelect) {
          selectedSlotLevel = slotSelect.value; // Keep as "pact:X" string or regular level number
        }

        // Get selected metamagic options
        const selectedMetamagic = metamagicCheckboxes
          .filter(cb => cb.checked)
          .map(cb => cb.value);

        // Check if we should skip slot consumption (concentration recast)
        const skipSlot = skipSlotCheckbox ? skipSlotCheckbox.checked : false;

        if (option.type === 'cast') {
          // Cast spell only (for spells with conditional damage like Meld into Stone)
          // Announce description only if not already announced AND not using concentration recast
          if (!descriptionAnnounced && !skipSlot) {
            if (typeof announceSpellDescription !== 'undefined') {
              announceSpellDescription(spell, selectedSlotLevel);
            }
          }

          const afterCast = (spell, slot) => {
            usedSlot = slot;
            if (typeof showNotification !== 'undefined') {
              showNotification(`✨ ${spell.name} cast successfully!`, 'success');
            }
          };
          // Description announced (if needed), don't announce again in castSpell
          if (typeof castSpell !== 'undefined') {
            castSpell(spell, spellIndex, afterCast, selectedSlotLevel, selectedMetamagic, skipSlot, true);
          }
          spellCast = true;

          // Disable cast button after casting
          btn.disabled = true;
          btn.style.opacity = '0.5';
          btn.style.cursor = 'not-allowed';

          // Don't close modal - allow rolling damage if needed

        } else if (option.type === 'attack') {
          // Cast spell + roll attack, but keep modal open
          // Announce description only if not already announced AND not using concentration recast
          if (!descriptionAnnounced && !skipSlot) {
            if (typeof announceSpellDescription !== 'undefined') {
              announceSpellDescription(spell, selectedSlotLevel);
            }
          }

          const afterCast = (spell, slot) => {
            usedSlot = slot;
            if (typeof getSpellAttackBonus !== 'undefined' && typeof roll !== 'undefined') {
              const attackBonus = getSpellAttackBonus();
              const attackFormula = attackBonus >= 0 ? `1d20+${attackBonus}` : `1d20${attackBonus}`;
              roll(`${spell.name} - Spell Attack`, attackFormula);
            }
          };
          // Description announced (if needed), don't announce again in castSpell
          if (typeof castSpell !== 'undefined') {
            castSpell(spell, spellIndex, afterCast, selectedSlotLevel, selectedMetamagic, skipSlot, true);
          }
          spellCast = true;

          // Disable slot selection and metamagic after casting
          if (slotSelect) slotSelect.disabled = true;
          metamagicCheckboxes.forEach(cb => cb.disabled = true);

          // Disable attack button after casting
          btn.disabled = true;
          btn.style.opacity = '0.5';
          btn.style.cursor = 'not-allowed';

        } else if (option.type === 'damage' || option.type === 'healing' || option.type === 'temphp') {
          // If spell not cast yet (no attack roll), cast it first
          if (!spellCast) {
            // Announce description only if not already announced AND not using concentration recast
            if (!descriptionAnnounced && !skipSlot) {
              if (typeof announceSpellDescription !== 'undefined') {
                announceSpellDescription(spell, selectedSlotLevel);
              }
            }

            const afterCast = (spell, slot) => {
              usedSlot = slot;
              let formula = option.formula;
              let actualSlotLevel = selectedSlotLevel != null ? selectedSlotLevel : (slot && slot.level);
              // Extract numeric level from "pact:X" format if needed
              if (typeof actualSlotLevel === 'string' && actualSlotLevel.startsWith('pact:')) {
                actualSlotLevel = parseInt(actualSlotLevel.split(':')[1]);
              }
              if (actualSlotLevel != null) {
                formula = formula.replace(/slotlevel/gi, actualSlotLevel);
              }
              // Replace ~target.level with character level (for cantrips)
              if (formula.includes('~target.level') && characterData.level) {
                formula = formula.replace(/~target\.level/g, characterData.level);
              }
              if (typeof resolveVariablesInFormula !== 'undefined') {
                formula = resolveVariablesInFormula(formula);
              }
              if (typeof evaluateMathInFormula !== 'undefined') {
                formula = evaluateMathInFormula(formula);
              }

              const label = option.type === 'healing' ?
                `${spell.name} - Healing` :
                (option.type === 'temphp' ?
                  `${spell.name} - Temp HP` :
                  `${spell.name} - Damage (${option.damageType || ''})`);
              if (typeof roll !== 'undefined') {
                roll(label, formula);
              }
            };
            // Description announced (if needed), don't announce again in castSpell
            if (typeof castSpell !== 'undefined') {
              castSpell(spell, spellIndex, afterCast, selectedSlotLevel, selectedMetamagic, skipSlot, true);
            }
          } else {
            // Spell already cast (via attack), just roll damage
            let formula = option.formula;
            let actualSlotLevel = selectedSlotLevel != null ? selectedSlotLevel : (usedSlot && usedSlot.level);
            // Extract numeric level from "pact:X" format if needed
            if (typeof actualSlotLevel === 'string' && actualSlotLevel.startsWith('pact:')) {
              actualSlotLevel = parseInt(actualSlotLevel.split(':')[1]);
            }
            if (actualSlotLevel != null) {
              formula = formula.replace(/slotlevel/gi, actualSlotLevel);
            }
            // Replace ~target.level with character level (for cantrips)
            if (formula.includes('~target.level') && characterData.level) {
              formula = formula.replace(/~target\.level/g, characterData.level);
            }
            if (typeof resolveVariablesInFormula !== 'undefined') {
              formula = resolveVariablesInFormula(formula);
            }
            if (typeof evaluateMathInFormula !== 'undefined') {
              formula = evaluateMathInFormula(formula);
            }

            const label = option.type === 'healing' ?
              `${spell.name} - Healing` :
              (option.type === 'temphp' ?
                `${spell.name} - Temp HP` :
                `${spell.name} - Damage (${option.damageType || ''})`);
            if (typeof roll !== 'undefined') {
              roll(label, formula);
            }
          }

          // Close modal after rolling damage
          document.body.removeChild(overlay);

        } else if (option.type === 'lifesteal') {
          // Lifesteal: Cast spell, roll damage, calculate and apply healing
          // Announce description only if not already announced AND not using concentration recast
          if (!descriptionAnnounced && !skipSlot) {
            if (typeof announceSpellDescription !== 'undefined') {
              announceSpellDescription(spell, selectedSlotLevel);
            }
          }

          const afterCast = (spell, slot) => {
            let damageFormula = option.damageFormula;
            const actualSlotLevel = selectedSlotLevel != null ? selectedSlotLevel : (slot && slot.level);
            if (actualSlotLevel != null) {
              damageFormula = damageFormula.replace(/slotlevel/gi, actualSlotLevel);
            }
            if (damageFormula.includes('~target.level') && characterData.level) {
              damageFormula = damageFormula.replace(/~target\.level/g, characterData.level);
            }
            if (typeof resolveVariablesInFormula !== 'undefined') {
              damageFormula = resolveVariablesInFormula(damageFormula);
            }
            if (typeof evaluateMathInFormula !== 'undefined') {
              damageFormula = evaluateMathInFormula(damageFormula);
            }

            // Roll damage
            if (typeof roll !== 'undefined') {
              roll(`${spell.name} - Lifesteal Damage (${option.damageType})`, damageFormula);
            }

            // After a short delay, prompt for damage dealt to calculate healing
            setTimeout(() => {
              const healingText = option.healingRatio === 'half' ? 'half' : 'the full amount';
              const damageDealt = prompt(`💉 Lifesteal: Enter the damage dealt\n\nYou regain HP equal to ${healingText} of the damage.`);

              if (damageDealt && !isNaN(damageDealt)) {
                const damage = parseInt(damageDealt);
                const healing = option.healingRatio === 'half' ? Math.floor(damage / 2) : damage;

                // Apply healing
                const oldHP = characterData.hitPoints.current;
                const maxHP = characterData.hitPoints.max;
                characterData.hitPoints.current = Math.min(oldHP + healing, maxHP);
                const actualHealing = characterData.hitPoints.current - oldHP;

                // Reset death saves if healing from 0 HP
                if (oldHP === 0 && actualHealing > 0) {
                  characterData.deathSaves = { successes: 0, failures: 0 };
                  if (typeof debug !== 'undefined') {
                    debug.log('♻️ Death saves reset due to healing');
                  }
                }

                if (typeof saveCharacterData !== 'undefined') {
                  saveCharacterData();
                }
                if (typeof buildSheet !== 'undefined') {
                  buildSheet(characterData);
                }

                // Announce healing
                const colorBanner = typeof getColoredBanner !== 'undefined' ? getColoredBanner() : '';
                const message = `&{template:default} {{name=${colorBanner}${characterData.name} - Lifesteal}} {{💉 Damage Dealt=${damage}}} {{💚 HP Regained=${actualHealing}}} {{Current HP=${characterData.hitPoints.current}/${maxHP}}}`;

                const messageData = {
                  action: 'announceSpell',
                  message: message,
                  color: characterData.notificationColor
                };

                if (window.opener && !window.opener.closed) {
                  try {
                    window.opener.postMessage(messageData, '*');
                  } catch (error) {
                    if (typeof debug !== 'undefined') {
                      debug.warn('⚠️ Could not send via window.opener:', error.message);
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

                if (typeof showNotification !== 'undefined') {
                  showNotification(`💉 Lifesteal! Dealt ${damage} damage, regained ${actualHealing} HP`, 'success');
                }
              }
            }, 500);
          };
          // Description announced (if needed), don't announce again in castSpell
          if (typeof castSpell !== 'undefined') {
            castSpell(spell, spellIndex, afterCast, selectedSlotLevel, selectedMetamagic, skipSlot, true);
          }

          // Close modal after rolling
          document.body.removeChild(overlay);
        }
      });

      optionsContainer.appendChild(btn);
    });

    // Set up slot selection change handler to update button labels
    if (slotSelect) {
      const updateButtonLabels = () => {
        // Handle pact magic slot format "pact:X" - extract the level number
        const slotValue = slotSelect.value;
        const selectedSlotLevel = slotValue.startsWith('pact:')
          ? parseInt(slotValue.split(':')[1])
          : parseInt(slotValue);
        optionButtons.forEach(({ button, option }) => {
          const resolvedLabel = getResolvedLabel(option, selectedSlotLevel);
          const edgeCaseNote = option.edgeCaseNote ? `<div style="font-size: 0.8em; color: #666; margin-top: 2px;">${option.edgeCaseNote}</div>` : '';
          button.innerHTML = `${option.icon} ${resolvedLabel}${edgeCaseNote}`;
        });
      };

      // Add change event listener
      slotSelect.addEventListener('change', updateButtonLabels);

      // Call initially to set correct labels for default selection
      updateButtonLabels();
    }

    // Add "Done" button if spell has attack (to close modal after attacking without rolling damage)
    if (hasAttack && hasDamage) {
      const doneBtn = document.createElement('button');
      doneBtn.style.cssText = 'padding: 10px; background: #3498db; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold;';
      doneBtn.textContent = 'Done';
      doneBtn.addEventListener('click', () => {
        document.body.removeChild(overlay);
      });
      optionsContainer.appendChild(doneBtn);
    }

    modal.appendChild(optionsContainer);

    // Cancel button
    const cancelBtn = document.createElement('button');
    cancelBtn.style.cssText = 'margin-top: 16px; padding: 10px; background: #95a5a6; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; width: 100%;';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => {
      document.body.removeChild(overlay);
    });

    modal.appendChild(cancelBtn);
    overlay.appendChild(modal);

    // Close on overlay click
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        document.body.removeChild(overlay);
      }
    });

    // Add to DOM
    document.body.appendChild(overlay);
  }

  // ===== CUSTOM MACRO MODAL =====

  /**
   * Show custom macro configuration modal
   */
  function showCustomMacroModal(spell, spellIndex) {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; z-index: 10000;';

    const modal = document.createElement('div');
    modal.style.cssText = 'background: var(--bg-secondary); color: var(--text-primary); padding: 24px; border-radius: 8px; max-width: 600px; width: 90%; max-height: 80vh; overflow-y: auto; box-shadow: 0 4px 20px rgba(0,0,0,0.3);';

    const existingMacros = typeof getCustomMacros !== 'undefined' ? getCustomMacros(spell.name) : null;
    const skipNormalButtons = existingMacros?.skipNormalButtons || false;

    modal.innerHTML = `
      <h2 style="margin: 0 0 16px 0; color: #333;">Custom Macros: ${spell.name}</h2>
      <p style="margin: 0 0 16px 0; color: #666; font-size: 14px;">
        Configure custom macro buttons for this spell. Use this for magic item spells or custom variants that don't work with the default buttons.
      </p>

      <div style="margin-bottom: 16px;">
        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
          <input type="checkbox" id="skipNormalButtons" ${skipNormalButtons ? 'checked' : ''} style="width: 18px; height: 18px;">
          <span style="font-weight: bold;">Replace default buttons (hide attack/damage buttons)</span>
        </label>
        <p style="margin: 4px 0 0 26px; color: #666; font-size: 13px;">
          Check this to only show your custom macros, hiding the default spell buttons
        </p>
      </div>

      <div id="macro-buttons-container" style="margin-bottom: 16px;">
        <!-- Macro buttons will be added here -->
      </div>

      <button id="add-macro-btn" style="padding: 8px 16px; background: #27ae60; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; margin-bottom: 16px;">
        ➕ Add Macro Button
      </button>

      <div style="margin-top: 24px; padding-top: 16px; border-top: 2px solid #eee; display: flex; gap: 12px; justify-content: flex-end;">
        <button id="clear-macros-btn" style="padding: 10px 20px; background: #e74c3c; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold;">
          🗑️ Clear All
        </button>
        <button id="cancel-macros-btn" style="padding: 10px 20px; background: #95a5a6; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold;">
          Cancel
        </button>
        <button id="save-macros-btn" style="padding: 10px 20px; background: #3498db; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold;">
          💾 Save
        </button>
      </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const container = modal.querySelector('#macro-buttons-container');
    const addBtn = modal.querySelector('#add-macro-btn');
    const clearBtn = modal.querySelector('#clear-macros-btn');
    const cancelBtn = modal.querySelector('#cancel-macros-btn');
    const saveBtn = modal.querySelector('#save-macros-btn');

    let macroCounter = 0;

    function addMacroButton(label = '', macro = '') {
      const macroDiv = document.createElement('div');
      macroDiv.className = 'macro-button-config';
      macroDiv.style.cssText = 'padding: 12px; background: #f8f9fa; border-radius: 6px; margin-bottom: 12px; border: 2px solid #dee2e6;';
      macroDiv.dataset.macroId = macroCounter++;

      macroDiv.innerHTML = `
        <div style="margin-bottom: 8px;">
          <label style="display: block; font-weight: bold; margin-bottom: 4px; color: #333;">Button Label:</label>
          <input type="text" class="macro-label" value="${label}" placeholder="e.g., ⚔️ Attack, 💥 Damage, ✨ Cast" style="width: 100%; padding: 8px; border: 2px solid #ddd; border-radius: 4px; font-size: 14px;">
        </div>
        <div style="margin-bottom: 8px;">
          <label style="display: block; font-weight: bold; margin-bottom: 4px; color: #333;">Macro Text:</label>
          <textarea class="macro-text" placeholder="&{template:default} {{name=My Spell}} {{effect=Custom effect}}" style="width: 100%; padding: 8px; border: 2px solid #ddd; border-radius: 4px; font-size: 13px; font-family: monospace; min-height: 80px;">${macro}</textarea>
        </div>
        <button class="remove-macro-btn" style="padding: 6px 12px; background: #e74c3c; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;">
          ❌ Remove
        </button>
      `;

      const removeBtn = macroDiv.querySelector('.remove-macro-btn');
      removeBtn.addEventListener('click', () => {
        macroDiv.remove();
      });

      container.appendChild(macroDiv);
    }

    // Add existing macros or one empty macro
    if (existingMacros && existingMacros.buttons && existingMacros.buttons.length > 0) {
      existingMacros.buttons.forEach(btn => {
        addMacroButton(btn.label, btn.macro);
      });
    } else {
      addMacroButton();
    }

    addBtn.addEventListener('click', () => addMacroButton());

    clearBtn.addEventListener('click', () => {
      if (confirm(`Clear all custom macros for "${spell.name}"?`)) {
        if (typeof saveCustomMacros !== 'undefined') {
          saveCustomMacros(spell.name, null);
        }
        document.body.removeChild(overlay);
        if (typeof showNotification !== 'undefined') {
          showNotification(`🗑️ Cleared custom macros for ${spell.name}`, 'success');
        }
      }
    });

    cancelBtn.addEventListener('click', () => {
      document.body.removeChild(overlay);
    });

    saveBtn.addEventListener('click', () => {
      const macroConfigs = Array.from(container.querySelectorAll('.macro-button-config'));
      const buttons = macroConfigs.map(config => {
        const label = config.querySelector('.macro-label').value.trim();
        const macro = config.querySelector('.macro-text').value.trim();
        return { label, macro };
      }).filter(btn => btn.label && btn.macro); // Only save if both label and macro are provided

      const skipNormalButtons = modal.querySelector('#skipNormalButtons').checked;

      if (typeof saveCustomMacros !== 'undefined') {
        saveCustomMacros(spell.name, {
          buttons,
          skipNormalButtons
        });
      }

      document.body.removeChild(overlay);
      if (typeof showNotification !== 'undefined') {
        showNotification(`💾 Saved custom macros for ${spell.name}`, 'success');
      }
    });

    // Close on overlay click
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        document.body.removeChild(overlay);
      }
    });
  }

  // ===== EXPORTS =====

  globalThis.showSpellModal = showSpellModal;
  globalThis.showCustomMacroModal = showCustomMacroModal;

})();
