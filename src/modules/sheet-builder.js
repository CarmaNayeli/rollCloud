/**
 * Sheet Builder Module
 *
 * Handles the main character sheet UI construction.
 * Builds all UI sections including:
 * - Character header (name, class, level, race)
 * - Combat stats (AC, HP, initiative, death saves, inspiration)
 * - Abilities, saves, and skills
 * - Actions & attacks
 * - Spells (organized by source and level)
 * - Inventory & equipment
 * - Companions (familiars, summons, animal companions)
 * - Resources and spell slots
 *
 * Loaded as a plain script (no ES6 modules) to export to globalThis.
 *
 * Functions exported to globalThis:
 * - buildSheet(data)
 */

(function() {
  'use strict';

  /**
   * Build the entire character sheet UI from character data
   * @param {Object} data - Character data object
   */
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

    // Character name with source badge
    const characterName = data.name || 'Character';
    const isCloudCharacter = data.source === 'database' ||
                             data.hasCloudVersion === true ||
                             (currentSlotId && currentSlotId.startsWith('db-')) ||
                             data.id?.startsWith('db-');

    if (isCloudCharacter) {
      charNameEl.innerHTML = `${characterName} <span style="
        background: linear-gradient(135deg, #3498db 0%, #2980b9 100%);
        color: white;
        padding: 2px 8px;
        border-radius: 12px;
        font-size: 0.7em;
        font-weight: bold;
        margin-left: 8px;
        vertical-align: middle;
        box-shadow: 0 2px 4px rgba(0,0,0,0.2);
      ">☁️ Cloud</span>`;
    } else {
      charNameEl.innerHTML = `${characterName} <span style="
        background: linear-gradient(135deg, #c2185b 0%, #ad1457 100%);
        color: white;
        padding: 2px 8px;
        border-radius: 12px;
        font-size: 0.7em;
        font-weight: bold;
        margin-left: 8px;
        vertical-align: middle;
        box-shadow: 0 2px 4px rgba(0,0,0,0.2);
      ">💾 Local</span>`;
    }

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
      const announcement = `&{template:default} {{name=${getColoredBanner(data)}${data.name} rolls for initiative!}} {{Type=Initiative}} {{Bonus=+${initiativeBonus}}}`;
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
        const announcement = `&{template:default} {{name=${getColoredBanner(data)}${data.name} makes a ${ability.charAt(0).toUpperCase() + ability.slice(1)} check!}} {{Type=Ability Check}} {{Bonus=+${mod}}}`;
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
        const announcement = `&{template:default} {{name=${getColoredBanner(data)}${data.name} makes a ${ability.toUpperCase()} save!}} {{Type=Saving Throw}} {{Bonus=+${bonus}}}`;
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
        const announcement = `&{template:default} {{name=${getColoredBanner(data)}${data.name} makes a ${displayName} check!}} {{Type=Skill Check}} {{Bonus=${bonus >= 0 ? '+' : ''}${bonus}}}`;
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

    // Hide loading overlay and show the sheet with fade-in effect
    const loadingOverlay = document.getElementById('loading-overlay');
    const container = document.querySelector('.container');
    if (loadingOverlay) {
      loadingOverlay.style.display = 'none';
    }
    if (container) {
      container.classList.add('loaded');
    }

    debug.log('✅ Sheet built successfully');
  }

  // ===== EXPORTS =====

  // Export function to globalThis
  globalThis.buildSheet = buildSheet;

  debug.log('✅ Sheet Builder module loaded');

})();
