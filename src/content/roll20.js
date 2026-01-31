/**
 * Roll20 Content Script
 * Handles roll announcements and character sheet overlay
 */

(function() {
  'use strict';

  debug.log('RollCloud: Roll20 content script loaded');

  /**
   * Posts a message to Roll20 chat
   * Uses Firefox-compatible event handling to avoid CSP/security issues
   */
  function postChatMessage(message) {
    try {
      // Find the chat input textarea
      const chatInput = document.querySelector('#textchat-input textarea');
      if (!chatInput) {
        debug.error('❌ Could not find Roll20 chat input textarea (#textchat-input textarea)');
        return false;
      }

      debug.log('📝 Setting chat input value:', message.substring(0, 80) + (message.length > 80 ? '...' : ''));
      chatInput.focus();

      // Use native property descriptor to set value (more compatible with frameworks)
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value'
      ).set;
      nativeInputValueSetter.call(chatInput, message);

      // Firefox-compatible event dispatch using cloneInto if available
      // This properly transfers event options to the page's context
      try {
        if (typeof cloneInto === 'function') {
          // Firefox: Use cloneInto to create events in page context
          const eventInit = cloneInto({ bubbles: true, cancelable: true }, window);
          chatInput.dispatchEvent(new window.wrappedJSObject.Event('input', eventInit));
          chatInput.dispatchEvent(new window.wrappedJSObject.Event('change', eventInit));
        } else {
          // Chrome/other browsers: Standard event dispatch
          chatInput.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
          chatInput.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
        }
      } catch (eventError) {
        // If event dispatch fails entirely, log but continue - button click should still work
        debug.warn('⚠️ Event dispatch encountered an error (non-fatal):', eventError.message);
      }

      // Find and click the send button
      const sendButton = document.querySelector('#textchat-input .btn');
      if (!sendButton) {
        debug.error('❌ Could not find Roll20 chat send button (#textchat-input .btn)');
        return false;
      }

      sendButton.click();
      debug.log('✅ Message posted to Roll20 chat');
      return true;
    } catch (error) {
      debug.error('❌ Error posting to Roll20 chat:', error);
      return false;
    }
  }

  /**
   * Handles roll messages from Dice Cloud
   * Wrapped in try-catch to ensure one failure doesn't break subsequent rolls
   */
  function handleDiceCloudRoll(rollData) {
    try {
      debug.log('🎲 Handling roll:', rollData);
      debug.log('🎲 Roll data keys:', Object.keys(rollData || {}));
      if (rollData && rollData.source === 'discord') {
        debug.log('📡 Roll originated from Discord command');
      }

      // Validate rollData exists
      if (!rollData) {
        debug.error('❌ No roll data provided');
        return { success: false, error: 'No roll data provided' };
      }

      // Use pre-formatted message if it exists (for spells, actions, etc.)
      // Otherwise format the roll data
      let formattedMessage;
      try {
        formattedMessage = rollData.message || formatRollForRoll20(rollData);
      } catch (formatError) {
        debug.error('❌ Error formatting roll:', formatError);
        formattedMessage = `&{template:default} {{name=${rollData.name || 'Roll'}}} {{Roll=[[${rollData.formula || '1d20'}]]}}`;
      }
      debug.log('🎲 Formatted message:', formattedMessage);

      const success = postChatMessage(formattedMessage);

      if (success) {
        debug.log('✅ Roll successfully posted to Roll20');

        // Wait for Roll20 to process the roll and add it to chat
        // Then parse the actual Roll20 result (not DiceCloud's roll)
        try {
          observeNextRollResult(rollData);
        } catch (observeError) {
          // Non-fatal - roll was posted, just couldn't observe result
          debug.warn('⚠️ Could not set up roll observer:', observeError.message);
        }
        return { success: true };
      } else {
        debug.error('❌ Failed to post roll to Roll20 - chat input or send button not found');
        return { success: false, error: 'Roll20 chat not ready. Make sure you are in a Roll20 game.' };
      }
    } catch (error) {
      debug.error('❌ Unexpected error in handleDiceCloudRoll:', error);
      return { success: false, error: 'Unexpected error: ' + error.message };
    }
  }

  /**
   * Observes Roll20 chat for the next roll result and checks for natural 1s/20s
   */
  function observeNextRollResult(originalRollData) {
    debug.log('👀 Setting up observer for Roll20 roll result...');

    const chatLog = document.querySelector('#textchat .content');
    if (!chatLog) {
      debug.error('❌ Could not find Roll20 chat log');
      return;
    }

    // Create observer to watch for new messages
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            // Check if this is a message with an inline roll
            const inlineRoll = node.querySelector('.inlinerollresult');
            if (inlineRoll) {
              debug.log('🎲 Found new Roll20 inline roll:', inlineRoll);

              // Parse the roll result from Roll20's display
              const rollResult = parseRoll20InlineRoll(inlineRoll, originalRollData);

              if (rollResult) {
                debug.log('🎲 Parsed Roll20 roll result:', rollResult);

                // Check for natural 1s or 20s
                if (rollResult.baseRoll === 1 || rollResult.baseRoll === 20) {
                  const rollType = rollResult.baseRoll === 1 ? 'Natural 1' : 'Natural 20';
                  debug.log(`🎯 ${rollType} detected in Roll20 roll!`);

                  // Send to popup for racial trait checking
                  browserAPI.runtime.sendMessage({
                    action: 'rollResult',
                    rollResult: rollResult.total.toString(),
                    baseRoll: rollResult.baseRoll.toString(),
                    rollType: originalRollData.formula,
                    rollName: originalRollData.name,
                    checkRacialTraits: true
                  });

                  debug.log(`🧬 Sent ${rollType} result to popup`);
                }
              }

              // Disconnect after processing first roll
              observer.disconnect();
              break;
            }
          }
        }
      }
    });

    // Start observing
    observer.observe(chatLog, { childList: true, subtree: true });
    debug.log('✅ Observer set up for Roll20 chat');

    // Auto-disconnect after 5 seconds to prevent memory leaks
    setTimeout(() => {
      observer.disconnect();
      debug.log('⏱️ Roll observer timed out and disconnected');
    }, 5000);
  }

  /**
   * Parses Roll20's inline roll result to extract the base d20 roll
   */
  function parseRoll20InlineRoll(inlineRollElement, originalRollData) {
    try {
      // Roll20 inline rolls have a title attribute with the full roll breakdown
      // e.g., "Rolling 1d20+5 = (<span class="basicdiceroll">17</span>)+5"
      const title = inlineRollElement.getAttribute('title') || '';
      debug.log('📊 Roll20 inline roll title:', title);

      // Strip HTML tags from the title to get plain text
      const plainTitle = title.replace(/<[^>]*>/g, '');
      debug.log('📊 Plain title:', plainTitle);

      // Extract the base roll from parentheses in the title
      // Format after stripping HTML: "Rolling 1d20+5 = (17)+5" or "Rolling 1d20 = (1)"
      const baseRollMatch = plainTitle.match(/=\s*\(\s*(\d+)\s*\)/);
      const baseRoll = baseRollMatch ? parseInt(baseRollMatch[1]) : null;

      // Get the total from the visible text
      const totalText = inlineRollElement.textContent?.trim() || '';
      const total = parseInt(totalText);

      debug.log(`📊 Extracted: baseRoll=${baseRoll}, total=${total}`);

      // Only return if we successfully extracted a d20 roll (1-20)
      if (baseRoll && baseRoll >= 1 && baseRoll <= 20) {
        return {
          baseRoll: baseRoll,
          total: total,
          formula: originalRollData.formula,
          name: originalRollData.name
        };
      }

      return null;
    } catch (error) {
      debug.error('❌ Error parsing Roll20 inline roll:', error);
      return null;
    }
  }

  /**
   * Calculates the base d20 roll from formula and final result
   */
  function calculateBaseRoll(formula, result) {
    try {
      debug.log(`🧮 Calculating base roll - Formula: "${formula}", Result: "${result}"`);
      
      // Parse the formula to extract the modifier
      // Formula format: "1d20+X" or "1d20-X"
      const modifierMatch = formula.match(/1d20([+-]\d+)/i);
      
      if (modifierMatch) {
        const modifier = parseInt(modifierMatch[1]);
        const totalResult = parseInt(result);
        const baseRoll = totalResult - modifier;
        
        debug.log(`🧮 Calculation: ${totalResult} - (${modifier}) = ${baseRoll}`);
        
        // Ensure the base roll is within valid d20 range (1-20)
        if (baseRoll >= 1 && baseRoll <= 20) {
          return baseRoll;
        } else {
          debug.warn(`⚠️ Calculated base roll ${baseRoll} is outside valid d20 range (1-20)`);
          return baseRoll; // Still return it, but log warning
        }
      } else {
        // No modifier found, assume the result is the base roll
        debug.log(`🧮 No modifier found in formula, using result as base roll: ${result}`);
        return parseInt(result);
      }
    } catch (error) {
      debug.error('❌ Error calculating base roll:', error);
      return parseInt(result); // Fallback to using the result directly
    }
  }

  /**
   * Checks Roll20's inline roll elements for natural 1s
   */
  function checkRoll20InlineRolls(characterName) {
    debug.log('🔍 Checking Roll20 inline rolls for natural 1s for:', characterName);
    
    // Find all inline roll elements
    const inlineRolls = document.querySelectorAll('.inlinerollresult, .rollresult');
    debug.log(`🔍 Found ${inlineRolls.length} inline roll elements`);
    
    inlineRolls.forEach((rollElement, index) => {
      try {
        // Get the roll data from Roll20's inline roll system
        const rollData = getRoll20RollData(rollElement);
        debug.log(`🔍 Checking inline roll ${index + 1}:`, rollData);
        
        if (rollData && rollData.baseRoll === 1 && rollData.name.includes(characterName)) {
          debug.log('🍀 Natural 1 detected in Roll20 inline roll!');
          debug.log('🍀 Roll data:', rollData);
          
          // Send message to popup for Halfling Luck
          browserAPI.runtime.sendMessage({
            action: 'rollResult',
            rollResult: rollData.total.toString(),
            baseRoll: rollData.baseRoll.toString(),
            rollType: rollData.formula,
            rollName: rollData.name,
            checkRacialTraits: true
          });
          
          debug.log('🧬 Sent natural 1 result to popup for Halfling Luck');
        }
      } catch (error) {
        debug.warn('⚠️ Error checking inline roll:', error);
      }
    });
    
    debug.log('🔍 Finished checking inline rolls');
  }

  /**
   * Extracts roll data from Roll20's inline roll elements
   */
  function getRoll20RollData(rollElement) {
    try {
      // Roll20 stores roll data in the element's dataset or in a script tag
      const rollName = rollElement.closest('.message')?.querySelector('.message-name')?.textContent || 
                     rollElement.closest('.message')?.textContent?.split('\n')[0]?.trim() || '';
      
      // Try to get the roll formula from the inline roll
      const formulaElement = rollElement.querySelector('.formula') || rollElement;
      const formula = formulaElement.textContent?.trim() || '';
      
      // Look for the base roll value in the roll details
      const rollDetails = rollElement.textContent || rollElement.innerText || '';
      const baseRollMatch = rollDetails.match(/^(\d+)/);
      const baseRoll = baseRollMatch ? parseInt(baseRollMatch[1]) : null;
      
      // Look for the total result
      const totalMatch = rollDetails.match(/(\d+)\s*$/);
      const total = totalMatch ? parseInt(totalMatch[1]) : baseRoll;
      
      debug.log(`🔍 Extracted roll data - Name: ${rollName}, Formula: ${formula}, Base: ${baseRoll}, Total: ${total}`);
      
      return {
        name: rollName,
        formula: formula,
        baseRoll: baseRoll,
        total: total
      };
    } catch (error) {
      debug.warn('⚠️ Error extracting roll data:', error);
      return null;
    }
  }

  /**
   * Check if a character belongs to this tab's user
   * Used to filter Discord commands to prevent cross-user contamination
   */
  function isOurCharacter(characterName) {
    if (!characterName) return false;

    // Check if character is in our registered popups
    if (characterPopups && characterPopups[characterName]) {
      return true;
    }

    // Check if character is in our player data (GM panel)
    if (playerData && playerData[characterName]) {
      return true;
    }

    // If we have no characters registered yet, allow it through
    // (first-time setup or user hasn't opened sheets yet)
    const hasAnyCharacters = (characterPopups && Object.keys(characterPopups).length > 0) ||
                           (playerData && Object.keys(playerData).length > 0);

    if (!hasAnyCharacters) {
      debug.log(`✅ Allowing ${characterName} (no characters registered yet)`);
      return true;
    }

    return false;
  }

  /**
   * Get color emoji for character notification color (matches popup-sheet getColoredBanner)
   */
  function getColorEmoji(color) {
    const colorEmojiMap = {
      '#3498db': '🔵', // Blue
      '#e74c3c': '🔴', // Red
      '#27ae60': '🟢', // Green
      '#9b59b6': '🟣', // Purple
      '#e67e22': '🟠', // Orange
      '#f1c40f': '🟡', // Yellow
      '#95a5a6': '⚪', // Grey
      '#34495e': '⚫', // Black
      '#8b4513': '🟤'  // Brown
    };
    return colorEmojiMap[color] || '🔵';
  }

  /**
   * Formats roll data for Roll20 chat display with fancy template
   */
  function formatRollForRoll20(rollData) {
    const { name, formula, characterName, advantage, disadvantage, checkType, prerolledResult, color } = rollData;

    // Handle advantage/disadvantage for d20 rolls
    let rollFormula = formula;
    let rollType = '';

    if ((advantage || disadvantage) && formula.includes('d20')) {
      if (advantage && !disadvantage) {
        rollFormula = formula.replace('1d20', '2d20kh1'); // 2d20 keep highest
        rollType = ' (Advantage)';
      } else if (disadvantage && !advantage) {
        rollFormula = formula.replace('1d20', '2d20kl1'); // 2d20 keep lowest
        rollType = ' (Disadvantage)';
      }
    }

    // Get color emoji for character
    const colorEmoji = color ? getColorEmoji(color) : '';
    const colorPrefix = colorEmoji ? `${colorEmoji} ` : '';

    // Build character display name
    let displayName = name;
    if (characterName && !name.includes(characterName)) {
      displayName = `${colorPrefix}${characterName} - ${name}`;
    } else {
      displayName = `${colorPrefix}${name}`;
    }

    // If we have a prerolled result (e.g., from death saves), use it instead of rolling again
    if (prerolledResult !== null && prerolledResult !== undefined) {
      debug.log(`🎲 Using prerolled result: ${prerolledResult} instead of rolling ${rollFormula}`);
      return `&{template:default} {{name=${displayName}${rollType}}} {{Roll=${prerolledResult}}}`;
    }

    // Use Roll20's template system with inline rolls for fancy formatting
    // [[formula]] creates an inline roll that Roll20 will calculate
    return `&{template:default} {{name=${displayName}${rollType}}} {{Roll=[[${rollFormula}]]}}`;
  }

  /**
   * Normalizes popup/character sheet spell data into a common format for posting to Roll20
   * @param {Object} eventData - Raw spell data from popup sheet postMessage event
   * @returns {Object} Normalized spell data
   */
  function normalizePopupSpellData(eventData) {
    const spell = eventData.spellData || {};
    // Extract numeric level from "pact:X" format if needed
    let castLevel = eventData.castLevel || parseInt(spell.level) || 0;
    if (typeof castLevel === 'string' && castLevel.startsWith('pact:')) {
      castLevel = parseInt(castLevel.split(':')[1]) || 0;
    } else {
      castLevel = parseInt(castLevel) || 0;
    }
    const spellLevel = parseInt(spell.level) || 0;
    const characterName = eventData.characterName || 'Character';
    const notificationColor = eventData.color || eventData.notificationColor || '#3498db';

    return {
      // Basic spell info
      name: spell.name || eventData.spellName || 'Unknown Spell',
      characterName: characterName,
      level: spellLevel,
      castLevel: castLevel,
      school: spell.school,

      // Spell details
      castingTime: spell.castingTime,
      range: spell.range,
      duration: spell.duration,
      components: spell.components,
      source: spell.source,
      summary: spell.summary,
      description: spell.description,

      // Tags and modifiers
      concentration: spell.concentration,
      ritual: spell.ritual,
      isCantrip: spellLevel === 0,
      isFreecast: false,
      isUpcast: castLevel > spellLevel,

      // Metamagic and effects (popup doesn't send these yet, but prepared for future)
      metamagicUsed: eventData.metamagicUsed || [],
      effects: eventData.effects || [],

      // Resource usage (popup doesn't send these yet, but prepared for future)
      slotUsed: eventData.slotUsed,
      resourceChanges: eventData.resourceChanges || [],

      // Rolls (popup sends these separately via roll() function, but prepared for future)
      attackRoll: spell.attackRoll,
      damageRolls: spell.damageRolls || [],
      fallbackDamage: spell.damage,
      fallbackDamageType: spell.damageType,

      // Visual
      notificationColor: notificationColor
    };
  }

  /**
   * Normalizes Discord spell data into a common format for posting to Roll20
   * @param {Object} spellData - Raw spell data from Discord command
   * @returns {Object} Normalized spell data
   */
  function normalizeDiscordSpellData(spellData) {
    const spell = spellData.spell_data || spellData.spell || {};
    const castLevel = parseInt(spellData.cast_level) || parseInt(spell.level) || 0;
    const spellLevel = parseInt(spell.level) || 0;

    return {
      // Basic spell info
      name: spell.name || 'Unknown Spell',
      characterName: spellData.character_name || 'Character',
      level: spellLevel,
      castLevel: castLevel,
      school: spell.school,

      // Spell details
      castingTime: spell.castingTime || spell.casting_time,
      range: spell.range,
      duration: spell.duration,
      components: spell.components,
      source: spell.source,
      summary: spell.summary || spellData.summary,
      description: spell.description || spellData.description,

      // Tags and modifiers
      concentration: spell.concentration,
      ritual: spell.ritual,
      isCantrip: spellData.isCantrip || spellLevel === 0,
      isFreecast: spellData.isFreecast || false,
      isUpcast: spellData.isUpcast || castLevel > spellLevel,

      // Metamagic and effects
      metamagicUsed: spellData.metamagicUsed || [],
      effects: spellData.effects || [],

      // Resource usage
      slotUsed: spellData.slotUsed,
      resourceChanges: spellData.resourceChanges || [],

      // Rolls
      attackRoll: spell.attackRoll || spell.attack_roll,
      damageRolls: spellData.damageRolls || spellData.damage_rolls || [],
      fallbackDamage: spell.damage,
      fallbackDamageType: spell.damageType || spell.damage_type,

      // Visual - check multiple possible field names
      notificationColor: spellData.notification_color || spellData.notificationColor ||
                        spell.notification_color || spell.notificationColor || '#3498db'
    };
  }

  /**
   * Posts a spell to Roll20 chat with full formatting
   * Unified function that works regardless of source (Discord, character sheet, etc.)
   * @param {Object} normalizedSpellData - Normalized spell data from normalizeDiscordSpellData() or similar
   */
  function postSpellToRoll20(normalizedSpellData) {
    const {
      name,
      characterName,
      level,
      castLevel,
      school,
      castingTime,
      range,
      duration,
      components,
      source,
      summary,
      description,
      concentration,
      ritual,
      isCantrip,
      isFreecast,
      isUpcast,
      metamagicUsed,
      effects,
      slotUsed,
      resourceChanges,
      attackRoll,
      damageRolls,
      fallbackDamage,
      fallbackDamageType,
      notificationColor
    } = normalizedSpellData;

    // Get color emoji banner
    const colorEmoji = getColorEmoji(notificationColor);

    // Build tags string
    let tags = '';
    if (concentration) tags += ' 🧠 Concentration';
    if (ritual) tags += ' 📖 Ritual';
    if (metamagicUsed && metamagicUsed.length > 0) {
      const metamagicNames = metamagicUsed.map(m => m.name).join(', ');
      tags += ` ✨ ${metamagicNames}`;
    }
    if (isCantrip) tags += ' 🎯 Cantrip';
    if (isFreecast) tags += ' 🆓 Free Cast';
    if (isUpcast) tags += ` ⬆️ Upcast to Level ${castLevel}`;

    // Build announcement message
    let announcement = `&{template:default} {{name=${colorEmoji} ${characterName} casts ${name}!${tags}}}`;

    // Add spell level and school
    if (level > 0) {
      let levelText = `Level ${level}`;
      if (school) levelText += ` ${school}`;
      if (isUpcast) {
        levelText += ` (Upcast to Level ${castLevel})`;
      }
      announcement += ` {{Level=${levelText}}}`;
    } else if (school) {
      announcement += ` {{Level=${school} cantrip}}`;
    }

    // Add spell details
    if (castingTime) announcement += ` {{Casting Time=${castingTime}}}`;
    if (range) announcement += ` {{Range=${range}}}`;
    if (duration) announcement += ` {{Duration=${duration}}}`;
    if (components) announcement += ` {{Components=${components}}}`;
    if (source) announcement += ` {{Source=${source}}}`;

    // Add slot usage
    if (slotUsed && !isCantrip && !isFreecast) {
      announcement += ` {{Slot Used=${slotUsed.level} (${slotUsed.remaining}/${slotUsed.total} remaining)}}`;
    }

    // Add resource changes
    if (resourceChanges && resourceChanges.length > 0) {
      const resourceText = resourceChanges.map(change =>
        `${change.resource}: ${change.current}/${change.max}`
      ).join(', ');
      announcement += ` {{Resources=${resourceText}}}`;
    }

    // Add effects
    if (effects && effects.length > 0) {
      const effectsText = effects.map(effect => effect.description || effect.type).join(', ');
      announcement += ` {{Effects=${effectsText}}}`;
    }

    // Add summary and description
    if (summary) {
      announcement += ` {{Summary=${summary}}}`;
    }
    if (description) {
      announcement += ` {{Description=${description}}}`;
    }

    // Post the announcement
    postChatMessage(announcement);

    // Helper function to scale damage formula for upcasting
    const scaleFormulaForUpcast = (formula, baseLevel, actualCastLevel) => {
      if (!formula || baseLevel <= 0 || actualCastLevel <= baseLevel) return formula;

      // Replace slotLevel placeholder if present
      let scaledFormula = formula.replace(/slotLevel/gi, actualCastLevel);

      // If formula doesn't have slotLevel, try to scale it automatically
      if (scaledFormula === formula) {
        const levelDiff = actualCastLevel - baseLevel;
        const diceMatch = formula.match(/^(\d+)d(\d+)/);
        if (diceMatch && levelDiff > 0) {
          const baseDice = parseInt(diceMatch[1]);
          const dieSize = parseInt(diceMatch[2]);
          const scaledDice = baseDice + levelDiff;
          scaledFormula = formula.replace(/^(\d+)d(\d+)/, `${scaledDice}d${dieSize}`);
          debug.log(`📈 Scaled formula from ${formula} to ${scaledFormula} (upcast by ${levelDiff} levels)`);
        }
      }

      return scaledFormula;
    };

    // Roll attack if spell has attack roll
    if (attackRoll && attackRoll !== '(none)') {
      setTimeout(() => {
        try {
          const attackMsg = formatRollForRoll20({
            name: `${name} - Attack`,
            formula: attackRoll,
            characterName: characterName
          });
          postChatMessage(attackMsg);
        } catch (attackError) {
          debug.error(`❌ Failed to roll attack for ${name}:`, attackError);
          postChatMessage(`&{template:default} {{name=⚠️ Roll Failed}} {{error=Attack roll for ${name} failed: ${attackError.message}}}`);
        }
      }, 100);
    }

    // Roll damage(s) from damageRolls array - scale for upcasting
    if (damageRolls && Array.isArray(damageRolls) && damageRolls.length > 0) {
      damageRolls.forEach((roll, index) => {
        if (roll.damage) {
          setTimeout(() => {
            try {
              const damageType = roll.damageType || 'damage';
              const isHealing = damageType.toLowerCase() === 'healing';
              const isTempHP = damageType.toLowerCase().includes('temp');
              let rollName;
              if (isHealing) {
                rollName = `${name} - Healing`;
              } else if (isTempHP) {
                rollName = `${name} - Temp HP`;
              } else {
                rollName = roll.name || `${name} - ${damageType}`;
              }

              // Scale formula for upcasting
              const scaledFormula = scaleFormulaForUpcast(roll.damage, level, castLevel);

              const damageMsg = formatRollForRoll20({
                name: rollName,
                formula: scaledFormula,
                characterName: characterName
              });
              postChatMessage(damageMsg);
            } catch (damageError) {
              debug.error(`❌ Failed to roll damage for ${name}:`, damageError);
              postChatMessage(`&{template:default} {{name=⚠️ Roll Failed}} {{error=Damage roll ${index + 1} for ${name} failed: ${damageError.message}}}`);
            }
          }, 200 + (index * 100));
        }
      });
    } else if (fallbackDamage) {
      // Fallback to single damage field for backward compatibility
      setTimeout(() => {
        try {
          const damageType = fallbackDamageType || 'damage';
          const isHealing = damageType.toLowerCase() === 'healing';
          const rollName = isHealing ? `${name} - Healing` : `${name} - ${damageType}`;

          // Scale formula for upcasting
          const scaledFormula = scaleFormulaForUpcast(fallbackDamage, level, castLevel);

          const damageMsg = formatRollForRoll20({
            name: rollName,
            formula: scaledFormula,
            characterName: characterName
          });
          postChatMessage(damageMsg);
        } catch (damageError) {
          debug.error(`❌ Failed to roll damage for ${name}:`, damageError);
          postChatMessage(`&{template:default} {{name=⚠️ Roll Failed}} {{error=Damage roll for ${name} failed: ${damageError.message}}}`);
        }
      }, 200);
    }
  }

  /**
   * Listen for messages from other parts of the extension
   * Wrapped in try-catch to prevent one error from breaking subsequent message handling
   */
  browserAPI.runtime.onMessage.addListener((request, sender, sendResponse) => {
    try {
      debug.log('📨 Roll20 content script received message:', request.action, request);

      if (request.action === 'postRollToChat') {
        try {
          const result = handleDiceCloudRoll(request.roll);
          sendResponse(result || { success: true });
        } catch (rollError) {
          debug.error('❌ Error handling postRollToChat:', rollError);
          sendResponse({ success: false, error: rollError.message });
        }
        return true; // Keep message channel open
      } else if (request.action === 'sendRollToRoll20') {
      // Handle the message that Dice Cloud is actually sending
      debug.log('🎲 Received sendRollToRoll20 message:', request.roll);
      try {
        const result = handleDiceCloudRoll(request.roll);
        sendResponse(result || { success: true });
      } catch (rollError) {
        debug.error('❌ Error handling sendRollToRoll20:', rollError);
        sendResponse({ success: false, error: rollError.message || 'Failed to process roll' });
      }
      return true; // Keep message channel open
    } else if (request.action === 'rollFromPopout') {
      // Check if this is actually an announcement wrapped in rollFromPopout (Firefox relay path)
      if (request.roll && request.roll.action === 'announceSpell') {
        debug.log('✨ Detected announceSpell wrapped in rollFromPopout, routing to announcement handler');
        if (request.roll.message) {
          postChatMessage(request.roll.message);
          sendResponse({ success: true });
        } else if (request.roll.spellData) {
          const normalizedSpellData = normalizePopupSpellData(request.roll);
          postSpellToRoll20(normalizedSpellData);
          sendResponse({ success: true });
        }
        return true;
      }

      // Post roll directly to Roll20 - no DiceCloud needed!
      debug.log('🎲 Received roll request from popup:', request);

      const rollData = {
        name: request.name || request.roll?.name,
        formula: request.formula || request.roll?.formula,
        characterName: request.characterName || request.roll?.characterName,
        color: request.color || request.roll?.color
      };

      // Check if silent rolls mode is enabled - if so, hide the roll instead of posting
      if (silentRollsEnabled) {
        debug.log('🔇 Silent rolls active - hiding roll instead of posting');
        const hiddenRoll = {
          id: Date.now() + Math.random(), // Unique ID
          name: rollData.name,
          formula: rollData.formula,
          characterName: rollData.characterName,
          timestamp: new Date().toLocaleTimeString(),
          result: null // Will be filled when revealed
        };
        hiddenRolls.push(hiddenRoll);
        updateHiddenRollsDisplay();
        sendResponse({ success: true, hidden: true });
      } else {
        // Normal flow - post to Roll20 chat
        const formattedMessage = formatRollForRoll20(rollData);
        const success = postChatMessage(formattedMessage);

        if (success) {
          debug.log('✅ Roll posted directly to Roll20 (no DiceCloud!)');
          // Observe Roll20's result for natural 1s/20s
          observeNextRollResult(rollData);
        }

        sendResponse({ success: success });
      }
    } else if (request.action === 'announceSpell') {
      // Handle spell announcements relayed from background script (Firefox)
      if (request.spellData) {
        // New pathway: structured spell data from popup-sheet
        debug.log('🔮 Received structured spell data from background script:', request);
        const normalizedSpellData = normalizePopupSpellData(request);
        postSpellToRoll20(normalizedSpellData);
      } else if (request.message) {
        // Legacy pathway: pre-formatted message (for non-spell announcements)
        postChatMessage(request.message);
      } else {
        handleDiceCloudRoll(request);
      }
      sendResponse({ success: true });
    } else if (request.action === 'postChatMessageFromPopup') {
      // Handle character broadcast messages from popup
      if (request.message) {
        debug.log('📨 Received postChatMessageFromPopup:', request.message);
        const success = postChatMessage(request.message);
        sendResponse({ success: success });
      } else {
        debug.warn('⚠️ postChatMessageFromPopup missing message');
        sendResponse({ success: false, error: 'No message provided' });
      }
    } else if (request.action === 'testRoll20Connection') {
      // Test if we can access Roll20 chat
      const chatInput = document.querySelector('#textchat-input textarea');
      sendResponse({
        success: !!chatInput,
        message: chatInput ? 'Roll20 chat accessible' : 'Roll20 chat not found'
      });
    } else if (request.action === 'showCharacterSheet') {
      debug.log('🔍 showCharacterSheet called, checking playerData:', playerData);
      debug.log('🔍 playerData keys:', Object.keys(playerData || {}));

      // Check if there's any character data synced
      if (!playerData || Object.keys(playerData).length === 0) {
        debug.log('⚠️ No character data found - asking user about GM mode');

        // Ask user if they want to open GM mode
        const userConfirmed = confirm('No character data found.\n\nWould you like to open GM mode instead?');

        if (userConfirmed) {
          // User clicked "Yes" - open GM panel
          try {
            postChatMessage('👑 Opening GM mode...');
            debug.log('✅ Chat message posted successfully');
          } catch (error) {
            debug.error('❌ Error posting chat message:', error);
          }

          try {
            toggleGMMode(true);
            debug.log('✅ GM panel opened successfully');
          } catch (error) {
            debug.error('❌ Error opening GM panel:', error);
          }

          sendResponse({ success: true, message: 'GM mode opened' });
        } else {
          // User clicked "Cancel" - do nothing
          debug.log('ℹ️ User cancelled GM mode opening');
          sendResponse({ success: false, error: 'No character data found' });
        }
        return;
      }

      // Show the character sheet overlay
      try {
        // Try to access the character sheet overlay script
        // This will work if the overlay is already loaded
        const overlayElement = document.getElementById('rollcloud-character-overlay');
        if (overlayElement) {
          overlayElement.style.display = 'block';
          sendResponse({ success: true });
        } else {
          // Try to trigger the overlay creation
          const event = new CustomEvent('showRollCloudSheet');
          document.dispatchEvent(event);
          sendResponse({ success: true });
        }
      } catch (error) {
        debug.error('Error showing character sheet:', error);
        sendResponse({ success: false, error: error.message });
      }
    } else if (request.action === 'forwardToPopup') {
      // Forward roll result to popup for racial traits checking
      debug.log('🧬 Forwarding roll result to popup:', request);
      debug.log('🧬 Available popups:', Object.keys(characterPopups));
      
      // Send to all registered popup windows
      Object.keys(characterPopups).forEach(characterName => {
        const popup = characterPopups[characterName];
        try {
          if (popup && !popup.closed) {
            debug.log(`🧬 Sending to popup for ${characterName}:`, popup);
            popup.postMessage({
              action: 'rollResult',
              rollResult: request.rollResult,
              baseRoll: request.baseRoll,
              rollType: request.rollType,
              rollName: request.rollName,
              checkRacialTraits: request.checkRacialTraits
            }, '*');
            
            debug.log(`📤 Sent rollResult to popup for ${characterName}`);
          } else {
            // Clean up closed popups
            delete characterPopups[characterName];
            debug.log(`🗑️ Removed closed popup for ${characterName}`);
          }
        } catch (error) {
          debug.warn(`⚠️ Error sending rollResult to popup "${characterName}":`, error);
          delete characterPopups[characterName];
        }
      });

      sendResponse({ success: true });
    } else if (request.action === 'setAutoBackwardsSync') {
      // Handle auto backwards sync toggle from popup
      debug.log('🔄 Setting auto backwards sync:', request.enabled);

      // Check if diceCloudSync exists (experimental build)
      if (window.diceCloudSync) {
        if (request.enabled) {
          window.diceCloudSync.enable();
          debug.log('✅ Auto backwards sync enabled');
        } else {
          window.diceCloudSync.disable();
          debug.log('❌ Auto backwards sync disabled');
        }
        sendResponse({ success: true });
      } else {
        debug.warn('⚠️ diceCloudSync not available (not experimental build?)');
        sendResponse({ success: false, error: 'Sync not available' });
      }
    } else if (request.action === 'useActionFromDiscord') {
      try {
        debug.log('⚔️ Received useActionFromDiscord:', request);
        const actionName = request.actionName || 'Unknown Action';
        const commandData = request.commandData || {};
        const charName = commandData.character_name || 'Character';

        // SECURITY: Only process if this character belongs to this tab's user
        if (!isOurCharacter(charName)) {
          debug.log(`⏭️ Ignoring Discord action for ${charName} (not our character)`);
          sendResponse({ success: true, ignored: true });
          return true;
        }

        // Get action data - check multiple possible locations
        const actionData = commandData.action_data || commandData || {};
        debug.log('⚔️ Action data:', actionData);

        // Build announcement message
        let announcement = `&{template:default} {{name=${charName} uses ${actionData.name || actionName}!}}`;

        // Add action type if available
        if (actionData.actionType) {
          announcement += ` {{Type=${actionData.actionType}}}`;
        }

        // Add description if available
        if (actionData.description) {
          announcement += ` {{Description=${actionData.description}}}`;
        }

        // Post the announcement first
        postChatMessage(announcement);

        // Roll attack if action has attack roll (check both field names for compatibility)
        const attackRoll = actionData.attackRoll || actionData.attackBonus;
        if (attackRoll) {
          setTimeout(() => {
            // If it's just a number (bonus), format as d20+bonus
            const attackFormula = attackRoll.includes('d') ? attackRoll : `1d20+${attackRoll}`;
            const attackMsg = formatRollForRoll20({
              name: `${actionData.name || actionName} - Attack`,
              formula: attackFormula,
              characterName: charName
            });
            postChatMessage(attackMsg);
          }, 100);
        }

        // Roll damage if available (check both field names for compatibility)
        const damageRoll = actionData.damage || actionData.damageRoll;
        if (damageRoll) {
          setTimeout(() => {
            const damageType = actionData.damageType || 'damage';
            const damageMsg = formatRollForRoll20({
              name: `${actionData.name || actionName} - ${damageType}`,
              formula: damageRoll,
              characterName: charName
            });
            postChatMessage(damageMsg);
          }, 200);
        }

        sendResponse({ success: true });
      } catch (useActionError) {
        debug.error('❌ Error in useActionFromDiscord:', useActionError);
        sendResponse({ success: false, error: useActionError.message });
      }
    } else if (request.action === 'castSpellFromDiscord') {
      try {
        debug.log('🔮 Received castSpellFromDiscord:', request);

        // SECURITY: Only process if this character belongs to this tab's user
        const characterName = request.spellData?.character_name;
        if (characterName && !isOurCharacter(characterName)) {
          debug.log(`⏭️ Ignoring Discord spell for ${characterName} (not our character)`);
          sendResponse({ success: true, ignored: true });
          return true;
        }

        // Normalize the Discord spell data into common format
        const normalizedSpellData = normalizeDiscordSpellData(request.spellData || {});

        // Use the unified function to post to Roll20
        postSpellToRoll20(normalizedSpellData);

        sendResponse({ success: true });
      } catch (castError) {
        debug.error('❌ Error in castSpellFromDiscord:', castError);
        sendResponse({ success: false, error: castError.message });
      }
    } else if (request.action === 'useAbilityFromDiscord') {
      try {
        debug.log('✨ Received useAbilityFromDiscord:', request);
      const abilityName = request.abilityName || 'Unknown Ability';
      const abilityData = request.abilityData || {};
      const charName = abilityData.character_name || 'Character';

      // SECURITY: Only process if this character belongs to this tab's user
      if (!isOurCharacter(charName)) {
        debug.log(`⏭️ Ignoring Discord ability for ${charName} (not our character)`);
        sendResponse({ success: true, ignored: true });
        return true;
      }

      const action = abilityData.action_data || abilityData.action || {};
      const notificationColor = abilityData.notification_color || '#3498db';

      // Get color emoji banner (matches popup-sheet getColoredBanner)
      const colorEmoji = getColorEmoji(notificationColor);

      // Build action announcement (matches popup-sheet announceAction)
      let announcement = `&{template:default} {{name=${colorEmoji} ${charName} uses ${action.name || abilityName}!}}`;

      // Add action type
      if (action.actionType) {
        announcement += ` {{Type=${action.actionType}}}`;
      }

      // Add range if available
      if (action.range) {
        announcement += ` {{Range=${action.range}}}`;
      }

      // Add description if available
      if (action.description) {
        announcement += ` {{Description=${action.description}}}`;
      }

      // Post the announcement
      postChatMessage(announcement);

      // Roll attack if action has attack roll
      if (action.attackRoll || action.attackBonus) {
        setTimeout(() => {
          try {
            const attackFormula = action.attackRoll || `1d20+${action.attackBonus}`;
            const attackMsg = formatRollForRoll20({
              name: `${action.name || abilityName} - Attack`,
              formula: attackFormula,
              characterName: charName
            });
            postChatMessage(attackMsg);
          } catch (attackError) {
            debug.error(`❌ Failed to roll attack for ${action.name || abilityName}:`, attackError);
            postChatMessage(`&{template:default} {{name=⚠️ Roll Failed}} {{error=Attack roll for ${action.name || abilityName} failed: ${attackError.message}}}`);
          }
        }, 100);
      }

      // Roll damage if available
      if (action.damageRoll || action.damage) {
        setTimeout(() => {
          try {
            const damageFormula = action.damageRoll || action.damage;
            const damageType = action.damageType || 'damage';
            const isHealing = damageType.toLowerCase() === 'healing';
            const rollName = isHealing ? `${action.name || abilityName} - Healing` : `${action.name || abilityName} - ${damageType}`;
            const damageMsg = formatRollForRoll20({
              name: rollName,
              formula: damageFormula,
              characterName: charName
            });
            postChatMessage(damageMsg);
          } catch (damageError) {
            debug.error(`❌ Failed to roll damage for ${action.name || abilityName}:`, damageError);
            postChatMessage(`&{template:default} {{name=⚠️ Roll Failed}} {{error=Damage roll for ${action.name || abilityName} failed: ${damageError.message}}}`);
          }
        }, 200);
      }

        sendResponse({ success: true });
      } catch (abilityError) {
        debug.error('❌ Error in useAbilityFromDiscord:', abilityError);
        sendResponse({ success: false, error: abilityError.message });
      }
    } else if (request.action === 'healFromDiscord') {
      try {
        debug.log('💚 Received healFromDiscord:', request);
        const amount = request.amount || 0;
        const isTemp = request.isTemp || false;
        const charName = request.characterName || 'Character';

        // SECURITY: Only process if this character belongs to this tab's user
        if (!isOurCharacter(charName)) {
          debug.log(`⏭️ Ignoring Discord heal for ${charName} (not our character)`);
          sendResponse({ success: true, ignored: true });
          return true;
        }

        // Post announcement to Roll20 chat
        const healType = isTemp ? 'Temporary HP' : 'HP';
        const emoji = isTemp ? '🛡️' : '💚';
        const announcement = `&{template:default} {{name=${emoji} ${charName} ${isTemp ? 'gains' : 'is healed'}}} {{${healType}=+${amount}}}`;

        postChatMessage(announcement);
        sendResponse({ success: true });
      } catch (healError) {
        debug.error('❌ Error in healFromDiscord:', healError);
        sendResponse({ success: false, error: healError.message });
      }
    } else if (request.action === 'takeDamageFromDiscord') {
      try {
        debug.log('💔 Received takeDamageFromDiscord:', request);
        const amount = request.amount || 0;
        const damageType = request.damageType || 'untyped';
        const charName = request.characterName || 'Character';

        // SECURITY: Only process if this character belongs to this tab's user
        if (!isOurCharacter(charName)) {
          debug.log(`⏭️ Ignoring Discord damage for ${charName} (not our character)`);
          sendResponse({ success: true, ignored: true });
          return true;
        }

        // Post announcement to Roll20 chat
        const damageTypeDisplay = damageType !== 'untyped' ? ` (${damageType})` : '';
        const announcement = `&{template:default} {{name=💔 ${charName} takes damage}} {{Damage=${amount}${damageTypeDisplay}}}`;

        postChatMessage(announcement);
        sendResponse({ success: true });
      } catch (damageError) {
        debug.error('❌ Error in takeDamageFromDiscord:', damageError);
        sendResponse({ success: false, error: damageError.message });
      }
    } else if (request.action === 'restFromDiscord') {
      try {
        debug.log('🛏️ Received restFromDiscord:', request);
        const restType = request.restType || 'short';
        const charName = request.characterName || 'Character';

        // SECURITY: Only process if this character belongs to this tab's user
        if (!isOurCharacter(charName)) {
          debug.log(`⏭️ Ignoring Discord rest for ${charName} (not our character)`);
          sendResponse({ success: true, ignored: true });
          return true;
        }

        // Post announcement to Roll20 chat
        const emoji = restType === 'short' ? '☕' : '🛏️';
        const restName = restType === 'short' ? 'Short Rest' : 'Long Rest';
        const announcement = `&{template:default} {{name=${emoji} ${charName} takes a ${restName}}} {{Rest Type=${restName}}}`;

        postChatMessage(announcement);
        sendResponse({ success: true });
      } catch (restError) {
        debug.error('❌ Error in restFromDiscord:', restError);
        sendResponse({ success: false, error: restError.message });
      }
    } else if (request.action === 'endTurnFromDiscord') {
      try {
        debug.log('⏭️ Received endTurnFromDiscord');
        postChatMessage('/e ends their turn.');
        sendResponse({ success: true });
      } catch (endTurnError) {
        debug.error('❌ Error in endTurnFromDiscord:', endTurnError);
        sendResponse({ success: false, error: endTurnError.message });
      }
    }
    } catch (outerError) {
      // Catch any unexpected errors to prevent breaking the message listener
      debug.error('❌ Unexpected error in message listener:', outerError);
      try {
        sendResponse({ success: false, error: 'Unexpected error: ' + outerError.message });
      } catch (e) {
        // sendResponse may have already been called or channel closed
      }
    }
    return true; // Keep message channel open for potential async responses
  });

  /**
   * Listen for messages from popup windows
   */
  window.addEventListener('message', (event) => {
    if (event.data.action === 'postRollToChat') {
      handleDiceCloudRoll(event.data.roll);
    } else if (event.data.action === 'postChat') {
      // Handle general chat messages (like spell descriptions)
      postChatMessage(event.data.message);
    } else if (event.data.action === 'rollFromPopout') {
      // Post roll directly to Roll20 - no DiceCloud needed!
      debug.log('🎲 Received roll request from popup via postMessage:', event.data);

      const rollData = {
        name: event.data.name,
        formula: event.data.formula,
        characterName: event.data.characterName
      };

      // Check if silent rolls mode is enabled - if so, hide the roll instead of posting
      if (silentRollsEnabled) {
        debug.log('🔇 Silent rolls active - hiding roll instead of posting');
        const hiddenRoll = {
          id: Date.now() + Math.random(), // Unique ID
          name: rollData.name,
          formula: rollData.formula,
          characterName: rollData.characterName,
          timestamp: new Date().toLocaleTimeString(),
          result: null // Will be filled when revealed
        };
        hiddenRolls.push(hiddenRoll);
        updateHiddenRollsDisplay();

        // Send confirmation back to popup
        if (event.source) {
          event.source.postMessage({
            action: 'rollHidden',
            roll: hiddenRoll
          }, '*');
        }
      } else {
        // Normal flow - post to Roll20 chat
        const formattedMessage = formatRollForRoll20(rollData);
        const success = postChatMessage(formattedMessage);

        if (success) {
          debug.log('✅ Roll posted directly to Roll20 (no DiceCloud!)');
          // Observe Roll20's result for natural 1s/20s
          observeNextRollResult(rollData);
        }
      }
    } else if (event.data.action === 'announceSpell') {
      // Handle spell announcements - check if we have structured spell data or just a message
      if (event.data.spellData) {
        // New pathway: structured spell data from popup-sheet
        debug.log('🔮 Received structured spell data from popup:', event.data);
        const normalizedSpellData = normalizePopupSpellData(event.data);
        postSpellToRoll20(normalizedSpellData);
      } else if (event.data.message) {
        // Legacy pathway: pre-formatted message (for non-spell announcements like initiative, saves, etc.)
        postChatMessage(event.data.message);
      } else {
        handleDiceCloudRoll(event.data);
      }
    }
  });

  // ============================================================================
  // GM INITIATIVE TRACKER
  // ============================================================================

  let gmModeEnabled = false; // Start disabled - GM panel is a popup when toggled on
  let silentRollsEnabled = false; // Separate toggle for silent rolls
  let gmPanel = null;
  const characterPopups = {}; // Track popup windows by character name
  let combatStarted = false; // Track if combat has been initiated
  let initiativeTracker = {
    combatants: [],
    currentTurnIndex: 0,
    round: 1,
    delayedCombatants: [] // Track combatants who have delayed their turn
  };
  let hiddenRolls = []; // Store hidden GM rolls
  let turnHistory = []; // Store turn history for logging
  let playerData = {}; // Store player overview data { characterName: { hp, maxHp, ac, etc } }

  /**
   * Create GM Initiative Tracker Panel
   */
  function createGMPanel() {
    if (gmPanel) return gmPanel;

    // Create panel
    gmPanel = document.createElement('div');
    gmPanel.id = 'gm-panel';
    gmPanel.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      width: 500px;
      height: 600px;
      min-width: 400px;
      min-height: 400px;
      max-width: 90vw;
      max-height: 90vh;
      background: #1e1e1e;
      border: 2px solid #FC57F9;
      border-radius: 12px;
      z-index: 999998;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      color: #fff;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5);
      display: none;
      flex-direction: column;
      overflow: hidden;
      resize: both;
      visibility: visible;
      opacity: 1;
    `;

    // Create tab content containers
    const initiativeTab = document.createElement('div');
    initiativeTab.className = 'gm-tab-content';
    initiativeTab.dataset.tab = 'initiative';
    initiativeTab.style.display = 'block';

    const hiddenRollsTab = document.createElement('div');
    hiddenRollsTab.className = 'gm-tab-content';
    hiddenRollsTab.dataset.tab = 'hidden-rolls';
    hiddenRollsTab.style.display = 'none';

    const playersTab = document.createElement('div');
    playersTab.className = 'gm-tab-content';
    playersTab.dataset.tab = 'players';
    playersTab.style.display = 'none';

    const historyTab = document.createElement('div');
    historyTab.className = 'gm-tab-content';
    historyTab.dataset.tab = 'history';
    historyTab.style.display = 'none';

    // ===== INITIATIVE TAB CONTENT =====
    const controls = document.createElement('div');
    controls.style.cssText = `
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      margin-bottom: 15px;
    `;
    controls.innerHTML = `
      <button id="start-combat-btn" style="padding: 12px; background: #27ae60; color: #fff; border: none; border-radius: 8px; cursor: pointer; font-weight: bold; font-size: 1em; grid-column: span 2; box-shadow: 0 2px 8px rgba(39, 174, 96, 0.3);">⚔️ Start Combat</button>
      <button id="prev-turn-btn" style="padding: 8px 12px; background: #3498db; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 0.85em; display: none;">← Prev</button>
      <button id="next-turn-btn" style="padding: 8px 12px; background: #FC57F9; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 0.85em; display: none;">Next →</button>
      <button id="clear-all-btn" style="padding: 8px 12px; background: #e74c3c; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 0.85em; grid-column: span 2;">🗑️ Clear All</button>
    `;

    const roundDisplay = document.createElement('div');
    roundDisplay.id = 'round-display';
    roundDisplay.style.cssText = `
      text-align: center;
      padding: 8px;
      background: #34495e;
      border-radius: 6px;
      margin-bottom: 15px;
      font-weight: bold;
    `;
    roundDisplay.textContent = 'Round 1';

    const initiativeList = document.createElement('div');
    initiativeList.id = 'initiative-list';
    initiativeList.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-bottom: 15px;
    `;

    const addFormSection = document.createElement('div');
    addFormSection.style.cssText = `
      margin-top: 15px;
      padding-top: 15px;
      border-top: 2px solid #34495e;
    `;

    const addFormHeader = document.createElement('div');
    addFormHeader.style.cssText = `
      cursor: pointer;
      user-select: none;
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px;
      margin-bottom: 10px;
      background: #34495e;
      border-radius: 6px;
      font-weight: bold;
      transition: background 0.2s;
    `;
    addFormHeader.innerHTML = `
      <span>➕ Add Combatant</span>
      <span id="add-form-toggle" style="transition: transform 0.3s; transform: rotate(-90deg);">▼</span>
    `;

    const addForm = document.createElement('div');
    addForm.id = 'add-combatant-form';
    addForm.style.cssText = `
      display: block;
      transition: max-height 0.3s ease-out, opacity 0.3s ease-out;
      overflow: hidden;
      max-height: 0;
      opacity: 0;
    `;
    addForm.innerHTML = `
      <input type="text" id="combatant-name-input" placeholder="Combatant name" style="width: 100%; padding: 8px; margin-bottom: 8px; border: 2px solid #34495e; border-radius: 4px; background: #34495e; color: #fff; font-size: 0.9em;" />
      <input type="number" id="combatant-init-input" placeholder="Initiative" style="width: 100%; padding: 8px; margin-bottom: 8px; border: 2px solid #34495e; border-radius: 4px; background: #34495e; color: #fff; font-size: 0.9em;" />
      <button id="add-combatant-btn" style="width: 100%; padding: 8px 12px; background: #3498db; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-weight: bold;">➕ Add</button>
    `;

    addFormSection.appendChild(addFormHeader);
    addFormSection.appendChild(addForm);

    // Add initiative content to initiative tab
    initiativeTab.appendChild(controls);
    initiativeTab.appendChild(roundDisplay);
    initiativeTab.appendChild(initiativeList);
    initiativeTab.appendChild(addFormSection);

    // ===== HIDDEN ROLLS TAB CONTENT =====
    hiddenRollsTab.innerHTML = `
      <div style="text-align: center; padding: 20px; color: #888;">
        <div style="font-size: 3em; margin-bottom: 10px;">🎲</div>
        <p style="margin: 0;">No hidden rolls yet</p>
        <p style="font-size: 0.85em; margin-top: 8px;">Rolls made while GM Mode is active will appear here</p>
      </div>
      <div id="hidden-rolls-list" style="display: flex; flex-direction: column; gap: 8px;"></div>
    `;

    // ===== PLAYER OVERVIEW TAB CONTENT =====
    playersTab.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
        <h3 style="margin: 0; font-size: 1.2em; color: #FC57F9;">Party Overview</h3>
        <div style="display: flex; gap: 8px;">
          <button id="import-players-btn" style="padding: 8px 14px; background: #27ae60; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 0.95em; font-weight: bold;">📥 Import</button>
          <button id="refresh-players-btn" style="padding: 8px 14px; background: #9b59b6; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 0.95em; font-weight: bold;">🔄 Refresh</button>
        </div>
      </div>
      <div style="text-align: center; padding: 20px; color: #888;">
        <div style="font-size: 3em; margin-bottom: 10px;">👥</div>
        <p style="margin: 0; font-size: 1.1em;">No players tracked yet</p>
        <p style="font-size: 1em; margin-top: 8px;">Click Import to load character data from storage</p>
      </div>
      <div id="player-overview-list" style="display: flex; flex-direction: column; gap: 10px;"></div>
    `;

    // ===== TURN HISTORY TAB CONTENT =====
    historyTab.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
        <h3 style="margin: 0; font-size: 1em; color: #FC57F9;">Last 10 Turns</h3>
        <button id="export-history-btn" style="padding: 6px 12px; background: #3498db; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 0.8em;">📋 Copy</button>
      </div>
      <div id="turn-history-empty-state" style="text-align: center; padding: 20px; color: #888;">
        <div style="font-size: 3em; margin-bottom: 10px;">📜</div>
        <p style="margin: 0;">No turn history yet</p>
        <p style="font-size: 0.85em; margin-top: 8px;">Combat actions will be logged here</p>
      </div>
      <div id="turn-history-list" style="display: flex; flex-direction: column; gap: 8px;"></div>
    `;

    // ===== CREATE HEADER =====
    const header = document.createElement('div');
    header.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 15px;
      background: #1e1e1e;
      border-bottom: 2px solid #FC57F9;
      cursor: move;
      user-select: none;
    `;
    header.innerHTML = `
      <div>
        <h2 style="margin: 0; font-size: 1.2em; color: #FC57F9;">👑 GM Panel</h2>
        <div style="display: flex; align-items: center; gap: 15px; margin-top: 8px;">
          <label style="display: flex; align-items: center; gap: 8px; font-size: 0.9em; color: #aaa; cursor: pointer;">
            <input type="checkbox" id="silent-rolls-toggle" style="width: 16px; height: 16px; cursor: pointer;" />
            <span>🔇 Silent Rolls</span>
          </label>
        </div>
      </div>
      <button id="gm-panel-close" style="background: #e74c3c; color: #fff; border: none; padding: 8px 12px; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 0.9em;">✖</button>
    `;

    // ===== CREATE TAB NAVIGATION =====
    const tabNav = document.createElement('div');
    tabNav.style.cssText = `
      display: flex;
      gap: 0;
      background: #1e1e1e;
      border-bottom: 1px solid #34495e;
    `;
    tabNav.innerHTML = `
      <button class="gm-tab-btn" data-tab="initiative" style="flex: 1; padding: 12px; background: #2a2a2a; color: #FC57F9; border: none; border-bottom: 3px solid #FC57F9; cursor: pointer; font-weight: bold; font-size: 0.9em; transition: all 0.2s;">⚔️ Initiative</button>
      <button class="gm-tab-btn" data-tab="history" style="flex: 1; padding: 12px; background: transparent; color: #888; border: none; border-bottom: 3px solid transparent; cursor: pointer; font-weight: bold; font-size: 0.9em; transition: all 0.2s;">📜 History</button>
      <button class="gm-tab-btn" data-tab="hidden-rolls" style="flex: 1; padding: 12px; background: transparent; color: #888; border: none; border-bottom: 3px solid transparent; cursor: pointer; font-weight: bold; font-size: 0.9em; transition: all 0.2s;">🎲 Hidden Rolls</button>
      <button class="gm-tab-btn" data-tab="players" style="flex: 1; padding: 12px; background: transparent; color: #888; border: none; border-bottom: 3px solid transparent; cursor: pointer; font-weight: bold; font-size: 0.9em; transition: all 0.2s;">👥 Players</button>
    `;

    // ===== CREATE CONTENT WRAPPER =====
    const contentWrapper = document.createElement('div');
    contentWrapper.style.cssText = `
      padding: 15px;
      background: #2a2a2a;
      color: #fff;
      border-radius: 0 0 12px 12px;
      overflow-y: auto;
      flex: 1;
    `;

    // Assemble all tabs into content wrapper
    contentWrapper.appendChild(initiativeTab);
    contentWrapper.appendChild(hiddenRollsTab);
    contentWrapper.appendChild(playersTab);
    contentWrapper.appendChild(historyTab);

    // Assemble panel
    gmPanel.appendChild(header);
    gmPanel.appendChild(tabNav);
    gmPanel.appendChild(contentWrapper);
    document.body.appendChild(gmPanel);

    // Make draggable
    makeDraggable(gmPanel, header);

    // Start listening for character broadcasts
    startCharacterBroadcastListener();

    // Load player data from storage
    loadPlayerDataFromStorage();
    
    // Test storage functionality immediately
    debug.log('🧪 Testing storage functionality...');
    
    // Test 1: Promise-based API
    if (browserAPI.storage.local.get instanceof Function) {
      browserAPI.storage.local.get(['characterProfiles']).then(result => {
        debug.log('🧪 Promise storage test result:', result);
        if (result.characterProfiles) {
          debug.log('🧪 Found characterProfiles:', Object.keys(result.characterProfiles));
          Object.keys(result.characterProfiles).forEach(key => {
            debug.log(`🧪 Profile ${key}:`, result.characterProfiles[key].type);
          });
        } else {
          debug.log('🧪 No characterProfiles found in storage (Promise)');
        }
      }).catch(error => {
        debug.error('🧪 Promise storage error:', error);
      });
    }
    
    // Test 2: Callback-based API (fallback)
    try {
      browserAPI.storage.local.get(['characterProfiles'], (result) => {
        debug.log('🧪 Callback storage test result:', result);
        if (browserAPI.runtime.lastError) {
          debug.error('🧪 Callback storage error:', browserAPI.runtime.lastError);
        } else if (result.characterProfiles) {
          debug.log('🧪 Found characterProfiles (callback):', Object.keys(result.characterProfiles));
        } else {
          debug.log('🧪 No characterProfiles found in storage (callback)');
        }
      });
    } catch (error) {
      debug.error('🧪 Callback storage test failed:', error);
    }

    // Attach event listeners
    attachGMPanelListeners();

    debug.log('✅ GM Panel created');
    return gmPanel;
  }

  /**
   * Start listening for character broadcasts from players
   */
  function startCharacterBroadcastListener() {
    // Monitor chat for character broadcasts
    const chatObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            // Check for character broadcast messages
            const messageContent = node.textContent || node.innerText || '';
            debug.log('🔍 Chat message detected:', messageContent.substring(0, 100));
            if (messageContent.includes('👑[ROLLCLOUD:CHARACTER:') && messageContent.includes(']👑')) {
              debug.log('👑 Detected character broadcast in chat');
              parseCharacterBroadcast(messageContent);
            }
          }
        });
      });
    });

    // Find the chat container and observe it
    const chatContainer = document.querySelector('.chat-content') || 
                         document.querySelector('.chatlog') || 
                         document.querySelector('#textchat') ||
                         document.querySelector('.chat');

    if (chatContainer) {
      chatObserver.observe(chatContainer, {
        childList: true,
        subtree: true
      });
      debug.log('👑 Started listening for character broadcasts in chat');
    } else {
      debug.warn('⚠️ Could not find chat container for character broadcast listener');
    }
  }

  /**
   * Parse character broadcast message and import data
   */
  function parseCharacterBroadcast(message) {
    try {
      // Extract the encoded data
      const match = message.match(/👑\[ROLLCLOUD:CHARACTER:(.+?)\]👑/);
      if (!match) {
        debug.warn('⚠️ Invalid character broadcast format');
        return;
      }

      const encodedData = match[1];
      const decodedData = JSON.parse(decodeURIComponent(escape(atob(encodedData))));
      
      if (decodedData.type !== 'ROLLCLOUD_CHARACTER_BROADCAST') {
        debug.warn('⚠️ Not a character broadcast message');
        return;
      }

      const character = decodedData.character;
      const fullSheet = decodedData.fullSheet || character; // Use full sheet if available
      debug.log('👑 Received character broadcast:', character.name);
      debug.log('🔍 Full sheet data keys:', fullSheet ? Object.keys(fullSheet) : 'null');
      debug.log('🔍 Full sheet sample:', fullSheet ? JSON.stringify(fullSheet, null, 2).substring(0, 500) + '...' : 'null');

      // Import COMPLETE character data to GM panel
      updatePlayerData(character.name, fullSheet);
      
      // Show notification to GM
      debug.log(`✅ ${character.name} shared their character sheet! 👑`);
      
    } catch (error) {
      debug.error('❌ Error parsing character broadcast:', error);
    }
  }

  /**
   * Make element draggable with boundary constraints
   */
  function makeDraggable(element, handle) {
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
    handle.onmousedown = dragMouseDown;

    function dragMouseDown(e) {
      e.preventDefault();
      pos3 = e.clientX;
      pos4 = e.clientY;
      document.onmouseup = closeDragElement;
      document.onmousemove = elementDrag;
    }

    function elementDrag(e) {
      e.preventDefault();
      pos1 = pos3 - e.clientX;
      pos2 = pos4 - e.clientY;
      pos3 = e.clientX;
      pos4 = e.clientY;

      // Use requestAnimationFrame to avoid forced reflow
      requestAnimationFrame(() => {
        // Read layout properties first (batched reads)
        const offsetTop = element.offsetTop;
        const offsetLeft = element.offsetLeft;
        const offsetWidth = element.offsetWidth;
        const offsetHeight = element.offsetHeight;
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        // Calculate new position
        let newTop = offsetTop - pos2;
        let newLeft = offsetLeft - pos1;

        // Apply boundary constraints
        const minTop = 0;
        const minLeft = 0;
        const maxLeft = viewportWidth - offsetWidth;
        const maxTop = viewportHeight - offsetHeight;

        // Constrain within viewport
        newTop = Math.max(minTop, Math.min(newTop, maxTop));
        newLeft = Math.max(minLeft, Math.min(newLeft, maxLeft));

        // Batch all style writes together
        element.style.top = newTop + "px";
        element.style.left = newLeft + "px";
        element.style.right = 'auto';
      });
    }

    function closeDragElement() {
      document.onmouseup = null;
      document.onmousemove = null;
    }
  }

  /**
   * Attach event listeners to GM panel controls
   */
  function attachGMPanelListeners() {
    // Silent rolls toggle
    const silentRollsToggle = document.getElementById('silent-rolls-toggle');
    if (silentRollsToggle) {
      silentRollsToggle.addEventListener('change', (e) => {
        silentRollsEnabled = e.target.checked;
        debug.log(`🔇 Silent rolls ${silentRollsEnabled ? 'enabled' : 'disabled'}`);
        
        // Update hidden rolls tab description
        const hiddenRollsTab = gmPanel.querySelector('[data-tab="hidden-rolls"]');
        if (hiddenRollsTab) {
          const description = hiddenRollsTab.querySelector('p:nth-child(2)');
          if (description) {
            description.textContent = silentRollsEnabled 
              ? 'Rolls made while silent rolls is enabled will appear here'
              : 'Rolls made while GM Mode is active will appear here';
          }
        }
      });
    }

    // Tab switching
    const tabButtons = gmPanel.querySelectorAll('.gm-tab-btn');
    const tabContents = gmPanel.querySelectorAll('.gm-tab-content');

    tabButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const targetTab = btn.dataset.tab;

        // Update button styles
        tabButtons.forEach(b => {
          if (b.dataset.tab === targetTab) {
            b.style.background = '#2a2a2a';
            b.style.color = '#FC57F9';
            b.style.borderBottom = '3px solid #FC57F9';
          } else {
            b.style.background = 'transparent';
            b.style.color = '#888';
            b.style.borderBottom = '3px solid transparent';
          }
        });

        // Show target tab content, hide others
        tabContents.forEach(content => {
          content.style.display = content.dataset.tab === targetTab ? 'block' : 'none';
        });

        debug.log(`📑 Switched to GM tab: ${targetTab}`);
      });
    });

    // Close button
    const closeBtn = document.getElementById('gm-panel-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => toggleGMMode(false));
    }

    // Turn controls
    const startCombatBtn = document.getElementById('start-combat-btn');
    const nextBtn = document.getElementById('next-turn-btn');
    const prevBtn = document.getElementById('prev-turn-btn');
    const clearAllBtn = document.getElementById('clear-all-btn');

    debug.log('🔍 GM Panel controls found:', {
      startCombatBtn: !!startCombatBtn,
      nextBtn: !!nextBtn,
      prevBtn: !!prevBtn,
      clearAllBtn: !!clearAllBtn
    });

    if (startCombatBtn) startCombatBtn.addEventListener('click', startCombat);
    if (nextBtn) nextBtn.addEventListener('click', nextTurn);
    if (prevBtn) prevBtn.addEventListener('click', prevTurn);
    if (clearAllBtn) clearAllBtn.addEventListener('click', clearAllCombatants);

    // Collapsible add form toggle
    const addFormHeader = gmPanel.querySelector('div[style*="cursor: pointer"]');
    const addForm = document.getElementById('add-combatant-form');
    const addFormToggle = document.getElementById('add-form-toggle');
    let isFormCollapsed = true; // Start collapsed

    if (addFormHeader && addForm && addFormToggle) {
      addFormHeader.addEventListener('click', () => {
        isFormCollapsed = !isFormCollapsed;
        if (isFormCollapsed) {
          addForm.style.maxHeight = '0';
          addForm.style.opacity = '0';
          addFormToggle.style.transform = 'rotate(-90deg)';
        } else {
          addForm.style.maxHeight = '500px';
          addForm.style.opacity = '1';
          addFormToggle.style.transform = 'rotate(0deg)';
        }
      });
    }

    // Add combatant form
    const addBtn = document.getElementById('add-combatant-btn');
    const nameInput = document.getElementById('combatant-name-input');
    const initInput = document.getElementById('combatant-init-input');

    if (addBtn && nameInput && initInput) {
      addBtn.addEventListener('click', () => {
        const name = nameInput.value.trim();
        const initiative = parseInt(initInput.value);
        if (name && !isNaN(initiative)) {
          addCombatant(name, initiative, 'manual');
          nameInput.value = '';
          initInput.value = '';
        }
      });

      // Enter key to add
      initInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          addBtn.click();
        }
      });
    }

    // Export turn history button
    const exportHistoryBtn = document.getElementById('export-history-btn');
    if (exportHistoryBtn) {
      exportHistoryBtn.addEventListener('click', exportTurnHistory);
    }

    // Import players button
    const importPlayersBtn = document.getElementById('import-players-btn');
    if (importPlayersBtn) {
      importPlayersBtn.addEventListener('click', importPlayerData);
    }

    // Refresh players button
    const refreshPlayersBtn = document.getElementById('refresh-players-btn');
    if (refreshPlayersBtn) {
      refreshPlayersBtn.addEventListener('click', () => {
        updatePlayerOverviewDisplay();
        debug.log('🔄 Refreshed player overview');
      });
    }

    debug.log('✅ GM Panel listeners attached');
  }

  /**
   * Update Hidden Rolls Display
   */
  function updateHiddenRollsDisplay() {
    const hiddenRollsList = document.getElementById('hidden-rolls-list');
    if (!hiddenRollsList) return;

    if (hiddenRolls.length === 0) {
      hiddenRollsList.innerHTML = '';
      // Show empty state if tab content exists
      const tabContent = gmPanel.querySelector('[data-tab="hidden-rolls"]');
      if (tabContent) {
        const emptyState = tabContent.querySelector('div[style*="text-align: center"]');
        if (emptyState) emptyState.style.display = 'block';
      }
      return;
    }

    // Hide empty state
    const tabContent = gmPanel.querySelector('[data-tab="hidden-rolls"]');
    if (tabContent) {
      const emptyState = tabContent.querySelector('div[style*="text-align: center"]');
      if (emptyState) emptyState.style.display = 'none';
    }

    hiddenRollsList.innerHTML = hiddenRolls.map((roll, index) => `
      <div style="background: #34495e; padding: 12px; border-radius: 8px; border-left: 4px solid #f39c12;">
        <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 8px;">
          <div style="flex: 1;">
            <div style="font-weight: bold; color: #f39c12; margin-bottom: 4px;">${roll.characterName}</div>
            <div style="font-size: 0.9em; color: #ccc;">${roll.name}</div>
            <div style="font-size: 0.85em; color: #888; margin-top: 4px;">${roll.timestamp}</div>
          </div>
          <div style="font-size: 1.2em; color: #f39c12;">🔒</div>
        </div>
        <div style="background: #2c3e50; padding: 8px; border-radius: 4px; font-family: monospace; font-size: 0.9em; margin-bottom: 10px;">
          ${roll.formula}
        </div>
        <div style="display: flex; gap: 8px;">
          <button class="reveal-roll-btn" data-roll-id="${roll.id}" style="flex: 1; padding: 8px; background: #27ae60; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 0.85em;">
            📢 Publish Roll
          </button>
          <button class="delete-roll-btn" data-roll-id="${roll.id}" style="padding: 8px 12px; background: #e74c3c; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 0.85em;">
            🗑️
          </button>
        </div>
      </div>
    `).join('');

    // Add event listeners to reveal and delete roll buttons
    const revealRollBtns = hiddenRollsList.querySelectorAll('.reveal-roll-btn');
    const deleteRollBtns = hiddenRollsList.querySelectorAll('.delete-roll-btn');

    revealRollBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const rollId = btn.dataset.rollId;
        revealHiddenRoll(rollId);
      });
    });

    deleteRollBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const rollId = btn.dataset.rollId;
        deleteHiddenRoll(rollId);
      });
    });

    debug.log(`📋 Updated hidden rolls display: ${hiddenRolls.length} rolls`);
  }

  /**
   * Reveal a hidden roll (post it to Roll20 chat)
   */
  window.revealHiddenRoll = function(rollId) {
    const rollIndex = hiddenRolls.findIndex(r => r.id === rollId);
    if (rollIndex === -1) return;

    const roll = hiddenRolls[rollIndex];
    debug.log('🔓 Revealing hidden roll:', roll);

    // Format the message as "GM roll: [Name] rolled [roll name]! **[calculated value]**"
    // Use Roll20's inline roll syntax [[formula]] to evaluate the roll
    const formattedMessage = `GM roll: **${roll.characterName}** rolled ${roll.name}! **[[${roll.formula}]]**`;
    const success = postChatMessage(formattedMessage);

    if (success) {
      debug.log('✅ Hidden roll revealed to Roll20');
      // Remove from hidden rolls
      hiddenRolls.splice(rollIndex, 1);
      updateHiddenRollsDisplay();
    } else {
      debug.error('❌ Failed to reveal hidden roll');
    }
  };

  /**
   * Delete a hidden roll without revealing
   */
  window.deleteHiddenRoll = function(rollId) {
    const rollIndex = hiddenRolls.findIndex(r => r.id === rollId);
    if (rollIndex === -1) return;

    hiddenRolls.splice(rollIndex, 1);
    updateHiddenRollsDisplay();
    debug.log('🗑️ Deleted hidden roll');
  };

  /**
   * Create player header HTML
   */
  function createPlayerHeader(name, player, playerId) {
    const hpPercent = player.maxHp > 0 ? (player.hp / player.maxHp) * 100 : 0;
    const hpColor = hpPercent > 50 ? '#27ae60' : hpPercent > 25 ? '#f39c12' : '#e74c3c';
    
    return `
      <div style="background: #34495e; border-radius: 8px; border-left: 4px solid ${hpColor}; overflow: hidden;">
        <!-- Player Header (always visible) -->
        <div class="player-header-btn" data-player-name="${name}" style="padding: 12px; cursor: pointer; user-select: none; display: flex; justify-content: space-between; align-items: center; transition: background 0.2s;" onmouseover="this.style.background='#3d5a6e'" onmouseout="this.style.background='transparent'">
          <div style="flex: 1;">
            <div style="font-weight: bold; font-size: 1.1em; color: #FC57F9; margin-bottom: 4px;">${name}</div>
            <div style="display: flex; gap: 12px; font-size: 0.95em; color: #ccc;">
              <span>HP: ${player.hp}/${player.maxHp}</span>
              <span>AC: ${player.ac || '—'}</span>
              <span>Init: ${player.initiative || '—'}</span>
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <span id="${playerId}-toggle" style="transition: transform 0.3s; transform: rotate(-90deg); color: #888; font-size: 1.1em;">▼</span>
            <button class="player-delete-btn" data-player-name="${name}" style="padding: 4px 8px; background: #e74c3c; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 0.8em; font-weight: bold;" title="Remove player">🗑️</button>
          </div>
        </div>
    `;
  }

  /**
   * Update Player Overview Display
   */
  function updatePlayerOverviewDisplay() {
    const playerOverviewList = document.getElementById('player-overview-list');
    if (!playerOverviewList) return;

    const players = Object.keys(playerData);

    if (players.length === 0) {
      playerOverviewList.innerHTML = '';
      // Show empty state
      const tabContent = gmPanel.querySelector('[data-tab="players"]');
      if (tabContent) {
        const emptyState = tabContent.querySelector('div[style*="text-align: center"]');
        if (emptyState) emptyState.style.display = 'block';
      }
      return;
    }

    // Hide empty state
    const tabContent = gmPanel.querySelector('[data-tab="players"]');
    if (tabContent) {
      const emptyState = tabContent.querySelector('div[style*="text-align: center"]');
      if (emptyState) emptyState.style.display = 'none';
    }

    playerOverviewList.innerHTML = players.map((name, index) => {
      const player = playerData[name];
      const playerId = `player-${index}`;
      const hpPercent = player.maxHp > 0 ? (player.hp / player.maxHp) * 100 : 0;
      const hpColor = hpPercent > 50 ? '#27ae60' : hpPercent > 25 ? '#f39c12' : '#e74c3c';

      return createPlayerHeader(name, player, playerId) + `

          <!-- Detailed View (collapsible) -->
          <div id="${playerId}-details" style="max-height: 0; opacity: 0; overflow: hidden; transition: max-height 0.3s ease-out, opacity 0.3s ease-out;">
            <div style="padding: 0 12px 12px 12px;">
              <!-- Character Sub-tabs -->
              <div style="display: flex; gap: 4px; margin-bottom: 10px; border-bottom: 1px solid #2c3e50;">
                <button class="player-subtab-btn" data-player="${playerId}" data-subtab="overview" style="padding: 8px 12px; background: transparent; color: #FC57F9; border: none; border-bottom: 2px solid #FC57F9; cursor: pointer; font-size: 0.9em; font-weight: bold;">Overview</button>
                <button class="player-subtab-btn" data-player="${playerId}" data-subtab="combat" style="padding: 8px 12px; background: transparent; color: #888; border: none; border-bottom: 2px solid transparent; cursor: pointer; font-size: 0.9em;">Combat</button>
                <button class="player-subtab-btn" data-player="${playerId}" data-subtab="status" style="padding: 8px 12px; background: transparent; color: #888; border: none; border-bottom: 2px solid transparent; cursor: pointer; font-size: 0.9em;">Status</button>
              </div>

              <!-- Overview Tab -->
              <div class="player-subtab-content" data-player="${playerId}" data-subtab="overview" style="display: block;">
                <!-- HP Bar -->
                <div style="margin-bottom: 10px;">
                  <div style="display: flex; justify-content: space-between; font-size: 0.95em; color: #ccc; margin-bottom: 4px;">
                    <span>Hit Points</span>
                    <span>${player.hp}/${player.maxHp}</span>
                  </div>
                  <div style="width: 100%; height: 12px; background: #2c3e50; border-radius: 5px; overflow: hidden;">
                    <div style="width: ${hpPercent}%; height: 100%; background: ${hpColor}; transition: width 0.3s;"></div>
                  </div>
                </div>

                <!-- Stats Grid -->
                <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;">
                  <div style="background: #2c3e50; padding: 8px; border-radius: 4px; text-align: center;">
                    <div style="font-size: 0.85em; color: #888;">Armor Class</div>
                    <div style="font-weight: bold; color: #fff; font-size: 1.3em;">${player.ac || '—'}</div>
                  </div>
                  <div style="background: #2c3e50; padding: 8px; border-radius: 4px; text-align: center;">
                    <div style="font-size: 0.85em; color: #888;">Passive Perception</div>
                    <div style="font-weight: bold; color: #fff; font-size: 1.3em;">${player.passivePerception || '—'}</div>
                  </div>
                  <div style="background: #2c3e50; padding: 8px; border-radius: 4px; text-align: center;">
                    <div style="font-size: 0.85em; color: #888;">Initiative</div>
                    <div style="font-weight: bold; color: #fff; font-size: 1.3em;">${player.initiative || '—'}</div>
                  </div>
                </div>
              </div>

              <!-- Combat Tab -->
              <div class="player-subtab-content" data-player="${playerId}" data-subtab="combat" style="display: none;">
                <div style="background: #2c3e50; padding: 10px; border-radius: 4px; margin-bottom: 8px;">
                  <div style="font-size: 0.95em; color: #888; margin-bottom: 6px;">Attack Roll</div>
                  <div style="font-size: 0.9em; color: #ccc;">Click character sheet to make attacks</div>
                </div>
                <div style="background: #2c3e50; padding: 10px; border-radius: 4px;">
                  <div style="font-size: 0.95em; color: #888; margin-bottom: 6px;">Combat Stats</div>
                  <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                    <span style="font-size: 0.9em; color: #ccc;">AC:</span>
                    <span style="font-size: 0.9em; color: #fff; font-weight: bold;">${player.ac || '—'}</span>
                  </div>
                  <div style="display: flex; justify-content: space-between;">
                    <span style="font-size: 0.9em; color: #ccc;">Initiative:</span>
                    <span style="font-size: 0.9em; color: #fff; font-weight: bold;">${player.initiative || '—'}</span>
                  </div>
                </div>
              </div>

              <!-- Status Tab -->
              <div class="player-subtab-content" data-player="${playerId}" data-subtab="status" style="display: none;">
                <!-- Conditions -->
                ${player.conditions && player.conditions.length > 0 ? `
                  <div style="margin-bottom: 10px;">
                    <div style="font-size: 0.95em; color: #888; margin-bottom: 6px;">Active Conditions</div>
                    <div style="display: flex; flex-wrap: wrap; gap: 6px;">
                      ${player.conditions.map(c => `<span style="background: #e74c3c; padding: 5px 12px; border-radius: 4px; font-size: 0.9em; font-weight: bold;">${c}</span>`).join('')}
                    </div>
                  </div>
                ` : '<div style="padding: 10px; text-align: center; color: #888; font-size: 0.95em;">No active conditions</div>'}

                <!-- Concentration -->
                ${player.concentrationSpell ? `
                  <div style="background: #9b59b6; padding: 10px; border-radius: 4px; margin-bottom: 10px;">
                    <div style="font-size: 0.95em; font-weight: bold; margin-bottom: 4px;">🧠 Concentrating</div>
                    <div style="font-size: 0.9em;">${player.concentrationSpell}</div>
                  </div>
                ` : ''}

                <!-- Death Saves (if unconscious) -->
                ${player.deathSaves ? `
                  <div style="background: #c0392b; padding: 10px; border-radius: 4px;">
                    <div style="font-size: 0.95em; font-weight: bold; margin-bottom: 6px;">💀 Death Saving Throws</div>
                    <div style="display: flex; justify-content: space-around; font-size: 0.9em;">
                      <div>
                        <div style="color: #27ae60; font-weight: bold;">Successes</div>
                        <div style="font-size: 1.3em; text-align: center;">✓ ${player.deathSaves.successes || 0}</div>
                      </div>
                      <div>
                        <div style="color: #e74c3c; font-weight: bold;">Failures</div>
                        <div style="font-size: 1.3em; text-align: center;">✗ ${player.deathSaves.failures || 0}</div>
                      </div>
                    </div>
                  </div>
                ` : ''}
              </div>
            </div>
          </div>
        </div>
      `;
    }).join('');

    debug.log(`👥 Updated player overview: ${players.length} players`);

    // Add event listeners for player header buttons
    document.querySelectorAll('.player-header-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const playerName = btn.dataset.playerName;
        showFullCharacterModal(playerName);
      });
    });

    // Add event listeners for delete buttons
    document.querySelectorAll('.player-delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const playerName = btn.dataset.playerName;
        deletePlayerFromGM(playerName);
      });
    });
  }

  /**
   * Update player data from character sheet
   */
  function updatePlayerData(characterName, data) {
    if (!playerData[characterName]) {
      playerData[characterName] = {};
    }

    // Merge new data
    Object.assign(playerData[characterName], data);

    // Save to storage
    savePlayerDataToStorage();

    // Update display if GM panel is open
    if (gmModeEnabled) {
      updatePlayerOverviewDisplay();
    }

    debug.log(`👤 Updated player data for ${characterName}:`, playerData[characterName]);
  }

  /**
   * Save player data to storage
   */
  function savePlayerDataToStorage() {
    debug.log('💾 Attempting to save player data:', Object.keys(playerData));

    // First, load existing characterProfiles to avoid overwriting synced character data
    return browserAPI.storage.local.get(['characterProfiles']).then(result => {
      const existingProfiles = result.characterProfiles || {};

      // Remove old rollcloudPlayer entries first
      Object.keys(existingProfiles).forEach(key => {
        if (existingProfiles[key].type === 'rollcloudPlayer') {
          delete existingProfiles[key];
        }
      });

      // Add current player data to existing profiles
      Object.keys(playerData).forEach(playerName => {
        existingProfiles[playerName] = {
          ...playerData[playerName],
          type: 'rollcloudPlayer',
          lastUpdated: new Date().toISOString()
        };
        debug.log(`💾 Preparing to save player: ${playerName}, type: rollcloudPlayer`);
      });

      // Save merged data back to storage (convert callback-based to Promise-based)
      return new Promise((resolve, reject) => {
        browserAPI.storage.local.set({
          characterProfiles: existingProfiles
        }, () => {
          if (browserAPI.runtime.lastError) {
            debug.error('❌ Error saving to storage:', browserAPI.runtime.lastError);
            reject(browserAPI.runtime.lastError);
          } else {
            debug.log('✅ Successfully saved player data to characterProfiles storage');
            debug.log('💾 Total profiles in storage:', Object.keys(existingProfiles).length);
            resolve();
          }
        });
      });
    }).catch(error => {
      debug.error('❌ Error reading existing profiles before save:', error);
      throw error;
    });
  }

  /**
   * Load player data from storage
   */
  function loadPlayerDataFromStorage() {
    return browserAPI.storage.local.get(['characterProfiles']).then(result => {
      if (result.characterProfiles) {
        // Load only rollcloudPlayer entries from characterProfiles
        playerData = {};
        Object.keys(result.characterProfiles).forEach(key => {
          const profile = result.characterProfiles[key];
          if (profile.type === 'rollcloudPlayer') {
            playerData[key] = profile;
          }
        });

        debug.log(`📂 Loaded ${Object.keys(playerData).length} GM players from storage`);

        // Update display if GM panel is open
        if (gmModeEnabled) {
          updatePlayerOverviewDisplay();
        }
      }
    }).catch(error => {
      debug.error('❌ Error loading player data from storage:', error);
    });
  }

  /**
   * Delete player data
   */
  function deletePlayerData(characterName) {
    if (playerData[characterName]) {
      delete playerData[characterName];
      
      // Save to storage
      savePlayerDataToStorage();
      
      // Update display if GM panel is open
      if (gmModeEnabled) {
        updatePlayerOverviewDisplay();
      }
      
      debug.log(`🗑️ Deleted player data for ${characterName}`);
    }
  }

  /**
   * Delete player from GM panel
   */
  window.deletePlayerFromGM = function(characterName) {
    if (confirm(`Remove ${characterName} from GM Panel?`)) {
      deletePlayerData(characterName);
    }
  };

  /**
   * Toggle player details expansion
   */
  window.togglePlayerDetails = function(playerId) {
    const details = document.getElementById(`${playerId}-details`);
    const toggle = document.getElementById(`${playerId}-toggle`);

    if (!details || !toggle) return;

    const isExpanded = details.style.maxHeight && details.style.maxHeight !== '0px';

    if (isExpanded) {
      // Collapse
      details.style.maxHeight = '0';
      details.style.opacity = '0';
      toggle.style.transform = 'rotate(-90deg)';
    } else {
      // Expand
      details.style.maxHeight = '1000px';
      details.style.opacity = '1';
      toggle.style.transform = 'rotate(0deg)';

      // Attach sub-tab listeners for this player
      attachPlayerSubtabListeners(playerId);
    }
  };

  /**
   * Show full character sheet as popout window
   */
  window.showFullCharacterModal = function(playerName) {
    const player = playerData[playerName];
    if (!player) {
      debug.warn(`⚠️ No data found for player: ${playerName}`);
      return;
    }

    // Check if ANY popup is currently open (enforce single popup limit)
    const openPopups = Object.entries(characterPopups).filter(([name, popup]) => popup && !popup.closed);

    if (openPopups.length > 0) {
      const [existingPlayerName, existingPopup] = openPopups[0];

      // If the same character is already open, just focus it
      if (existingPlayerName === playerName) {
        existingPopup.focus();
        debug.log(`👁️ Focused existing character popup for ${playerName}`);
        return;
      }

      // Different character - close the existing popup and open the new one
      debug.log(`🔄 Closing popup for ${existingPlayerName} to open ${playerName}`);
      existingPopup.close();
      delete characterPopups[existingPlayerName];
    }

    // Create popout window and load the EXISTING popup-sheet.html file
    const popup = window.open(browserAPI.runtime.getURL('src/popup-sheet.html'), `character-${playerName}`, 'width=900,height=700,scrollbars=yes,resizable=yes,toolbar=no,menubar=no,location=no,status=no');

    if (!popup) {
      debug.error('❌ Failed to open popup window - please allow popups for this site');
      return;
    }

    // Track the popup
    characterPopups[playerName] = popup;

    // Store player data for the popup to request
    window.currentPopoutPlayer = player;
    window.currentPopoutPlayerName = playerName;

    // Listen for data requests from the popup
    window.addEventListener('message', function(event) {
      if (event.data && event.data.action === 'requestCharacterData') {
        // Send the character data to the popup
        popup.postMessage({
          action: 'loadCharacterData',
          characterData: window.currentPopoutPlayer
        }, '*');
      }
    });

    debug.log(`🪟 Opened character popup for ${playerName}`);
  };

  /**
   * Attach event listeners for player sub-tabs
   */
  function attachPlayerSubtabListeners(playerId) {
    const subtabBtns = document.querySelectorAll(`.player-subtab-btn[data-player="${playerId}"]`);
    const subtabContents = document.querySelectorAll(`.player-subtab-content[data-player="${playerId}"]`);

    subtabBtns.forEach(btn => {
      // Remove existing listener if any
      btn.replaceWith(btn.cloneNode(true));
    });

    // Re-query after replacing
    const newSubtabBtns = document.querySelectorAll(`.player-subtab-btn[data-player="${playerId}"]`);

    newSubtabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const targetSubtab = btn.dataset.subtab;

        // Update button styles
        newSubtabBtns.forEach(b => {
          if (b.dataset.subtab === targetSubtab) {
            b.style.color = '#FC57F9';
            b.style.borderBottom = '2px solid #FC57F9';
          } else {
            b.style.color = '#888';
            b.style.borderBottom = '2px solid transparent';
          }
        });

        // Show target content, hide others
        subtabContents.forEach(content => {
          content.style.display = content.dataset.subtab === targetSubtab ? 'block' : 'none';
        });
      });
    });
  }

  /**
   * Import player data from chrome storage
   */
  function importPlayerData() {
    debug.log('📥 Importing player data from storage...');

    chrome.storage.local.get(['characterProfiles'], (result) => {
      if (chrome.runtime.lastError) {
        debug.error('❌ Failed to import player data:', chrome.runtime.lastError);
        postChatMessage('❌ Failed to import character data');
        return;
      }

      const characterProfiles = result.characterProfiles || {};
      const profileKeys = Object.keys(characterProfiles);

      if (profileKeys.length === 0) {
        debug.log('⚠️ No character profiles found in storage');
        postChatMessage('⚠️ No character data found. Please sync a character from Dice Cloud first.');
        return;
      }

      // Clear existing player data
      playerData = {};

      // Import each character profile
      profileKeys.forEach(profileId => {
        const character = characterProfiles[profileId];

        if (!character || !character.name) {
          debug.warn(`⚠️ Skipping invalid character profile: ${profileId}`);
          return;
        }

        // Import complete character data
        playerData[character.name] = {
          // Basic stats
          hp: character.hp?.current ?? character.hitPoints?.current ?? 0,
          maxHp: character.hp?.max ?? character.hitPoints?.max ?? 0,
          ac: character.armorClass ?? character.ac ?? 10,
          initiative: character.initiative ?? 0,
          passivePerception: character.passivePerception ?? 10,
          proficiency: character.proficiency ?? 0,
          speed: character.speed ?? '30 ft',
          
          // Character info
          name: character.name,
          class: character.class || 'Unknown',
          level: character.level || 1,
          race: character.race || 'Unknown',
          hitDice: character.hitDice || '10',
          
          // Abilities
          attributes: character.attributes || {
            strength: 10,
            dexterity: 10,
            constitution: 10,
            intelligence: 10,
            wisdom: 10,
            charisma: 10
          },
          
          // Skills
          skills: character.skills || [],
          
          // Actions
          actions: character.actions || [],
          
          // Combat status
          conditions: character.conditions || [],
          concentration: character.concentration || null,
          deathSaves: character.deathSaves || null,
          
          // Type marking for storage
          type: 'rollcloudPlayer',
          lastUpdated: new Date().toISOString()
        };

        debug.log(`✅ Imported player: ${character.name} (HP: ${character.hp?.current ?? character.hitPoints?.current ?? 0}/${character.hp?.max ?? character.hitPoints?.max ?? 0}, AC: ${character.armorClass ?? character.ac ?? 10})`);
      });

      // Update display
      updatePlayerOverviewDisplay();

      const playerCount = Object.keys(playerData).length;
      debug.log(`✅ Successfully imported ${playerCount} player(s)`);
      postChatMessage(`✅ GM imported ${playerCount} character(s) to party overview`);
    });
  }

  /**
   * Export player data to clipboard
   */
  function exportPlayerData() {
    if (Object.keys(playerData).length === 0) {
      debug.log('⚠️ No player data to export');
      return;
    }

    const exportText = Object.keys(playerData).map(name => {
      const player = playerData[name];
      return `**${name}**
HP: ${player.hp}/${player.maxHp}
AC: ${player.ac || '—'}
Initiative: ${player.initiative || '—'}
Passive Perception: ${player.passivePerception || '—'}
${player.conditions && player.conditions.length > 0 ? `Conditions: ${player.conditions.join(', ')}` : ''}
${player.concentration ? `Concentrating: ${player.concentration}` : ''}
${player.deathSaves ? `Death Saves: ✓${player.deathSaves.successes || 0} / ✗${player.deathSaves.failures || 0}` : ''}
`;
    }).join('\n---\n\n');

    // Copy to clipboard
    navigator.clipboard.writeText(exportText).then(() => {
      debug.log('✅ Player data copied to clipboard');
      postChatMessage('📋 GM exported party overview to clipboard');
    }).catch(err => {
      debug.error('❌ Failed to copy player data:', err);
    });
  }

  /**
   * Log turn action to history
   */
  function logTurnAction(action) {
    const historyEntry = {
      timestamp: new Date().toLocaleTimeString(),
      round: initiativeTracker.round,
      turnIndex: initiativeTracker.currentTurnIndex,
      combatant: getCurrentCombatant()?.name || 'Unknown',
      ...action
    };

    turnHistory.unshift(historyEntry); // Add to beginning
    if (turnHistory.length > 10) {
      turnHistory = turnHistory.slice(0, 10); // Keep only last 10
    }

    updateTurnHistoryDisplay();
    debug.log('📜 Logged turn action:', historyEntry);
  }

  /**
   * Update Turn History Display
   */
  function updateTurnHistoryDisplay() {
    const turnHistoryList = document.getElementById('turn-history-list');
    const emptyState = document.getElementById('turn-history-empty-state');
    if (!turnHistoryList) return;

    if (turnHistory.length === 0) {
      turnHistoryList.innerHTML = '';
      // Show empty state
      if (emptyState) emptyState.style.display = 'block';
      return;
    }

    // Hide empty state
    if (emptyState) emptyState.style.display = 'none';

    turnHistoryList.innerHTML = turnHistory.map((entry, index) => {
      const actionIcon = entry.action === 'attack' ? '⚔️' :
                        entry.action === 'spell' ? '✨' :
                        entry.action === 'damage' ? '💔' :
                        entry.action === 'healing' ? '💚' :
                        entry.action === 'condition' ? '🎯' :
                        entry.action === 'turn' ? '🔄' : '📝';

      return `
        <div style="background: #34495e; padding: 10px; border-radius: 6px; border-left: 4px solid #3498db;">
          <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 6px;">
            <div>
              <span style="font-weight: bold; color: #FC57F9;">${entry.combatant}</span>
              <span style="font-size: 0.75em; color: #888; margin-left: 8px;">Round ${entry.round}</span>
            </div>
            <span style="font-size: 0.75em; color: #888;">${entry.timestamp}</span>
          </div>
          <div style="display: flex; align-items: center; gap: 8px; font-size: 0.9em;">
            <span style="font-size: 1.2em;">${actionIcon}</span>
            <span style="color: #ccc;">${entry.description}</span>
          </div>
          ${entry.damage ? `<div style="margin-top: 4px; font-size: 0.85em; color: #e74c3c;">Damage: ${entry.damage}</div>` : ''}
          ${entry.healing ? `<div style="margin-top: 4px; font-size: 0.85em; color: #27ae60;">Healing: ${entry.healing}</div>` : ''}
          ${entry.condition ? `<div style="margin-top: 4px; font-size: 0.85em; color: #f39c12;">Condition: ${entry.condition}</div>` : ''}
        </div>
      `;
    }).join('');

    debug.log(`📜 Updated turn history: ${turnHistory.length} entries`);
  }

  /**
   * Export turn history to clipboard
   */
  function exportTurnHistory() {
    const historyText = turnHistory.map(entry => {
      let text = `[Round ${entry.round}] ${entry.combatant} - ${entry.description}`;
      if (entry.damage) text += ` (Damage: ${entry.damage})`;
      if (entry.healing) text += ` (Healing: ${entry.healing})`;
      if (entry.condition) text += ` (Condition: ${entry.condition})`;
      return text;
    }).join('\n');

    navigator.clipboard.writeText(historyText).then(() => {
      postChatMessage('📋 Turn history copied to clipboard');
      debug.log('📋 Turn history exported to clipboard');
    }).catch(err => {
      debug.error('❌ Failed to copy turn history:', err);
    });
  }

  /**
   * Toggle GM Mode
   */
  function toggleGMMode(enabled) {
    const previousState = gmModeEnabled;
    gmModeEnabled = enabled !== undefined ? enabled : !gmModeEnabled;

    debug.log(`👑 toggleGMMode called with enabled=${enabled}, previousState=${previousState}, newState=${gmModeEnabled}`);

    if (!gmPanel) {
      debug.log('👑 Creating GM panel...');
      createGMPanel();
    }

    if (!gmPanel) {
      debug.error('❌ Failed to create GM panel!');
      return;
    }

    // Use 'flex' not 'block' to maintain flexbox layout
    gmPanel.style.display = gmModeEnabled ? 'flex' : 'none';

    // Debug: Check if panel is actually visible
    if (gmModeEnabled) {
      debug.log('🔍 GM Panel display set to flex');
      debug.log('🔍 GM Panel offsetWidth:', gmPanel.offsetWidth);
      debug.log('🔍 GM Panel offsetHeight:', gmPanel.offsetHeight);
      debug.log('🔍 GM Panel computed display:', window.getComputedStyle(gmPanel).display);
      debug.log('🔍 GM Panel parent:', gmPanel.parentElement);
      debug.log('🔍 GM Panel style:', gmPanel.style.cssText);

      // Check if panel is in viewport
      const rect = gmPanel.getBoundingClientRect();
      debug.log('🔍 GM Panel bounding rect:', rect);
      debug.log('🔍 Is panel in viewport:', rect.width > 0 && rect.height > 0);

      // Force visibility check (especially for Firefox)
      setTimeout(() => {
        debug.log('🔍 Delayed check - GM Panel display:', window.getComputedStyle(gmPanel).display);
        debug.log('🔍 Delayed check - GM Panel visible:', gmPanel.offsetWidth > 0);

        // Try to force visibility if needed
        if (gmPanel.offsetWidth === 0) {
          debug.warn('⚠️ GM Panel has zero width, trying to force visibility...');
          gmPanel.style.visibility = 'visible';
          gmPanel.style.opacity = '1';
          gmPanel.style.display = 'flex';
          // Firefox sometimes needs explicit dimensions
          gmPanel.style.width = '500px';
          gmPanel.style.height = '600px';
          debug.log('🔍 Forced visibility styles applied');
        }
      }, 100);
    }

    // Visual feedback - enhance glow when active
    if (gmModeEnabled) {
      gmPanel.style.borderColor = '#FC57F9'; // Cyan border
      gmPanel.style.boxShadow = '0 8px 32px rgba(78, 205, 196, 0.6)'; // Enhanced cyan glow when active
    } else {
      gmPanel.style.borderColor = '#FC57F9'; // Cyan border
      gmPanel.style.boxShadow = '0 8px 32px rgba(0,0,0,0.5)'; // Default shadow
    }

    // Start/stop chat monitoring
    if (gmModeEnabled) {
      startChatMonitoring();
    } else {
      stopChatMonitoring();

      // Close all shared character sheet popups when GM panel closes
      // (but NOT the GM's own main character sheet)
      Object.keys(characterPopups).forEach(characterName => {
        const popup = characterPopups[characterName];
        try {
          if (popup && !popup.closed) {
            popup.close();
            debug.log(`🔒 Closed shared character sheet for: ${characterName}`);
          }
        } catch (error) {
          debug.warn(`⚠️ Error closing popup for ${characterName}:`, error);
        }
        delete characterPopups[characterName];
      });
      debug.log('🔒 All shared character sheets closed');
    }

    // Post chat announcement only when state actually changes
    if (previousState !== gmModeEnabled) {
      const message = gmModeEnabled
        ? '👑 GM Panel is now active'
        : '👑 GM Panel deactivated';

      // Use setTimeout to ensure the chat is ready
      setTimeout(() => {
        postChatMessage(message);
      }, 100);
    }

    debug.log(`👑 GM Mode ${gmModeEnabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Add combatant to initiative tracker
   */
  function addCombatant(name, initiative, source = 'chat') {
    // Check if already exists
    const exists = initiativeTracker.combatants.find(c => c.name === name);
    if (exists) {
      debug.log(`⚠️ Combatant ${name} already in tracker, updating initiative`);
      exists.initiative = initiative;
      updateInitiativeDisplay();
      return;
    }

    initiativeTracker.combatants.push({
      name,
      initiative,
      source
    });

    // Sort by initiative (highest first)
    initiativeTracker.combatants.sort((a, b) => b.initiative - a.initiative);

    updateInitiativeDisplay();
    debug.log(`✅ Added combatant: ${name} (Init: ${initiative})`);
  }

  /**
   * Remove combatant from tracker
   */
  function removeCombatant(name) {
    const index = initiativeTracker.combatants.findIndex(c => c.name === name);
    if (index !== -1) {
      initiativeTracker.combatants.splice(index, 1);

      // Adjust current turn index if necessary
      if (initiativeTracker.currentTurnIndex >= initiativeTracker.combatants.length) {
        initiativeTracker.currentTurnIndex = 0;
      }

      updateInitiativeDisplay();
      debug.log(`🗑️ Removed combatant: ${name}`);
    }
  }

  /**
   * Clear all combatants
   */
  function clearAllCombatants() {
    if (confirm('Clear all combatants from initiative tracker?')) {
      initiativeTracker.combatants = [];
      initiativeTracker.currentTurnIndex = 0;
      initiativeTracker.round = 1;
      combatStarted = false;

      // Show Start Combat button again
      const startBtn = document.getElementById('start-combat-btn');
      const prevBtn = document.getElementById('prev-turn-btn');
      const nextBtn = document.getElementById('next-turn-btn');

      if (startBtn) startBtn.style.display = 'block';
      if (prevBtn) prevBtn.style.display = 'none';
      if (nextBtn) nextBtn.style.display = 'none';

      updateInitiativeDisplay();
      postChatMessage('🛑 Combat ended. Initiative tracker cleared.');
      debug.log('🗑️ All combatants cleared');
    }
  }

  /**
   * Start combat - initialize first turn
   */
  function startCombat() {
    if (initiativeTracker.combatants.length === 0) {
      debug.warn('⚠️ Cannot start combat with no combatants');
      return;
    }

    // Reset to beginning
    initiativeTracker.currentTurnIndex = 0;
    initiativeTracker.round = 1;
    combatStarted = true;

    // Update UI
    document.getElementById('round-display').textContent = 'Round 1';
    const startBtn = document.getElementById('start-combat-btn');
    const prevBtn = document.getElementById('prev-turn-btn');
    const nextBtn = document.getElementById('next-turn-btn');

    if (startBtn) {
      startBtn.style.display = 'none';
    }
    if (prevBtn) prevBtn.style.display = 'block';
    if (nextBtn) nextBtn.style.display = 'block';

    updateInitiativeDisplay();
    notifyCurrentTurn();

    // Announce combat start
    postChatMessage('⚔️ Combat has begun! Round 1 starts!');
    announceTurn();

    debug.log('⚔️ Combat started!');
  }

  /**
   * Next turn
   */
  function nextTurn() {
    if (initiativeTracker.combatants.length === 0) return;

    initiativeTracker.currentTurnIndex++;
    if (initiativeTracker.currentTurnIndex >= initiativeTracker.combatants.length) {
      initiativeTracker.currentTurnIndex = 0;
      initiativeTracker.round++;
      document.getElementById('round-display').textContent = `Round ${initiativeTracker.round}`;
      // Announce new round
      postChatMessage(`⚔️ Round ${initiativeTracker.round} begins!`);
      // Notify Discord of round change
      postRoundChangeToDiscord(initiativeTracker.round);
    }

    updateInitiativeDisplay();
    notifyCurrentTurn();
    announceTurn();

    // Log turn change
    const current = getCurrentCombatant();
    if (current) {
      logTurnAction({
        action: 'turn',
        description: `${current.name}'s turn begins`
      });
    }

    debug.log(`⏭️ Next turn: ${getCurrentCombatant()?.name}`);
  }

  /**
   * Previous turn
   */
  function prevTurn() {
    if (initiativeTracker.combatants.length === 0) return;

    initiativeTracker.currentTurnIndex--;
    if (initiativeTracker.currentTurnIndex < 0) {
      initiativeTracker.currentTurnIndex = initiativeTracker.combatants.length - 1;
      initiativeTracker.round = Math.max(1, initiativeTracker.round - 1);
      document.getElementById('round-display').textContent = `Round ${initiativeTracker.round}`;
    }

    updateInitiativeDisplay();
    notifyCurrentTurn();
    announceTurn();
    debug.log(`⏮️ Prev turn: ${getCurrentCombatant()?.name}`);
  }

  /**
   * Get current combatant
   */
  function getCurrentCombatant() {
    return initiativeTracker.combatants[initiativeTracker.currentTurnIndex];
  }

  /**
   * Delay current turn
   */
  function delayTurn(combatantIndex) {
    const combatant = initiativeTracker.combatants[combatantIndex];
    if (!combatant) return;

    debug.log(`⏸️ Delaying turn for: ${combatant.name}`);

    // Add to delayed list
    initiativeTracker.delayedCombatants.push({
      name: combatant.name,
      initiative: combatant.initiative,
      originalIndex: combatantIndex
    });

    // Log the action
    logTurnAction({
      action: 'turn',
      description: `${combatant.name} delays their turn`
    });

    // Announce delay
    postChatMessage(`⏸️ ${combatant.name} delays their turn`);

    // Move to next turn
    nextTurn();

    updateInitiativeDisplay();
  }

  /**
   * Undelay a combatant (cancel their delay)
   */
  function undelayTurn(combatantName) {
    const delayedIndex = initiativeTracker.delayedCombatants.findIndex(d => d.name === combatantName);
    if (delayedIndex === -1) return;

    debug.log(`▶️ Undelaying: ${combatantName}`);

    // Remove from delayed list
    initiativeTracker.delayedCombatants.splice(delayedIndex, 1);

    // Log the action
    logTurnAction({
      action: 'turn',
      description: `${combatantName} resumes their turn`
    });

    // Announce
    postChatMessage(`▶️ ${combatantName} resumes their turn`);

    updateInitiativeDisplay();
  }

  /**
   * Insert a delayed combatant's turn now
   */
  function insertDelayedTurn(combatantName) {
    const delayedIndex = initiativeTracker.delayedCombatants.findIndex(d => d.name === combatantName);
    if (delayedIndex === -1) return;

    const delayed = initiativeTracker.delayedCombatants[delayedIndex];
    debug.log(`▶️ Inserting delayed turn for: ${delayed.name}`);

    // Remove from delayed list
    initiativeTracker.delayedCombatants.splice(delayedIndex, 1);

    // Log the action
    logTurnAction({
      action: 'turn',
      description: `${delayed.name} acts on delayed turn`
    });

    // Announce
    postChatMessage(`▶️ ${delayed.name} acts now (delayed turn)`);

    // Notify the character sheet
    notifyCurrentTurn();

    updateInitiativeDisplay();
  }

  /**
   * Update initiative display
   */
  function updateInitiativeDisplay() {
    const list = document.getElementById('initiative-list');
    if (!list) return;

    if (initiativeTracker.combatants.length === 0) {
      list.innerHTML = '<div style="text-align: center; color: #7f8c8d; padding: 20px;">No combatants yet. Add manually or roll initiative in Roll20 chat!</div>';
      return;
    }

    list.innerHTML = initiativeTracker.combatants.map((combatant, index) => {
      const isActive = index === initiativeTracker.currentTurnIndex;
      const isDelayed = initiativeTracker.delayedCombatants.some(d => d.name === combatant.name);

      return `
        <div style="padding: 10px; background: ${isActive ? '#FC57F9' : isDelayed ? '#9b59b6' : '#34495e'}; border: 2px solid ${isActive ? '#FC57F9' : isDelayed ? '#8e44ad' : '#2c3e50'}; border-radius: 6px; ${isActive ? 'box-shadow: 0 0 15px rgba(78, 205, 196, 0.4);' : ''}">
          <div style="display: flex; align-items: center; gap: 10px; margin-bottom: ${isActive ? '8px' : '0'};">
            <div style="font-weight: bold; font-size: 1.2em; min-width: 30px; text-align: center;">${combatant.initiative}</div>
            <div style="flex: 1; font-weight: bold;">
              ${combatant.name}
              ${isDelayed ? '<span style="font-size: 0.85em; color: #f39c12; margin-left: 8px;">⏸️ Delayed</span>' : ''}
            </div>
            <button class="rollcloud-remove-combatant" data-combatant-name="${combatant.name}" style="background: #e74c3c; color: #fff; border: none; border-radius: 4px; padding: 4px 8px; cursor: pointer; font-size: 0.85em;">✕</button>
          </div>
          ${isActive && !isDelayed ? `
            <button class="rollcloud-delay-turn" data-combatant-index="${index}" style="width: 100%; background: #f39c12; color: #fff; border: none; border-radius: 4px; padding: 6px; cursor: pointer; font-weight: bold; font-size: 0.85em;">⏸️ Delay Turn</button>
          ` : ''}
          ${isActive && isDelayed ? `
            <button class="rollcloud-undelay-turn" data-combatant-name="${combatant.name}" style="width: 100%; background: #27ae60; color: #fff; border: none; border-radius: 4px; padding: 6px; cursor: pointer; font-weight: bold; font-size: 0.85em;">▶️ Resume Turn</button>
          ` : ''}
        </div>
      `;
    }).join('');

    // Show delayed combatants section if any exist
    if (initiativeTracker.delayedCombatants.length > 0) {
      list.innerHTML += `
        <div style="margin-top: 15px; padding-top: 15px; border-top: 2px solid #34495e;">
          <div style="font-weight: bold; color: #f39c12; margin-bottom: 10px; display: flex; align-items: center; gap: 6px;">
            <span>⏸️</span> Delayed Actions
          </div>
          ${initiativeTracker.delayedCombatants.map(delayed => `
            <div style="padding: 8px; background: #9b59b6; border-radius: 6px; margin-bottom: 8px; display: flex; align-items: center; gap: 8px;">
              <div style="flex: 1;">
                <div style="font-weight: bold;">${delayed.name}</div>
                <div style="font-size: 0.75em; opacity: 0.8;">Initiative: ${delayed.initiative}</div>
              </div>
              <button class="rollcloud-insert-delayed" data-delayed-name="${delayed.name}" style="background: #27ae60; color: #fff; border: none; border-radius: 4px; padding: 6px 12px; cursor: pointer; font-weight: bold; font-size: 0.85em;">▶️ Act Now</button>
            </div>
          `).join('')}
        </div>
      `;
    }

    // Attach event listeners (CSP-compliant)
    const removeButtons = list.querySelectorAll('.rollcloud-remove-combatant');
    removeButtons.forEach(button => {
      button.addEventListener('click', () => {
        const name = button.getAttribute('data-combatant-name');
        removeCombatant(name);
      });
    });

    const delayButtons = list.querySelectorAll('.rollcloud-delay-turn');
    delayButtons.forEach(button => {
      button.addEventListener('click', () => {
        const index = parseInt(button.getAttribute('data-combatant-index'));
        delayTurn(index);
      });
    });

    const undelayButtons = list.querySelectorAll('.rollcloud-undelay-turn');
    undelayButtons.forEach(button => {
      button.addEventListener('click', () => {
        const name = button.getAttribute('data-combatant-name');
        undelayTurn(name);
      });
    });

    const insertDelayedButtons = list.querySelectorAll('.rollcloud-insert-delayed');
    insertDelayedButtons.forEach(button => {
      button.addEventListener('click', () => {
        const name = button.getAttribute('data-delayed-name');
        insertDelayedTurn(name);
      });
    });
  }

  /**
   * Notify current turn to character sheet and Discord
   */
  function notifyCurrentTurn() {
    const current = getCurrentCombatant();
    if (!current) return;

    debug.log(`🎯 Notifying turn for: "${current.name}"`);
    debug.log(`📋 Registered popups: ${Object.keys(characterPopups).map(n => `"${n}"`).join(', ')}`);

    // Helper function to normalize names for comparison
    // Removes emoji prefixes, "It's", "'s turn", and trims
    function normalizeName(name) {
      return name
        .replace(/^(?:🔵|🔴|⚪|⚫|🟢|🟡|🟠|🟣|🟤)\s*/, '') // Remove emoji prefixes
        .replace(/^It's\s+/i, '') // Remove "It's" prefix
        .replace(/'s\s+turn.*$/i, '') // Remove "'s turn" suffix
        .trim();
    }

    const normalizedCurrentName = normalizeName(current.name);
    debug.log(`🔍 Normalized current combatant: "${normalizedCurrentName}"`);

    // Send activateTurn/deactivateTurn to all popup windows
    Object.keys(characterPopups).forEach(characterName => {
      const popup = characterPopups[characterName];
      try {
        if (popup && !popup.closed) {
          const normalizedCharName = normalizeName(characterName);

          // Strict match: names must be exactly equal after normalization
          const isTheirTurn = normalizedCharName === normalizedCurrentName;

          debug.log(`🔍 Comparing: "${characterName}" (normalized: "${normalizedCharName}") vs "${current.name}" (normalized: "${normalizedCurrentName}") → ${isTheirTurn ? 'ACTIVATE' : 'DEACTIVATE'}`);
          debug.log(`🔍 Raw comparison: "${characterName}" === "${current.name}" → ${characterName === current.name}`);

          popup.postMessage({
            action: isTheirTurn ? 'activateTurn' : 'deactivateTurn',
            combatant: current.name
          }, '*');

          debug.log(`📤 Sent ${isTheirTurn ? 'activateTurn' : 'deactivateTurn'} to "${characterName}"`);
        } else {
          // Clean up closed popups
          delete characterPopups[characterName];
          debug.log(`🗑️ Removed closed popup for ${characterName}`);
        }
      } catch (error) {
        debug.warn(`⚠️ Error sending message to popup "${characterName}":`, error);
        delete characterPopups[characterName];
      }
    });

    // Post to Discord webhook
    postTurnToDiscord(current);
  }

  /**
   * Post turn notification to Discord webhook
   */
  function postTurnToDiscord(combatant) {
    if (!combatant) return;

    browserAPI.runtime.sendMessage({
      action: 'postToDiscord',
      payload: {
        type: 'turnStart',
        characterName: combatant.name,
        combatant: combatant.name,
        initiative: combatant.initiative,
        round: initiativeTracker.round
      }
    }).then(response => {
      if (response && response.success) {
        debug.log(`🎮 Discord: Posted turn for ${combatant.name}`);
      }
    }).catch(err => {
      // Webhook might not be configured - that's fine
      debug.log('Discord webhook not configured or failed:', err.message);
    });
  }

  /**
   * Post round change to Discord webhook
   */
  function postRoundChangeToDiscord(round) {
    const current = getCurrentCombatant();

    browserAPI.runtime.sendMessage({
      action: 'postToDiscord',
      payload: {
        type: 'roundChange',
        round: round,
        combatant: current ? current.name : null
      }
    }).then(response => {
      if (response && response.success) {
        debug.log(`🎮 Discord: Posted round ${round} change`);
      }
    }).catch(err => {
      debug.log('Discord webhook not configured or failed:', err.message);
    });
  }

  function announceTurn() {
    const current = getCurrentCombatant();
    if (!current) return;

    postChatMessage(`🎯 It's ${current.name}'s turn! (Initiative: ${current.initiative})`);
  }

  /**
   * Chat monitoring for initiative rolls
   */
  let chatObserver = null;

  function startChatMonitoring() {
    const chatLog = document.getElementById('textchat');
    if (!chatLog) {
      debug.warn('⚠️ Roll20 chat not found, cannot monitor for initiative');
      return;
    }

    // Watch for new messages
    chatObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === 1 && node.classList && node.classList.contains('message')) {
            checkForInitiativeRoll(node);
            checkForPlayerRoll(node); // Track any character roll for player overview
          }
        });
      });
    });

    chatObserver.observe(chatLog, {
      childList: true,
      subtree: true
    });

    debug.log('👀 Monitoring Roll20 chat for initiative rolls and player tracking');
  }

  function stopChatMonitoring() {
    if (chatObserver) {
      chatObserver.disconnect();
      chatObserver = null;
      debug.log('🛑 Stopped monitoring chat');
    }
  }

  /**
   * Check message for initiative roll
   */
  function checkForInitiativeRoll(messageNode) {
    const text = messageNode.textContent || '';
    const innerHTML = messageNode.innerHTML || '';

    // Debug: Log the message to see format
    debug.log('📨 Chat message (text):', text);
    debug.log('📨 Chat message (html):', innerHTML);

    // Skip our own announcements (turn changes, round starts, GM mode toggles)
    // These start with specific emojis and should not be parsed as initiative rolls
    const ownAnnouncementPrefixes = ['🎯', '⚔️', '👑'];
    const trimmedText = text.trim();
    for (const prefix of ownAnnouncementPrefixes) {
      if (trimmedText.includes(prefix)) {
        debug.log('⏭️ Skipping own announcement message');
        return;
      }
    }

    // Check for Roll20's inline roll format in HTML
    // Look for dice rolls with "inlinerollresult" class
    const inlineRolls = messageNode.querySelectorAll('.inlinerollresult');
    if (inlineRolls.length > 0) {
      // Check if message contains "initiative" keyword
      const lowerText = text.toLowerCase();
      if (lowerText.includes('initiative') || lowerText.includes('init')) {
        let characterName = null;

        // Try to extract from roll template caption first
        const rollTemplate = messageNode.querySelector('.sheet-rolltemplate-default, .sheet-rolltemplate-custom');
        if (rollTemplate) {
          const caption = rollTemplate.querySelector('caption, .sheet-template-name, .charname');
          if (caption) {
            const captionText = caption.textContent.trim();
            // Extract name from patterns like "🔵 Test 2 rolls Initiative" or "Name: Initiative"
            const nameMatch = captionText.match(/^(?:🔵|🔴|⚪|⚫|🟢|🟡|🟠|🟣|🟤)?\s*(.+?)\s+(?:rolls?\s+)?[Ii]nitiative/i);
            if (nameMatch) {
              characterName = nameMatch[1].trim();
            }
          }
        }

        // Fallback: Extract character name from .by element (regular chat messages)
        if (!characterName) {
          const byElement = messageNode.querySelector('.by');
          characterName = byElement ? byElement.textContent.trim().replace(/:/g, '') : null;
        }

        // Get the roll result from the last inline roll
        const lastRoll = inlineRolls[inlineRolls.length - 1];
        const rollResult = lastRoll.textContent.trim();
        const initiative = parseInt(rollResult);

        if (characterName && !isNaN(initiative) && initiative >= 0 && initiative <= 50) {
          debug.log(`🎲 Detected initiative roll (inline): ${characterName} = ${initiative}`);
          addCombatant(characterName, initiative, 'chat');
          return;
        }
      }
    }

    // Look for patterns like:
    // "Grey rolls Initiative Roll 21"
    // "Test 1 rolls Initiative Roll 22"
    // "CharacterName rolled a 15 for initiative"
    // "Initiative: 18"
    const initiativePatterns = [
      // Pattern 1: "Name rolls Initiative Roll 21" or "Name: rolls Initiative 21"
      /^(.+?)(?::)?\s+rolls?\s+[Ii]nitiative.*?(\d+)/,
      // Pattern 2: "Name rolled 15 for initiative"
      /^(.+?)\s+rolled?\s+(?:a\s+)?(\d+)\s+for\s+[Ii]nitiative/,
      // Pattern 3: Generic "Name ... initiative ... 15" (case insensitive)
      /^(.+?).*?[Ii]nitiative.*?(\d+)/,
      // Pattern 4: "Name ... Init ... 15"
      /^(.+?).*?[Ii]nit.*?(\d+)/
    ];

    for (const pattern of initiativePatterns) {
      const match = text.match(pattern);
      if (match) {
        let name = match[1].trim();
        // Remove trailing colons and "rolls" text
        name = name.replace(/\s*:?\s*rolls?$/i, '').trim();
        const initiative = parseInt(match[2]);

        if (name && !isNaN(initiative) && initiative >= 0 && initiative <= 50) {
          debug.log(`🎲 Detected initiative roll (text): ${name} = ${initiative}`);
          addCombatant(name, initiative, 'chat');
          return;
        }
      }
    }
  }

  /**
   * Check message for any character roll and track player
   */
  function checkForPlayerRoll(messageNode) {
    const text = messageNode.textContent || '';

    // Skip our own announcements
    const ownAnnouncementPrefixes = ['🎯', '⚔️', '👑', '🔓', '⏸️', '▶️', '📋'];
    const trimmedText = text.trim();
    for (const prefix of ownAnnouncementPrefixes) {
      if (trimmedText.includes(prefix)) {
        return;
      }
    }

    // Skip system messages
    if (text.includes('created the character') ||
        text.includes('Welcome to Roll20') ||
        text.includes('has joined the game')) {
      return;
    }

    // Skip initiative rolls (handled separately in initiative tracker)
    if (/\binitiative\b/i.test(text) || /\binit\b/i.test(text)) {
      debug.log('⏭️ Skipping initiative roll for player tracking');
      return;
    }

    // Check for inline rolls (indicates a character is rolling)
    const inlineRolls = messageNode.querySelectorAll('.inlinerollresult');
    if (inlineRolls.length === 0) {
      return; // No rolls, skip
    }

    let characterName = null;

    // Try to extract character name from roll template
    const rollTemplate = messageNode.querySelector('.sheet-rolltemplate-default, .sheet-rolltemplate-custom, [class*="rolltemplate"]');
    if (rollTemplate) {
      const caption = rollTemplate.querySelector('caption, .sheet-template-name, .charname, [class*="charname"]');
      if (caption) {
        const captionText = caption.textContent.trim();
        // Extract name from patterns like "🔵 Character Name rolls Attack" or "Character Name: Attack"
        const nameMatch = captionText.match(/^(?:🔵|🔴|⚪|⚫|🟢|🟡|🟠|🟣|🟤)?\s*(.+?)\s*(?:rolls?\s+|\s*:\s*|$)/i);
        if (nameMatch) {
          characterName = nameMatch[1].trim();
        }
      }
    }

    // Fallback: Try to extract from message structure
    if (!characterName) {
      const byElement = messageNode.querySelector('.by');
      if (byElement) {
        characterName = byElement.textContent.trim();
      }
    }

    // Fallback: Parse from message text
    if (!characterName) {
      // Pattern: "Character Name: roll result" or "Character Name rolls"
      const patterns = [
        /^(?:🔵|🔴|⚪|⚫|🟢|🟡|🟠|🟣|🟤)?\s*(.+?)\s*:/,
        /^(?:🔵|🔴|⚪|⚫|🟢|🟡|🟠|🟣|🟤)?\s*(.+?)\s+rolls?/i
      ];

      for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) {
          characterName = match[1].trim();
          break;
        }
      }
    }

    // If we got a character name, track them
    if (characterName && characterName.length > 0) {
      // Skip obviously non-player names
      const skipNames = ['gm', 'dm', 'roll20', 'system', 'the', 'a ', 'an '];
      const lowerName = characterName.toLowerCase();
      if (skipNames.some(skip => lowerName === skip || lowerName.startsWith(skip + ' '))) {
        return;
      }

      // Add to player tracking if not already tracked
      if (!playerData[characterName]) {
        debug.log(`👥 New player detected from roll: ${characterName}`);

        playerData[characterName] = {
          hp: null, // Will be updated when popup sends data
          maxHp: null,
          ac: null,
          passivePerception: null,
          initiative: null,
          conditions: [],
          concentration: null,
          deathSaves: null
        };

        updatePlayerOverviewDisplay();

        // Log to turn history
        logTurnAction({
          action: 'turn',
          description: `${characterName} detected in combat`
        });
      }
    }
  }

  /**
   * Register a character popup window
   * Called by character-sheet-overlay when opening a popup
   */
  window.rollcloudRegisterPopup = function(characterName, popupWindow) {
    if (characterName && popupWindow) {
      characterPopups[characterName] = popupWindow;
      debug.log(`✅ Registered popup for: ${characterName}`);
    }
  };

  /**
   * Check recent chat messages to see if it's currently this character's turn
   */
  function checkRecentChatForCurrentTurn(characterName, popupWindow) {
    try {
      const chatLog = document.getElementById('textchat');
      if (!chatLog) {
        debug.warn('⚠️ Roll20 chat not found for turn check');
        return;
      }

      // Get recent messages (last 20 or so)
      const messages = chatLog.querySelectorAll('.message');
      const recentMessages = Array.from(messages).slice(-20);
      
      debug.log(`🔍 Checking recent ${recentMessages.length} messages for current turn of: ${characterName}`);

      // Helper function to normalize names
      function normalizeName(name) {
        return name
          .replace(/^(?:🔵|🔴|⚪|⚫|🟢|🟡|🟠|🟣|🟤)\s*/, '') // Remove emoji prefixes
          .replace(/^It's\s+/i, '') // Remove "It's" prefix
          .replace(/'s\s+turn.*$/i, '') // Remove "'s turn" suffix
          .trim();
      }

      const normalizedCharacterName = normalizeName(characterName);

      // Look for recent turn announcement
      for (let i = recentMessages.length - 1; i >= 0; i--) {
        const message = recentMessages[i];
        const text = message.textContent || '';
        
        // Check for turn announcement pattern
        const turnMatch = text.match(/🎯 It's (.+?)'s turn! \(Initiative: (\d+)\)/);
        if (turnMatch) {
          const announcedCharacter = normalizeName(turnMatch[1]);
          const initiative = parseInt(turnMatch[2]);
          
          debug.log(`🔍 Found turn announcement: "${turnMatch[1]}" (normalized: "${announcedCharacter}") vs "${characterName}" (normalized: "${normalizedCharacterName}")`);
          
          if (announcedCharacter === normalizedCharacterName) {
            debug.log(`✅ It's ${characterName}'s turn! Activating action economy...`);
            
            // Send activateTurn to this popup
            popupWindow.postMessage({
              action: 'activateTurn',
              combatant: characterName
            }, '*');
            
            return;
          } else {
            debug.log(`⏸️ It's ${turnMatch[1]}'s turn, not ${characterName}. Deactivating...`);
            
            // Send deactivateTurn to this popup
            popupWindow.postMessage({
              action: 'deactivateTurn',
              combatant: characterName
            }, '*');
            
            return;
          }
        }
      }
      
      debug.log(`🔍 No recent turn announcement found for ${characterName}`);
      
    } catch (error) {
      debug.error('Error checking recent chat for current turn:', error);
    }
  }

  // Listen for messages to toggle GM mode and post chat messages
  window.addEventListener('message', (event) => {
    debug.log('📨 Received message:', event.data);

    if (event.data && event.data.action === 'toggleGMMode') {
      debug.log('👑 Processing toggleGMMode message:', event.data.enabled);
      toggleGMMode(event.data.enabled);
    } else if (event.data && event.data.action === 'registerPopup') {
      // Register popup window for turn notifications
      if (event.data.characterName && event.source) {
        window.rollcloudRegisterPopup(event.data.characterName, event.source);
        debug.log(`✅ Registered popup via message for: ${event.data.characterName}`);
      }
    } else if (event.data && event.data.action === 'postChatMessageFromPopup') {
      // Post message from character sheet popup to Roll20 chat
      postChatMessage(event.data.message);
    } else if (event.data && event.data.action === 'checkCurrentTurn') {
      // Check if it's currently this character's turn by examining recent chat
      if (event.data.characterName) {
        checkRecentChatForCurrentTurn(event.data.characterName, event.source);
      }
    } else if (event.data && event.data.action === 'updatePlayerData') {
      // Receive player data updates for GM overview
      if (event.data.characterName && event.data.data) {
        updatePlayerData(event.data.characterName, event.data.data);
      }
    } else if (event.data && event.data.action === 'postToDiscordFromPopup') {
      // Forward Discord webhook post from popup to background script
      if (event.data.payload) {
        browserAPI.runtime.sendMessage({
          action: 'postToDiscord',
          payload: event.data.payload
        }).then(response => {
          if (response && response.success) {
            debug.log(`🎮 Discord: Forwarded action update from popup`);
          }
        }).catch(err => {
          debug.log('Discord webhook not configured or failed:', err.message);
        });
      }
    }
  });

  browserAPI.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'toggleGMMode') {
      toggleGMMode(request.enabled);
      sendResponse({ success: true });
    }

    // Handle active character changes for experimental two-way sync
    if (request.action === 'activeCharacterChanged') {
      debug.log('🔄 Active character changed, re-initializing sync:', request.characterId);

      // Re-initialize the sync with the new character
      if (window.diceCloudSync && typeof window.diceCloudSync.initialize === 'function') {
        debug.log('🔄 Re-initializing DiceCloud sync with character:', request.characterId);
        window.diceCloudSync.initialize(request.characterId)
          .then(() => {
            debug.log('✅ DiceCloud sync re-initialized successfully');
            sendResponse({ success: true });
          })
          .catch(error => {
            debug.error('❌ Failed to re-initialize DiceCloud sync:', error);
            sendResponse({ success: false, error: error.message });
          });
        return true; // Keep message channel open for async response
      } else {
        debug.warn('⚠️ DiceCloud sync not available for re-initialization');
        sendResponse({ success: false, error: 'Sync not available' });
      }
    }
  });

  /**
   * Start monitoring for character selection changes in Roll20
   * This detects when a character is selected and marks them as active
   */
  function startCharacterSelectionMonitor() {
    debug.log('🔍 Starting character selection monitor...');
    
    let lastSelectedCharacter = null;
    
    // Function to check for currently selected character
    function checkSelectedCharacter() {
      try {
        // Try multiple methods to detect selected character
        let selectedCharacter = null;
        
        // Method 1: Check for selected token in Roll20
        const selectedTokens = document.querySelectorAll('.token.selected, .token.selected-token');
        if (selectedTokens.length > 0) {
          // Get character name from token
          const token = selectedTokens[0];
          const tokenName = token.getAttribute('data-name') || 
                           token.getAttribute('title') || 
                           token.querySelector('.token-name')?.textContent ||
                           token.textContent;
          
          if (tokenName && tokenName.trim()) {
            selectedCharacter = tokenName.trim();
            debug.log(`🎯 Detected selected token: ${selectedCharacter}`);
          }
        }
        
        // Method 2: Check for active character in Roll20's UI
        if (!selectedCharacter) {
          const activeCharElement = document.querySelector('.character-item.active, .character.active, [data-character-id].active');
          if (activeCharElement) {
            selectedCharacter = activeCharElement.textContent?.trim() || 
                               activeCharElement.getAttribute('data-character-name');
            debug.log(`🎯 Detected active character in UI: ${selectedCharacter}`);
          }
        }
        
        // Method 3: Check Roll20's window object for current character
        if (!selectedCharacter && typeof window !== 'undefined' && window.Campaign) {
          try {
            const activeCharacter = window.Campaign.activeCharacter();
            if (activeCharacter && activeCharacter.attributes && activeCharacter.attributes.name) {
              selectedCharacter = activeCharacter.attributes.name;
              debug.log(`🎯 Detected active character from Campaign: ${selectedCharacter}`);
            }
          } catch (e) {
            // Campaign API might not be available
          }
        }
        
        // If we found a selected character and it's different from last time
        if (selectedCharacter && selectedCharacter !== lastSelectedCharacter) {
          debug.log(`✅ Character selection changed: "${lastSelectedCharacter}" → "${selectedCharacter}"`);
          lastSelectedCharacter = selectedCharacter;
          
          // Mark this character as active in Supabase
          markCharacterAsActive(selectedCharacter);
        }
        
      } catch (error) {
        debug.warn('⚠️ Error checking selected character:', error);
      }
    }
    
    // Check immediately
    checkSelectedCharacter();
    
    // Set up periodic checking (every 2 seconds)
    const checkInterval = setInterval(checkSelectedCharacter, 2000);
    
    // Also check when user clicks on the page (likely to select a token)
    document.addEventListener('click', () => {
      setTimeout(checkSelectedCharacter, 100); // Small delay to allow UI to update
    });
    
    // Clean up on page unload
    window.addEventListener('beforeunload', () => {
      clearInterval(checkInterval);
    });
    
    debug.log('✅ Character selection monitor started');
  }
  
  /**
   * Mark a character as active in Supabase
   */
  async function markCharacterAsActive(characterName) {
    try {
      debug.log(`🎯 Marking character as active: ${characterName}`);
      
      // Get current character profiles from storage
      const result = await browserAPI.storage.local.get(['characterProfiles']);
      const characterProfiles = result.characterProfiles || {};
      
      // Find the character ID that matches this name
      let characterId = null;
      for (const [id, profile] of Object.entries(characterProfiles)) {
        if (profile.name === characterName || profile.character_name === characterName) {
          characterId = id;
          break;
        }
      }
      
      if (characterId) {
        // Send message to background script to update active status
        const response = await browserAPI.runtime.sendMessage({
          action: 'setActiveCharacter',
          characterId: characterId
        });
        
        if (response && response.success) {
          debug.log(`✅ Successfully marked ${characterName} as active`);
        } else {
          debug.warn(`⚠️ Failed to mark ${characterName} as active:`, response);
        }
      } else {
        debug.warn(`⚠️ Could not find character ID for ${characterName} in local storage`);
      }
      
    } catch (error) {
      debug.error(`❌ Error marking character as active:`, error);
    }
  }

  // Listen for openGMMode custom event from character-sheet-overlay.js
  document.addEventListener('openGMMode', () => {
    debug.log('✅ Received openGMMode event - opening GM panel');
    try {
      postChatMessage('👑 Opening GM mode...');
    } catch (error) {
      debug.error(' Error posting chat message:', error);
    }
    toggleGMMode(true);
  });

  // Load player data from storage on initialization to ensure it's available
  // for checks before GM panel is created
  loadPlayerDataFromStorage();

  // Start monitoring for character selection changes
  startCharacterSelectionMonitor();

  // Initialize experimental two-way sync if available
  if (typeof browserAPI !== 'undefined' && browserAPI.runtime) {
    // Check if this is an experimental build by asking background script
    browserAPI.runtime.sendMessage({ action: 'getManifest' }).then(response => {
      if (response && response.success && response.manifest) {
        debug.log('🔍 Manifest check:', response.manifest);
        debug.log('🔍 Manifest name:', response.manifest.name);

        if (response.manifest.name && response.manifest.name.toLowerCase().includes('experimental')) {
          debug.log('🧪 Experimental build detected, initializing two-way sync...');
          
          // Scripts are loaded as content scripts, just initialize
          setTimeout(() => {
            // Debug: Check what's available on window
            debug.log('🔍 Window objects check:', {
              DDPClient: typeof window.DDPClient,
              initializeDiceCloudSync: typeof window.initializeDiceCloudSync,
              DiceCloudSync: typeof window.DiceCloudSync
            });
            
            // Initialize the sync
            if (typeof window.initializeDiceCloudSync === 'function') {
              debug.log('✅ Calling initializeDiceCloudSync function...');
              window.initializeDiceCloudSync();
              debug.log('✅ Experimental two-way sync initialized');
            } else {
              debug.warn('⚠️ DiceCloud sync initialization function not found');
              debug.warn('⚠️ Available window properties:', Object.keys(window).filter(key => key.toLowerCase().includes('dicecloud') || key.toLowerCase().includes('sync')));
            }
          }, 500); // Wait for content scripts to fully load
        } else {
          debug.log('📦 Standard build detected, skipping experimental sync');
        }
      } else {
        debug.log('📦 Could not get manifest info, assuming standard build');
      }
    }).catch(error => {
      debug.log('📦 Standard build detected (error), skipping experimental sync:', error);
    });
  } else {
    debug.log('❌ browserAPI.runtime not available');
  }

  debug.log(' Roll20 script ready - listening for roll announcements and GM mode');
})();
