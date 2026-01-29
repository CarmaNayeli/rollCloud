/**
 * Spell Casting Module
 *
 * Core spell casting logic including slot consumption, upcasting, and resource usage.
 * Loaded as a plain script (no ES6 modules) to export to globalThis.
 *
 * Functions exported to globalThis:
 * - castSpell(spell, index, afterCast, selectedSlotLevel, selectedMetamagic, skipSlotConsumption, skipAnnouncement)
 * - detectClassResources(spell)
 * - showResourceChoice(spell, spellLevel, spellSlots, maxSlots, classResources)
 * - showUpcastChoice(spell, originalLevel, afterCast)
 * - castWithSlot(spell, slot, metamagicOptions, afterCast)
 * - useClassResource(resource, spell)
 */

(function() {
  'use strict';

  // ===== MAIN CASTING FUNCTION =====

  /**
   * Main spell casting function
   * Handles cantrips, magic items, upcasting, and all spell slot logic
   */
  function castSpell(spell, index, afterCast = null, selectedSlotLevel = null, selectedMetamagic = [], skipSlotConsumption = false, skipAnnouncement = false) {
    debug.log('✨ Attempting to cast:', spell.name, spell, 'at level:', selectedSlotLevel, 'with metamagic:', selectedMetamagic, 'skipSlot:', skipSlotConsumption, 'skipAnnouncement:', skipAnnouncement);

    if (typeof characterData === 'undefined' || !characterData) {
      if (typeof showNotification !== 'undefined') {
        showNotification('❌ Character data not available', 'error');
      }
      return;
    }

    // Check if spell is from a magic item (doesn't consume spell slots)
    const isMagicItemSpell = spell.source && (
      spell.source.toLowerCase().includes('amulet') ||
      spell.source.toLowerCase().includes('ring') ||
      spell.source.toLowerCase().includes('wand') ||
      spell.source.toLowerCase().includes('staff') ||
      spell.source.toLowerCase().includes('rod') ||
      spell.source.toLowerCase().includes('cloak') ||
      spell.source.toLowerCase().includes('boots') ||
      spell.source.toLowerCase().includes('bracers') ||
      spell.source.toLowerCase().includes('gauntlets') ||
      spell.source.toLowerCase().includes('helm') ||
      spell.source.toLowerCase().includes('armor') ||
      spell.source.toLowerCase().includes('weapon') ||
      spell.source.toLowerCase().includes('talisman') ||
      spell.source.toLowerCase().includes('orb') ||
      spell.source.toLowerCase().includes('scroll') ||
      spell.source.toLowerCase().includes('potion')
    );

    // Check if spell has resources field indicating it doesn't consume spell slots
    // Only treat as free if resources.itemsConsumed is explicitly defined (magic items)
    // Normal spells should NOT match this condition
    const isFreeSpell = spell.resources &&
                         spell.resources.itemsConsumed &&
                         spell.resources.itemsConsumed.length > 0;

    // Cantrips (level 0), magic item spells, free spells, or concentration recast don't need slots
    if (!spell.level || spell.level === 0 || spell.level === '0' || isMagicItemSpell || isFreeSpell || skipSlotConsumption) {
      const reason = skipSlotConsumption ? 'concentration recast' : (isMagicItemSpell ? 'magic item' : (isFreeSpell ? 'free spell' : 'cantrip'));
      debug.log(`✨ Casting ${reason} (no spell slot needed)`);
      if (!skipAnnouncement && typeof announceSpellCast !== 'undefined') {
        announceSpellCast(spell, skipSlotConsumption ? 'concentration recast (no slot)' : ((isMagicItemSpell || isFreeSpell) ? `${spell.source} (no slot)` : null));
      }
      if (typeof showNotification !== 'undefined') {
        showNotification(`✨ ${skipSlotConsumption ? 'Using' : 'Cast'} ${spell.name}!`);
      }

      // Handle concentration
      if (spell.concentration && !skipSlotConsumption && typeof setConcentration !== 'undefined') {
        setConcentration(spell.name);
      }

      // Track reuseable spells (Spiritual Weapon, Meld into Stone, etc.)
      const shouldTrackAsReusable = (typeof isReuseableSpell !== 'undefined') ? isReuseableSpell(spell.name, characterData) : false;
      if (shouldTrackAsReusable && !skipSlotConsumption) {
        const castSpellsKey = `castSpells_${characterData.name}`;
        const castSpells = JSON.parse(localStorage.getItem(castSpellsKey) || '[]');
        if (!castSpells.includes(spell.name)) {
          castSpells.push(spell.name);
          localStorage.setItem(castSpellsKey, JSON.stringify(castSpells));
          debug.log(`✅ Tracked reuseable spell: ${spell.name}`);
        }
      }

      // Execute afterCast with a fake slot for magic items and free spells to allow formulas to work
      if (afterCast && typeof afterCast === 'function') {
        setTimeout(() => {
          // For magic items, free spells, and concentration recasts, create a slot object with the appropriate level
          const fakeSlotLevel = skipSlotConsumption && selectedSlotLevel ? selectedSlotLevel : spell.level;
          const fakeSlot = ((isMagicItemSpell || isFreeSpell || skipSlotConsumption) && fakeSlotLevel) ? { level: parseInt(fakeSlotLevel) } : null;
          afterCast(spell, fakeSlot);
        }, 300);
      }
      return;
    }

    const spellLevel = parseInt(spell.level);

    // If slot level was selected in modal, use it directly
    if (selectedSlotLevel !== null) {
      // Check if slots are nested in spellSlots object or at top level
      const slotsObject = characterData.spellSlots || characterData;

      // Check if this is a Pact Magic slot (format: "pact:${level}")
      const isPactMagicSlot = typeof selectedSlotLevel === 'string' && selectedSlotLevel.startsWith('pact:');
      let actualLevel, slotVar, currentSlots, slotLabel;

      if (isPactMagicSlot) {
        // Parse pact magic slot level
        actualLevel = parseInt(selectedSlotLevel.split(':')[1]);
        slotVar = 'pactMagicSlots';
        // Check both spellSlots and otherVariables for Pact Magic
        currentSlots = slotsObject.pactMagicSlots ?? characterData.otherVariables?.pactMagicSlots ?? 0;
        const isUpcast = actualLevel > spellLevel;
        slotLabel = isUpcast ? `Pact Magic (level ${actualLevel}, upcast from ${spellLevel})` : `Pact Magic (level ${actualLevel})`;
        debug.log(`🔮 Using Pact Magic slot at level ${actualLevel}, current=${currentSlots}`);
      } else {
        // Regular spell slot
        actualLevel = parseInt(selectedSlotLevel);
        slotVar = `level${actualLevel}SpellSlots`;
        currentSlots = slotsObject[slotVar] || 0;
        const isUpcast = actualLevel > spellLevel;
        slotLabel = isUpcast ? `level ${actualLevel} slot (upcast from ${spellLevel})` : `level ${actualLevel} slot`;
      }

      if (currentSlots <= 0) {
        if (typeof showNotification !== 'undefined') {
          showNotification(`❌ No ${slotLabel} remaining!`, 'error');
        }
        return;
      }

      // Consume the slot - update both spellSlots and otherVariables for Pact Magic
      if (isPactMagicSlot) {
        // Decrement pact magic in all locations where it might be stored
        if (slotsObject.pactMagicSlots !== undefined) {
          slotsObject.pactMagicSlots = currentSlots - 1;
        }
        if (characterData.otherVariables?.pactMagicSlots !== undefined) {
          characterData.otherVariables.pactMagicSlots = currentSlots - 1;
        }
        debug.log(`🔮 Consumed Pact Magic slot: ${currentSlots} -> ${currentSlots - 1}`);
      } else {
        slotsObject[slotVar] = currentSlots - 1;
      }

      if (typeof saveCharacterData !== 'undefined') {
        saveCharacterData();
      }
      if (typeof buildSheet !== 'undefined') {
        buildSheet(characterData);
      }

      // Apply metamagic costs
      if (selectedMetamagic && selectedMetamagic.length > 0) {
        // TODO: Deduct sorcery points based on selected metamagic
        debug.log('Metamagic selected:', selectedMetamagic);
      }

      // Update selectedSlotLevel to actual level for formula resolution
      selectedSlotLevel = actualLevel;

      if (!skipAnnouncement && typeof announceSpellCast !== 'undefined') {
        announceSpellCast(spell, slotLabel);
      }
      if (typeof showNotification !== 'undefined') {
        showNotification(`✨ Cast ${spell.name} using ${slotLabel}!`);
      }

      // Handle concentration
      if (spell.concentration && typeof setConcentration !== 'undefined') {
        setConcentration(spell.name);
      }

      // Track reuseable spells (Spiritual Weapon, Meld into Stone, etc.)
      const shouldTrackAsReusable = (typeof isReuseableSpell !== 'undefined') ? isReuseableSpell(spell.name, characterData) : false;
      if (shouldTrackAsReusable) {
        const castSpellsKey = `castSpells_${characterData.name}`;
        const castSpells = JSON.parse(localStorage.getItem(castSpellsKey) || '[]');
        if (!castSpells.includes(spell.name)) {
          castSpells.push(spell.name);
          localStorage.setItem(castSpellsKey, JSON.stringify(castSpells));
          debug.log(`✅ Tracked reuseable spell: ${spell.name}`);
        }
      }

      // Execute afterCast
      if (afterCast && typeof afterCast === 'function') {
        setTimeout(() => {
          afterCast(spell, { level: selectedSlotLevel });
        }, 300);
      }
      return;
    }

    // No slot level selected - show upcast choice (legacy behavior)
    // Check for Divine Smite special handling
    if (spell.name.toLowerCase().includes('divine smite')) {
      debug.log(`⚡ Divine Smite spell detected, showing custom modal instead of upcast`);
      if (typeof showDivineSmiteModal !== 'undefined') {
        showDivineSmiteModal(spell);
      }
      return;
    }

    showUpcastChoice(spell, spellLevel, afterCast);
  }

  /**
   * Detect class resources (wrapper for action-executor)
   */
  function detectClassResources(spell) {
    if (typeof executorDetectClassResources !== 'undefined' && typeof characterData !== 'undefined') {
      return executorDetectClassResources(characterData);
    }
    return [];
  }

  // ===== RESOURCE CHOICE MODAL =====

  /**
   * Show modal to choose between spell slot and class resources (Ki, Sorcery Points, etc.)
   */
  function showResourceChoice(spell, spellLevel, spellSlots, maxSlots, classResources) {
    // Create modal overlay
    const modal = document.createElement('div');
    modal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; z-index: 10000;';

    // Create modal content
    const modalContent = document.createElement('div');
    modalContent.style.cssText = 'background: var(--bg-secondary); color: var(--text-primary); padding: 30px; border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,0.3); max-width: 400px; width: 90%;';

    let buttonsHTML = `
      <h3 style="margin: 0 0 20px 0; color: var(--text-primary); text-align: center;">Cast ${spell.name}</h3>
      <p style="text-align: center; color: var(--text-secondary); margin-bottom: 25px;">Choose a resource:</p>
      <div style="display: flex; flex-direction: column; gap: 12px;">
    `;

    // Add spell slot option if available
    if (spellSlots > 0) {
      buttonsHTML += `
        <button class="resource-choice-btn" data-type="spell-slot" data-level="${spellLevel}" style="padding: 15px; font-size: 1em; font-weight: bold; background: #9b59b6; color: white; border: 2px solid #9b59b6; border-radius: 8px; cursor: pointer; transition: all 0.2s; text-align: left;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span>Level ${spellLevel} Spell Slot</span>
            <span style="background: rgba(255,255,255,0.3); padding: 4px 8px; border-radius: 4px; font-size: 0.9em;">${spellSlots}/${maxSlots}</span>
          </div>
        </button>
      `;
    }

    // Add class resource options
    classResources.forEach((resource, idx) => {
      const colors = {
        'Ki': { bg: '#f39c12', border: '#f39c12' },
        'Sorcery Points': { bg: '#e74c3c', border: '#e74c3c' },
        'Pact Magic': { bg: '#16a085', border: '#16a085' },
        'Channel Divinity': { bg: '#3498db', border: '#3498db' }
      };
      const color = colors[resource.name] || { bg: '#95a5a6', border: '#95a5a6' };

      buttonsHTML += `
        <button class="resource-choice-btn" data-type="class-resource" data-index="${idx}" style="padding: 15px; font-size: 1em; font-weight: bold; background: ${color.bg}; color: white; border: 2px solid ${color.border}; border-radius: 8px; cursor: pointer; transition: all 0.2s; text-align: left;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span>${resource.name}</span>
            <span style="background: rgba(255,255,255,0.3); padding: 4px 8px; border-radius: 4px; font-size: 0.9em;">${resource.current}/${resource.max}</span>
          </div>
        </button>
      `;
    });

    buttonsHTML += `
      </div>
      <button id="resource-cancel" style="width: 100%; margin-top: 20px; padding: 12px; font-size: 1em; background: #95a5a6; color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: bold;">
        Cancel
      </button>
    `;

    modalContent.innerHTML = buttonsHTML;
    modal.appendChild(modalContent);
    document.body.appendChild(modal);

    // Add hover effects
    const resourceBtns = modalContent.querySelectorAll('.resource-choice-btn');
    resourceBtns.forEach(btn => {
      btn.addEventListener('mouseenter', () => {
        btn.style.transform = 'translateY(-2px)';
        btn.style.boxShadow = '0 4px 12px rgba(0,0,0,0.2)';
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.transform = 'translateY(0)';
        btn.style.boxShadow = 'none';
      });

      btn.addEventListener('click', () => {
        const type = btn.dataset.type;

        if (type === 'spell-slot') {
          const level = parseInt(btn.dataset.level);
          modal.remove();
          // Check if they want to upcast
          showUpcastChoice(spell, level);
        } else if (type === 'class-resource') {
          const resourceIdx = parseInt(btn.dataset.index);
          const resource = classResources[resourceIdx];
          modal.remove();
          if (useClassResource(resource, spell) && typeof announceSpellCast !== 'undefined') {
            announceSpellCast(spell, resource.name);
          }
        }
      });
    });

    // Cancel button
    document.getElementById('resource-cancel').addEventListener('click', () => {
      modal.remove();
    });

    // Click outside to close
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.remove();
      }
    });
  }

  // ===== UPCAST CHOICE MODAL =====

  /**
   * Show upcast modal with slot level selection and metamagic options
   */
  function showUpcastChoice(spell, originalLevel, afterCast = null) {
    if (typeof characterData === 'undefined' || !characterData) return;

    // Get all available spell slots at this level or higher
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

    debug.log('🔮 Pact Magic detection:', { rawPactLevel, rawPactSlots, rawPactSlotsMax, pactMagicSlots, pactMagicSlotsMax, effectivePactLevel });

    // Add Pact Magic slots first if available and spell level is compatible
    // Show even if depleted (current = 0) - user can still cast with GM permission
    if (pactMagicSlotsMax > 0 && originalLevel <= effectivePactLevel) {
      availableSlots.push({
        level: effectivePactLevel,
        current: pactMagicSlots,
        max: pactMagicSlotsMax,
        slotVar: 'pactMagicSlots',
        slotMaxVar: 'pactMagicSlotsMax',
        isPactMagic: true,
        label: `Level ${effectivePactLevel} - Pact Magic`
      });
      debug.log(`🔮 Added Pact Magic to upcast options: Level ${effectivePactLevel} (${pactMagicSlots}/${pactMagicSlotsMax})`);
    }

    // Then check regular spell slots - show all levels with max > 0 (even if depleted)
    for (let level = originalLevel; level <= 9; level++) {
      const slotVar = `level${level}SpellSlots`;
      const slotMaxVar = `level${level}SpellSlotsMax`;
      let current = characterData.spellSlots?.[slotVar] || 0;
      let max = characterData.spellSlots?.[slotMaxVar] || 0;

      // Skip if this level's slots are actually Pact Magic slots (avoid duplicates)
      if (pactMagicSlotsMax > 0 && level === effectivePactLevel) {
        // Pact Magic is already added separately above
        continue;
      }

      // Show slot level if character has access to it (max > 0), even if depleted
      if (max > 0) {
        availableSlots.push({ level, current, max, slotVar, slotMaxVar });
      }
    }

    // Check for metamagic options
    const metamagicOptions = (typeof getAvailableMetamagic !== 'undefined') ? getAvailableMetamagic() : [];
    const sorceryPoints = (typeof getSorceryPointsResource !== 'undefined') ? getSorceryPointsResource() : null;
    debug.log('🔮 Metamagic detection:', {
      metamagicOptions,
      sorceryPoints,
      hasMetamagic: metamagicOptions.length > 0 && sorceryPoints && sorceryPoints.current > 0
    });
    const hasMetamagic = metamagicOptions.length > 0 && sorceryPoints && sorceryPoints.current > 0;

    debug.log('🔮 Available slots for casting:', availableSlots);

    // Handle case where no spell slots are available - allow casting anyway with warning
    if (availableSlots.length === 0) {
      const noSlotsModal = document.createElement('div');
      noSlotsModal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; z-index: 10000;';

      const noSlotsContent = document.createElement('div');
      noSlotsContent.style.cssText = 'background: var(--bg-secondary); color: var(--text-primary); padding: 30px; border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,0.3); max-width: 400px; width: 90%; text-align: center;';
      noSlotsContent.innerHTML = `
        <h3 style="margin: 0 0 20px 0; color: #e67e22;">No Spell Slots Available</h3>
        <p style="color: var(--text-secondary); margin-bottom: 20px;">You don't have any spell slots of level ${originalLevel} or higher to cast ${spell.name}.</p>
        <p style="color: #95a5a6; font-size: 0.9em; margin-bottom: 20px;">You can still cast if your GM allows it - no slot will be decremented.</p>
        <div style="display: flex; gap: 10px; justify-content: center;">
          <button id="no-slots-cancel" style="padding: 12px 25px; background: #95a5a6; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 1em;">Cancel</button>
          <button id="no-slots-cast" style="padding: 12px 25px; background: #e67e22; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 1em;">Cast Anyway</button>
        </div>
      `;

      noSlotsModal.appendChild(noSlotsContent);
      document.body.appendChild(noSlotsModal);

      document.getElementById('no-slots-cancel').onclick = () => noSlotsModal.remove();
      document.getElementById('no-slots-cast').onclick = () => {
        noSlotsModal.remove();
        // Cast without decrementing a slot - pass a fake slot with noSlotUsed flag
        castWithSlot(spell, {
          level: originalLevel,
          current: 0,
          max: 0,
          slotVar: null,
          noSlotUsed: true
        }, [], afterCast);
      };
      noSlotsModal.onclick = (e) => { if (e.target === noSlotsModal) noSlotsModal.remove(); };
      return;
    }

    // Show upcast modal
    const modal = document.createElement('div');
    modal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; z-index: 10000;';

    const modalContent = document.createElement('div');
    modalContent.style.cssText = 'background: var(--bg-secondary); color: var(--text-primary); padding: 30px; border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,0.3); max-width: 400px; width: 90%;';

    let dropdownHTML = `
      <h3 style="margin: 0 0 20px 0; color: var(--text-primary); text-align: center;">Cast ${spell.name}</h3>
      <p style="text-align: center; color: var(--text-secondary); margin-bottom: 20px;">Level ${originalLevel} spell</p>

      <div style="margin-bottom: 25px;">
        <label style="display: block; margin-bottom: 10px; font-weight: bold; color: var(--text-primary);">Spell Slot Level:</label>
        <select id="upcast-slot-select" style="width: 100%; padding: 12px; font-size: 1.1em; border: 2px solid var(--border-color); border-radius: 6px; box-sizing: border-box; background: var(--bg-tertiary); color: var(--text-primary);">
    `;

    availableSlots.forEach((slot, index) => {
      let label;
      const depleted = slot.current <= 0;
      const depletedMarker = depleted ? ' [EMPTY]' : '';

      if (slot.isPactMagic) {
        label = `${slot.label} - ${slot.current}/${slot.max} remaining${depletedMarker}`;
      } else if (slot.level === originalLevel) {
        label = `Level ${slot.level} (Normal) - ${slot.current}/${slot.max} remaining${depletedMarker}`;
      } else {
        label = `Level ${slot.level} (Upcast) - ${slot.current}/${slot.max} remaining${depletedMarker}`;
      }
      // Store index so we can identify Pact Magic vs regular slots
      dropdownHTML += `<option value="${index}" data-level="${slot.level}" data-pact="${slot.isPactMagic || false}" data-current="${slot.current}">${label}</option>`;
    });

    dropdownHTML += `
        </select>
      </div>
    `;

    // Add metamagic options if available
    if (hasMetamagic) {
      dropdownHTML += `
        <div style="margin-bottom: 20px; padding: 12px; background: #f8f9fa; border-radius: 8px; border: 2px solid #9b59b6;">
          <div style="display: flex; justify-content: space-between; align-items: center; cursor: pointer; margin-bottom: 8px;" onclick="document.getElementById('metamagic-container').style.display = document.getElementById('metamagic-container').style.display === 'none' ? 'flex' : 'none'; this.querySelector('.toggle-arrow').textContent = document.getElementById('metamagic-container').style.display === 'none' ? '▶' : '▼';">
            <label style="font-weight: bold; color: #9b59b6; cursor: pointer;">✨ Metamagic (Sorcery Points: ${sorceryPoints.current}/${sorceryPoints.max})</label>
            <span class="toggle-arrow" style="color: #9b59b6; font-size: 0.8em;">▼</span>
          </div>
          <div id="metamagic-container" style="display: flex; flex-direction: column; gap: 6px;">
      `;

      metamagicOptions.forEach((meta, index) => {
        const cost = meta.cost === 'variable' && typeof calculateMetamagicCost !== 'undefined' ?
          calculateMetamagicCost(meta.name, originalLevel) : meta.cost;
        const canAfford = sorceryPoints.current >= cost;
        const disabledStyle = !canAfford ? 'opacity: 0.5; cursor: not-allowed;' : '';

        dropdownHTML += `
            <label style="display: flex; align-items: center; padding: 8px; background: white; border-radius: 4px; cursor: pointer; ${disabledStyle}" title="${meta.description || ''}">
              <input type="checkbox" class="metamagic-option" data-name="${meta.name}" data-cost="${cost}" ${!canAfford ? 'disabled' : ''} style="margin-right: 8px; width: 16px; height: 16px; cursor: pointer; flex-shrink: 0;">
              <span style="flex: 1; color: var(--text-primary); font-size: 0.95em;">${meta.name}</span>
              <span style="color: #9b59b6; font-weight: bold; font-size: 0.9em;">${cost} SP</span>
            </label>
        `;
      });

      dropdownHTML += `
          </div>
          <div id="metamagic-cost" style="margin-top: 8px; text-align: right; font-weight: bold; color: var(--text-primary); font-size: 0.9em;">Total Cost: 0 SP</div>
        </div>
      `;
    }

    dropdownHTML += `
      <div style="display: flex; gap: 10px;">
        <button id="upcast-cancel" style="flex: 1; padding: 12px; font-size: 1em; background: #95a5a6; color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: bold;">
          Cancel
        </button>
        <button id="upcast-confirm" style="flex: 1; padding: 12px; font-size: 1em; background: #9b59b6; color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: bold;">
          Cast Spell
        </button>
      </div>
    `;

    modalContent.innerHTML = dropdownHTML;
    modal.appendChild(modalContent);
    document.body.appendChild(modal);

    const selectElement = document.getElementById('upcast-slot-select');
    const confirmBtn = document.getElementById('upcast-confirm');
    const cancelBtn = document.getElementById('upcast-cancel');

    // Track metamagic selections
    let selectedMetamagic = [];

    if (hasMetamagic) {
      const metamagicCheckboxes = document.querySelectorAll('.metamagic-option');
      const costDisplay = document.getElementById('metamagic-cost');

      // Update selected spell level when it changes (affects Twinned Spell cost)
      selectElement.addEventListener('change', () => {
        const selectedIndex = parseInt(selectElement.value);
        const selectedLevel = availableSlots[selectedIndex]?.level || originalLevel;

        // Recalculate costs for variable-cost metamagic
        metamagicCheckboxes.forEach(checkbox => {
          const metaName = checkbox.dataset.name;
          const metaOption = metamagicOptions.find(m => m.name === metaName);
          if (metaOption && metaOption.cost === 'variable' && typeof calculateMetamagicCost !== 'undefined') {
            const newCost = calculateMetamagicCost(metaName, selectedLevel);
            checkbox.dataset.cost = newCost;

            // Update display
            const label = checkbox.closest('label');
            const costSpan = label.querySelector('span:last-child');
            costSpan.textContent = `${newCost} SP`;

            // Check if still affordable
            if (sorceryPoints.current < newCost && checkbox.checked) {
              checkbox.checked = false;
            }
          }
        });

        // Update total cost
        updateMetamagicCost();
      });

      function updateMetamagicCost() {
        let totalCost = 0;
        selectedMetamagic = [];

        metamagicCheckboxes.forEach(checkbox => {
          if (checkbox.checked) {
            const cost = parseInt(checkbox.dataset.cost);
            totalCost += cost;
            selectedMetamagic.push({
              name: checkbox.dataset.name,
              cost: cost
            });
          }
        });

        costDisplay.textContent = `Total Cost: ${totalCost} SP`;

        // Disable confirm if not enough sorcery points
        if (totalCost > sorceryPoints.current) {
          confirmBtn.disabled = true;
          confirmBtn.style.opacity = '0.5';
          confirmBtn.style.cursor = 'not-allowed';
        } else {
          confirmBtn.disabled = false;
          confirmBtn.style.opacity = '1';
          confirmBtn.style.cursor = 'pointer';
        }
      }

      metamagicCheckboxes.forEach(checkbox => {
        checkbox.addEventListener('change', updateMetamagicCost);
      });
    }

    confirmBtn.addEventListener('click', () => {
      const selectedIndex = parseInt(selectElement.value);
      const selectedSlot = availableSlots[selectedIndex];
      debug.log(`🔮 Selected slot from upcast modal:`, selectedSlot);

      // Check if slot is depleted
      if (selectedSlot.current <= 0) {
        // Show warning modal
        modal.remove();

        const warnModal = document.createElement('div');
        warnModal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; z-index: 10001;';

        const warnContent = document.createElement('div');
        warnContent.style.cssText = 'background: var(--bg-secondary); color: var(--text-primary); padding: 30px; border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,0.3); max-width: 400px; width: 90%; text-align: center;';
        warnContent.innerHTML = `
          <h3 style="margin: 0 0 20px 0; color: #e67e22;">No Slots Remaining</h3>
          <p style="color: var(--text-secondary); margin-bottom: 20px;">You have no ${selectedSlot.isPactMagic ? 'Pact Magic' : `Level ${selectedSlot.level}`} spell slots remaining.</p>
          <p style="color: #95a5a6; font-size: 0.9em; margin-bottom: 20px;">You can still cast if your GM allows it - no slot will be decremented.</p>
          <div style="display: flex; gap: 10px; justify-content: center;">
            <button id="warn-cancel" style="padding: 12px 25px; background: #95a5a6; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 1em;">Cancel</button>
            <button id="warn-cast" style="padding: 12px 25px; background: #e67e22; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 1em;">Cast Anyway</button>
          </div>
        `;

        warnModal.appendChild(warnContent);
        document.body.appendChild(warnModal);

        document.getElementById('warn-cancel').onclick = () => warnModal.remove();
        document.getElementById('warn-cast').onclick = () => {
          warnModal.remove();
          // Cast with noSlotUsed flag
          castWithSlot(spell, { ...selectedSlot, noSlotUsed: true }, selectedMetamagic, afterCast);
        };
        warnModal.onclick = (e) => { if (e.target === warnModal) warnModal.remove(); };
        return;
      }

      modal.remove();
      castWithSlot(spell, selectedSlot, selectedMetamagic, afterCast);
    });

    cancelBtn.addEventListener('click', () => {
      modal.remove();
    });

    // Click outside to close
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.remove();
      }
    });
  }

  // ===== SLOT AND RESOURCE CONSUMPTION =====

  /**
   * Cast spell with selected slot and metamagic
   */
  function castWithSlot(spell, slot, metamagicOptions = [], afterCast = null) {
    if (typeof characterData === 'undefined' || !characterData) return;

    // Deduct spell slot (unless casting without a slot)
    if (!slot.noSlotUsed && slot.slotVar) {
      characterData.spellSlots[slot.slotVar] = slot.current - 1;

      // Also update otherVariables for Pact Magic to keep in sync
      if (slot.isPactMagic && characterData.otherVariables?.pactMagicSlots !== undefined) {
        characterData.otherVariables.pactMagicSlots = slot.current - 1;
      }
    }

    // Deduct sorcery points for metamagic
    let totalMetamagicCost = 0;
    let metamagicNames = [];

    if (metamagicOptions && metamagicOptions.length > 0 && typeof getSorceryPointsResource !== 'undefined') {
      const sorceryPoints = getSorceryPointsResource();
      if (sorceryPoints) {
        metamagicOptions.forEach(meta => {
          totalMetamagicCost += meta.cost;
          metamagicNames.push(meta.name);
        });

        // Deduct sorcery points
        sorceryPoints.current = Math.max(0, sorceryPoints.current - totalMetamagicCost);
        debug.log(`✨ Used ${totalMetamagicCost} sorcery points for metamagic. Remaining: ${sorceryPoints.current}/${sorceryPoints.max}`);
      }
    }

    // Don't call markActionAsUsed - announceSpellCast already announces to chat

    if (typeof saveCharacterData !== 'undefined') {
      saveCharacterData();
    }

    let resourceText;
    let notificationText;

    if (slot.noSlotUsed) {
      // Casting without a spell slot (GM override)
      resourceText = `Level ${slot.level} (NO SLOT USED - slot not decremented)`;
      notificationText = `✨ Cast ${spell.name}! (no spell slot decremented)`;
      debug.log(`⚠️ Cast without slot - no slot decremented`);
    } else if (slot.isPactMagic) {
      resourceText = `Pact Magic (Level ${slot.level})`;
      debug.log(`✅ Used Pact Magic slot. Remaining: ${characterData.spellSlots[slot.slotVar]}/${slot.max}`);
      notificationText = `✨ Cast ${spell.name}! (${characterData.spellSlots[slot.slotVar]}/${slot.max} Pact slots left)`;
    } else if (slot.level > parseInt(spell.level)) {
      resourceText = `Level ${slot.level} slot (upcast from ${spell.level})`;
      debug.log(`✅ Used spell slot. Remaining: ${characterData.spellSlots[slot.slotVar]}/${slot.max}`);
      notificationText = `✨ Cast ${spell.name}! (${characterData.spellSlots[slot.slotVar]}/${slot.max} slots left)`;
    } else {
      resourceText = `Level ${slot.level} slot`;
      debug.log(`✅ Used spell slot. Remaining: ${characterData.spellSlots[slot.slotVar]}/${slot.max}`);
      notificationText = `✨ Cast ${spell.name}! (${characterData.spellSlots[slot.slotVar]}/${slot.max} slots left)`;
    }

    // Add metamagic to resource text
    if (metamagicNames.length > 0) {
      resourceText += ` + ${metamagicNames.join(', ')} (${totalMetamagicCost} SP)`;
    }
    if (metamagicNames.length > 0 && typeof getSorceryPointsResource !== 'undefined') {
      const sorceryPoints = getSorceryPointsResource();
      notificationText += ` with ${metamagicNames.join(', ')}! (${sorceryPoints.current}/${sorceryPoints.max} SP left)`;
    }

    if (typeof announceSpellCast !== 'undefined') {
      announceSpellCast(spell, resourceText);
    }
    if (typeof showNotification !== 'undefined') {
      showNotification(notificationText);
    }

    // Handle concentration
    if (spell.concentration && typeof setConcentration !== 'undefined') {
      setConcentration(spell.name);
    }

    // Track reuseable spells (Spiritual Weapon, Meld into Stone, etc.)
    const shouldTrackAsReusable = (typeof isReuseableSpell !== 'undefined') ? isReuseableSpell(spell.name, characterData) : false;
    if (shouldTrackAsReusable) {
      const castSpellsKey = `castSpells_${characterData.name}`;
      const castSpells = JSON.parse(localStorage.getItem(castSpellsKey) || '[]');
      if (!castSpells.includes(spell.name)) {
        castSpells.push(spell.name);
        localStorage.setItem(castSpellsKey, JSON.stringify(castSpells));
        debug.log(`✅ Tracked reuseable spell: ${spell.name}`);
      }
    }

    // Update the display
    if (typeof buildSheet !== 'undefined') {
      buildSheet(characterData);
    }

    // Execute after-cast callback (for rolling attack/damage/healing)
    if (afterCast && typeof afterCast === 'function') {
      setTimeout(() => {
        afterCast(spell, slot);
      }, 300); // Small delay to ensure chat message is sent first
    }
  }

  /**
   * Use class resource to cast spell (Ki, Sorcery Points, etc.)
   */
  function useClassResource(resource, spell) {
    if (typeof characterData === 'undefined' || !characterData) return false;

    if (resource.current <= 0) {
      if (typeof showNotification !== 'undefined') {
        showNotification(`❌ No ${resource.name} remaining!`, 'error');
      }
      return false;
    }

    characterData.otherVariables[resource.varName] = resource.current - 1;

    // Don't call markActionAsUsed - announceSpellCast already announces to chat

    if (typeof saveCharacterData !== 'undefined') {
      saveCharacterData();
    }

    debug.log(`✅ Used ${resource.name}. Remaining: ${characterData.otherVariables[resource.varName]}/${resource.max}`);
    if (typeof showNotification !== 'undefined') {
      showNotification(`✨ Cast ${spell.name}! (${characterData.otherVariables[resource.varName]}/${resource.max} ${resource.name} left)`);
    }

    // Handle concentration
    if (spell.concentration && typeof setConcentration !== 'undefined') {
      setConcentration(spell.name);
    }

    // Track reuseable spells (Spiritual Weapon, Meld into Stone, etc.)
    const shouldTrackAsReusable = (typeof isReuseableSpell !== 'undefined') ? isReuseableSpell(spell.name, characterData) : false;
    if (shouldTrackAsReusable) {
      const castSpellsKey = `castSpells_${characterData.name}`;
      const castSpells = JSON.parse(localStorage.getItem(castSpellsKey) || '[]');
      if (!castSpells.includes(spell.name)) {
        castSpells.push(spell.name);
        localStorage.setItem(castSpellsKey, JSON.stringify(castSpells));
        debug.log(`✅ Tracked reuseable spell: ${spell.name}`);
      }
    }

    if (typeof buildSheet !== 'undefined') {
      buildSheet(characterData);
    }
    return true;
  }

  // ===== EXPORTS =====

  globalThis.castSpell = castSpell;
  globalThis.detectClassResources = detectClassResources;
  globalThis.showResourceChoice = showResourceChoice;
  globalThis.showUpcastChoice = showUpcastChoice;
  globalThis.castWithSlot = castWithSlot;
  globalThis.useClassResource = useClassResource;

})();
