/**
 * Action Executor - Central D&D Logic Module
 *
 * This module consolidates all D&D game logic into a single importable file:
 *   - All 4 edge case modules (spell, class feature, racial, combat maneuver)
 *   - Metamagic system (costs, detection, resolution)
 *   - Resource detection (sorcery points, ki, pact magic, channel divinity)
 *   - Spell slot resolution and consumption logic
 *   - Action option building (attack/damage/healing buttons + edge cases)
 *   - Execution functions that return { text, rolls, effects }
 *
 * Consumers:
 *   - popup-sheet.html (loads edge cases as scripts, then this file)
 *   - background.js (service worker loads edge cases via importScripts, then this file)
 *
 * All functions accept characterData as a parameter (no closures/globals).
 *
 * Note: Edge case modules must be loaded BEFORE this file:
 *   - popup-sheet.html: loads via <script> tags
 *   - background.js: loads via importScripts()
 */

// Edge case functions are available on globalThis/window from previously loaded modules


// ===== METAMAGIC SYSTEM =====

/**
 * Official Sorcerer metamagic costs (in sorcery points)
 */
const METAMAGIC_COSTS = {
  'Careful Spell': 1,
  'Distant Spell': 1,
  'Empowered Spell': 1,
  'Extended Spell': 1,
  'Heightened Spell': 3,
  'Quickened Spell': 2,
  'Subtle Spell': 1,
  'Twinned Spell': 'variable' // Cost equals spell level (min 1 for cantrips)
};

/**
 * Calculate metamagic sorcery point cost
 * @param {string} metamagicName - Name of the metamagic option
 * @param {number} spellLevel - Level of the spell being cast
 * @returns {number} Cost in sorcery points
 */
function calculateMetamagicCost(metamagicName, spellLevel) {
  const cost = METAMAGIC_COSTS[metamagicName];
  if (cost === 'variable') {
    // Twinned Spell costs spell level (minimum 1 for cantrips)
    return Math.max(1, spellLevel);
  }
  return cost || 0;
}

/**
 * Find available metamagic options from character features
 * @param {Object} characterData - Full character data object
 * @returns {Array<{name: string, cost: number|string, description: string}>}
 */
function getAvailableMetamagic(characterData) {
  if (!characterData || !characterData.features) {
    return [];
  }

  const metamagicOptions = characterData.features.filter(feature => {
    const name = feature.name.trim();
    let matchedName = null;

    if (METAMAGIC_COSTS.hasOwnProperty(name)) {
      matchedName = name;
    } else {
      matchedName = Object.keys(METAMAGIC_COSTS).find(key =>
        key.toLowerCase() === name.toLowerCase()
      );
    }

    if (matchedName) {
      feature._matchedName = matchedName;
      return true;
    }
    return false;
  }).map(feature => {
    const matchedName = feature._matchedName || feature.name.trim();
    return {
      name: matchedName,
      cost: METAMAGIC_COSTS[matchedName],
      description: feature.description || ''
    };
  });

  return metamagicOptions;
}

/**
 * Find sorcery points resource in character data
 * @param {Object} characterData - Full character data object
 * @returns {Object|null} Resource object with { name, current, max } or null
 */
function getSorceryPointsResource(characterData) {
  if (!characterData || !characterData.resources) {
    return null;
  }

  const sorceryResource = characterData.resources.find(r => {
    const lowerName = r.name.toLowerCase().trim();
    return (
      lowerName.includes('sorcery point') ||
      lowerName === 'sorcery points' ||
      lowerName === 'sorcery' ||
      lowerName.includes('sorcerer point')
    );
  });

  return sorceryResource || null;
}


// ===== RESOURCE DETECTION =====

/**
 * Check if a spell comes from a magic item (doesn't consume spell slots)
 * @param {Object} spell - Spell data object
 * @returns {boolean}
 */
function isMagicItemSpell(spell) {
  if (!spell.source) return false;
  const src = spell.source.toLowerCase();
  return (
    src.includes('amulet') ||
    src.includes('ring') ||
    src.includes('wand') ||
    src.includes('staff') ||
    src.includes('rod') ||
    src.includes('cloak') ||
    src.includes('boots') ||
    src.includes('bracers') ||
    src.includes('gauntlets') ||
    src.includes('helm') ||
    src.includes('armor') ||
    src.includes('weapon') ||
    src.includes('talisman') ||
    src.includes('orb') ||
    src.includes('scroll') ||
    src.includes('potion')
  );
}

/**
 * Check if a spell is free (has item consumption but no slot cost)
 * @param {Object} spell - Spell data object
 * @returns {boolean}
 */
function isFreeSpell(spell) {
  return !!(
    spell.resources &&
    spell.resources.itemsConsumed &&
    spell.resources.itemsConsumed.length > 0
  );
}

/**
 * Detect class-specific resources available for casting (Ki, Pact Magic, Channel Divinity)
 * @param {Object} characterData - Full character data object
 * @returns {Array<{name: string, current: number, max: number, varName: string, variableName: string}>}
 */
function detectClassResources(characterData) {
  const resources = [];
  const otherVars = (characterData && characterData.otherVariables) || {};

  // Check for Ki (Monk)
  if (otherVars.ki !== undefined || otherVars.kiPoints !== undefined) {
    const ki = otherVars.ki || otherVars.kiPoints || 0;
    const kiMax = otherVars.kiMax || otherVars.kiPointsMax || 0;
    const kiVarName = otherVars.ki !== undefined ? 'ki' : 'kiPoints';
    if (kiMax > 0) {
      resources.push({
        name: 'Ki',
        current: ki,
        max: kiMax,
        varName: kiVarName,
        variableName: kiVarName
      });
    }
  }

  // NOTE: Sorcery Points are NOT a casting resource - they're only used for metamagic

  // Check for Pact Magic slots (Warlock)
  if (otherVars.pactMagicSlots !== undefined) {
    const slots = otherVars.pactMagicSlots || 0;
    const slotsMax = otherVars.pactMagicSlotsMax || 0;
    if (slotsMax > 0) {
      resources.push({
        name: 'Pact Magic',
        current: slots,
        max: slotsMax,
        varName: 'pactMagicSlots',
        variableName: 'pactMagicSlots'
      });
    }
  }

  // Check for Channel Divinity (Cleric/Paladin)
  let channelDivinityVarName = null;
  let channelDivinityUses = 0;
  let channelDivinityMax = 0;

  if (otherVars.channelDivinityCleric !== undefined) {
    channelDivinityVarName = 'channelDivinityCleric';
    channelDivinityUses = otherVars.channelDivinityCleric || 0;
    channelDivinityMax = otherVars.channelDivinityClericMax || 0;
  } else if (otherVars.channelDivinityPaladin !== undefined) {
    channelDivinityVarName = 'channelDivinityPaladin';
    channelDivinityUses = otherVars.channelDivinityPaladin || 0;
    channelDivinityMax = otherVars.channelDivinityPaladinMax || 0;
  } else if (otherVars.channelDivinity !== undefined) {
    channelDivinityVarName = 'channelDivinity';
    channelDivinityUses = otherVars.channelDivinity || 0;
    channelDivinityMax = otherVars.channelDivinityMax || 0;
  }

  if (channelDivinityVarName && channelDivinityMax > 0) {
    resources.push({
      name: 'Channel Divinity',
      current: channelDivinityUses,
      max: channelDivinityMax,
      varName: channelDivinityVarName,
      variableName: channelDivinityVarName
    });
  }

  return resources;
}


// ===== ACTION OPTIONS (edge case application) =====

/**
 * Determine the action options (attack/damage/heal buttons) for an action,
 * with edge case modifications applied.
 *
 * @param {Object} action - Action data { name, attackRoll, damage, damageType, actionType, ... }
 * @param {Object} [characterData] - Character data (used for ruleset detection in edge cases)
 * @returns {{ options: Array, skipNormalButtons: boolean }}
 */
function getActionOptions(action, characterData = null) {
  const options = [];

  // Check for attack
  if (action.attackRoll) {
    let formula = action.attackRoll;
    if (typeof formula === 'number' || !formula.includes('d20')) {
      const bonus = parseInt(formula);
      formula = bonus >= 0 ? `1d20+${bonus}` : `1d20${bonus}`;
    }

    options.push({
      type: 'attack',
      label: 'Attack',
      formula: formula,
      icon: 'attack',
      color: '#e74c3c'
    });
  }

  // Check for damage/healing rolls
  const isValidDiceFormula = action.damage && (
    /\d*d\d+/.test(action.damage) ||
    /\d*d\d+/.test(action.damage.replace(/\s*\+\s*/g, '+'))
  );

  if (isValidDiceFormula) {
    const isHealing = action.damageType && action.damageType.toLowerCase().includes('heal');
    const isTempHP = action.damageType && (
      action.damageType.toLowerCase() === 'temphp' ||
      action.damageType.toLowerCase() === 'temporary' ||
      action.damageType.toLowerCase().includes('temp')
    );

    let btnText;
    if (isHealing) {
      btnText = 'Heal';
    } else if (action.actionType === 'feature' || !action.attackRoll) {
      btnText = 'Roll';
    } else {
      btnText = 'Damage';
    }

    options.push({
      type: isHealing ? 'healing' : (isTempHP ? 'temphp' : 'damage'),
      label: btnText,
      formula: action.damage,
      icon: isTempHP ? 'shield' : (isHealing ? 'heal' : 'damage'),
      color: isTempHP ? '#3498db' : (isHealing ? '#c2185b' : '#e67e22')
    });
  }

  // Apply edge case modifications
  let edgeCaseResult;

  if (isClassFeatureEdgeCase(action.name)) {
    edgeCaseResult = applyClassFeatureEdgeCaseModifications(action, options);
  } else if (isRacialFeatureEdgeCase(action.name)) {
    edgeCaseResult = applyRacialFeatureEdgeCaseModifications(action, options);
  } else if (isCombatManeuverEdgeCase(action.name)) {
    edgeCaseResult = applyCombatManeuverEdgeCaseModifications(action, options);
  } else {
    edgeCaseResult = { options, skipNormalButtons: false };
  }

  return edgeCaseResult;
}


// ===== SPELL EXECUTION LOGIC =====

/**
 * Resolve what happens when a spell is cast. Returns a structured result
 * describing the effects without performing any side effects (no UI, no storage).
 *
 * @param {Object} spell - Spell data { name, level, source, resources, concentration, damage, attackRoll, ... }
 * @param {Object} characterData - Full character data
 * @param {Object} [options] - Cast options
 * @param {number|string|null} [options.selectedSlotLevel] - Chosen slot level (null = auto)
 * @param {Array} [options.selectedMetamagic] - Array of { name, cost } metamagic selections
 * @param {boolean} [options.skipSlotConsumption] - Skip slot usage (concentration recast)
 * @returns {{ text: string, rolls: Array, effects: Array, slotUsed: Object|null, metamagicUsed: Array, isCantrip: boolean, isFreecast: boolean, resourceChanges: Array }}
 */
function resolveSpellCast(spell, characterData, options = {}) {
  const {
    selectedSlotLevel = null,
    selectedMetamagic = [],
    skipSlotConsumption = false
  } = options;

  const result = {
    text: '',
    rolls: [],
    effects: [],
    slotUsed: null,
    metamagicUsed: [],
    isCantrip: false,
    isFreecast: false,
    resourceChanges: []
  };

  const magicItem = isMagicItemSpell(spell);
  const freeCast = isFreeSpell(spell);
  const isCantrip = !spell.level || spell.level === 0 || spell.level === '0';

  // Determine if this cast is free (no slot needed)
  if (isCantrip || magicItem || freeCast || skipSlotConsumption) {
    result.isCantrip = isCantrip;
    result.isFreecast = magicItem || freeCast || skipSlotConsumption;

    const reason = skipSlotConsumption ? 'concentration recast' :
      (magicItem ? 'magic item' : (freeCast ? 'free spell' : 'cantrip'));

    result.text = `Cast ${spell.name} (${reason})`;

    if (spell.concentration && !skipSlotConsumption) {
      result.effects.push({ type: 'concentration', spell: spell.name });
    }

    if (isReuseableSpell(spell.name, characterData) && !skipSlotConsumption) {
      result.effects.push({ type: 'track_reusable', spell: spell.name });
    }

    // Collect rolls from spell data
    if (spell.attackRoll && spell.attackRoll !== '(none)') {
      result.rolls.push({ type: 'attack', formula: spell.attackRoll, name: `${spell.name} - Attack` });
    }
    if (spell.damageRolls && Array.isArray(spell.damageRolls)) {
      spell.damageRolls.forEach(roll => {
        if (roll.damage) {
          const damageType = roll.damageType || 'damage';
          const isHealing = damageType.toLowerCase() === 'healing';
          result.rolls.push({
            type: isHealing ? 'healing' : 'damage',
            formula: roll.damage,
            name: `${spell.name} - ${isHealing ? 'Healing' : damageType}`,
            damageType
          });
        }
      });
    } else if (spell.damage) {
      const damageType = spell.damageType || 'damage';
      const isHealing = damageType.toLowerCase() === 'healing';
      result.rolls.push({
        type: isHealing ? 'healing' : 'damage',
        formula: spell.damage,
        name: `${spell.name} - ${isHealing ? 'Healing' : damageType}`,
        damageType
      });
    }

    return result;
  }

  // Spell needs a slot
  const spellLevel = parseInt(spell.level);

  if (selectedSlotLevel !== null) {
    const isPactMagicSlot = typeof selectedSlotLevel === 'string' && selectedSlotLevel.startsWith('pact:');
    let actualLevel, slotVar, slotLabel;

    if (isPactMagicSlot) {
      actualLevel = parseInt(selectedSlotLevel.split(':')[1]);
      slotVar = 'pactMagicSlots';
      slotLabel = `Pact Magic (level ${actualLevel})`;
    } else {
      actualLevel = parseInt(selectedSlotLevel);
      slotVar = `level${actualLevel}SpellSlots`;
      slotLabel = actualLevel > spellLevel
        ? `Level ${actualLevel} slot (upcast from ${spell.level})`
        : `Level ${actualLevel} slot`;
    }

    result.slotUsed = {
      level: actualLevel,
      slotVar,
      isPactMagic: isPactMagicSlot,
      label: slotLabel
    };
    result.resourceChanges.push({ type: 'spell_slot', slotVar, delta: -1 });

    // Handle metamagic
    if (selectedMetamagic && selectedMetamagic.length > 0) {
      let totalCost = 0;
      selectedMetamagic.forEach(meta => {
        const cost = typeof meta.cost === 'number' ? meta.cost : calculateMetamagicCost(meta.name, actualLevel);
        totalCost += cost;
        result.metamagicUsed.push({ name: meta.name, cost });
      });
      result.resourceChanges.push({ type: 'sorcery_points', delta: -totalCost });
      result.text = `Cast ${spell.name} using ${slotLabel} + ${result.metamagicUsed.map(m => m.name).join(', ')} (${totalCost} SP)`;
    } else {
      result.text = `Cast ${spell.name} using ${slotLabel}`;
    }
  } else {
    // No slot selected - caller should prompt for upcast
    result.text = `Cast ${spell.name} (needs level ${spellLevel}+ slot)`;
    result.effects.push({ type: 'needs_slot_selection', minLevel: spellLevel });
  }

  if (spell.concentration) {
    result.effects.push({ type: 'concentration', spell: spell.name });
  }

  if (isReuseableSpell(spell.name, characterData)) {
    result.effects.push({ type: 'track_reusable', spell: spell.name });
  }

  // Collect rolls
  if (spell.attackRoll && spell.attackRoll !== '(none)') {
    result.rolls.push({ type: 'attack', formula: spell.attackRoll, name: `${spell.name} - Attack` });
  }
  if (spell.damageRolls && Array.isArray(spell.damageRolls)) {
    spell.damageRolls.forEach(roll => {
      if (roll.damage) {
        const damageType = roll.damageType || 'damage';
        const isHealing = damageType.toLowerCase() === 'healing';
        result.rolls.push({
          type: isHealing ? 'healing' : 'damage',
          formula: roll.damage,
          name: `${spell.name} - ${isHealing ? 'Healing' : damageType}`,
          damageType
        });
      }
    });
  } else if (spell.damage) {
    const damageType = spell.damageType || 'damage';
    const isHealing = damageType.toLowerCase() === 'healing';
    result.rolls.push({
      type: isHealing ? 'healing' : 'damage',
      formula: spell.damage,
      name: `${spell.name} - ${isHealing ? 'Healing' : damageType}`,
      damageType
    });
  }

  // Check for spell edge cases
  if (isTooComplicatedSpell(spell.name, characterData)) {
    result.effects.push({ type: 'too_complicated', description: 'Requires DM intervention' });
  }

  return result;
}

/**
 * Resolve what happens when an action/ability is used. Returns a structured result.
 *
 * @param {Object} action - Action data { name, attackRoll, damage, damageType, actionType, description, range, ... }
 * @param {Object} characterData - Full character data
 * @returns {{ text: string, rolls: Array, effects: Array, edgeCase: Object|null }}
 */
function resolveActionUse(action, characterData = null) {
  const result = {
    text: `${action.name}`,
    rolls: [],
    effects: [],
    edgeCase: null
  };

  // Get options with edge cases applied
  const actionResult = getActionOptions(action, characterData);
  result.edgeCase = actionResult.skipNormalButtons ? actionResult : null;

  // Build rolls from options
  actionResult.options.forEach(opt => {
    if (opt.formula) {
      result.rolls.push({
        type: opt.type,
        formula: opt.formula,
        name: `${action.name} - ${opt.label}`,
        damageType: action.damageType
      });
    }
  });

  // Add description if available
  if (action.description) {
    result.effects.push({ type: 'description', text: action.description });
  }

  return result;
}


// ===== DISCORD INTEGRATION HELPERS =====

/**
 * Prepare spell list metadata for Discord bot autocomplete and command options.
 * Takes raw character data (as stored in Supabase raw_dicecloud_data) and returns
 * an enriched spell list that tells the bot what options to offer.
 *
 * @param {Object|string} rawCharacterData - Character data (object or JSON string)
 * @returns {{ spells: Array<{name, baseLevel, upcastable, maxUpcastLevel, edgeOverride, edgeCaseType, concentration, school, castingTime, range, components, duration, hasAttack, hasDamage, hasHealing}>, metamagic: Array<{name, cost}>, maxSpellSlotLevel: number }}
 */
function prepareSpellsForDiscord(rawCharacterData) {
  const data = typeof rawCharacterData === 'string'
    ? JSON.parse(rawCharacterData)
    : rawCharacterData;

  const characterData = data || {};
  const spells = characterData.spells || [];
  const spellSlots = characterData.spellSlots || {};

  // Determine highest spell slot level available
  let maxSpellSlotLevel = 0;
  for (let i = 9; i >= 1; i--) {
    const maxKey = `level${i}SpellSlotsMax`;
    if (spellSlots[maxKey] && spellSlots[maxKey] > 0) {
      maxSpellSlotLevel = i;
      break;
    }
  }
  // Also check pact magic
  const otherVars = characterData.otherVariables || {};
  if (otherVars.pactMagicSlotsMax && otherVars.pactMagicSlotsMax > 0) {
    const pactLevel = otherVars.pactMagicSlotLevel || 1;
    maxSpellSlotLevel = Math.max(maxSpellSlotLevel, pactLevel);
  }

  const enrichedSpells = spells.map(spell => {
    const baseLevel = parseInt(spell.level) || 0;
    const isCantrip = baseLevel === 0;
    const spellEdge = isEdgeCase(spell.name);
    let edgeCaseType = null;
    if (spellEdge) {
      const ec = getEdgeCase(spell.name);
      edgeCaseType = ec ? ec.type : null;
    }

    return {
      name: spell.name,
      baseLevel,
      upcastable: !isCantrip && baseLevel < 9,
      maxUpcastLevel: isCantrip ? 0 : Math.max(baseLevel, maxSpellSlotLevel),
      edgeOverride: spellEdge,
      edgeCaseType,
      concentration: !!spell.concentration,
      ritual: !!spell.ritual,
      school: spell.school || null,
      castingTime: spell.castingTime || null,
      range: spell.range || null,
      components: spell.components || null,
      duration: spell.duration || null,
      hasAttack: !!(spell.attackRoll && spell.attackRoll !== '(none)'),
      hasDamage: !!(spell.damage || (spell.damageRolls && spell.damageRolls.length > 0)),
      hasHealing: !!(spell.damageType && spell.damageType.toLowerCase().includes('heal'))
    };
  });

  // Metamagic options available to this character
  const metamagic = getAvailableMetamagic(characterData);

  return {
    spells: enrichedSpells,
    metamagic,
    maxSpellSlotLevel
  };
}

/**
 * Prepare action list metadata for Discord bot autocomplete.
 *
 * @param {Object|string} rawCharacterData - Character data (object or JSON string)
 * @returns {{ actions: Array<{name, actionType, hasAttack, hasDamage, hasHealing, edgeOverride, edgeCaseType, range, description}> }}
 */
function prepareActionsForDiscord(rawCharacterData) {
  const data = typeof rawCharacterData === 'string'
    ? JSON.parse(rawCharacterData)
    : rawCharacterData;

  const characterData = data || {};
  const actions = characterData.actions || [];

  const enrichedActions = actions.map(action => {
    const classEdge = isClassFeatureEdgeCase(action.name);
    const racialEdge = isRacialFeatureEdgeCase(action.name);
    const combatEdge = isCombatManeuverEdgeCase(action.name);
    const edgeOverride = classEdge || racialEdge || combatEdge;

    const isHealing = action.damageType && action.damageType.toLowerCase().includes('heal');
    const hasDamage = !!(action.damage && /\d*d\d+/.test(action.damage));

    return {
      name: action.name,
      actionType: action.actionType || 'action',
      hasAttack: !!action.attackRoll,
      hasDamage: hasDamage && !isHealing,
      hasHealing: hasDamage && isHealing,
      edgeOverride,
      edgeCaseType: classEdge ? 'class_feature' : (racialEdge ? 'racial_feature' : (combatEdge ? 'combat_maneuver' : null)),
      range: action.range || null,
      description: action.description || null
    };
  });

  return { actions: enrichedActions };
}

/**
 * Execute a Discord /cast command. Takes the command_data payload from the bot
 * and returns a full execution result without any side effects.
 *
 * @param {Object} commandData - { spell_name, spell_level, cast_level, character_name, character_id, notification_color, spell_data, metamagic? }
 * @param {Object} characterData - Full character data from raw_dicecloud_data
 * @returns {{ text: string, rolls: Array, effects: Array, slotUsed: Object|null, metamagicUsed: Array, embed: Object }}
 */
function executeDiscordCast(commandData, characterData) {
  const spell = commandData.spell_data || {};
  const castLevel = commandData.cast_level || commandData.spell_level || spell.level;
  const charName = commandData.character_name || 'Character';
  const metamagicName = commandData.metamagic || null;

  // Check if this is a too-complicated spell
  if (isTooComplicatedSpell(spell.name, characterData)) {
    return {
      text: `${charName} casts ${spell.name}! (DM adjudication required)`,
      rolls: [],
      effects: [{ type: 'too_complicated', description: spell.description || 'Requires DM intervention' }],
      slotUsed: null,
      metamagicUsed: [],
      embed: {
        title: `${charName} casts ${spell.name}`,
        description: 'This spell requires DM adjudication.',
        spellLevel: parseInt(spell.level) || 0,
        castLevel: parseInt(castLevel) || 0
      }
    };
  }

  // Resolve metamagic if specified
  const selectedMetamagic = [];
  if (metamagicName) {
    const cost = calculateMetamagicCost(metamagicName, parseInt(castLevel) || 0);
    selectedMetamagic.push({ name: metamagicName, cost });
  }

  // Use resolveSpellCast for the actual logic
  const result = resolveSpellCast(spell, characterData, {
    selectedSlotLevel: parseInt(castLevel) || null,
    selectedMetamagic,
    skipSlotConsumption: false
  });

  // Build embed data for the Discord response
  const spellLevel = parseInt(spell.level) || 0;
  const isUpcast = parseInt(castLevel) > spellLevel;

  result.embed = {
    title: `${charName} casts ${spell.name}`,
    description: formatSpellSummary(spell, parseInt(castLevel)),
    spellLevel,
    castLevel: parseInt(castLevel) || spellLevel,
    isUpcast,
    metamagic: selectedMetamagic.map(m => m.name)
  };

  return result;
}

/**
 * Execute a Discord /use command. Takes command_data and returns execution result.
 *
 * @param {Object} commandData - { action_name, action_type, character_name, character_id, notification_color, action_data }
 * @param {Object} characterData - Full character data from raw_dicecloud_data
 * @returns {{ text: string, rolls: Array, effects: Array, edgeCase: Object|null, embed: Object }}
 */
function executeDiscordAction(commandData, characterData) {
  const action = commandData.action_data || commandData.action || {};
  const charName = commandData.character_name || 'Character';

  const result = resolveActionUse(action, characterData);

  result.embed = {
    title: `${charName} uses ${action.name || commandData.action_name}`,
    description: formatActionSummary(action),
    actionType: action.actionType || commandData.action_type || 'action'
  };

  return result;
}


// ===== FORMATTING HELPERS (for Discord embed descriptions) =====

/**
 * Format a spell summary for Discord embed. Uses the actual field names from
 * DiceCloud data (damage, damageRolls, damageType) rather than the mismatched
 * ones (damageRoll, healingRoll).
 */
function formatSpellSummary(spell, castLevel) {
  let desc = '';

  if (spell.castingTime) desc += `**Casting Time:** ${spell.castingTime}\n`;
  if (spell.range) desc += `**Range:** ${spell.range}\n`;
  if (spell.duration && spell.duration !== 'Instantaneous') desc += `**Duration:** ${spell.duration}\n`;
  if (spell.components) desc += `**Components:** ${spell.components}\n`;
  if (spell.concentration) desc += `**Concentration:** Yes\n`;

  // Use correct field names from DiceCloud extraction
  if (spell.damageRolls && Array.isArray(spell.damageRolls) && spell.damageRolls.length > 0) {
    spell.damageRolls.forEach(roll => {
      if (roll.damage) {
        const type = roll.damageType || 'damage';
        const isHealing = type.toLowerCase() === 'healing';
        const label = isHealing ? 'Healing' : type.charAt(0).toUpperCase() + type.slice(1);
        desc += `**${label}:** ${roll.damage}`;
        if (castLevel && parseInt(spell.level) > 0 && castLevel > parseInt(spell.level)) {
          desc += ` (upcast to level ${castLevel})`;
        }
        desc += '\n';
      }
    });
  } else if (spell.damage) {
    const type = spell.damageType || 'damage';
    const isHealing = type.toLowerCase() === 'healing';
    const label = isHealing ? 'Healing' : 'Damage';
    desc += `**${label}:** ${spell.damage}`;
    if (castLevel && parseInt(spell.level) > 0 && castLevel > parseInt(spell.level)) {
      desc += ` (upcast to level ${castLevel})`;
    }
    desc += '\n';
  }

  // Backward compat: also check damageRoll/healingRoll if present
  if (!spell.damage && !spell.damageRolls) {
    if (spell.damageRoll) desc += `**Damage:** ${spell.damageRoll}\n`;
    if (spell.healingRoll) desc += `**Healing:** ${spell.healingRoll}\n`;
  }

  if (spell.attackRoll && spell.attackRoll !== '(none)') {
    desc += `**Attack:** ${spell.attackRoll}\n`;
  }

  return desc || 'Spell sent to Roll20.';
}

/**
 * Format an action summary for Discord embed.
 */
function formatActionSummary(action) {
  let desc = '';

  if (action.attackRoll || action.attackBonus) {
    const formula = action.attackRoll || `+${action.attackBonus}`;
    desc += `**Attack:** ${formula}\n`;
  }

  if (action.damage && /\d*d\d+/.test(action.damage)) {
    const type = action.damageType || 'damage';
    const isHealing = type.toLowerCase().includes('heal');
    desc += `**${isHealing ? 'Healing' : 'Damage'}:** ${action.damage}`;
    if (action.damageType && !isHealing) desc += ` ${action.damageType}`;
    desc += '\n';
  }

  if (action.range) desc += `**Range:** ${action.range}\n`;
  if (action.duration && action.duration !== 'Instantaneous') desc += `**Duration:** ${action.duration}\n`;

  return desc || 'Action sent to Roll20.';
}

// Expose all functions and constants to globalThis for importScripts usage
if (typeof globalThis !== 'undefined') {
  // Edge case modules (re-exported from the individual edge case files)
  globalThis.SPELL_EDGE_CASES = globalThis.SPELL_EDGE_CASES;
  globalThis.isEdgeCase = globalThis.isEdgeCase;
  globalThis.getEdgeCase = globalThis.getEdgeCase;
  globalThis.applyEdgeCaseModifications = globalThis.applyEdgeCaseModifications;
  globalThis.isReuseableSpell = globalThis.isReuseableSpell;
  globalThis.isTooComplicatedSpell = globalThis.isTooComplicatedSpell;
  globalThis.detectRulesetFromCharacterData = globalThis.detectRulesetFromCharacterData;

  globalThis.CLASS_FEATURE_EDGE_CASES = globalThis.CLASS_FEATURE_EDGE_CASES;
  globalThis.isClassFeatureEdgeCase = globalThis.isClassFeatureEdgeCase;
  globalThis.getClassFeatureEdgeCase = globalThis.getClassFeatureEdgeCase;
  globalThis.applyClassFeatureEdgeCaseModifications = globalThis.applyClassFeatureEdgeCaseModifications;
  globalThis.getClassFeaturesByType = globalThis.getClassFeaturesByType;
  globalThis.getAllClassFeatureEdgeCaseTypes = globalThis.getAllClassFeatureEdgeCaseTypes;

  globalThis.RACIAL_FEATURE_EDGE_CASES = globalThis.RACIAL_FEATURE_EDGE_CASES;
  globalThis.isRacialFeatureEdgeCase = globalThis.isRacialFeatureEdgeCase;
  globalThis.getRacialFeatureEdgeCase = globalThis.getRacialFeatureEdgeCase;
  globalThis.applyRacialFeatureEdgeCaseModifications = globalThis.applyRacialFeatureEdgeCaseModifications;

  globalThis.COMBAT_MANEUVER_EDGE_CASES = globalThis.COMBAT_MANEUVER_EDGE_CASES;
  globalThis.isCombatManeuverEdgeCase = globalThis.isCombatManeuverEdgeCase;
  globalThis.getCombatManeuverEdgeCase = globalThis.getCombatManeuverEdgeCase;
  globalThis.applyCombatManeuverEdgeCaseModifications = globalThis.applyCombatManeuverEdgeCaseModifications;

  // Metamagic system
  globalThis.METAMAGIC_COSTS = METAMAGIC_COSTS;
  globalThis.calculateMetamagicCost = calculateMetamagicCost;
  globalThis.getAvailableMetamagic = getAvailableMetamagic;
  globalThis.getSorceryPointsResource = getSorceryPointsResource;

  // Resource detection
  globalThis.isMagicItemSpell = isMagicItemSpell;
  globalThis.isFreeSpell = isFreeSpell;
  globalThis.detectClassResources = detectClassResources;

  // Action options
  globalThis.getActionOptions = getActionOptions;

  // Spell execution
  globalThis.resolveSpellCast = resolveSpellCast;
  globalThis.resolveActionUse = resolveActionUse;

  // Discord integration
  globalThis.prepareSpellsForDiscord = prepareSpellsForDiscord;
  globalThis.prepareActionsForDiscord = prepareActionsForDiscord;
  globalThis.executeDiscordCast = executeDiscordCast;
  globalThis.executeDiscordAction = executeDiscordAction;
}
