/**
 * Spell Display Module
 *
 * Handles spell UI rendering, filtering, and card creation.
 * Loaded as a plain script (no ES6 modules) to export to globalThis.
 *
 * Functions exported to globalThis:
 * - buildSpellsBySource(container, spells)
 * - categorizeSpell(spell)
 * - rebuildSpells()
 * - createSpellCard(spell, index)
 * - validateSpellData(spell)
 *
 * State variables:
 * - spellFilters (level, category, castingTime, search)
 */

(function() {
  'use strict';

  // ===== STATE VARIABLES =====

  let spellFilters = {
    level: 'all',
    category: 'all',
    castingTime: 'all',
    search: ''
  };

  // ===== SPELL DISPLAY FUNCTIONS =====

  /**
   * Build spells display grouped by level with filtering
   */
  function buildSpellsBySource(container, spells) {
    debug.log(`📚 buildSpellsBySource called with ${spells.length} spells`);
    debug.log(`📚 Spell names: ${spells.map(s => s.name).join(', ')}`);

    // Debug: Check for Eldritch Blast damageRolls
    const eldritchBlast = spells.find(s => s.name && s.name.toLowerCase().includes('eldritch blast'));
    if (eldritchBlast) {
      console.log('⚡ ELDRITCH BLAST DATA IN POPUP:', {
        name: eldritchBlast.name,
        attackRoll: eldritchBlast.attackRoll,
        damageRolls: eldritchBlast.damageRolls,
        damageRollsLength: eldritchBlast.damageRolls ? eldritchBlast.damageRolls.length : 'undefined',
        damageRollsJSON: JSON.stringify(eldritchBlast.damageRolls)
      });
    }

    // Apply filters first
    let filteredSpells = spells.filter(spell => {
      // Filter out duplicate Divine Smite entries - keep only the main one
      const spellName = (spell.name || '').toLowerCase();
      if (spellName.includes('divine smite')) {
        // Skip variants like "Divine Smite Level 1", "Divine Smite (Against Fiends, Critical) Level 1", etc.
        // Keep only the base "Divine Smite" entry
        if (spellName !== 'divine smite' && !spellName.match(/^divine smite$/)) {
          debug.log(`⏭️ Filtering out duplicate Divine Smite spell: ${spell.name}`);
          return false;
        } else {
          debug.log(`✅ Keeping main Divine Smite spell: ${spell.name}`);
        }
      }

      // Filter by spell level
      if (spellFilters.level !== 'all') {
        const spellLevel = parseInt(spell.level) || 0;
        if (spellLevel.toString() !== spellFilters.level) {
          return false;
        }
      }

      // Filter by category
      if (spellFilters.category !== 'all') {
        const category = categorizeSpell(spell);
        if (category !== spellFilters.category) {
          return false;
        }
      }

      // Filter by casting time
      if (spellFilters.castingTime !== 'all') {
        const castingTime = (spell.castingTime || '').toLowerCase();
        if (spellFilters.castingTime === 'action') {
          // Match "action" but exclude "bonus action" and "reaction"
          if (!castingTime.includes('action') || castingTime.includes('bonus') || castingTime.includes('reaction')) {
            return false;
          }
        }
        if (spellFilters.castingTime === 'bonus' && !castingTime.includes('bonus')) {
          return false;
        }
        if (spellFilters.castingTime === 'reaction' && !castingTime.includes('reaction')) {
          return false;
        }
      }

      // Filter by search term
      if (spellFilters.search) {
        const searchLower = spellFilters.search;
        const name = (spell.name || '').toLowerCase();
        const desc = (spell.description || '').toLowerCase();
        if (!name.includes(searchLower) && !desc.includes(searchLower)) {
          return false;
        }
      }

      return true;
    });

    debug.log(`🔍 Filtered ${spells.length} spells to ${filteredSpells.length} spells`);

    // Group spells by actual spell level (not source)
    const spellsByLevel = {};

    filteredSpells.forEach((spell, index) => {
      // Add index to spell for tracking
      spell.index = index;

      // Use spell level for grouping
      const spellLevel = parseInt(spell.level) || 0;
      const levelKey = spellLevel === 0 ? 'Cantrips' : `Level ${spellLevel} Spells`;

      if (!spellsByLevel[levelKey]) {
        spellsByLevel[levelKey] = [];
      }
      spellsByLevel[levelKey].push(spell);
    });

    // Clear container
    container.innerHTML = '';

    // Sort by spell level (cantrips first, then 1-9)
    const sortedLevels = Object.keys(spellsByLevel).sort((a, b) => {
      if (a === 'Cantrips') return -1;
      if (b === 'Cantrips') return 1;
      return a.localeCompare(b, undefined, { numeric: true });
    });

    sortedLevels.forEach(levelKey => {
      // Create level section
      const levelSection = document.createElement('div');
      levelSection.style.cssText = 'margin-bottom: 20px;';

      const levelHeader = document.createElement('h4');
      levelHeader.textContent = `📚 ${levelKey}`;
      levelHeader.style.cssText = 'color: var(--text-primary); margin-bottom: 10px; padding: 5px; background: #ecf0f1; border-radius: 4px;';
      levelSection.appendChild(levelHeader);

      // Sort spells alphabetically within level
      const sortedSpells = spellsByLevel[levelKey].sort((a, b) => {
        return (a.name || '').localeCompare(b.name || '');
      });

      // Deduplicate spells by name and combine sources
      const deduplicatedSpells = [];
      const spellsByName = {};

      debug.log(`📚 Deduplicating ${sortedSpells.length} spells in ${levelKey}`, sortedSpells.map(s => s.name));
      sortedSpells.forEach(spell => {
        const spellName = spell.name || 'Unnamed Spell';

        if (!spellsByName[spellName]) {
          // First occurrence of this spell
          spellsByName[spellName] = spell;
          deduplicatedSpells.push(spell);
          debug.log(`📚 First occurrence: "${spellName}"`);
        } else {
          // Duplicate spell - combine sources
          const existingSpell = spellsByName[spellName];
          debug.log(`📚 Found duplicate: "${spellName}" - combining sources`);
          if (spell.source && !existingSpell.source.includes(spell.source)) {
            existingSpell.source += '; ' + spell.source;
            debug.log(`📚 Combined duplicate spell "${spellName}": ${existingSpell.source}`);
          }
        }
      });
      debug.log(`📚 After deduplication: ${deduplicatedSpells.length} unique spells in ${levelKey}`, deduplicatedSpells.map(s => s.name));

      // Add deduplicated spells
      deduplicatedSpells.forEach(spell => {
        const spellCard = createSpellCard(spell, spell.index);
        levelSection.appendChild(spellCard);
      });

      container.appendChild(levelSection);
    });
  }

  /**
   * Categorize a spell as damage, healing, or utility
   */
  function categorizeSpell(spell) {
    // Use actual spell data instead of string matching in description
    // Check damageRolls array to determine if it's damage or healing
    if (spell.damageRolls && Array.isArray(spell.damageRolls) && spell.damageRolls.length > 0) {
      // Check if any damage roll is healing
      const hasHealing = spell.damageRolls.some(roll =>
        roll.damageType && roll.damageType.toLowerCase() === 'healing'
      );

      // Check if any damage roll is actual damage (not healing)
      const hasDamage = spell.damageRolls.some(roll =>
        !roll.damageType || roll.damageType.toLowerCase() !== 'healing'
      );

      // Categorize based on what the spell actually does
      if (hasHealing && !hasDamage) {
        return 'healing';
      } else if (hasDamage) {
        return 'damage';
      }
    }

    // Check for attack roll (attack spells are damage)
    if (spell.attackRoll && spell.attackRoll !== '(none)') {
      return 'damage';
    }

    // Everything else is utility (no damage rolls, no attack roll)
    return 'utility';
  }

  /**
   * Rebuild spells with current filters
   */
  function rebuildSpells() {
    if (typeof characterData === 'undefined' || !characterData || !characterData.spells) return;
    const container = document.getElementById('spells-container');
    buildSpellsBySource(container, characterData.spells);
  }

  /**
   * Create spell card UI element
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
      tags += '<span class="ritual-tag">📖 Ritual</span>';
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
      if (!e.target.classList.contains('roll-btn') && !e.target.classList.contains('cast-spell-modal-btn')) {
        desc.classList.toggle('expanded');
        toggleBtn.textContent = desc.classList.contains('expanded') ? '▲ Hide' : '▼ Details';
      }
    });

    // Roll button
    const rollBtn = desc.querySelector('.roll-btn');
    if (rollBtn && spell.formula) {
      rollBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (typeof roll !== 'undefined') {
          roll(spell.name, spell.formula);
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
          if (typeof announceSpellDescription !== 'undefined') {
            announceSpellDescription(spell);
          }
          if (typeof showDivineSmiteModal !== 'undefined') {
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
          if (typeof announceSpellDescription !== 'undefined') {
            announceSpellDescription(spell);
          }
          if (typeof getLayOnHandsResource !== 'undefined') {
            const layOnHandsPool = getLayOnHandsResource();
            if (layOnHandsPool && typeof showLayOnHandsModal !== 'undefined') {
              showLayOnHandsModal(layOnHandsPool);
            } else if (typeof showNotification !== 'undefined') {
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
          if (typeof announceSpellDescription !== 'undefined') {
            announceSpellDescription(spell);
          }
          if (typeof getLayOnHandsResource !== 'undefined') {
            const layOnHandsPool = getLayOnHandsResource();
            if (layOnHandsPool && typeof showLayOnHandsModal !== 'undefined') {
              showLayOnHandsModal(layOnHandsPool);
            } else if (typeof showNotification !== 'undefined') {
              showNotification('❌ No Lay on Hands pool resource found', 'error');
            }
          }
          return;
        }

        if (typeof getSpellOptions !== 'undefined') {
          const spellOptionsResult = getSpellOptions(spell);
          const options = spellOptionsResult.options;

          // Check if this is a "too complicated" spell that should only announce
          if (spellOptionsResult.skipNormalButtons) {
            if (typeof announceSpellDescription !== 'undefined') {
              announceSpellDescription(spell);
            }
            if (typeof castSpell !== 'undefined') {
              castSpell(spell, index, null, null, [], false, true); // skipAnnouncement = true
            }
            return;
          }

          if (options.length === 0) {
            // No rolls - announce description and cast immediately
            if (typeof announceSpellDescription !== 'undefined') {
              announceSpellDescription(spell);
            }
            if (typeof castSpell !== 'undefined') {
              castSpell(spell, index, null, null, [], false, true); // skipAnnouncement = true
            }
          } else {
            // Has rolls - show modal with options
            // Check if concentration recast option will exist in modal
            const hasConcentrationRecast = spell.concentration &&
              (typeof concentratingSpell !== 'undefined' && concentratingSpell === spell.name);

            if (!hasConcentrationRecast) {
              // No concentration recast option - announce description immediately
              if (typeof announceSpellDescription !== 'undefined') {
                announceSpellDescription(spell);
              }
              if (typeof showSpellModal !== 'undefined') {
                showSpellModal(spell, index, options, true); // descriptionAnnounced = true
              }
            } else {
              // Has concentration recast - announce from modal button handlers
              if (typeof showSpellModal !== 'undefined') {
                showSpellModal(spell, index, options, false); // descriptionAnnounced = false
              }
            }
          }
        }
      });
    }

    // Custom macro override button
    const customMacroBtn = header.querySelector('.custom-macro-btn');
    if (customMacroBtn) {
      customMacroBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (typeof showCustomMacroModal !== 'undefined') {
          showCustomMacroModal(spell, index);
        }
      });
    }

    card.appendChild(header);
    card.appendChild(desc);
    return card;
  }

  /**
   * Validate spell data and log any issues
   * Cross-checks parsed data against spell description
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

  // ===== EXPORTS =====

  globalThis.buildSpellsBySource = buildSpellsBySource;
  globalThis.categorizeSpell = categorizeSpell;
  globalThis.rebuildSpells = rebuildSpells;
  globalThis.createSpellCard = createSpellCard;
  globalThis.validateSpellData = validateSpellData;

  // Export state variable
  Object.defineProperty(globalThis, 'spellFilters', {
    get: () => spellFilters,
    set: (value) => { spellFilters = value; }
  });

})();
