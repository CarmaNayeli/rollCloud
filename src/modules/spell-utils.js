/**
 * Spell Utilities Module
 *
 * Helper functions for spell calculations, announcements, and options.
 * Loaded as a plain script (no ES6 modules) to export to globalThis.
 *
 * Functions exported to globalThis:
 * - getSpellcastingAbilityMod()
 * - getSpellAttackBonus()
 * - announceSpellDescription(spell, castLevel)
 * - announceSpellCast(spell, resourceUsed)
 * - getAvailableMetamagic()
 * - getSpellOptions(spell)
 * - handleSpellOption(spell, spellIndex, option)
 * - getCustomMacros(spellName)
 * - saveCustomMacros(spellName, macros)
 */

(function() {
  'use strict';

  // ===== SPELLCASTING ABILITY FUNCTIONS =====

  /**
   * Get spellcasting ability modifier based on character class
   */
  function getSpellcastingAbilityMod() {
    if (typeof characterData === 'undefined' || !characterData || !characterData.abilityMods) {
      return 0;
    }

    const charClass = (characterData.class || '').toLowerCase();

    // Map classes to their spellcasting abilities
    // Wisdom-based: Cleric, Druid, Ranger, Monk
    if (charClass.includes('cleric') || charClass.includes('druid') ||
        charClass.includes('ranger') || charClass.includes('monk')) {
      return characterData.abilityMods.wisdomMod || 0;
    }
    // Intelligence-based: Wizard, Artificer, Eldritch Knight, Arcane Trickster
    else if (charClass.includes('wizard') || charClass.includes('artificer') ||
             charClass.includes('eldritch knight') || charClass.includes('arcane trickster')) {
      return characterData.abilityMods.intelligenceMod || 0;
    }
    // Charisma-based: Sorcerer, Bard, Warlock, Paladin
    else if (charClass.includes('sorcerer') || charClass.includes('bard') ||
             charClass.includes('warlock') || charClass.includes('paladin')) {
      return characterData.abilityMods.charismaMod || 0;
    }

    // Default to highest mental stat
    const intMod = characterData.abilityMods.intelligenceMod || 0;
    const wisMod = characterData.abilityMods.wisdomMod || 0;
    const chaMod = characterData.abilityMods.charismaMod || 0;
    return Math.max(intMod, wisMod, chaMod);
  }

  /**
   * Calculate spell attack bonus
   */
  function getSpellAttackBonus() {
    const spellMod = getSpellcastingAbilityMod();
    const profBonus = (typeof characterData !== 'undefined' && characterData) ? (characterData.proficiencyBonus || 0) : 0;
    return spellMod + profBonus;
  }

  // ===== SPELL ANNOUNCEMENT FUNCTIONS =====

  /**
   * Announce spell description to Roll20 chat
   * Called immediately when Cast button is clicked, before any modal
   */
  function announceSpellDescription(spell, castLevel = null) {
    if (typeof characterData === 'undefined' || !characterData) return;

    // Send structured spell data to Roll20 for uniform formatting
    const messageData = {
      action: 'announceSpell',
      spellName: spell.name,
      characterName: characterData.name,
      color: characterData.notificationColor,
      // Send structured spell data instead of pre-formatted message
      spellData: spell,
      castLevel: castLevel
    };

    // Try window.opener first (Chrome)
    if (window.opener && !window.opener.closed) {
      try {
        window.opener.postMessage(messageData, '*');
        debug.log('✅ Spell data sent via window.opener');
      } catch (error) {
        debug.warn('⚠️ Could not send via window.opener:', error.message);
        // Fall through to background script relay
      }
    } else if (typeof browserAPI !== 'undefined') {
      // Fallback: Use background script to relay to Roll20 (Firefox)
      debug.log('📡 Using background script to relay spell data to Roll20...');
      browserAPI.runtime.sendMessage({
        action: 'relayRollToRoll20',
        roll: messageData
      }, (response) => {
        if (browserAPI.runtime.lastError) {
          debug.error('❌ Error relaying spell announcement:', browserAPI.runtime.lastError);
        } else if (response && response.success) {
          debug.log('✅ Spell data announced to Roll20');
        }
      });
    }
  }

  /**
   * Legacy function kept for backward compatibility with utility spells
   * For attack/damage spells, use announceSpellDescription() instead
   */
  function announceSpellCast(spell, resourceUsed) {
    if (typeof characterData === 'undefined' || !characterData) return;

    // For spells with attack/damage, description was already announced
    // This just announces resource usage
    if (resourceUsed) {
      const colorBanner = (typeof getColoredBanner !== 'undefined') ? getColoredBanner() : '';
      let message = `&{template:default} {{name=${colorBanner}${spell.name}}}`;
      message += ` {{Resource Used=${resourceUsed}}}`;

      const messageData = {
        action: 'announceSpell',
        spellName: spell.name,
        characterName: characterData.name,
        message: message,
        color: characterData.notificationColor
      };

      // Try window.opener first (Chrome)
      if (window.opener && !window.opener.closed) {
        try {
          window.opener.postMessage(messageData, '*');
          debug.log('✅ Spell resource usage sent via window.opener');
        } catch (error) {
          debug.warn('⚠️ Could not send via window.opener:', error.message);
        }
      } else if (typeof browserAPI !== 'undefined') {
        browserAPI.runtime.sendMessage({
          action: 'relayRollToRoll20',
          roll: messageData
        }, (response) => {
          if (browserAPI.runtime.lastError) {
            debug.error('❌ Error relaying spell announcement:', browserAPI.runtime.lastError);
          }
        });
      }
    }

    // Also roll if there's a formula (utility spells)
    if (spell.formula && typeof roll !== 'undefined') {
      setTimeout(() => {
        roll(spell.name, spell.formula);
      }, 500);
    }
  }

  // ===== METAMAGIC FUNCTIONS =====

  /**
   * Get available metamagic options (wrapper for action-executor)
   */
  function getAvailableMetamagic() {
    if (typeof executorGetAvailableMetamagic !== 'undefined' && typeof characterData !== 'undefined') {
      const options = executorGetAvailableMetamagic(characterData);
      debug.log('🔮 Found metamagic options:', options.map(m => m.name));
      return options;
    }
    return [];
  }

  // ===== SPELL OPTIONS FUNCTIONS =====

  /**
   * Get available spell options (attack/damage rolls)
   */
  function getSpellOptions(spell) {
    // Validate spell data first
    const validation = (typeof validateSpellData !== 'undefined') ? validateSpellData(spell) : { valid: true };

    // Detailed debug logging to trace damage data
    console.log(`🔮 getSpellOptions for "${spell.name}":`, {
      attackRoll: spell.attackRoll,
      damageRolls: spell.damageRolls,
      damageRollsLength: spell.damageRolls ? spell.damageRolls.length : 'undefined',
      damageRollsContent: JSON.stringify(spell.damageRolls),
      concentration: spell.concentration
    });

    const options = [];

    // Check for attack (exclude defensive spells which should never have attack button)
    const spellNameLower = (spell.name || '').toLowerCase();
    const isDefensiveSpell = spellNameLower === 'shield' ||
                              spellNameLower.startsWith('shield ') ||
                              spellNameLower === 'absorb elements' ||
                              spellNameLower === 'counterspell';
    if (spell.attackRoll && spell.attackRoll !== '(none)' && !isDefensiveSpell) {
      // Handle special flag from dicecloud.js that indicates we should use spell attack bonus
      let attackFormula = spell.attackRoll;
      if (attackFormula === 'use_spell_attack_bonus') {
        const attackBonus = getSpellAttackBonus();
        attackFormula = attackBonus >= 0 ? `1d20+${attackBonus}` : `1d20${attackBonus}`;
      }

      options.push({
        type: 'attack',
        label: '⚔️ Spell Attack',
        formula: attackFormula,
        icon: '⚔️',
        color: '#e74c3c'
      });
    }

    // Check for damage/healing rolls
    if (spell.damageRolls && spell.damageRolls.length > 0) {
      // Handle lifesteal spells specially (damage + healing based on damage dealt)
      if (spell.isLifesteal) {
        const damageRoll = spell.damageRolls.find(r => r.damageType && r.damageType.toLowerCase() !== 'healing');
        const healingRoll = spell.damageRolls.find(r => r.damageType && r.damageType.toLowerCase() === 'healing');

        if (damageRoll && healingRoll) {
          // Resolve formula for display
          let displayFormula = damageRoll.damage;
          if (displayFormula.includes('~target.level') && typeof characterData !== 'undefined' && characterData.level) {
            displayFormula = displayFormula.replace(/~target\.level/g, characterData.level);
          }
          if (typeof resolveVariablesInFormula !== 'undefined') {
            displayFormula = resolveVariablesInFormula(displayFormula);
          }
          if (typeof evaluateMathInFormula !== 'undefined') {
            displayFormula = evaluateMathInFormula(displayFormula);
          }

          // Format damage type
          let damageTypeLabel = '';
          if (damageRoll.damageType && damageRoll.damageType !== 'untyped') {
            damageTypeLabel = damageRoll.damageType.charAt(0).toUpperCase() + damageRoll.damageType.slice(1);
          }

          // Check healing formula to determine healing ratio
          const healingFormula = healingRoll.damage.toLowerCase();
          let healingRatio = 'full';
          if (healingFormula.includes('/ 2') || healingFormula.includes('*0.5') || healingFormula.includes('half')) {
            healingRatio = 'half';
          }

          options.push({
            type: 'lifesteal',
            label: `${displayFormula} ${damageTypeLabel} + Heal (${healingRatio})`,
            damageFormula: damageRoll.damage,
            healingFormula: healingRoll.damage,
            damageType: damageRoll.damageType,
            healingRatio: healingRatio,
            icon: '💉',
            color: 'linear-gradient(135deg, #c0392b 0%, #27ae60 100%)'
          });
        }
      } else {
        // Normal spells - show separate buttons for each damage/healing type
        spell.damageRolls.forEach((roll, index) => {
          // Skip rolls that are part of an OR group (they'll be represented by the main roll)
          if (roll.isOrGroupMember) {
            return;
          }

          const isHealing = roll.damageType && roll.damageType.toLowerCase() === 'healing';
          const isTempHP = roll.damageType && (
            roll.damageType.toLowerCase() === 'temphp' ||
            roll.damageType.toLowerCase() === 'temporary' ||
            roll.damageType.toLowerCase().includes('temp')
          );

          // Resolve non-slot-dependent variables for display (character level, ability mods, etc.)
          // Keep slotLevel as-is since we don't know what slot will be used yet
          let displayFormula = roll.damage;

          // Replace ~target.level with character level (for cantrips like Toll the Dead)
          if (displayFormula.includes('~target.level') && typeof characterData !== 'undefined' && characterData.level) {
            displayFormula = displayFormula.replace(/~target\.level/g, characterData.level);
          }

          if (typeof resolveVariablesInFormula !== 'undefined') {
            displayFormula = resolveVariablesInFormula(displayFormula);
          }
          if (typeof evaluateMathInFormula !== 'undefined') {
            displayFormula = evaluateMathInFormula(displayFormula);
          }

          // If this roll has OR choices, create separate buttons for each choice
          if (roll.orChoices && roll.orChoices.length > 1) {
            roll.orChoices.forEach(choice => {
              // Format damage type nicely
              let damageTypeLabel = '';
              if (choice.damageType && choice.damageType !== 'untyped') {
                damageTypeLabel = choice.damageType.charAt(0).toUpperCase() + choice.damageType.slice(1);
              }

              const label = damageTypeLabel ? `${displayFormula} ${damageTypeLabel}` : displayFormula;

              const choiceIsTempHP = choice.damageType === 'temphp' || choice.damageType === 'temporary' ||
                                      (choice.damageType && choice.damageType.toLowerCase().includes('temp'));

              options.push({
                type: choiceIsTempHP ? 'temphp' : (isHealing ? 'healing' : 'damage'),
                label: label,
                formula: roll.damage,
                damageType: choice.damageType,
                index: index,
                icon: choiceIsTempHP ? '🛡️' : (isHealing ? '💚' : '💥'),
                color: choiceIsTempHP ? '#3498db' : (isHealing ? '#27ae60' : '#e67e22')
              });
            });
          } else {
            // Single damage type - create one button
            // Format damage type nicely
            let damageTypeLabel = '';
            if (roll.damageType && roll.damageType !== 'untyped') {
              // Capitalize first letter
              damageTypeLabel = roll.damageType.charAt(0).toUpperCase() + roll.damageType.slice(1);
            }

            // Build label: formula + damage type
            const label = damageTypeLabel ? `${displayFormula} ${damageTypeLabel}` : displayFormula;

            options.push({
              type: isTempHP ? 'temphp' : (isHealing ? 'healing' : 'damage'),
              label: label,
              formula: roll.damage, // Keep original formula for actual rolling
              damageType: roll.damageType,
              index: index,
              icon: isTempHP ? '🛡️' : (isHealing ? '💚' : '💥'),
              color: isTempHP ? '#3498db' : (isHealing ? '#27ae60' : '#e67e22')
            });
          }
        });
      }
    }

    // Log options before edge case modifications
    console.log(`📋 getSpellOptions "${spell.name}" - options before edge cases:`, options.map(o => `${o.type}: ${o.label}`));

    // If spell has BOTH attack AND damage options, add a "Cast Spell" button first
    // This allows users to cast the spell (consume slot) without immediately rolling attack or damage
    const hasAttack = options.some(opt => opt.type === 'attack');
    const hasDamage = options.some(opt => opt.type === 'damage' || opt.type === 'healing');
    if (hasAttack && hasDamage) {
      options.unshift({
        type: 'cast',
        label: 'Cast Spell',
        icon: '✨',
        color: '#9b59b6',
        edgeCaseNote: 'Cast without rolling - then click Attack or Damage'
      });
    }

    // Apply edge case modifications
    const result = (typeof applyEdgeCaseModifications !== 'undefined') ?
      applyEdgeCaseModifications(spell, options) :
      { options, skipNormalButtons: false };

    console.log(`📋 getSpellOptions "${spell.name}" - final options:`, result.options?.map(o => `${o.type}: ${o.label}`), 'skipNormalButtons:', result.skipNormalButtons);
    return result;
  }

  /**
   * Handle spell option click (attack, damage, healing, etc.)
   */
  function handleSpellOption(spell, spellIndex, option) {
    if (option.type === 'attack') {
      // Cast spell + roll attack
      const afterCast = (spell, slot) => {
        const attackBonus = getSpellAttackBonus();
        const attackFormula = attackBonus >= 0 ? `1d20+${attackBonus}` : `1d20${attackBonus}`;
        if (typeof roll !== 'undefined') {
          roll(`${spell.name} - Spell Attack`, attackFormula);
        }
      };
      if (typeof castSpell !== 'undefined') {
        castSpell(spell, spellIndex, afterCast);
      }
    } else if (option.type === 'damage' || option.type === 'healing') {
      // Handle OR choices if present
      let damageType = option.damageType;
      if (option.orChoices && option.orChoices.length > 1) {
        const choiceText = option.orChoices.map((c, i) => `${i + 1}. ${c.damageType}`).join('\n');
        const choice = prompt(`Choose damage type for ${spell.name}:\n${choiceText}\n\nEnter number (1-${option.orChoices.length}):`);

        if (choice === null) return; // User cancelled

        const choiceIndex = parseInt(choice) - 1;
        if (choiceIndex >= 0 && choiceIndex < option.orChoices.length) {
          damageType = option.orChoices[choiceIndex].damageType;
        } else {
          alert(`Invalid choice. Please try again.`);
          return;
        }
      }

      // Cast spell + roll damage/healing
      const afterCast = (spell, slot) => {
        let formula = option.formula;
        // Replace slotLevel with actual slot level (case-insensitive)
        if (slot && slot.level) {
          formula = formula.replace(/slotlevel/gi, slot.level);
        }
        // Resolve other DiceCloud variables
        if (typeof resolveVariablesInFormula !== 'undefined') {
          formula = resolveVariablesInFormula(formula);
        }
        // Evaluate simple math expressions
        if (typeof evaluateMathInFormula !== 'undefined') {
          formula = evaluateMathInFormula(formula);
        }

        const label = option.type === 'healing' ?
          `${spell.name} - Healing` :
          (damageType ? `${spell.name} - Damage (${damageType})` : `${spell.name} - Damage`);

        if (typeof roll !== 'undefined') {
          roll(label, formula);
        }
      };

      if (typeof castSpell !== 'undefined') {
        castSpell(spell, spellIndex, afterCast);
      }
    }
  }

  // ===== CUSTOM MACRO SYSTEM =====

  /**
   * Get custom macros for a spell
   */
  function getCustomMacros(spellName) {
    if (typeof characterData === 'undefined' || !characterData) return null;
    const key = `customMacros_${characterData.name}`;
    const allMacros = JSON.parse(localStorage.getItem(key) || '{}');
    return allMacros[spellName] || null;
  }

  /**
   * Save custom macros for a spell
   */
  function saveCustomMacros(spellName, macros) {
    if (typeof characterData === 'undefined' || !characterData) return;
    const key = `customMacros_${characterData.name}`;
    const allMacros = JSON.parse(localStorage.getItem(key) || '{}');

    if (macros && macros.buttons && macros.buttons.length > 0) {
      allMacros[spellName] = macros;
    } else {
      delete allMacros[spellName]; // Remove if no macros defined
    }

    localStorage.setItem(key, JSON.stringify(allMacros));
    debug.log(`💾 Saved custom macros for "${spellName}":`, macros);
  }

  // ===== EXPORTS =====

  globalThis.getSpellcastingAbilityMod = getSpellcastingAbilityMod;
  globalThis.getSpellAttackBonus = getSpellAttackBonus;
  globalThis.announceSpellDescription = announceSpellDescription;
  globalThis.announceSpellCast = announceSpellCast;
  globalThis.getAvailableMetamagic = getAvailableMetamagic;
  globalThis.getSpellOptions = getSpellOptions;
  globalThis.handleSpellOption = handleSpellOption;
  globalThis.getCustomMacros = getCustomMacros;
  globalThis.saveCustomMacros = saveCustomMacros;

})();
