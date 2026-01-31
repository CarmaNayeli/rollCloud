/**
 * Spell Cards Module
 *
 * Handles spell card creation, validation, and option generation.
 * - Creates interactive spell card UI elements
 * - Validates spell data structure
 * - Generates spell options (attack, damage, healing, etc.)
 *
 * Loaded as a plain script (no ES6 modules) to export to globalThis.
 */

(function() {
  'use strict';

  /**
   * Create a spell card UI element
   * @param {object} spell - Spell object
   * @param {number} index - Spell index
   * @returns {HTMLElement} Spell card element
   */
  function createSpellCard(spell, index) {
    const card = document.createElement('div');
    card.className = 'spell-card';

    const header = document.createElement('div');
    header.className = 'spell-header';

    // Build tags string
    let tags = '';
    if (spell.concentration) {
      tags += '<span class="concentration-tag">🧠 Concentration</span>';
    }
    if (spell.ritual) {
      tags += `<button class="ritual-tag ritual-cast-btn" data-spell-index="${index}" style="padding: 4px 8px; background: #8e44ad; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; transition: background 0.2s;" onmouseover="this.style.background='#9b59b6'" onmouseout="this.style.background='#8e44ad'" title="Cast as ritual (no spell slot required)">📖 Ritual</button>`;
    }

    // All spells get a single Cast button that opens a modal with options
    const castButtonHTML = `<button class="cast-spell-modal-btn" data-spell-index="${index}" style="padding: 6px 12px; background: #9b59b6; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">✨ Cast</button>`;

    // Custom macro override button (for magic items and custom spells) - only shown if setting is enabled
    const overrideButtonHTML = (typeof showCustomMacroButtons !== 'undefined' && showCustomMacroButtons)
      ? `<button class="custom-macro-btn" data-spell-index="${index}" style="padding: 6px 12px; background: #34495e; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;" title="Configure custom macros for this spell">⚙️</button>`
      : '';

    header.innerHTML = `
      <div>
        <span style="font-weight: bold;">${spell.name}</span>
        ${spell.level ? `<span style="margin-left: 10px; color: #666;">Level ${spell.level}</span>` : ''}
        ${tags}
      </div>
      <div style="display: flex; gap: 8px;">
        ${castButtonHTML}
        ${overrideButtonHTML}
        <button class="toggle-btn">▼ Details</button>
      </div>
    `;

    const desc = document.createElement('div');
    desc.className = 'spell-description';
    desc.id = `spell-desc-${index}`;

    const debug = window.debug || console;

    // Debug spell data
    if (spell.attackRoll || spell.damage) {
      debug.log(`📝 Spell "${spell.name}" has attack/damage:`, { attackRoll: spell.attackRoll, damage: spell.damage, damageType: spell.damageType });
    }

    // Build full description from summary and description fields
    let fullDescription = '';
    if (spell.summary && spell.description) {
      fullDescription = `${spell.summary}<br><br>${spell.description}`;
    } else if (spell.summary) {
      fullDescription = spell.summary;
    } else if (spell.description) {
      fullDescription = spell.description;
    }

    desc.innerHTML = `
      ${spell.castingTime ? `<div><strong>Casting Time:</strong> ${spell.castingTime}</div>` : ''}
      ${spell.range ? `<div><strong>Range:</strong> ${spell.range}</div>` : ''}
      ${spell.components ? `<div><strong>Components:</strong> ${spell.components}</div>` : ''}
      ${spell.duration ? `<div><strong>Duration:</strong> ${spell.duration}</div>` : ''}
      ${spell.school ? `<div><strong>School:</strong> ${spell.school}</div>` : ''}
      ${spell.source ? `<div><strong>Source:</strong> ${spell.source}</div>` : ''}
      ${fullDescription ? `<div style="margin-top: 10px;"><strong>Summary:</strong> ${fullDescription}</div>` : ''}
      ${spell.formula ? `<button class="roll-btn">🎲 Roll ${spell.formula}</button>` : ''}
    `;

    // Toggle functionality
    const toggleBtn = header.querySelector('.toggle-btn');
    header.addEventListener('click', (e) => {
      if (!e.target.classList.contains('roll-btn') &&
          !e.target.classList.contains('cast-spell-modal-btn') &&
          !e.target.classList.contains('ritual-cast-btn')) {
        desc.classList.toggle('expanded');
        toggleBtn.textContent = desc.classList.contains('expanded') ? '▲ Hide' : '▼ Details';
      }
    });

    // Roll button
    const rollBtn = desc.querySelector('.roll-btn');
    if (rollBtn && spell.formula && typeof roll === 'function') {
      rollBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        roll(spell.name, spell.formula);
      });
    }

    // Ritual cast button
    const ritualBtn = header.querySelector('.ritual-cast-btn');
    if (ritualBtn) {
      ritualBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        debug.log(`📖 Ritual cast button clicked for: ${spell.name}`);

        // Cast as ritual - no spell slot consumed
        if (typeof announceSpellDescription === 'function') {
          // Announce with ritual note
          const ritualSpell = { ...spell, name: `${spell.name} (Ritual)` };
          announceSpellDescription(ritualSpell);
        }

        // Cast spell with skipSlotConsumption = true for rituals
        if (typeof castSpell === 'function') {
          castSpell(spell, index, null, spell.level, [], true, true); // skipSlotConsumption = true, skipAnnouncement = true
        } else {
          debug.error('❌ castSpell function not available');
          if (typeof showNotification === 'function') {
            showNotification('❌ Cannot cast spell', 'error');
          }
        }
      });
    }

    // Cast spell modal button
    const castModalBtn = header.querySelector('.cast-spell-modal-btn');
    if (castModalBtn) {
      castModalBtn.addEventListener('click', (e) => {
        e.stopPropagation();

        // Check for Divine Smite special handling
        if (spell.name.toLowerCase().includes('divine smite')) {
          debug.log(`⚡ Divine Smite cast button clicked: ${spell.name}, showing custom modal`);
          if (typeof announceSpellDescription === 'function') {
            announceSpellDescription(spell);
          }
          if (typeof showDivineSmiteModal === 'function') {
            showDivineSmiteModal(spell);
          }
          return;
        }

        // Check for Lay on Hands: Heal special handling
        const normalizedSpellName = spell.name.toLowerCase()
          .replace(/[^a-z0-9\s:]/g, '') // Remove special chars except colon and space
          .replace(/\s+/g, ' ') // Normalize spaces
          .trim();
        const normalizedSearch = 'lay on hands: heal';

        if (normalizedSpellName === normalizedSearch) {
          debug.log(`💚 Lay on Hands: Heal cast button clicked: ${spell.name}, showing custom modal`);
          debug.log(`💚 Normalized match: "${normalizedSpellName}" === "${normalizedSearch}"`);
          if (typeof announceSpellDescription === 'function') {
            announceSpellDescription(spell);
          }
          if (typeof getLayOnHandsResource === 'function') {
            const layOnHandsPool = getLayOnHandsResource();
            if (layOnHandsPool && typeof showLayOnHandsModal === 'function') {
              showLayOnHandsModal(layOnHandsPool);
            } else if (typeof showNotification === 'function') {
              showNotification('❌ No Lay on Hands pool resource found', 'error');
            }
          }
          return;
        }

        // Fallback: Catch ANY Lay on Hands action for debugging
        if (spell.name.toLowerCase().includes('lay on hands')) {
          debug.log(`🚨 FALLBACK: Caught Lay on Hands spell: "${spell.name}"`);
          debug.log(`🚨 This spell didn't match 'lay on hands: heal' but contains 'lay on hands'`);
          debug.log(`🚨 Showing modal anyway for debugging`);
          if (typeof announceSpellDescription === 'function') {
            announceSpellDescription(spell);
          }
          if (typeof getLayOnHandsResource === 'function') {
            const layOnHandsPool = getLayOnHandsResource();
            if (layOnHandsPool && typeof showLayOnHandsModal === 'function') {
              showLayOnHandsModal(layOnHandsPool);
            } else if (typeof showNotification === 'function') {
              showNotification('❌ No Lay on Hands pool resource found', 'error');
            }
          }
          return;
        }

        const spellOptionsResult = getSpellOptions(spell);
        const options = spellOptionsResult.options;

        // Check if this is a "too complicated" spell that should only announce
        if (spellOptionsResult.skipNormalButtons) {
          if (typeof announceSpellDescription === 'function') {
            announceSpellDescription(spell);
          }
          if (typeof castSpell === 'function') {
            castSpell(spell, index, null, null, [], false, true); // skipAnnouncement = true
          }
          return;
        }

        if (options.length === 0) {
          // No rolls - announce description and cast immediately
          if (typeof announceSpellDescription === 'function') {
            announceSpellDescription(spell);
          }
          if (typeof castSpell === 'function') {
            castSpell(spell, index, null, null, [], false, true); // skipAnnouncement = true
          }
        } else {
          // Has rolls - show modal with options
          // Check if concentration recast option will exist in modal
          const hasConcentrationRecast = spell.concentration && typeof concentratingSpell !== 'undefined' && concentratingSpell === spell.name;

          if (!hasConcentrationRecast) {
            // No concentration recast option - announce description immediately
            if (typeof announceSpellDescription === 'function') {
              announceSpellDescription(spell);
            }
            if (typeof showSpellModal === 'function') {
              showSpellModal(spell, index, options, true); // descriptionAnnounced = true
            }
          } else {
            // Has concentration recast - announce from modal button handlers
            if (typeof showSpellModal === 'function') {
              showSpellModal(spell, index, options, false); // descriptionAnnounced = false
            }
          }
        }
      });
    }

    // Custom macro override button
    const customMacroBtn = header.querySelector('.custom-macro-btn');
    if (customMacroBtn && typeof showCustomMacroModal === 'function') {
      customMacroBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        showCustomMacroModal(spell, index);
      });
    }

    card.appendChild(header);
    card.appendChild(desc);
    return card;
  }

  /**
   * Validate spell data and log any issues
   * Cross-checks parsed data against spell description
   * @param {object} spell - Spell object
   * @returns {object} Validation result with valid flag, issues, and warnings
   */
  function validateSpellData(spell) {
    const issues = [];
    const warnings = [];

    // Check if spell has children data
    if (!spell.damageRolls && !spell.attackRoll) {
      console.log(`ℹ️ Spell "${spell.name}" has no attack or damage data (utility spell)`);
      return { valid: true, issues: [], warnings: [] };
    }

    // Validate attack roll
    if (spell.attackRoll && spell.attackRoll !== '(none)') {
      if (typeof spell.attackRoll !== 'string' || spell.attackRoll.trim() === '') {
        issues.push(`Attack roll is invalid: ${spell.attackRoll}`);
      }
    }

    // Validate damage rolls
    if (spell.damageRolls && Array.isArray(spell.damageRolls)) {
      spell.damageRolls.forEach((roll, index) => {
        if (!roll.damage) {
          issues.push(`Damage roll ${index} missing formula`);
        } else if (typeof roll.damage !== 'string' || roll.damage.trim() === '') {
          issues.push(`Damage roll ${index} has invalid formula: ${roll.damage}`);
        }

        if (!roll.damageType) {
          warnings.push(`Damage roll ${index} missing damage type (will show as "untyped")`);
        }

        // Check for dice notation
        const hasDice = /d\d+/i.test(roll.damage);
        if (!hasDice) {
          warnings.push(`Damage roll "${roll.damage}" doesn't contain dice notation - might be a variable reference`);
        }
      });
    }

    // Cross-check against description
    const description = (spell.description || '').toLowerCase();
    const summary = (spell.summary || '').toLowerCase();
    const fullText = `${summary} ${description}`;

    if (fullText) {
      // Check for attack mention (use word boundaries to avoid false positives like Shield's "triggering attack")
      const hasAttackMention = /\b(spell attack|attack roll)\b/i.test(fullText);
      const hasAttackData = spell.attackRoll && spell.attackRoll !== '(none)';

      if (hasAttackMention && !hasAttackData) {
        warnings.push(`Description mentions attack but no attack roll found`);
      } else if (!hasAttackMention && hasAttackData) {
        warnings.push(`Has attack roll but description doesn't mention attack`);
      }

      // Check for damage mention
      const damageMentions = fullText.match(/(\d+d\d+)/g);
      const hasDamageMention = damageMentions && damageMentions.length > 0;
      const hasDamageData = spell.damageRolls && spell.damageRolls.length > 0;

      if (hasDamageMention && !hasDamageData) {
        warnings.push(`Description mentions ${damageMentions.join(', ')} but no damage rolls found`);
      } else if (hasDamageData && !hasDamageMention) {
        // This is fine - description might use variables like "spell level" instead of exact dice
        console.log(`ℹ️ "${spell.name}" has ${spell.damageRolls.length} damage rolls but description doesn't show explicit dice`);
      }
    }

    if (issues.length > 0) {
      console.warn(`❌ Validation issues for spell "${spell.name}":`, issues);
    }

    if (warnings.length > 0) {
      console.warn(`⚠️ Validation warnings for spell "${spell.name}":`, warnings);
    }

    if (issues.length === 0 && warnings.length === 0) {
      console.log(`✅ Spell "${spell.name}" validated successfully`);
    }

    return { valid: issues.length === 0, issues, warnings };
  }

  /**
   * Get available spell options (attack/damage rolls)
   * @param {object} spell - Spell object
   * @returns {object} Options object with options array and skipNormalButtons flag
   */
  function getSpellOptions(spell) {
    // Validate spell data first
    const validation = validateSpellData(spell);

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
      if (attackFormula === 'use_spell_attack_bonus' && typeof getSpellAttackBonus === 'function') {
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
          if (displayFormula.includes('~target.level') && characterData.level) {
            displayFormula = displayFormula.replace(/~target\.level/g, characterData.level);
          }
          if (typeof resolveVariablesInFormula === 'function') {
            displayFormula = resolveVariablesInFormula(displayFormula);
          }
          if (typeof evaluateMathInFormula === 'function') {
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
            color: 'linear-gradient(135deg, #c0392b 0%, #c2185b 100%)'
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
          let actualFormula = roll.damage; // Keep separate from display formula

          // Apply warlock invocation modifications to damage
          if (typeof getActiveInvocations === 'function' && typeof applyInvocationToDamage === 'function') {
            const activeInvocations = getActiveInvocations(characterData);
            if (activeInvocations.length > 0) {
              const modified = applyInvocationToDamage(spell.name, displayFormula, activeInvocations, characterData);
              if (modified.modified) {
                displayFormula = modified.display;
                actualFormula = modified.formula;
              }
            }
          }

          // Replace ~target.level with character level (for cantrips like Toll the Dead)
          if (displayFormula.includes('~target.level') && characterData.level) {
            displayFormula = displayFormula.replace(/~target\.level/g, characterData.level);
            actualFormula = actualFormula.replace(/~target\.level/g, characterData.level);
          }

          if (typeof resolveVariablesInFormula === 'function') {
            displayFormula = resolveVariablesInFormula(displayFormula);
          }
          if (typeof evaluateMathInFormula === 'function') {
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
                formula: actualFormula, // Use actualFormula which includes Agonizing Blast modifier
                damageType: choice.damageType,
                index: index,
                icon: choiceIsTempHP ? '🛡️' : (isHealing ? '💚' : '💥'),
                color: choiceIsTempHP ? '#3498db' : (isHealing ? '#c2185b' : '#e67e22')
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
              formula: actualFormula, // Use actualFormula which includes Agonizing Blast modifier
              damageType: roll.damageType,
              index: index,
              icon: isTempHP ? '🛡️' : (isHealing ? '💚' : '💥'),
              color: isTempHP ? '#3498db' : (isHealing ? '#c2185b' : '#e67e22')
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
    const result = typeof applyEdgeCaseModifications === 'function'
      ? applyEdgeCaseModifications(spell, options)
      : { options, skipNormalButtons: false };

    console.log(`📋 getSpellOptions "${spell.name}" - final options:`, result.options?.map(o => `${o.type}: ${o.label}`), 'skipNormalButtons:', result.skipNormalButtons);
    return result;
  }

  // Export functions to globalThis
  Object.assign(globalThis, {
    createSpellCard,
    validateSpellData,
    getSpellOptions
  });

  console.log('✅ Spell Cards module loaded');

})();
