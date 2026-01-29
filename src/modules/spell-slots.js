/**
 * Spell Slots Module
 *
 * Handles spell slot display, adjustment, and recovery (Arcane Recovery).
 * Loaded as a plain script (no ES6 modules) to export to globalThis.
 *
 * Functions exported to globalThis:
 * - buildSpellSlotsDisplay()
 * - adjustSpellSlot(level, current, max, isPactMagic)
 * - handleRecoverSpellSlot(action)
 * - recoverSpellSlot(slot, action, maxLevel)
 */

(function() {
  'use strict';

  // ===== SPELL SLOT DISPLAY FUNCTIONS =====

  /**
   * Build spell slots display with Pact Magic support
   */
  function buildSpellSlotsDisplay() {
    const container = document.getElementById('spell-slots-container');

    if (typeof characterData === 'undefined' || !characterData || !characterData.spellSlots) {
      container.innerHTML = '<p style="text-align: center; color: #666;">No spell slots available</p>';
      debug.log('⚠️ No spell slots in character data');
      // Collapse the section when empty
      if (typeof collapseSectionByContainerId !== 'undefined') {
        collapseSectionByContainerId('spell-slots-container');
      }
      return;
    }

    const slotsGrid = document.createElement('div');
    slotsGrid.className = 'spell-slots-grid';

    let hasAnySlots = false;
    let totalCurrentSlots = 0;
    let totalMaxSlots = 0;

    // Check for Pact Magic (Warlock) - stored separately from regular slots
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

    debug.log(`🔮 Spell slots display - Pact Magic: level=${pactMagicSlotLevel} (effective=${effectivePactLevel}), slots=${pactMagicSlots}/${pactMagicSlotsMax}, hasPact=${hasPactMagic}`);

    // Add Pact Magic slots first if present
    if (hasPactMagic) {
      hasAnySlots = true;
      totalCurrentSlots += pactMagicSlots;
      totalMaxSlots += pactMagicSlotsMax;

      const slotCard = document.createElement('div');
      slotCard.className = pactMagicSlots > 0 ? 'spell-slot-card pact-magic' : 'spell-slot-card pact-magic empty';
      slotCard.style.cssText = 'background: linear-gradient(135deg, #6b3fa0, #9b59b6); border: 2px solid #8e44ad;';

      slotCard.innerHTML = `
        <div class="spell-slot-level">Pact (${effectivePactLevel})</div>
        <div class="spell-slot-count">${pactMagicSlots}/${pactMagicSlotsMax}</div>
      `;

      // Add click to manually adjust Pact Magic slots
      slotCard.addEventListener('click', () => {
        adjustSpellSlot(`pact:${effectivePactLevel}`, pactMagicSlots, pactMagicSlotsMax, true);
      });
      slotCard.style.cursor = 'pointer';
      slotCard.title = 'Click to adjust Pact Magic slots (recharge on short rest)';

      slotsGrid.appendChild(slotCard);
    }

    // Check each level (1-9) for regular spell slots
    for (let level = 1; level <= 9; level++) {
      const slotVar = `level${level}SpellSlots`;
      const slotMaxVar = `level${level}SpellSlotsMax`;

      const maxSlots = characterData.spellSlots[slotMaxVar] || 0;

      // Only show if character has regular slots at this level
      if (maxSlots > 0) {
        hasAnySlots = true;
        const currentSlots = characterData.spellSlots[slotVar] || 0;

        // Track totals
        totalCurrentSlots += currentSlots;
        totalMaxSlots += maxSlots;

        const slotCard = document.createElement('div');
        slotCard.className = currentSlots > 0 ? 'spell-slot-card' : 'spell-slot-card empty';

        slotCard.innerHTML = `
          <div class="spell-slot-level">Level ${level}</div>
          <div class="spell-slot-count">${currentSlots}/${maxSlots}</div>
        `;

        // Add click to manually adjust slots with hover effect
        slotCard.addEventListener('click', () => {
          adjustSpellSlot(level, currentSlots, maxSlots);
        });
        slotCard.style.cursor = 'pointer';
        slotCard.title = 'Click to adjust spell slots';

        slotsGrid.appendChild(slotCard);
      }
    }

    if (hasAnySlots) {
      container.innerHTML = '';

      // Add total slots summary
      const summaryCard = document.createElement('div');
      summaryCard.className = 'spell-slots-summary';
      summaryCard.style.cssText = `
        background: linear-gradient(135deg, #9b59b6 0%, #8e44ad 100%);
        color: white;
        padding: 12px;
        border-radius: 8px;
        text-align: center;
        margin-bottom: 15px;
        font-weight: bold;
        box-shadow: 0 2px 8px rgba(155, 89, 182, 0.3);
      `;

      const totalPercent = totalMaxSlots > 0 ? (totalCurrentSlots / totalMaxSlots) * 100 : 0;
      summaryCard.innerHTML = `
        <div style="font-size: 14px; opacity: 0.9;">Total Spell Slots</div>
        <div style="font-size: 20px; margin: 4px 0;">${totalCurrentSlots}/${totalMaxSlots}</div>
        <div style="font-size: 12px; opacity: 0.8;">${Math.round(totalPercent)}% remaining</div>
      `;

      container.appendChild(summaryCard);
      container.appendChild(slotsGrid);

      // Add a small note
      const note = document.createElement('p');
      note.style.cssText = 'text-align: center; color: #666; font-size: 0.85em; margin-top: 8px;';
      note.textContent = 'Click a slot to manually adjust';
      container.appendChild(note);

      debug.log(`✨ Spell slots display: ${totalCurrentSlots}/${totalMaxSlots} total slots across ${Math.max(...Array.from({length: 9}, (_, i) => i + 1).filter(level => characterData.spellSlots[`level${level}SpellSlotsMax`] > 0))} levels`);
      // Expand the section when it has content
      if (typeof expandSectionByContainerId !== 'undefined') {
        expandSectionByContainerId('spell-slots-container');
      }
    } else {
      container.innerHTML = '<p style="text-align: center; color: #666;">No spell slots available</p>';
      debug.log('⚠️ Character has 0 max slots for all levels');
      // Collapse the section when empty
      if (typeof collapseSectionByContainerId !== 'undefined') {
        collapseSectionByContainerId('spell-slots-container');
      }
    }
  }

  /**
   * Manually adjust spell slot value
   */
  function adjustSpellSlot(level, current, max, isPactMagic = false) {
    // Check if this is a Pact Magic slot (format: "pact:${level}")
    const isPact = isPactMagic || (typeof level === 'string' && level.startsWith('pact:'));
    const actualLevel = isPact ? parseInt(level.toString().split(':')[1] || level) : level;

    const slotLabel = isPact ? `Pact Magic (Level ${actualLevel})` : `Level ${actualLevel}`;
    const newValue = prompt(`Adjust ${slotLabel} Spell Slots\n\nCurrent: ${current}/${max}\n\nEnter new current value (0-${max}):`);

    if (newValue === null) return; // Cancelled

    const parsed = parseInt(newValue);
    if (isNaN(parsed) || parsed < 0 || parsed > max) {
      if (typeof showNotification !== 'undefined') {
        showNotification('❌ Invalid value', 'error');
      }
      return;
    }

    if (isPact) {
      characterData.spellSlots.pactMagicSlots = parsed;
    } else {
      const slotVar = `level${actualLevel}SpellSlots`;
      characterData.spellSlots[slotVar] = parsed;
    }

    if (typeof saveCharacterData !== 'undefined') {
      saveCharacterData();
    }
    if (typeof buildSheet !== 'undefined') {
      buildSheet(characterData);
    }

    if (typeof showNotification !== 'undefined') {
      showNotification(`✅ ${slotLabel} slots set to ${parsed}/${max}`);
    }
  }

  // ===== ARCANE RECOVERY FUNCTIONS =====

  /**
   * Handle Arcane Recovery action (Wizard feature)
   * Recovers spell slots up to (proficiency bonus / 2) level
   */
  function handleRecoverSpellSlot(action) {
    // Calculate max recoverable level from proficiency bonus
    const profBonus = characterData.proficiencyBonus || 2;
    const maxLevel = Math.ceil(profBonus / 2);

    debug.log(`🔮 Recover Spell Slot: proficiencyBonus=${profBonus}, maxLevel=${maxLevel}`);

    // Find available spell slots of eligible levels
    const eligibleSlots = [];
    for (let level = 1; level <= maxLevel && level <= 9; level++) {
      const slotKey = `level${level}SpellSlots`;
      const maxKey = `level${level}SpellSlotsMax`;

      if (characterData[slotKey] !== undefined && characterData[maxKey] !== undefined) {
        const current = characterData[slotKey];
        const max = characterData[maxKey];

        if (current < max) {
          eligibleSlots.push({ level, current, max, slotKey, maxKey });
        }
      }
    }

    if (eligibleSlots.length === 0) {
      if (typeof showNotification !== 'undefined') {
        showNotification(`❌ No spell slots to recover (max level: ${maxLevel})`, 'error');
      }
      return;
    }

    // If only one eligible slot, recover it automatically
    if (eligibleSlots.length === 1) {
      const slot = eligibleSlots[0];
      recoverSpellSlot(slot, action, maxLevel);
      return;
    }

    // If multiple slots, let user choose
    let message = `Recover Spell Slot (max level: ${maxLevel})\n\nChoose which spell slot to recover:\n\n`;
    eligibleSlots.forEach((slot, index) => {
      message += `${index + 1}. Level ${slot.level}: ${slot.current}/${slot.max}\n`;
    });

    const choice = prompt(message);
    if (choice === null) return; // Cancelled

    const choiceIndex = parseInt(choice) - 1;
    if (isNaN(choiceIndex) || choiceIndex < 0 || choiceIndex >= eligibleSlots.length) {
      if (typeof showNotification !== 'undefined') {
        showNotification('❌ Invalid choice', 'error');
      }
      return;
    }

    const selectedSlot = eligibleSlots[choiceIndex];
    recoverSpellSlot(selectedSlot, action, maxLevel);
  }

  /**
   * Recover a spell slot (Arcane Recovery)
   */
  function recoverSpellSlot(slot, action, maxLevel) {
    // Increment the spell slot
    characterData[slot.slotKey] = Math.min(characterData[slot.slotKey] + 1, characterData[slot.maxKey]);

    if (typeof saveCharacterData !== 'undefined') {
      saveCharacterData();
    }

    // Create description with resolved formula
    const description = `You expend a use of your Channel Divinity to fuel your spells. As a bonus action, you touch your holy symbol, utter a prayer, and regain one expended spell slot, the level of which can be no higher than ${maxLevel}.`;

    // Announce the action
    if (typeof announceAction !== 'undefined') {
      announceAction({
        name: action.name,
        description: description,
        actionType: action.actionType || 'bonus'
      });
    }

    if (typeof showNotification !== 'undefined') {
      showNotification(`🔮 Recovered Level ${slot.level} Spell Slot (${characterData[slot.slotKey]}/${characterData[slot.maxKey]})`, 'success');
    }

    // Refresh display
    if (typeof buildSheet !== 'undefined') {
      buildSheet(characterData);
    }
  }

  // ===== EXPORTS =====

  globalThis.buildSpellSlotsDisplay = buildSpellSlotsDisplay;
  globalThis.adjustSpellSlot = adjustSpellSlot;
  globalThis.handleRecoverSpellSlot = handleRecoverSpellSlot;
  globalThis.recoverSpellSlot = recoverSpellSlot;

})();
