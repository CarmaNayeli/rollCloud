/**
 * Dice Cloud Content Script
 * Extracts character data from Dice Cloud using the REST API
 */

(function() {
  'use strict';

  debug.log('🎲 RollCloud: DiceCloud content script loaded');
  debug.log('📍 Current URL:', window.location.href);

  // DiceCloud API endpoint
  const API_BASE = 'https://dicecloud.com/api';

  // Standardized DiceCloud variable names
  const STANDARD_VARS = {
    abilities: ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'],
    abilityMods: ['strengthMod', 'dexterityMod', 'constitutionMod', 'intelligenceMod', 'wisdomMod', 'charismaMod'],
    saves: ['strengthSave', 'dexteritySave', 'constitutionSave', 'intelligenceSave', 'wisdomSave', 'charismaSave'],
    skills: [
      'acrobatics', 'animalHandling', 'arcana', 'athletics', 'deception', 'history',
      'insight', 'intimidation', 'investigation', 'medicine', 'nature', 'perception',
      'performance', 'persuasion', 'religion', 'sleightOfHand', 'stealth', 'survival'
    ],
    spellSlots: [
      'level1SpellSlots', 'level2SpellSlots', 'level3SpellSlots', 'level4SpellSlots', 'level5SpellSlots',
      'level6SpellSlots', 'level7SpellSlots', 'level8SpellSlots', 'level9SpellSlots',
      'level1SpellSlotsMax', 'level2SpellSlotsMax', 'level3SpellSlotsMax', 'level4SpellSlotsMax', 'level5SpellSlotsMax',
      'level6SpellSlotsMax', 'level7SpellSlotsMax', 'level8SpellSlotsMax', 'level9SpellSlotsMax'
    ],
    combat: ['armorClass', 'hitPoints', 'speed', 'initiative', 'proficiencyBonus']
  };

  /**
   * Utility function to position popup within viewport bounds
   * @param {number} x - Initial X position (clientX)
   * @param {number} y - Initial Y position (clientY)
   * @param {number} width - Popup width (default: 200)
   * @param {number} height - Popup height (default: 150)
   * @returns {Object} - Adjusted x, y coordinates within viewport
   */
  function getPopupPosition(x, y, width = 200, height = 150) {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    // Adjust horizontal position
    let adjustedX = x;
    if (x + width > viewportWidth) {
      adjustedX = viewportWidth - width - 10; // 10px margin from edge
      if (adjustedX < 10) adjustedX = 10; // Ensure minimum margin from left edge
    }
    
    // Adjust vertical position
    let adjustedY = y;
    if (y + height > viewportHeight) {
      adjustedY = viewportHeight - height - 10; // 10px margin from edge
      if (adjustedY < 10) adjustedY = 10; // Ensure minimum margin from top edge
    }
    
    return { x: adjustedX, y: adjustedY };
  }

  /**
   * Strips conditional expressions from text (e.g., DiceCloud template strings)
   * Removes patterns like: {condition ? "value" : "other"} or {variable == 1 && level >= 3 ? "..." : ""}
   * Also removes array indexing patterns like: {[0, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2][4]}
   * @param {string} text - Text potentially containing conditional expressions
   * @returns {string} - Cleaned text with conditionals removed
   */
  function stripConditionalExpressions(text) {
    if (!text || typeof text !== 'string') return text;

    // Remove conditional expressions enclosed in braces
    // Pattern matches: {anything ? anything : anything}
    // Uses a simple approach: find {, count braces to match closing }, remove if contains ?
    let result = text;
    let changed = true;

    // Iterate until no more changes (handles nested conditionals)
    while (changed) {
      const before = result;

      // Match conditional expressions: {...?...}
      // This regex matches braces that contain a ? character (ternary operator)
      result = result.replace(/\{[^{}]*\?[^{}]*\}/g, '');

      // Match array indexing expressions: {[...][...]}
      // This regex matches braces that contain array bracket patterns with indexing
      result = result.replace(/\{[\s]*\[[^\]]*\][\s]*\[[^\]]*\][\s]*\}/g, '');

      changed = (before !== result);
    }

    // Clean up any extra whitespace that may have been left
    result = result.replace(/\s{2,}/g, ' ').trim();

    return result;
  }

  /**
   * Extracts character ID from the current URL
   */
  function getCharacterIdFromUrl() {
    const url = window.location.pathname;
    debug.log('🔍 Parsing URL:', url);

    // Try different patterns
    const patterns = [
      /\/character\/([^/]+)/,           // /character/ABC123
      /\/character\/([^/]+)\/[^/]+/,    // /character/ABC123/CharName
      /character=([^&]+)/,              // ?character=ABC123
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) {
        debug.log('✅ Found character ID:', match[1]);
        return match[1];
      }
    }

    debug.error('❌ Could not extract character ID from URL');
    return null;
  }
/**
   * Fetches character data from DiceCloud API
   */
  async function fetchCharacterDataFromAPI() {
    debug.log('📡 Starting API fetch...');
    
    const characterId = getCharacterIdFromUrl();

    if (!characterId) {
      const error = 'Not on a character page. Navigate to a character sheet first.';
      debug.error('❌', error);
      throw new Error(error);
    }

    debug.log('🔐 Requesting API token from background...');
    
    // Get stored API token from background script
    let tokenResponse;
    try {
      tokenResponse = await browserAPI.runtime.sendMessage({ action: 'getApiToken' });
      debug.log('🔑 Token response from background:', tokenResponse);
    } catch (error) {
      debug.error('Extension context error:', error);
      debug.log('🔄 Background script not responding, trying direct storage...');
      
      // Fallback: get token directly from storage
      try {
        const storageResult = await browserAPI.storage.local.get(['diceCloudToken', 'tokenExpires', 'username']);
        debug.log('📦 Direct storage result:', storageResult);
        if (storageResult.diceCloudToken) {
          tokenResponse = {
            success: true,
            token: storageResult.diceCloudToken,
            tokenExpires: storageResult.tokenExpires,
            username: storageResult.username
          };
          debug.log('✅ Token obtained from direct storage');
        } else {
          debug.error('❌ No token found in storage, storage keys:', Object.keys(storageResult));
          throw new Error('No token found in storage');
        }
      } catch (storageError) {
        debug.error('Storage fallback failed:', storageError);
        throw new Error('Extension reloaded. Please refresh the page.');
      }
    }

    // If background script responded but failed, also try storage fallback
    if (tokenResponse && !tokenResponse.success) {
      debug.log('🔄 Background script reported failure, trying direct storage...');
      try {
        const storageResult = await browserAPI.storage.local.get(['diceCloudToken', 'tokenExpires', 'username']);
        debug.log('📦 Direct storage result (background failed):', storageResult);
        if (storageResult.diceCloudToken) {
          tokenResponse = {
            success: true,
            token: storageResult.diceCloudToken,
            tokenExpires: storageResult.tokenExpires,
            username: storageResult.username
          };
          debug.log('✅ Token obtained from direct storage (background failed)');
        } else {
          debug.error('❌ No token found in storage, storage keys:', Object.keys(storageResult));
          throw new Error('No token found in storage');
        }
      } catch (storageError) {
        debug.error('Storage fallback failed:', storageError);
        throw new Error('Extension reloaded. Please refresh the page.');
      }
    }

    debug.log('🔍 Final token response:', tokenResponse);

    if (!tokenResponse.success || !tokenResponse.token) {
      const error = 'Not logged in to DiceCloud. Please login via the extension popup.';
      debug.error('❌', error);
      throw new Error(error);
    }

    debug.log('✅ API token obtained');
    debug.log('📡 Fetching character data for ID:', characterId);

    // Add timestamp to URL to bypass any caching (cache busting)
    const timestamp = Date.now();
    const apiUrl = `${API_BASE}/creature/${characterId}?_t=${timestamp}`;
    debug.log('🌐 API URL:', apiUrl);

    // Fetch character data from API
    try {
      const response = await fetch(apiUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${tokenResponse.token}`,
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        },
        cache: 'no-store'
      });

      debug.log('📨 API Response status:', response.status);

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('API token expired. Please login again via the extension popup.');
        }
        const errorText = await response.text();
        debug.error('❌ API Error Response:', errorText);
        throw new Error(`API request failed: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();
      debug.log('✅ Received API data:', data);
      debug.log('📊 Data structure:', {
        hasCreatures: !!data.creatures,
        creaturesCount: (data.creatures && data.creatures.length) || 0,
        hasVariables: !!data.creatureVariables,
        variablesCount: (data.creatureVariables && data.creatureVariables.length) || 0,
        hasProperties: !!data.creatureProperties,
        propertiesCount: (data.creatureProperties && data.creatureProperties.length) || 0
      });
      
      return parseCharacterData(data);
    } catch (fetchError) {
      debug.error('❌ Fetch error:', fetchError);
      throw fetchError;
    }
  }

/**
   * Determines hit die type from character class (D&D 5e)
   */
  function getHitDieTypeFromClass(levels) {
    const hitDiceMap = {
      'barbarian': 'd12',
      'fighter': 'd10',
      'paladin': 'd10',
      'ranger': 'd10',
      'bard': 'd8',
      'cleric': 'd8',
      'druid': 'd8',
      'monk': 'd8',
      'rogue': 'd8',
      'warlock': 'd8',
      'sorcerer': 'd6',
      'wizard': 'd6'
    };

    // Get primary class from levels array (first entry or highest level)
    if (levels && levels.length > 0) {
      const primaryClass = levels[0]?.name?.toLowerCase() || '';
      for (const [classKey, die] of Object.entries(hitDiceMap)) {
        if (primaryClass.includes(classKey)) {
          return die;
        }
      }
    }

    return 'd8'; // Default
  }

  /**
   * Parses API response into structured character data
   */
  function parseCharacterData(apiData) {
    debug.log('🔧 Parsing character data...');
    
    if (!apiData.creatures || apiData.creatures.length === 0) {
      debug.error('❌ No creatures found in API response');
      throw new Error('No character data found in API response');
    }

    const creature = apiData.creatures[0];
    const variables = (apiData.creatureVariables && apiData.creatureVariables[0]) || {};
    const properties = apiData.creatureProperties || [];

    debug.log('📝 Creature:', creature);
    debug.log('📊 Variables count:', Object.keys(variables).length);
    debug.log('📋 Properties count:', properties.length);

    // Explicitly log any properties whose type or name looks like armor/AC to aid debugging
    try {
      const propArmorMatches = properties.filter(p => {
        const name = (p && p.name) ? String(p.name) : '';
        const type = (p && p.type) ? String(p.type) : '';
        return (/armor|\bac\b/i.test(name) || /armor|\bac\b/i.test(type));
      });
      debug.log(`🛡️ Properties with type/name containing armor/AC: ${propArmorMatches.length}`, propArmorMatches.map(p => ({
        id: p._id || p.id || null,
        name: p.name,
        type: p.type,
        stat: p.stat,
        stats: p.stats,
        operation: p.operation,
        amount: p.amount,
        inactive: p.inactive,
        disabled: p.disabled
      })));
    } catch (e) {
      debug.warn('⚠️ Error while listing armor-like properties:', e && e.message ? e.message : e);
    }

    // Calculate AC from properties with armor stat effects
    const calculateArmorClass = () => {
      let baseAC = 10;
      let armorAC = null;
      const acBonuses = [];
      
      debug.log('🛡️ Calculating AC from properties...');
      // Quick wins: check denormalized stats or creature-level AC fields
      try {
        // Helper: try to coerce a variety of shapes into a numeric AC
        const extractNumeric = (val) => {
          if (val === null || val === undefined) return null;
          if (typeof val === 'number' && !isNaN(val)) return val;
          if (typeof val === 'string') {
            const parsed = parseFloat(val);
            return isNaN(parsed) ? null : parsed;
          }
          if (typeof val === 'object') {
            // Common DiceCloud shapes: { total, value, calculation, text }
            if (val.total !== undefined && typeof val.total === 'number') return val.total;
            if (val.total !== undefined && typeof val.total === 'string') {
              const p = parseFloat(val.total);
              if (!isNaN(p)) return p;
            }
            if (val.value !== undefined && typeof val.value === 'number') return val.value;
            if (val.value !== undefined && typeof val.value === 'string') {
              const p = parseFloat(val.value);
              if (!isNaN(p)) return p;
            }
            if (val.calculation && typeof val.calculation === 'string') {
              const bm = val.calculation.match(/^(\d+)/);
              if (bm) return parseInt(bm[1]);
            }
            if (val.text && typeof val.text === 'string') {
              const p = parseFloat(val.text);
              if (!isNaN(p)) return p;
            }
          }
          return null;
        };

        if (creature && creature.denormalizedStats) {
          const dn = creature.denormalizedStats;
          const tryKeys = ['armorClass', 'ac', 'armor'];
          for (const k of tryKeys) {
            if (dn.hasOwnProperty(k)) {
              const num = extractNumeric(dn[k]);
              if (num !== null) {
                debug.log(`🛡️ Using denormalizedStats.${k}:`, num);
                return num;
              }
            }
          }
        }

        // Also check top-level creature fields that may hold precomputed AC
        if (creature && creature.armorClass !== undefined) {
          const num = extractNumeric(creature.armorClass);
          if (num !== null) {
            debug.log('🛡️ Using creature.armorClass:', num);
            return num;
          }
        }
        if (creature && creature.stats && creature.stats.ac !== undefined) {
          const num = extractNumeric(creature.stats.ac);
          if (num !== null) {
            debug.log('🛡️ Using creature.stats.ac:', num);
            return num;
          }
        }

        // Prefer DiceCloud variables that explicitly represent AC/armor
        try {
          if (variables && Object.keys(variables).length > 0) {
            const varNamesToCheck = ['armor', 'armorClass', 'armor_class', 'ac', 'acTotal', 'ac_total'];
            for (const vn of varNamesToCheck) {
              if (Object.prototype.hasOwnProperty.call(variables, vn)) {
                const v = variables[vn];
                const candidate = extractNumeric(v && (v.total ?? v.value ?? v));
                if (candidate !== null) {
                  debug.log(`🛡️ Using variable ${vn}:`, candidate);
                  return candidate;
                }
              }
            }
          }
        } catch (e) {
          debug.warn('⚠️ Error while checking variables for AC:', e && e.message ? e.message : e);
        }

        // Check properties for a named "Armor Class" property which directly sets base AC
        try {
          if (Array.isArray(properties) && properties.length > 0) {
            const propAC = properties.find(p => p && p.name && /\barmor class\b/i.test(p.name));
            if (propAC) {
              const propAmount = propAC.amount ?? propAC.value ?? propAC.total ?? propAC.baseValue ?? propAC;
              const propNum = extractNumeric(propAmount);
              if (propNum !== null) {
                debug.log('🛡️ Using property "Armor Class":', propNum, propAC);
                return propNum;
              }
            }
          }
        } catch (e) {
          debug.warn('⚠️ Error while checking properties for Armor Class:', e && e.message ? e.message : e);
        }
      } catch (e) {
        debug.warn('⚠️ Error while checking denormalized AC fields:', e && e.message ? e.message : e);
      }

      // If we reach here, try a deeper search inside denormalizedStats for any numeric candidates
      try {
        const findNumericRecursively = (obj, depth = 0, path = '') => {
          if (obj === null || obj === undefined || depth > 6) return null;
          const lastKey = path.split('.').pop();
          const ignoreKeyRegex = /^(xp|experience|milestoneLevels?|milestonelevel|level|levels|hp|hitPoints?|hit_points?)$/i;

          if (typeof obj === 'number' && !isNaN(obj)) {
            if (ignoreKeyRegex.test(lastKey || '')) return null;
            return { value: obj, path };
          }
          if (typeof obj === 'string') {
            const p = parseFloat(obj);
            if (!isNaN(p)) {
              if (ignoreKeyRegex.test(lastKey || '')) return null;
              return { value: p, path };
            }
            return null;
          }
          if (typeof obj === 'object') {
            // Prefer named keys first
            const preferKeys = ['armorClass', 'armor', 'ac', 'total', 'value', 'computed'];
            for (const k of preferKeys) {
              if (Object.prototype.hasOwnProperty.call(obj, k)) {
                const candidate = findNumericRecursively(obj[k], depth + 1, path ? `${path}.${k}` : k);
                if (candidate) return candidate;
              }
            }

            // Otherwise iterate all keys
            for (const key of Object.keys(obj)) {
              try {
                const candidate = findNumericRecursively(obj[key], depth + 1, path ? `${path}.${key}` : key);
                if (candidate) return candidate;
              } catch (inner) {
                // ignore
              }
            }
          }
          return null;
        };

        if (creature && creature.denormalizedStats) {
          debug.log('🛡️ Deep-scanning denormalizedStats for numeric AC candidates...');
          debug.log('🛡️ denormalizedStats snapshot:', creature.denormalizedStats);

          // First: search for numeric candidates where the key/path clearly indicates armor/AC
          const nameRegex = /armor|armorClass|armor_class|ac|ac_total/i;

          const findNamedNumericRecursively = (obj, depth = 0, path = '') => {
            if (obj === null || obj === undefined || depth > 6) return null;
            // If current path or last key looks like armor/AC and value is numeric, return it
            const lastKey = path.split('.').pop();
            if (typeof obj === 'number' && !isNaN(obj) && nameRegex.test(lastKey || '')) return { value: obj, path };
            if (typeof obj === 'string') {
              const p = parseFloat(obj);
              if (!isNaN(p) && nameRegex.test(lastKey || '')) return { value: p, path };
              return null;
            }
            if (typeof obj === 'object') {
              // Prefer named keys first
              const preferKeys = ['armorClass', 'armor', 'ac', 'total', 'value', 'computed'];
              for (const k of preferKeys) {
                if (Object.prototype.hasOwnProperty.call(obj, k)) {
                  const candidate = findNamedNumericRecursively(obj[k], depth + 1, path ? `${path}.${k}` : k);
                  if (candidate) return candidate;
                }
              }

              for (const key of Object.keys(obj)) {
                try {
                  const candidate = findNamedNumericRecursively(obj[key], depth + 1, path ? `${path}.${key}` : key);
                  if (candidate) return candidate;
                } catch (inner) {
                  // ignore
                }
              }
            }
            return null;
          };

          // Try named search first
          const namedFound = findNamedNumericRecursively(creature.denormalizedStats, 0, 'denormalizedStats');
          if (namedFound) {
            debug.log(`🛡️ Found named numeric candidate in denormalizedStats at ${namedFound.path}:`, namedFound.value);
            return namedFound.value;
          }

          // Fallback: generic numeric search (keeps previous behavior)
          const found = findNumericRecursively(creature.denormalizedStats, 0, 'denormalizedStats');
          if (found) {
            debug.log(`🛡️ Found numeric candidate in denormalizedStats at ${found.path}:`, found.value);
            return found.value;
          }
        }
      } catch (e) {
        debug.warn('⚠️ Error during deep denormalizedStats scan:', e && e.message ? e.message : e);
      }

      // Check DiceCloud variables for any armor/AC-like variables (common names vary)
      try {
        const armorVarKeys = Object.keys(variables || {}).filter(k => /armor|\bac\b/i.test(k));
        if (armorVarKeys.length > 0) {
          debug.log('🛡️ armor variable candidates:', armorVarKeys);
          for (const key of armorVarKeys) {
            try {
              const candidateVar = variables[key];
              const candidateNum = extractNumeric(candidateVar && (candidateVar.total ?? candidateVar.value ?? candidateVar));
              if (candidateNum !== null) {
                debug.log(`🛡️ Using variable ${key}:`, candidateNum);
                return candidateNum;
              } else {
                debug.log(`🛡️ Variable ${key} exists but did not yield numeric AC:`, candidateVar);
              }
            } catch (inner) {
              debug.log('⚠️ Error inspecting variable', key, inner && inner.message ? inner.message : inner);
            }
          }
        }
      } catch (e) {
        debug.warn('⚠️ Error while scanning variables for AC:', e && e.message ? e.message : e);
      }
      debug.log(`🛡️ Total properties to scan: ${properties.length}`);
      
      // Debug: Log all properties with type 'effect' to see structure
      const effectProps = properties.filter(p => p.type === 'effect');
      debug.log(`🛡️ Found ${effectProps.length} effect properties`);
      if (effectProps.length > 0) {
        debug.log('🛡️ Sample effect properties:', effectProps.slice(0, 5).map(p => ({
          name: p.name,
          type: p.type,
          stat: p.stat,
          stats: p.stats,
          operation: p.operation,
          amount: p.amount,
          inactive: p.inactive,
          disabled: p.disabled
        })));
        
        // Look specifically for armor-related effects
        const armorEffects = effectProps.filter(p => 
          p.stat === 'armor' || 
          (Array.isArray(p.stats) && p.stats.includes('armor')) ||
          (typeof p.stats === 'string' && p.stats === 'armor') ||
          (p.name && p.name.toLowerCase().includes('armor'))
        );
        debug.log(`🛡️ Found ${armorEffects.length} armor-related effects:`, armorEffects.map(p => ({
          name: p.name,
          type: p.type,
          stat: p.stat,
          stats: p.stats,
          operation: p.operation,
          amount: p.amount,
          inactive: p.inactive,
          disabled: p.disabled,
          enabled: p.enabled,
          equipped: p.equipped,
          parent: p.parent
        })));
      }
      
      // Find all effects that modify the "armor" stat
      properties.forEach(prop => {
        if (prop.inactive || prop.disabled) return;
        
        // Skip spell effects - they only apply when the spell is active
        // Common spell names that affect AC temporarily
        const spellACEffects = ['shield', 'shield of faith', 'armor of agathys', 'mage armor', 'barkskin'];
        if (prop.name && spellACEffects.some(spell => prop.name.toLowerCase().includes(spell))) {
          debug.log(`  ⏭️ Skipping spell effect: ${prop.name} (only applies when spell is active)`);
          return;
        }
        
        // Check if this property has an effect on armor stat
        // Handle both string and array formats for stats
        const hasArmorStat = prop.stat === 'armor' || 
                            (Array.isArray(prop.stats) && prop.stats.includes('armor')) ||
                            (typeof prop.stats === 'string' && prop.stats === 'armor');
        
        if (hasArmorStat) {
          // Extract amount - can be a number, string, or object with calculation property
          let amount = null;
          if (typeof prop.amount === 'number') {
            amount = prop.amount;
          } else if (typeof prop.amount === 'string') {
            amount = parseFloat(prop.amount);
          } else if (prop.amount && typeof prop.amount === 'object' && prop.amount.calculation) {
            // For calculated amounts, try to parse the calculation string
            // This handles formulas like "14+min(dexterity.modifier, 2)"
            const calc = prop.amount.calculation;
            debug.log(`🛡️ Found calculated armor amount: "${calc}" for ${prop.name || 'Unnamed'}`);
            // Try to extract a base number from the calculation (e.g., "14" from "14+...")
            const baseMatch = calc.match(/^(\d+)/);
            if (baseMatch) {
              amount = parseInt(baseMatch[1]);
              debug.log(`  📊 Extracted base AC value: ${amount} from calculation`);
            }
          }
          
          if (amount !== null && !isNaN(amount)) {
            const operation = prop.operation || '';
            debug.log(`🛡️ Found armor effect: ${prop.name || 'Unnamed'} - Operation: ${operation}, Amount: ${amount}`);
            
            // Base value operations set the AC directly (like armor)
            if (operation === 'base' || operation === 'Base value') {
              if (armorAC === null || amount > armorAC) {
                armorAC = amount;
                debug.log(`  ✅ Set armor AC to ${amount} from ${prop.name || 'Unnamed'}`);
              }
            }
            // Add operations add to AC (like shields, bonuses)
            else if (operation === 'add' || operation === 'Add') {
              acBonuses.push({ name: prop.name, amount });
              debug.log(`  ✅ Added AC bonus: +${amount} from ${prop.name || 'Unnamed'}`);
            }
          }
        }
      });
      
      // Dicecloud pre-calculates AC including all formulas and modifiers
      // Use that value if available, otherwise calculate from our detected effects
      debug.log('🛡️ Full armorClass variable object:', variables.armorClass);
      
      // Check if Dicecloud provided a calculated AC
      if (variables.armorClass && (variables.armorClass.total || variables.armorClass.value)) {
        const variableAC = variables.armorClass.total || variables.armorClass.value;
        debug.log(`🛡️ Using Dicecloud's calculated AC: ${variableAC}`);
        return variableAC;
      }
      
      // Dicecloud didn't provide AC, so calculate from our detected effects
      let finalAC = armorAC !== null ? armorAC : baseAC;
      acBonuses.forEach(bonus => {
        finalAC += bonus.amount;
      });
      
      debug.log(`🛡️ Dicecloud didn't provide AC variable, calculating from effects:`);
      debug.log(`   Base: ${armorAC !== null ? armorAC + ' (armor)' : baseAC + ' (unarmored)'}`);
      debug.log(`   Bonuses: ${acBonuses.map(b => `+${b.amount} (${b.name})`).join(', ') || 'none'}`);
      debug.log(`   Final AC: ${finalAC}`);
      
      return finalAC;
    };

    const characterData = {
      id: creature._id || getCharacterIdFromUrl(),  // CRITICAL: Store character ID for proper persistence
      name: creature.name || '',
      race: '',
      class: '',
      level: 0,
      background: '',
      alignment: creature.alignment || '',
      attributes: {},
      attributeMods: {},
      saves: {},
      savingThrows: {},
      skills: {},
      features: [],
      spells: [],
      actions: [],
      spellSlots: {},
      inventory: [],
      proficiencies: [],
      hitPoints: {
        current: (variables.hitPoints && (variables.hitPoints.currentValue ?? variables.hitPoints.value)) || 0,
        max: (variables.hitPoints && (variables.hitPoints.total ?? variables.hitPoints.max)) || 0
      },
      temporaryHP: (variables.temporaryHitPoints && (variables.temporaryHitPoints.value ?? variables.temporaryHitPoints.currentValue)) || 0,
      hitDice: (() => {
        // Check for hit dice in variables (e.g., D8HitDice, D10HitDice, etc.)
        const hitDiceTypes = ['D6HitDice', 'D8HitDice', 'D10HitDice', 'D12HitDice'];
        for (const diceType of hitDiceTypes) {
          if (variables[diceType] && (variables[diceType].total ?? variables[diceType].max) > 0) {
            const maxDice = variables[diceType].total ?? variables[diceType].max ?? creature.level ?? 1;
            const currentDice = variables[diceType].value ?? variables[diceType].currentValue ?? maxDice;
            return {
              current: currentDice,
              max: maxDice,
              type: diceType.replace('HitDice', '').toLowerCase() // D8HitDice -> d8
            };
          }
        }
        // Fallback to level-based calculation
        return {
          current: creature.level || 1,
          max: creature.level || 1,
          type: getHitDieTypeFromClass(creature.levels || [])
        };
      })(),
      armorClass: calculateArmorClass(),
      speed: (variables.speed && (variables.speed.total || variables.speed.value)) || 30,
      initiative: (variables.initiative && (variables.initiative.total || variables.initiative.value)) || 0,
      proficiencyBonus: (variables.proficiencyBonus && (variables.proficiencyBonus.total || variables.proficiencyBonus.value)) || 0,
      deathSaves: {
        successes: (creature.deathSave && creature.deathSave.success) || 0,
        failures: (creature.deathSave && creature.deathSave.fail) || 0
      },
      resources: [],  // Ki Points, Sorcery Points, Rage, etc.
      companions: [],  // NEW: Store companion creatures (Animal Companions, Find Familiar, etc.)
      conditions: [],  // Active conditions (Guidance, Bless, etc.) that affect rolls
      kingdom: {},
      army: {},
      otherVariables: {},
      // Store raw API data for debugging and fallback
      rawDiceCloudData: {
        creature: creature,
        variables: variables,
        properties: properties
      }
    };

    // Extract ability scores (use total to include all effects, fallback to value)
    STANDARD_VARS.abilities.forEach(ability => {
      if (variables[ability]) {
        characterData.attributes[ability] = variables[ability].total || variables[ability].value || 10;
      }
    });

    // Calculate modifiers from ability scores (standard D&D 5e formula)
    Object.keys(characterData.attributes).forEach(attr => {
      const score = characterData.attributes[attr] || 10;
      characterData.attributeMods[attr] = Math.floor((score - 10) / 2);
    });

    // Extract ability modifiers from Dice Cloud (but use calculated ones as backup)
    STANDARD_VARS.abilityMods.forEach(mod => {
      if (variables[mod]) {
        const abilityName = mod.replace('Mod', '');
        const diceCloudMod = variables[mod].total || variables[mod].value || 0;
        const calculatedMod = characterData.attributeMods[abilityName] || 0;
        
        // Use Dice Cloud modifier if it exists and is different, otherwise use calculated
        if (diceCloudMod !== 0 && diceCloudMod !== calculatedMod) {
          characterData.attributeMods[abilityName] = diceCloudMod;
          debug.log(`📊 Using Dice Cloud modifier for ${abilityName}: ${diceCloudMod} (calculated: ${calculatedMod})`);
        } else {
          debug.log(`📊 Using calculated modifier for ${abilityName}: ${calculatedMod}`);
        }
      }
    });

    // Extract saves (use total to include all effects, fallback to value)
    STANDARD_VARS.saves.forEach(save => {
      if (variables[save]) {
        const abilityName = save.replace('Save', '');
        const saveValue = variables[save].total || variables[save].value || 0;
        characterData.saves[abilityName] = saveValue;
        // Also store in savingThrows for compatibility
        characterData.savingThrows[abilityName] = saveValue;
      }
    });

    // Extract skills (use total to include all effects, fallback to value)
    STANDARD_VARS.skills.forEach(skill => {
      if (variables[skill]) {
        characterData.skills[skill] = variables[skill].total || variables[skill].value || 0;
      }
    });

    // Extract spell slots
    // Dice Cloud uses: slotLevel1, slotLevel2, etc. (current and max combined in one variable)
    debug.log('🔍 Extracting spell slots...');
    characterData.spellSlots = {};

    for (let level = 1; level <= 9; level++) {
      const diceCloudVarName = `slotLevel${level}`;
      const currentKey = `level${level}SpellSlots`;
      const maxKey = `level${level}SpellSlotsMax`;

      if (variables[diceCloudVarName]) {
        // Dice Cloud stores total slots in .total and current in .value
        const currentSlots = variables[diceCloudVarName].value || 0;
        const maxSlots = variables[diceCloudVarName].total || variables[diceCloudVarName].value || 0;

        characterData.spellSlots[currentKey] = currentSlots;
        characterData.spellSlots[maxKey] = maxSlots;

        debug.log(`  ✅ Level ${level}: ${currentSlots}/${maxSlots} (from ${diceCloudVarName})`);
      } else {
        debug.log(`  ⚠️ Level ${level}: ${diceCloudVarName} not found in variables`);
      }
    }

    // Extract Pact Magic slots (Warlock)
    // DiceCloud V2 uses various variable names for Warlock spell slots
    const pactMagicVarNames = [
      'pactMagicSlot', 'pactMagicSlots', 'pactSlot', 'pactSlots',
      'warlockSlot', 'warlockSlots', 'warlockSpellSlots',
      'pactMagic', 'pactMagicUses', 'spellSlotsPact'
    ];

    // Also check for slot level variable (check pact-specific names first!)
    const slotLevelVarNames = [
      'pactSlotLevelVisible', 'pactSlotLevel', // TLoE/common DiceCloud naming - check first!
      'pactMagicSlotLevel', 'warlockSlotLevel',
      'pactMagicLevel', 'warlockSpellLevel', 'pactCasterLevel',
      'slotLevel' // Generic slot level - check last as fallback
    ];

    let foundPactMagic = false;
    for (const varName of pactMagicVarNames) {
      if (variables[varName]) {
        const currentSlots = variables[varName].value || 0;
        const maxSlots = variables[varName].total || variables[varName].value || 0;

        // Try to find the slot level from various sources
        let slotLevel = 1;

        // Helper to extract numeric value from a property that could be a number or object
        const extractValue = (prop) => {
          if (prop === null || prop === undefined) return null;
          if (typeof prop === 'number') return prop;
          if (typeof prop === 'object') {
            // DiceCloud may nest values in .value, .total, or other properties
            return prop.value ?? prop.total ?? prop.currentValue ?? null;
          }
          return parseInt(prop) || null;
        };

        // First check if the pact slot variable itself has a spellSlotLevel property
        // DiceCloud stores this as a property of Spell Slot type attributes
        const slotLevelFromProp = extractValue(variables[varName].spellSlotLevel) ??
                                   extractValue(variables[varName].slotLevel) ??
                                   extractValue(variables[varName].level);
        if (slotLevelFromProp) {
          slotLevel = slotLevelFromProp;
          debug.log(`  📊 Found slot level ${slotLevel} from ${varName} property`);
        } else {
          // Try separate slot level variables
          for (const levelVarName of slotLevelVarNames) {
            if (variables[levelVarName]) {
              slotLevel = extractValue(variables[levelVarName]) || variables[levelVarName].value || 1;
              debug.log(`  📊 Found slot level ${slotLevel} from variable ${levelVarName}`);
              break;
            }
          }
        }

        // Fallback: calculate from warlock level (slots are at ceil(warlockLevel/2) up to 5)
        if (slotLevel === 1 && variables.warlockLevel) {
          slotLevel = Math.min(5, Math.ceil(variables.warlockLevel.value / 2));
          debug.log(`  📊 Calculated slot level ${slotLevel} from warlockLevel`);
        }

        // Store pact magic slots separately (they recharge on short rest, regular slots on long rest)
        // Do NOT combine with regular spell slots - they are tracked independently
        characterData.spellSlots.pactMagicSlots = currentSlots;
        characterData.spellSlots.pactMagicSlotsMax = maxSlots;
        characterData.spellSlots.pactMagicSlotLevel = slotLevel;

        debug.log(`  ✅ Pact Magic: ${currentSlots}/${maxSlots} at level ${slotLevel} (from ${varName})`);
        debug.log(`  📋 Full ${varName} variable:`, JSON.stringify(variables[varName]));
        foundPactMagic = true;
        break;
      }
    }

    // Debug: log all variables that contain "slot", "pact", "warlock", or "spell" to help identify the correct variable names
    const slotRelatedVars = Object.keys(variables).filter(k => {
      const lower = k.toLowerCase();
      return lower.includes('slot') || lower.includes('pact') ||
             lower.includes('warlock') || (lower.includes('spell') && !lower.includes('attack'));
    });
    debug.log('🔍 All slot/pact/warlock/spell related variables:', slotRelatedVars);
    if (slotRelatedVars.length > 0) {
      slotRelatedVars.forEach(varName => {
        debug.log(`   ${varName}:`, variables[varName]);
      });
    }

    debug.log('📊 Final spell slots object:', characterData.spellSlots);

    // Extract ALL kingdom attributes (Pathfinder Kingmaker / Kingdom Builder)
    const kingdomSkills = [
      'agriculture', 'arts', 'boating', 'defense', 'engineering', 'exploration',
      'folklore', 'industry', 'intrigue', 'magic', 'politics', 'scholarship',
      'statecraft', 'trade', 'warfare', 'wilderness'
    ];

    kingdomSkills.forEach(skill => {
      // Base skill value (e.g., kingdomAgriculture)
      const skillVar = `kingdom${skill.charAt(0).toUpperCase() + skill.slice(1)}`;
      if (variables[skillVar]) {
        characterData.kingdom[skill] = variables[skillVar].value || 0;
      }

      // Proficiency total (e.g., kingdomAgricultureProficiencyTotal)
      const profVar = `${skillVar}ProficiencyTotal`;
      if (variables[profVar]) {
        characterData.kingdom[`${skill}_proficiency_total`] = variables[profVar].value || 0;
      }
    });

    // Extract economy/culture/loyalty/stability (kingdom core stats)
    const kingdomCoreStats = ['culture', 'economy', 'loyalty', 'stability'];
    kingdomCoreStats.forEach(stat => {
      const statVar = `kingdom${stat.charAt(0).toUpperCase() + stat.slice(1)}`;
      if (variables[statVar]) {
        characterData.kingdom[stat] = variables[statVar].value || 0;
      }
    });

    // Extract army attributes
    const armySkills = ['scouting', 'maneuver', 'morale', 'ranged'];
    armySkills.forEach(skill => {
      const skillVar = `army${skill.charAt(0).toUpperCase() + skill.slice(1)}`;
      if (variables[skillVar]) {
        characterData.army[skill] = variables[skillVar].value || 0;
      }
    });

    // Extract other useful variables
    if (variables.heroPoints) {
      characterData.otherVariables.hero_points = variables.heroPoints.value || 0;
    }

    // Extract ALL remaining variables (catch-all for anything we haven't specifically extracted)
    const knownVars = new Set([
      ...STANDARD_VARS.abilities,
      ...STANDARD_VARS.abilityMods,
      ...STANDARD_VARS.saves,
      ...STANDARD_VARS.skills,
      'armorClass', 'hitPoints', 'speed', 'initiative', 'proficiencyBonus', 'heroPoints',
      '_id', '_creatureId' // Skip internal MongoDB fields
    ]);

    // Also skip kingdom/army vars we already extracted
    kingdomSkills.forEach(skill => {
      knownVars.add(`kingdom${skill.charAt(0).toUpperCase() + skill.slice(1)}`);
      knownVars.add(`kingdom${skill.charAt(0).toUpperCase() + skill.slice(1)}ProficiencyTotal`);
    });
    kingdomCoreStats.forEach(stat => {
      knownVars.add(`kingdom${stat.charAt(0).toUpperCase() + stat.slice(1)}`);
    });
    armySkills.forEach(skill => {
      knownVars.add(`army${skill.charAt(0).toUpperCase() + skill.slice(1)}`);
    });

    // Extract everything else
    Object.keys(variables).forEach(varName => {
      if (!knownVars.has(varName) && !varName.startsWith('_')) {
        const value = variables[varName] && variables[varName].value;
        if (value !== undefined && value !== null) {
          characterData.otherVariables[varName] = value;
        }
      }
    });

    debug.log(`Extracted ${Object.keys(characterData.otherVariables).length} additional variables`);
    
    // Debug: Check for race in other variables as fallback
    debug.log('🔍 Checking for race in otherVariables:', Object.keys(characterData.otherVariables).filter(key => key.toLowerCase().includes('race')).map(key => `${key}: ${characterData.otherVariables[key]}`));

    // Build a map of property IDs to names for spell source resolution
    const propertyIdToName = new Map();
    properties.forEach(prop => {
      if (prop._id && prop.name) {
        propertyIdToName.set(prop._id, prop.name);
      }
    });
    debug.log(`📋 Built property ID map with ${propertyIdToName.size} entries`);

    // Debug: Show sample entries from the map
    const sampleEntries = Array.from(propertyIdToName.entries()).slice(0, 10);
    debug.log('📋 Sample property ID map entries:', sampleEntries);

    // Debug: Show all class-type entries in the map
    const classEntries = properties.filter(p => p.type === 'class' && p._id && p.name);
    debug.log('📋 Class entries in map:', classEntries.map(p => ({ id: p._id, name: p.name, type: p.type })));

    // Parse properties for classes, race, features, spells, etc.
    // Track unique classes to avoid duplicates
    const uniqueClasses = new Set();

    // Track unique resources to avoid duplicates (DiceCloud can have duplicate resource entries)
    const uniqueResources = new Set();

    // Debug: Log all property types to see what's available
    const propertyTypes = new Set();
    let raceFound = false;
    let racePropertyId = null;
    let raceName = null;

    // First pass: find the race property and process all properties
    apiData.creatureProperties.forEach(prop => {
      propertyTypes.add(prop.type);

      // Check for race as a folder (DiceCloud stores races as folders)
      // Look for folders with common race names at the top level
      const commonRaces = ['human', 'elf', 'dwarf', 'halfling', 'gnome', 'half-elf', 'half-orc', 'dragonborn', 'tiefling', 'orc', 'goblin', 'kobold'];
      if (prop.type === 'folder' && prop.name) {
        const nameMatchesRace = commonRaces.some(race => prop.name.toLowerCase().includes(race));
        if (nameMatchesRace) {
          const parentDepth = prop.ancestors ? prop.ancestors.length : 0;
          debug.log(`🔍 DEBUG: Found folder "${prop.name}" with parentDepth ${parentDepth}, ancestors:`, prop.ancestors);

          if (parentDepth <= 2) { // Top-level or near top-level folder
            debug.log('🔍 Found potential race folder:', {
              name: prop.name,
              type: prop.type,
              _id: prop._id,
              parentDepth: parentDepth
            });
            if (!raceFound) {
              raceName = prop.name;
              racePropertyId = prop._id;
              characterData.race = prop.name;
              debug.log('🔍 Set race to:', prop.name, '(ID:', prop._id, ')');
              raceFound = true;
            }
          } else {
            debug.log(`🔍 DEBUG: Skipping "${prop.name}" - parentDepth ${parentDepth} > 2`);
          }
        }
      }

      if (prop.type === 'race') {
        debug.log('🔍 Found race property:', prop);
        if (prop.name) {
          raceName = prop.name;
          racePropertyId = prop._id;
          characterData.race = prop.name;
          debug.log('🔍 Set race to:', prop.name, '(ID:', prop._id, ')');
          raceFound = true;
        }
      } else if (prop.type === 'species') {
        debug.log('🔍 Found species property:', prop);
        if (prop.name) {
          raceName = prop.name;
          racePropertyId = prop._id;
          characterData.race = prop.name;
          debug.log('🔍 Set race to (from species):', prop.name, '(ID:', prop._id, ')');
          raceFound = true;
        }
      } else if (prop.type === 'characterRace') {
        debug.log('🔍 Found characterRace property:', prop);
        if (prop.name) {
          raceName = prop.name;
          racePropertyId = prop._id;
          characterData.race = prop.name;
          debug.log('🔍 Set race to (from characterRace):', prop.name, '(ID:', prop._id, ')');
          raceFound = true;
        }
      }

      switch (prop.type) {
        case 'class':
          // Only add class name once, even if there are multiple classLevel entries
          // Skip inactive or disabled classes
          if (prop.name && !prop.inactive && !prop.disabled) {
            // Remove [Multiclass] suffix before normalizing
            const cleanName = prop.name.replace(/\s*\[Multiclass\]/i, '').trim();
            const normalizedClassName = cleanName.toLowerCase().trim();
            debug.log(`📚 Found class property: "${prop.name}" (cleaned: "${cleanName}", normalized: "${normalizedClassName}")`);
            if (!uniqueClasses.has(normalizedClassName)) {
              debug.log(`  ✅ Adding class (not in set yet)`);
              uniqueClasses.add(normalizedClassName);
              if (characterData.class) {
                characterData.class += ` / ${cleanName}`;
              } else {
                characterData.class = cleanName;
              }
            } else {
              debug.log(`  ⏭️  Skipping class (already in set:`, Array.from(uniqueClasses), ')');
            }
          } else if (prop.name && (prop.inactive || prop.disabled)) {
            debug.log(`  ⏭️  Skipping inactive/disabled class: ${prop.name}`);
          }
          break;

        case 'classLevel':
          // Skip inactive or disabled class levels
          if (prop.inactive || prop.disabled) {
            if (prop.name) {
              debug.log(`  ⏭️  Skipping inactive/disabled classLevel: ${prop.name}`);
            }
            break;
          }

          // Count each classLevel entry as 1 level
          characterData.level += 1;
          // Also add the class name if not already added
          if (prop.name) {
            // Remove [Multiclass] suffix before normalizing
            const cleanName = prop.name.replace(/\s*\[Multiclass\]/i, '').trim();
            const normalizedClassName = cleanName.toLowerCase().trim();
            debug.log(`📊 Found classLevel property: "${prop.name}" (cleaned: "${cleanName}", normalized: "${normalizedClassName}")`);
            if (!uniqueClasses.has(normalizedClassName)) {
              debug.log(`  ✅ Adding class from classLevel (not in set yet)`);
              uniqueClasses.add(normalizedClassName);
              if (characterData.class) {
                characterData.class += ` / ${cleanName}`;
              } else {
                characterData.class = cleanName;
              }
            } else {
              debug.log(`  ⏭️  Skipping classLevel (already in set:`, Array.from(uniqueClasses), ')');
            }
          }
          break;

        case 'race':
          if (prop.name) {
            characterData.race = prop.name;
            debug.log('🔍 Found race property:', prop.name);
          }
          break;
          
        case 'species':
          if (prop.name) {
            characterData.race = prop.name;
            debug.log('🔍 Found species property (using as race):', prop.name);
          }
          break;
          
        case 'characterRace':
          if (prop.name) {
            characterData.race = prop.name;
            debug.log('🔍 Found characterRace property:', prop.name);
          }
          break;

        case 'background':
          if (prop.name) {
            characterData.background = prop.name;
          }
          break;

        case 'feature':
          // Skip inactive or disabled features (handles expired temporary features)
          if (prop.inactive || prop.disabled) {
            debug.log(`⏭️ Skipping inactive/disabled feature: ${prop.name}`);
            break;
          }

          // Extract features, especially those with rolls (like Sneak Attack)
          // Extract summary and description separately
          let featureSummary = '';
          if (prop.summary) {
            if (typeof prop.summary === 'object' && prop.summary.value) {
              featureSummary = prop.summary.value;
            } else if (typeof prop.summary === 'object' && prop.summary.text) {
              featureSummary = prop.summary.text;
            } else if (typeof prop.summary === 'string') {
              featureSummary = prop.summary;
            }
          }
          // Strip conditional expressions from summary
          featureSummary = stripConditionalExpressions(featureSummary);

          let featureDescription = '';
          if (prop.description) {
            if (typeof prop.description === 'object' && prop.description.value) {
              featureDescription = prop.description.value;
            } else if (typeof prop.description === 'object' && prop.description.text) {
              featureDescription = prop.description.text;
            } else if (typeof prop.description === 'string') {
              featureDescription = prop.description;
            }
          }
          // Strip conditional expressions from description
          featureDescription = stripConditionalExpressions(featureDescription);

          const feature = {
            name: prop.name || 'Unnamed Feature',
            summary: featureSummary, // Preserve summary separately
            description: featureDescription, // Preserve description separately
            uses: prop.uses,
            roll: prop.roll || '',
            damage: prop.damage || ''
          };

          characterData.features.push(feature);

          // Filter out metamagic features (they should only be used when casting spells)
          const metamagicFeatureNames = [
            'Careful Spell', 'Distant Spell', 'Empowered Spell', 'Extended Spell',
            'Heightened Spell', 'Quickened Spell', 'Subtle Spell', 'Twinned Spell'
          ];
          // Use case-insensitive matching for metamagic features
          const isMetamagicFeature = metamagicFeatureNames.some(name =>
            name.toLowerCase() === feature.name.toLowerCase()
          );

          // If feature has a roll/damage, also add it to actions for easy access
          // BUT skip metamagic features (they're handled in spell casting UI)
          if (!isMetamagicFeature && (feature.roll || feature.damage)) {
            characterData.actions.push({
              name: feature.name,
              actionType: 'action', // Features with rolls are typically actions
              attackRoll: '',
              damage: feature.damage || feature.roll,
              damageType: '',
              summary: feature.summary, // Preserve summary separately
              description: feature.description // Preserve description separately
            });
            debug.log(`⚔️ Added feature with roll to actions: ${feature.name}`);
          }
          break;

        case 'toggle':
          // Extract features from ALL toggles (enabled or disabled on DiceCloud)
          // Our sheet will have its own independent toggle to control when to use them
          // BUT skip inactive toggles (these are expired/removed temporary features)
          if (prop.inactive || prop.disabled) {
            debug.log(`⏭️ Skipping inactive/disabled toggle: ${prop.name}`);
            break;
          }

          debug.log(`🔘 Found toggle: ${prop.name} (enabled on DiceCloud: ${prop.enabled})`);
          debug.log(`🔘 Toggle full object:`, prop);

            // Check if this is a condition toggle (affects rolls)
            const conditionNames = ['guidance', 'bless', 'bane', 'bardic inspiration', 'inspiration', 
                                   'advantage', 'disadvantage', 'resistance', 'vulnerability'];
            const isConditionToggle = conditionNames.some(cond => 
              prop.name && prop.name.toLowerCase().includes(cond)
            );

            // Find child properties of this toggle
            const toggleChildren = apiData.creatureProperties.filter(child => {
              return child.parent && child.parent.id === prop._id;
            });

            debug.log(`🔘 Toggle "${prop.name}" has ${toggleChildren.length} children:`, toggleChildren.map(c => c.name));
            debug.log(`🔘 Toggle children full objects:`, toggleChildren);
            
            // If this is a condition toggle and it's enabled, add it to conditions
            if (isConditionToggle && prop.enabled) {
              // Extract the effect value from children
              let effectValue = '';
              toggleChildren.forEach(child => {
                if (child.type === 'effect' && child.amount) {
                  if (typeof child.amount === 'string') {
                    effectValue = child.amount;
                  } else if (typeof child.amount === 'object' && child.amount.calculation) {
                    effectValue = child.amount.calculation;
                  }
                }
              });
              
              characterData.conditions.push({
                name: prop.name,
                effect: effectValue || '1d4', // Default to 1d4 if no effect found
                active: true,
                source: 'dicecloud'
              });
              debug.log(`✨ Added active condition: ${prop.name} (${effectValue || '1d4'})`);
            }

            // Debug: Log child types
            toggleChildren.forEach(child => {
              debug.log(`🔘   Child "${child.name}" has type: ${child.type}`);
            });

            // Process each child (features, damage, effects, etc.)
            // Skip if parent toggle or child is inactive/disabled
            toggleChildren.forEach(child => {
              // Skip inactive or disabled children (handles temporary/expired features)
              if (child.inactive || child.disabled) {
                debug.log(`⏭️ Skipping inactive/disabled toggle child: ${child.name}`);
                return;
              }
              if (child.type === 'feature' || child.type === 'damage' || child.type === 'effect') {
                // Extract description from summary or description field
                let childSummary = '';
                let childDescription = '';
                
                // Extract summary
                if (child.summary) {
                  if (typeof child.summary === 'object' && child.summary.text) {
                    childSummary = child.summary.text;
                  } else if (typeof child.summary === 'object' && child.summary.value) {
                    childSummary = child.summary.value;
                  } else if (typeof child.summary === 'string') {
                    childSummary = child.summary;
                  }
                }
                
                // Extract description
                if (child.description) {
                  if (typeof child.description === 'object' && child.description.text) {
                    childDescription = child.description.text;
                  } else if (typeof child.description === 'object' && child.description.value) {
                    childDescription = child.description.value;
                  } else if (typeof child.description === 'string') {
                    childDescription = child.description;
                  }
                }

                // Fallback to parent summary if child has none
                if (!childSummary && prop.summary) {
                  if (typeof prop.summary === 'object' && prop.summary.text) {
                    childSummary = prop.summary.text;
                  } else if (typeof prop.summary === 'object' && prop.summary.value) {
                    childSummary = prop.summary.value;
                  } else if (typeof prop.summary === 'string') {
                    childSummary = prop.summary;
                  }
                }
                
                // Fallback to parent description if child has none
                if (!childDescription && prop.description) {
                  if (typeof prop.description === 'object' && prop.description.text) {
                    childDescription = prop.description.text;
                  } else if (typeof prop.description === 'object' && prop.description.value) {
                    childDescription = prop.description.value;
                  } else if (typeof prop.description === 'string') {
                    childDescription = prop.description;
                  }
                }

                // Strip conditional expressions from child summary and description
                childSummary = stripConditionalExpressions(childSummary);
                childDescription = stripConditionalExpressions(childDescription);

                // For backward compatibility, combine them for childDescription
                const combinedChildDescription = childSummary && childDescription
                  ? childSummary + '\n\n' + childDescription
                  : childSummary || childDescription || '';

                // Extract damage/roll value based on property type
                let damageValue = '';
                let rollValue = '';

                // For damage properties, check amount field (can be string or object with value/calculation)
                // Prioritize 'value' over 'calculation' for pre-computed formulas
                if (child.type === 'damage') {
                  if (typeof child.amount === 'string') {
                    damageValue = child.amount;
                  } else if (typeof child.amount === 'object') {
                    damageValue = child.amount.value || child.amount.calculation || '';
                  }
                  debug.log(`🎯 Found damage property: "${child.name || prop.name}" with value: "${damageValue}"`);
                }
                // For effects, check if there's an operation that modifies damage
                else if (child.type === 'effect' && child.operation === 'add' && child.amount) {
                  if (typeof child.amount === 'string') {
                    damageValue = child.amount;
                  } else if (typeof child.amount === 'object') {
                    damageValue = child.amount.value || child.amount.calculation || '';
                  }
                }
                // For features, use roll or damage fields
                else {
                  rollValue = child.roll || '';
                  damageValue = child.damage || '';
                }

                const toggleFeature = {
                  name: child.name || prop.name || 'Unnamed Feature',
                  summary: childSummary, // Preserve summary separately
                  description: childDescription, // Preserve description separately
                  uses: child.uses || prop.uses,
                  roll: rollValue,
                  damage: damageValue
                };

                debug.log(`🔘 Created toggle feature: "${toggleFeature.name}" with damage: "${damageValue}", roll: "${rollValue}"`);

                characterData.features.push(toggleFeature);

                // Add to actions if it has roll/damage OR if it has actionType
                // BUT: Never add effects to actions - they're passive modifiers (Guidance, Resistance, etc.)
                // Features and damage types can be actions
                const validActionTypes = ['action', 'bonus', 'reaction', 'free', 'legendary', 'lair', 'other'];
                const hasValidActionType = child.actionType && validActionTypes.includes(child.actionType.toLowerCase());

                // Check if it has a valid rollable/damage value (must be a non-empty string)
                const hasValidRoll = typeof toggleFeature.roll === 'string' && toggleFeature.roll.trim().length > 0;
                const hasValidDamage = typeof toggleFeature.damage === 'string' && toggleFeature.damage.trim().length > 0;

                debug.log(`🔘 Checking "${toggleFeature.name}": hasValidRoll=${hasValidRoll}, hasValidDamage=${hasValidDamage}, hasValidActionType=${hasValidActionType}, type=${child.type}`);

                // Only add to actions if:
                // 1. It's NOT an effect (effects are passive modifiers like Guidance, Resistance)
                //    UNLESS it has damage (like Sneak Attack, Divine Smite, etc.)
                // 2. AND it has rollable values OR a valid actionType
                const isDamageEffect = child.type === 'effect' && hasValidDamage;
                const shouldAddToActions = (child.type !== 'effect' || isDamageEffect) && (hasValidRoll || hasValidDamage || hasValidActionType);

                debug.log(`🔘 shouldAddToActions for "${toggleFeature.name}": ${shouldAddToActions} (isDamageEffect=${isDamageEffect})`);

                if (shouldAddToActions) {
                  // Features with damage/roll default to 'action', others keep explicit type or default to 'other'
                  const defaultType = (hasValidRoll || hasValidDamage) ? 'action' : 'other';
                  characterData.actions.push({
                    name: toggleFeature.name,
                    actionType: child.actionType || defaultType,
                    attackRoll: '',
                    damage: toggleFeature.damage || toggleFeature.roll,
                    damageType: child.damageType || '',
                    summary: toggleFeature.summary, // Preserve summary separately
                    description: toggleFeature.description // Preserve description separately
                  });

                  if (toggleFeature.damage || toggleFeature.roll) {
                    debug.log(`⚔️ Added toggle feature to actions: ${toggleFeature.name}`);
                  } else {
                    debug.log(`✨ Added toggle non-attack feature to actions: ${toggleFeature.name} (${child.actionType || 'feature'})`);
                  }
                }
              }
            });
          break;

        case 'spell':
          // Skip inactive or disabled spells (handles spells that require higher level)
          if (prop.inactive || prop.disabled) {
            debug.log(`⏭️ Skipping inactive/disabled spell: ${prop.name}`);
            break;
          }

          // Extract summary from object or string
          // Prioritize 'value' over 'text' because 'value' has inline calculations pre-computed
          let summary = '';
          if (prop.summary) {
            if (typeof prop.summary === 'object' && prop.summary.value) {
              summary = prop.summary.value;
            } else if (typeof prop.summary === 'object' && prop.summary.text) {
              summary = prop.summary.text;
            } else if (typeof prop.summary === 'string') {
              summary = prop.summary;
            }
          }

          // Extract description from object or string
          // Prioritize 'value' over 'text' because 'value' has inline calculations pre-computed
          let description = '';
          if (prop.description) {
            if (typeof prop.description === 'object' && prop.description.value) {
              description = prop.description.value;
            } else if (typeof prop.description === 'object' && prop.description.text) {
              description = prop.description.text;
            } else if (typeof prop.description === 'string') {
              description = prop.description;
            }
          }

          // Strip conditional expressions from summary and description
          summary = stripConditionalExpressions(summary);
          description = stripConditionalExpressions(description);

          // Combine summary and description when both exist
          let fullDescription = '';
          if (summary && description) {
            fullDescription = summary + '\n\n' + description;
          } else if (summary) {
            fullDescription = summary;
          } else if (description) {
            fullDescription = description;
          }

          // Determine source (from parent, tags, or ancestors)
          let source = 'Unknown Source';

          // Extract parent ID (handle both string and object formats)
          const parentId = typeof prop.parent === 'object' ? prop.parent?.id : prop.parent;

          // Debug: Log parent and ancestors info for ALL spells to diagnose the issue
          debug.log(`🔍 Spell "${prop.name}" debug:`, {
            parent: prop.parent,
            parentId: parentId,
            parentInMap: parentId ? propertyIdToName.has(parentId) : false,
            parentName: parentId ? propertyIdToName.get(parentId) : null,
            ancestors: prop.ancestors,
            ancestorsInMap: prop.ancestors ? prop.ancestors.map(ancestor => {
              const ancestorId = typeof ancestor === 'object' ? ancestor.id : ancestor;
              return {
                ancestor,
                ancestorId,
                inMap: propertyIdToName.has(ancestorId),
                name: propertyIdToName.get(ancestorId)
              };
            }) : [],
            tags: prop.tags,
            libraryTags: prop.libraryTags
          });

          // Try to get parent name from the map
          if (parentId && propertyIdToName.has(parentId)) {
            source = propertyIdToName.get(parentId);
            debug.log(`✅ Found source from parent for "${prop.name}": ${source}`);
          }
          // Fallback to ancestors if parent lookup failed
          else if (prop.ancestors && prop.ancestors.length > 0) {
            // Try ALL ancestors from closest to farthest until we find one with a name
            let found = false;
            for (let i = prop.ancestors.length - 1; i >= 0 && !found; i--) {
              const ancestor = prop.ancestors[i];
              // Extract ID from ancestor (handle both string and object formats)
              const ancestorId = typeof ancestor === 'object' ? ancestor.id : ancestor;

              if (ancestorId && propertyIdToName.has(ancestorId)) {
                source = propertyIdToName.get(ancestorId);
                debug.log(`✅ Found source from ancestor[${i}] for "${prop.name}": ${source}`);
                found = true;
              }
            }
            if (!found) {
              debug.log(`❌ No source found in ${prop.ancestors.length} ancestors for "${prop.name}"`);
            }
          }
          // Fallback to libraryTags - parse class names from tags like "clericSpell"
          if (source === 'Unknown Source' && prop.libraryTags && prop.libraryTags.length > 0) {
            // Look for tags ending in "Spell" (like "clericSpell", "wizardSpell")
            const classSpellTags = prop.libraryTags.filter(tag =>
              tag.toLowerCase().endsWith('spell') &&
              tag.toLowerCase() !== 'spell'
            );

            if (classSpellTags.length > 0) {
              // Extract class names and capitalize them
              const classNames = classSpellTags.map(tag => {
                // Remove "Spell" suffix and capitalize
                const className = tag.replace(/Spell$/i, '');
                return className.charAt(0).toUpperCase() + className.slice(1);
              });

              source = classNames.join(' / ');
              debug.log(`✅ Found source from libraryTags for "${prop.name}": ${source}`);
            }
          }
          // Fallback to regular tags
          else if (source === 'Unknown Source' && prop.tags && prop.tags.length > 0) {
            source = prop.tags.join(', ');
            debug.log(`✅ Found source from tags for "${prop.name}": ${source}`);
          }

          if (source === 'Unknown Source') {
            debug.log(`❌ No source found for "${prop.name}"`);
          }

          // Check if spell is from a locked feature (e.g., "11th Level Ranger" when character is level 3)
          const levelRequirement = source.match(/(\d+)(?:st|nd|rd|th)?\s+Level/i);
          const requiredLevel = levelRequirement ? parseInt(levelRequirement[1]) : 0;
          const characterLevel = characterData.level || 1;

          // Skip spells from features not yet unlocked
          if (requiredLevel > characterLevel) {
            debug.log(`⏭️ Skipping "${prop.name}" from "${source}" (requires level ${requiredLevel}, character is level ${characterLevel})`);
            break;
          }

          // Special handling: Font of Magic conversions should be actions, not spells
          if (prop.name === 'Convert Spell Slot to Sorcery Points') {
            // Try to find Font of Magic feature description from ancestors
            let fontOfMagicDesc = description;
            if (prop.ancestors && Array.isArray(prop.ancestors)) {
              for (const ancestor of prop.ancestors) {
                const ancestorId = typeof ancestor === 'object' ? ancestor.id : ancestor;
                const ancestorProp = properties.find(p => p._id === ancestorId);
                if (ancestorProp && ancestorProp.name === 'Font of Magic') {
                  // Extract Font of Magic description
                  if (ancestorProp.summary) {
                    fontOfMagicDesc = typeof ancestorProp.summary === 'string' ? ancestorProp.summary : ancestorProp.summary.text || ancestorProp.summary.value || '';
                  } else if (ancestorProp.description) {
                    fontOfMagicDesc = typeof ancestorProp.description === 'string' ? ancestorProp.description : ancestorProp.description.text || ancestorProp.description.value || '';
                  }
                  break;
                }
              }
            }

            characterData.actions.push({
              name: prop.name,
              actionType: 'bonus',
              attackRoll: '',
              damage: '',
              damageType: '',
              description: fontOfMagicDesc,
              uses: null,
              usesUsed: 0,
              resources: null
            });
            debug.log(`✨ Added Font of Magic conversion as action: ${prop.name}`);
            break;
          }

          // Find child properties for attack rolls and damage
          let attackRoll = '';
          let damageRolls = []; // Array to store multiple damage/healing rolls

          // Look for child rolls/damage that are descendants of this spell
          const spellChildren = properties.filter(p => {
            if (p.type !== 'roll' && p.type !== 'damage' && p.type !== 'attack') return false;

            // Check if this spell is in the child property's ancestors
            if (p.ancestors && Array.isArray(p.ancestors)) {
              const hasSpellAsAncestor = p.ancestors.some(ancestor => {
                const ancestorId = typeof ancestor === 'object' ? ancestor.id : ancestor;
                return ancestorId === prop._id;
              });
              if (hasSpellAsAncestor) {
                console.log(`  ✅ Including spell child: ${p.name} (${p.type})`, { amount: p.amount, roll: p.roll, inactive: p.inactive, disabled: p.disabled });
              }
              return hasSpellAsAncestor;
            }
            return false;
          });

          debug.log(`🔍 Spell "${prop.name}" has ${spellChildren.length} child properties:`, spellChildren.map(c => ({ type: c.type, name: c.name })));

          // Extract attack rolls and damage from children
          spellChildren.forEach(child => {
            debug.log(`  📋 Processing child: ${child.name} (${child.type})`);

            // Defensive spells (Shield, Absorb Elements, Counterspell) should NEVER have attack rolls - skip attack children
            const spellNameLower = (prop.name || '').toLowerCase().trim();
            const isDefensiveSpell = spellNameLower === 'shield' ||
                                      spellNameLower.startsWith('shield ') ||
                                      spellNameLower === 'absorb elements' ||
                                      spellNameLower === 'counterspell';
            if (isDefensiveSpell && (child.type === 'attack' || (child.type === 'roll' && child.name && child.name.toLowerCase().includes('attack')))) {
              debug.log(`    🛡️ Defensive spell - skipping attack child: ${child.name}`);
              return; // Skip this child
            }

            if (child.type === 'attack' || (child.type === 'roll' && child.name && child.name.toLowerCase().includes('attack'))) {
              // This is a spell attack roll
              debug.log(`    🎯 Attack child found:`, { name: child.name, roll: child.roll, type: child.type });

              if (child.roll) {
                if (typeof child.roll === 'string') {
                  attackRoll = child.roll;
                } else if (typeof child.roll === 'object' && child.roll.value !== undefined) {
                  const bonus = child.roll.value;
                  attackRoll = bonus >= 0 ? `1d20+${bonus}` : `1d20${bonus}`;
                } else if (typeof child.roll === 'object' && child.roll.calculation) {
                  attackRoll = child.roll.calculation;
                } else {
                  debug.log(`    ⚠️ Attack child has unexpected roll structure:`, child.roll);
                  attackRoll = 'use_spell_attack_bonus'; // Fallback
                }
              } else {
                debug.log(`    ⚠️ Attack child has no roll property, using spell attack bonus`);
                attackRoll = 'use_spell_attack_bonus'; // Fallback
              }
              debug.log(`    ✅ Attack roll set to: ${attackRoll}`);
            }

            if (child.type === 'damage' || (child.type === 'roll' && child.name && child.name.toLowerCase().includes('damage'))) {
              // This is spell damage
              debug.log(`    📊 Damage child found:`, {
                name: child.name,
                amount: child.amount,
                roll: child.roll,
                damageType: child.damageType
              });

              let damageFormula = '';
              if (child.amount) {
                if (typeof child.amount === 'string') {
                  damageFormula = child.amount;
                  debug.log(`      → Using amount string: "${damageFormula}"`);
                } else if (typeof child.amount === 'object') {
                  // Prefer value over calculation for pre-computed formulas with modifiers
                  if (child.amount.value !== undefined) {
                    damageFormula = String(child.amount.value);
                    debug.log(`      → Using amount.value: "${damageFormula}"`);
                  } else if (child.amount.calculation) {
                    damageFormula = child.amount.calculation;
                    debug.log(`      → Using amount.calculation: "${damageFormula}"`);
                  }
                }
              } else if (child.roll) {
                if (typeof child.roll === 'string') {
                  damageFormula = child.roll;
                  debug.log(`      → Using roll string: "${damageFormula}"`);
                } else if (typeof child.roll === 'object') {
                  // Prefer value over calculation for pre-computed formulas with modifiers
                  if (child.roll.value !== undefined) {
                    damageFormula = String(child.roll.value);
                    debug.log(`      → Using roll.value: "${damageFormula}"`);
                  } else if (child.roll.calculation) {
                    damageFormula = child.roll.calculation;
                    debug.log(`      → Using roll.calculation: "${damageFormula}"`);
                  }
                }
              }

              // Add to damage rolls array if we got a formula
              if (damageFormula) {
                // Filter out non-roll formulas:
                // - Variable references without dice (e.g., "spiritGuardiansDamage", "~target.tollTheDeadDamage")
                // - Half-damage save formulas (e.g., "floor(spiritGuardiansDamage / 2)" but NOT "(floor(slotLevel / 2))d8")
                // - Formulas that don't contain actual dice notation
                // Match dice notation: "d" followed by digits (e.g., "2d6", "(slotLevel)d8", "(floor(x)+1)d12")
                const hasDiceNotation = /d\d+/i.test(damageFormula);
                // Only consider it half-damage if it's dividing a damage variable (no dice in the formula)
                const isHalfDamageSave = !hasDiceNotation && /\w+Damage\s*\/\s*2|~target\.\w+\s*\/\s*2|floor\([^d)]+\/\s*2\)/i.test(damageFormula);
                const isVariableReference = !hasDiceNotation && /^[~\w.]+$/.test(damageFormula.trim());

                if (hasDiceNotation || (!isHalfDamageSave && !isVariableReference)) {
                  damageRolls.push({
                    damage: damageFormula,
                    damageType: child.damageType || 'damage'
                  });
                  console.log(`    ✅ Added damage roll: ${damageFormula} (${child.damageType || 'damage'})`);
                } else {
                  console.log(`    ⏭️ Skipping non-roll formula: ${damageFormula} (hasDice: ${hasDiceNotation}, isHalfSave: ${isHalfDamageSave}, isVar: ${isVariableReference})`);
                }
              }
            }
          });

          // Deduplicate damage rolls (remove exact duplicates with same formula AND damage type)
          const uniqueDamageRolls = [];
          const seenRolls = new Set();
          damageRolls.forEach(roll => {
            const key = `${roll.damage}|${roll.damageType}`;
            if (!seenRolls.has(key)) {
              seenRolls.add(key);
              uniqueDamageRolls.push(roll);
            } else {
              console.log(`    🔄 Skipping duplicate damage roll: ${roll.damage} (${roll.damageType})`);
            }
          });
          damageRolls = uniqueDamageRolls;

          // Extract temp HP from any spell that mentions temporary hit points
          const lowerDesc = fullDescription.toLowerCase();
          const hasTempHPKeyword = lowerDesc.includes('temporary hit point') || lowerDesc.includes('temp hp') || lowerDesc.includes('temporary hp');

          if (hasTempHPKeyword) {
            debug.log(`  🛡️ Spell "${prop.name}" mentions temporary hit points`);

            // If no damage rolls found, try to extract from description
            if (damageRolls.length === 0) {
              debug.log(`  🛡️ No damage children found, extracting temp HP from description`);
              // Look for patterns like "1d4+4", "2d6", "gain 5", etc. right before "temporary"
              // Try to find dice formulas first
              const beforeTempHP = fullDescription.substring(0, fullDescription.toLowerCase().indexOf('temporary'));
              const dicePattern = /(\d+d\d+(?:\s*[+\-]\s*\d+)?)/i;
              const match = beforeTempHP.match(dicePattern);
              if (match) {
                const formula = match[1].replace(/\s/g, ''); // Remove whitespace
                damageRolls.push({
                  damage: formula,
                  damageType: 'temphp'
                });
                debug.log(`  ✅ Extracted temp HP dice formula from description: ${formula}`);
              } else {
                // Try to find plain numbers like "gain 5 temporary" or "5 additional temporary"
                const numberPattern = /(?:gain|additional)\s+(\d+)(?:\s+(?:additional))?\s+temporary/i;
                const numberMatch = fullDescription.match(numberPattern);
                if (numberMatch) {
                  const amount = numberMatch[1];
                  damageRolls.push({
                    damage: amount,
                    damageType: 'temphp'
                  });
                  debug.log(`  ✅ Extracted temp HP fixed amount from description: ${amount}`);
                }
              }
            } else {
              // Mark all damage rolls as temp HP
              damageRolls.forEach(roll => {
                if (roll.damageType === 'damage' || !roll.damageType || roll.damageType === 'healing') {
                  roll.damageType = 'temphp';
                  debug.log(`  🛡️ Corrected ${prop.name} damage type to temphp`);
                }
              });
            }
          }

          // For backward compatibility, set single damage/damageType to first entry
          let damage = damageRolls.length > 0 ? damageRolls[0].damage : '';
          let damageType = damageRolls.length > 0 ? damageRolls[0].damageType : '';

          // Check description for additional patterns
          if (description) {
            // Look for spell attack patterns like "make a ranged spell attack roll", "make a melee spell attack", etc.
            // Check this even if damage is already found, since many spells have both
            const lowerDesc = description.toLowerCase();
            debug.log(`  🔍 Checking description for spell attack (attackRoll currently: "${attackRoll}")`);
            // Use specific patterns to avoid false positives (like Shield's "triggering attack" or "when hit by an attack roll")
            // Match: "make" within 5 words before "spell attack" or "attack roll"
            // This catches "make a ranged spell attack roll" but not "when hit by an attack roll"
            // Exception: Shield and defensive spells should never have attack button
            const spellNameLower = (prop.name || '').toLowerCase();
            const isDefensiveSpell = spellNameLower === 'shield' ||
                                      spellNameLower.startsWith('shield ') ||
                                      spellNameLower === 'absorb elements' ||
                                      spellNameLower === 'counterspell';

            // Check for offensive attack patterns: "make a/an ... spell attack" or "make a/an ... attack roll"
            // But NOT defensive patterns like "hit by an attack roll", "when an attack", "against the attack"
            const hasOffensiveAttack = /\bmake\s+(?:a|an)\s+(?:\w+\s+){0,3}(spell attack|attack roll)\b/i.test(description);
            const hasDefensivePattern = /\b(hit by|when an?|against the|triggering)\s+(?:\w+\s+){0,2}attack/i.test(description);
            const hasAttackMention = hasOffensiveAttack && !hasDefensivePattern;

            if (!attackRoll && hasAttackMention && !isDefensiveSpell) {
              attackRoll = 'use_spell_attack_bonus'; // Flag to use calculated spell attack bonus
              debug.log(`  💡 Found offensive attack pattern in description, marking for spell attack bonus`);
            } else if (!attackRoll) {
              debug.log(`  ⚠️ No attack pattern found in description for "${prop.name}"`);
            } else if (isDefensiveSpell && attackRoll) {
              // Defensive spells should never have attack roll
              debug.log(`  🛡️ Defensive spell detected - removing attack roll`);
              attackRoll = '';
            } else {
              debug.log(`  ℹ️ Attack roll already set from child properties, skipping description check`);
            }

            // Look for damage patterns like "4d6" or "1d10" only if no damage found yet
            if (!damage) {
              const damagePattern = /(\d+d\d+(?:\s*\+\s*\d+)?)\s+(\w+)\s+damage/i;
              const damageMatch = description.match(damagePattern);
              if (damageMatch) {
                damage = damageMatch[1].replace(/\s/g, '');
                damageType = damageMatch[2];
                debug.log(`  💡 Found damage in description: ${damage} ${damageType}`);
              }
            }
          }

          // Clean up range - remove spellSniper calculations
          let cleanRange = prop.range || '';
          if (cleanRange && cleanRange.toLowerCase().includes('spellsniper')) {
            debug.log(`  🔍 Cleaning spellSniper from range: "${cleanRange}"`);

            // Try multiple patterns to extract base range value
            // Pattern 1: {60 * (1 + spellSniper)} feet
            let match = cleanRange.match(/\{(\d+)\s*\*\s*\([^)]*spellSniper[^)]*\)\}/i);
            if (match) {
              const baseValue = match[1];
              const afterMatch = cleanRange.substring(match.index + match[0].length).trim();
              cleanRange = `${baseValue} ${afterMatch}`.trim();
              debug.log(`  ✅ Extracted base range (pattern 1): "${cleanRange}"`);
            } else {
              // Pattern 2: Try to find any number before spellSniper calculation
              match = cleanRange.match(/\{(\d+)[^}]*spellSniper[^}]*\}/i);
              if (match) {
                const baseValue = match[1];
                const afterMatch = cleanRange.substring(match.index + match[0].length).trim();
                cleanRange = `${baseValue} ${afterMatch}`.trim();
                debug.log(`  ✅ Extracted base range (pattern 2): "${cleanRange}"`);
              } else {
                // Fallback: just remove the entire spellSniper expression
                cleanRange = cleanRange.replace(/\{[^}]*spellSniper[^}]*\}/gi, '').trim();
                debug.log(`  ✅ Removed spellSniper expression (fallback): "${cleanRange}"`);
              }
            }
          }

          // Detect OR conditions (multiple damage rolls with same formula but different types)
          // Group them together so UI can present as a choice
          const processedOrGroups = new Set();
          damageRolls.forEach((roll, index) => {
            if (processedOrGroups.has(index)) return;

            // Find other damage rolls with same formula but different damage type
            const similarRolls = [];
            for (let i = index + 1; i < damageRolls.length; i++) {
              if (processedOrGroups.has(i)) continue;

              if (damageRolls[i].damage === roll.damage &&
                  damageRolls[i].damageType !== roll.damageType) {
                similarRolls.push(i);
              }
            }

            // If we found similar rolls, mark them as part of an OR group
            if (similarRolls.length > 0) {
              const orGroupId = `or_group_${index}`;
              roll.orGroup = orGroupId;
              roll.orChoices = [
                { damageType: roll.damageType },
                ...similarRolls.map(i => ({ damageType: damageRolls[i].damageType }))
              ];

              // Mark similar rolls as processed and part of this OR group
              similarRolls.forEach(i => {
                processedOrGroups.add(i);
                damageRolls[i].orGroup = orGroupId;
                damageRolls[i].isOrGroupMember = true; // Don't create separate button for this
              });

              debug.log(`🔀 Detected OR condition in "${prop.name}": ${roll.damage} with types: ${roll.orChoices.map(c => c.damageType).join(' OR ')}`);
            }
          });

          // Detect lifesteal mechanics (damage + healing where healing depends on damage dealt)
          let isLifesteal = false;

          // Check by spell name first (known lifesteal spells)
          const knownLifestealSpells = ['vampiric touch', 'life transference', 'absorb elements'];
          const isKnownLifesteal = prop.name && knownLifestealSpells.some(name =>
            prop.name.toLowerCase().includes(name)
          );

          if (isKnownLifesteal) {
            isLifesteal = true;
            debug.log(`💉 Detected lifesteal mechanic in "${prop.name}" (known lifesteal spell)`);

            // Ensure lifesteal spells have both damage and healing rolls
            const hasDamage = damageRolls.some(r => r.damageType && r.damageType.toLowerCase() !== 'healing' && r.damageType.toLowerCase() !== 'temphp');
            const hasHealing = damageRolls.some(r => r.damageType && r.damageType.toLowerCase() === 'healing');

            // If missing healing roll, add a synthetic one based on description
            if (hasDamage && !hasHealing) {
              debug.log(`  💉 Adding synthetic healing roll for lifesteal spell "${prop.name}"`);
              const damageRoll = damageRolls.find(r => r.damageType && r.damageType.toLowerCase() !== 'healing' && r.damageType.toLowerCase() !== 'temphp');
              if (damageRoll) {
                // Check if description says "half" for healing
                const lowerDesc = fullDescription.toLowerCase();
                const isHalfHealing = lowerDesc.includes('half') && (lowerDesc.includes('regain') || lowerDesc.includes('heal'));
                const healingFormula = isHalfHealing ? `(${damageRoll.damage}) / 2` : damageRoll.damage;
                damageRolls.push({
                  damage: healingFormula,
                  damageType: 'healing'
                });
                debug.log(`  ✅ Added healing roll: ${healingFormula}`);
              }
            }
          } else if (damageRolls.length >= 2) {
            const hasDamage = damageRolls.some(r => r.damageType && r.damageType.toLowerCase() !== 'healing');
            const hasHealing = damageRolls.some(r => r.damageType && r.damageType.toLowerCase() === 'healing');

            if (hasDamage && hasHealing) {
              // Check if description indicates healing depends on damage
              const lowerDesc = fullDescription.toLowerCase();
              const lifesteaIndicators = [
                'regain hit points equal to',
                'regain a number of hit points equal to',
                'regain hit points equal to half',
                'heal for half the damage',
                'regains hit points equal to',
                'gain temporary hit points equal to',
                'gain hit points equal to',
                'equal to half the',
                'equal to half of the',
                'half the amount of',
                'half of the',
                // Vampiric Touch specific patterns
                'you regain hit points',
                'regain hp equal to',
                'hp equal to half'
              ];

              isLifesteal = lifesteaIndicators.some(indicator =>
                lowerDesc.includes(indicator) && (lowerDesc.includes('damage') || lowerDesc.includes('necrotic') || lowerDesc.includes('dealt'))
              );

              if (isLifesteal) {
                debug.log(`💉 Detected lifesteal mechanic in "${prop.name}"`);
              } else {
                debug.log(`🔍 Not lifesteal: "${prop.name}" - has damage and healing but description doesn't match patterns`);
                debug.log(`    Description snippet: ${lowerDesc.substring(0, 200)}`);
              }
            }
          }

          // Final checks for defensive spells - they should NEVER have attack rolls
          const finalSpellNameLower = (prop.name || '').toLowerCase();
          const isFinalDefensiveSpell = finalSpellNameLower === 'shield' ||
                                         finalSpellNameLower.startsWith('shield ') ||
                                         finalSpellNameLower === 'absorb elements' ||
                                         finalSpellNameLower === 'counterspell';
          if (isFinalDefensiveSpell && attackRoll) {
            debug.log(`  🛡️ Defensive spell detected - removing attack roll (was: "${attackRoll}")`);
            attackRoll = '';
          }

          // Force attack roll for known attack spells that might be missing it
          const knownAttackSpells = ['guiding bolt', 'scorching ray', 'eldritch blast', 'fire bolt', 'ray of frost', 'chromatic orb'];
          const isKnownAttackSpell = prop.name && knownAttackSpells.some(name =>
            prop.name.toLowerCase().includes(name)
          );
          if (isKnownAttackSpell && !attackRoll) {
            attackRoll = 'use_spell_attack_bonus';
            debug.log(`  ⚔️ Known attack spell "${prop.name}" missing attack roll - adding it`);
          }

          // Add default damage for known cantrips if damage is missing
          // These cantrips have standard damage that scales with character level
          const knownCantripDamage = {
            'eldritch blast': { damage: '1d10', damageType: 'force' },
            'fire bolt': { damage: '1d10', damageType: 'fire' },
            'ray of frost': { damage: '1d8', damageType: 'cold' },
            'chill touch': { damage: '1d8', damageType: 'necrotic' },
            'sacred flame': { damage: '1d8', damageType: 'radiant' },
            'toll the dead': { damage: '1d8', damageType: 'necrotic' },
            'produce flame': { damage: '1d8', damageType: 'fire' },
            'thorn whip': { damage: '1d6', damageType: 'piercing' },
            'shocking grasp': { damage: '1d8', damageType: 'lightning' },
            'acid splash': { damage: '1d6', damageType: 'acid' },
            'poison spray': { damage: '1d12', damageType: 'poison' },
            'frostbite': { damage: '1d6', damageType: 'cold' },
            'infestation': { damage: '1d6', damageType: 'poison' },
            'mind sliver': { damage: '1d6', damageType: 'psychic' },
            'word of radiance': { damage: '1d6', damageType: 'radiant' },
            'create bonfire': { damage: '1d8', damageType: 'fire' },
            'thunderclap': { damage: '1d6', damageType: 'thunder' },
            'primal savagery': { damage: '1d10', damageType: 'acid' },
            'sapping sting': { damage: '1d4', damageType: 'necrotic' },
          };

          if (damageRolls.length === 0 && prop.name) {
            const lowerName = prop.name.toLowerCase();
            for (const [cantripName, damageInfo] of Object.entries(knownCantripDamage)) {
              if (lowerName.includes(cantripName)) {
                damageRolls.push({
                  damage: damageInfo.damage,
                  damageType: damageInfo.damageType
                });
                debug.log(`  ✅ Added default cantrip damage for "${prop.name}": ${damageInfo.damage} ${damageInfo.damageType}`);
                break;
              }
            }
          }

          // Meld into Stone: Extract conditional damage from description
          const isMeldIntoStone = prop.name && prop.name.toLowerCase().includes('meld into stone');
          if (isMeldIntoStone && damageRolls.length === 0) {
            debug.log(`  🪨 Meld into Stone detected - extracting conditional damage from description`);
            // Look for "6d6" or similar in description
            const damagePattern = /(\d+d\d+)(?:\s+\w+)?\s+damage/i;
            const match = fullDescription.match(damagePattern);
            if (match) {
              const formula = match[1];
              damageRolls.push({
                damage: formula,
                damageType: 'bludgeoning'
              });
              debug.log(`  ✅ Added conditional damage for Meld into Stone: ${formula} bludgeoning`);
            }
          }

          // Log final attack/damage values before adding to spells array
          if (attackRoll || damageRolls.length > 0) {
            debug.log(`📊 Spell "${prop.name}" final values:`, {
              attackRoll: attackRoll || '(none)',
              damageRolls: damageRolls.length > 0 ? damageRolls : '(none)',
              isLifesteal: isLifesteal,
              hasSummary: !!summary,
              hasDescription: !!description,
              fullDescriptionSnippet: fullDescription ? fullDescription.substring(0, 100) : ''
            });
          }

          characterData.spells.push({
            name: prop.name || 'Unnamed Spell',
            level: prop.level || 0,
            school: prop.school || '',
            castingTime: prop.castingTime || '',
            range: cleanRange,
            components: prop.components || '',
            duration: prop.duration || '',
            summary: summary, // Preserve summary separately
            description: description, // Preserve description separately
            fullDescription: fullDescription, // Keep combined version for backward compatibility
            prepared: prop.prepared || false,
            source: source,
            concentration: prop.concentration || false,
            ritual: prop.ritual || false,
            attackRoll: attackRoll,
            damage: damage, // First damage for backward compatibility
            damageType: damageType, // First damageType for backward compatibility
            damageRolls: damageRolls, // Array of all damage/healing rolls
            isLifesteal: isLifesteal, // Flag for lifesteal mechanics
            resources: prop.resources || null, // Store resource consumption data
            castWithoutSpellSlots: prop.castWithoutSpellSlots || false // DiceCloud "doesn't require spell slot" toggle
          });
          break;

        case 'item':
        case 'equipment':
        case 'container':
          // Extract description text from object structure
          let itemDescription = '';
          if (prop.description) {
            if (typeof prop.description === 'string') {
              itemDescription = prop.description;
            } else if (typeof prop.description === 'object') {
              itemDescription = prop.description.text || prop.description.value || '';
            }
          }
          // Strip conditional expressions from item description
          itemDescription = stripConditionalExpressions(itemDescription);

          characterData.inventory.push({
            _id: prop._id || null,
            name: prop.name || 'Unnamed Item',
            plural: prop.plural || null,
            quantity: prop.quantity || 1,
            weight: prop.weight || 0,
            value: prop.value || 0, // Gold piece value
            description: itemDescription,
            equipped: prop.equipped || false,
            requiresAttunement: prop.requiresAttunement || false,
            attuned: prop.attuned || false,
            icon: prop.icon || null, // { name, shape, color }
            tags: prop.tags || [],
            parent: prop.parent || null,
            type: prop.type || 'item', // Track if it's a container
            showIncrement: prop.showIncrement !== false // Default true
          });
          break;

        case 'proficiency':
          characterData.proficiencies.push({
            name: prop.name || '',
            type: prop.proficiencyType || 'other'
          });
          break;

        case 'action':
          // Extract all actions (attacks, bonus actions, reactions, etc.)
          if (prop.name && !prop.inactive && !prop.disabled) {
            // Handle summary and description - they might be separate or combined
            let summary = '';
            if (prop.summary) {
              if (typeof prop.summary === 'string') {
                summary = prop.summary;
              } else if (typeof prop.summary === 'object') {
                summary = prop.summary.text || prop.summary.value || '';
              }
            }

            let description = '';
            if (prop.description) {
              if (typeof prop.description === 'string') {
                description = prop.description;
              } else if (typeof prop.description === 'object') {
                description = prop.description.text || prop.description.value || '';
              }
            }

            // If we only have summary but no description, use summary as description for compatibility
            if (!description && summary) {
              description = summary;
            }

            // Special handling: Font of Magic conversion should use parent feature description
            if (prop.name === 'Convert Sorcery Points to Spell Slot') {
              // Try to find Font of Magic feature description from ancestors
              if (prop.ancestors && Array.isArray(prop.ancestors)) {
                for (const ancestor of prop.ancestors) {
                  const ancestorId = typeof ancestor === 'object' ? ancestor.id : ancestor;
                  const ancestorProp = properties.find(p => p._id === ancestorId);
                  if (ancestorProp && ancestorProp.name === 'Font of Magic') {
                    // Extract Font of Magic description
                    if (ancestorProp.summary) {
                      description = typeof ancestorProp.summary === 'string' ? ancestorProp.summary : ancestorProp.summary.text || ancestorProp.summary.value || '';
                    } else if (ancestorProp.description) {
                      description = typeof ancestorProp.description === 'string' ? ancestorProp.description : ancestorProp.description.text || ancestorProp.description.value || '';
                    }
                    break;
                  }
                }
              }
            }

            // Build attack roll formula from the calculated value
            let attackRoll = '';
            if (prop.attackRoll) {
              if (typeof prop.attackRoll === 'string') {
                attackRoll = prop.attackRoll;
              } else if (typeof prop.attackRoll === 'object' && prop.attackRoll.value !== undefined) {
                // Build the full d20 formula from the calculated bonus
                const bonus = prop.attackRoll.value;
                attackRoll = bonus >= 0 ? `1d20+${bonus}` : `1d20${bonus}`;
              } else if (typeof prop.attackRoll === 'number') {
                // If it's just a number, construct the formula
                const bonus = prop.attackRoll;
                attackRoll = bonus >= 0 ? `1d20+${bonus}` : `1d20${bonus}`;
              }
            }

            // Find damage properties that are descendants of this action
            // Damage can be nested under onHit or other child properties
            const damageProperties = properties.filter(p => {
              if (p.type !== 'damage') return false;

              // Check if this action is in the damage property's ancestors
              if (p.ancestors && Array.isArray(p.ancestors)) {
                return p.ancestors.some(ancestor => ancestor.id === prop._id);
              }

              // Fallback: check direct parent
              return p.parent && p.parent.id === prop._id;
            });

            let damage = '';
            let damageType = '';
            let damageComponents = []; // Track multiple damage types

            if (damageProperties.length > 0) {
              // Process ALL damage properties (not just the first one)
              // This handles multi-damage weapons (e.g., 1d8 slashing + 2d6 fire)
              for (const damageProp of damageProperties) {
                let damageFormula = '';

                // Extract damage formula with modifiers
                if (damageProp.amount) {
                  if (typeof damageProp.amount === 'string') {
                    damageFormula = damageProp.amount;
                  } else if (typeof damageProp.amount === 'object') {
                    // Get base damage formula (e.g., "1d8")
                    // Prioritize 'value' over 'calculation' for pre-computed formulas
                    damageFormula = damageProp.amount.value || damageProp.amount.calculation || damageProp.amount.text || '';

                    // Add effects (modifiers) to build complete formula
                    if (damageProp.amount.effects && Array.isArray(damageProp.amount.effects)) {
                      for (const effect of damageProp.amount.effects) {
                        if (effect.operation === 'add' && effect.amount) {
                          // Skip dice formula calculations (like "3d6" from Sneak Attack toggle)
                          // These are handled by separate action buttons
                          if (effect.amount.calculation) {
                            debug.log(`⏭️ Skipping dice formula effect in weapon damage: ${effect.amount.calculation} (handled by separate action)`);
                            continue;
                          }
                          // Only add numeric modifiers (like +4 from Dex)
                          if (effect.amount.value !== undefined) {
                            const modifier = effect.amount.value;
                            if (modifier !== 0) {
                              damageFormula += modifier >= 0 ? `+${modifier}` : `${modifier}`;
                            }
                          }
                        }
                      }
                    }
                  }
                }

                if (damageFormula) {
                  damageComponents.push({
                    formula: damageFormula,
                    type: damageProp.damageType || ''
                  });
                }
              }

              // Combine all damage formulas
              if (damageComponents.length > 0) {
                damage = damageComponents.map(d => d.formula).join('+');
                // Combine damage types (e.g., "slashing + fire")
                const types = damageComponents.map(d => d.type).filter(t => t);
                damageType = types.length > 0 ? types.join(' + ') : '';
              }
            }

            // Filter out metamagic features (they should only be used when casting spells)
            const metamagicNames = [
              'Careful Spell', 'Distant Spell', 'Empowered Spell', 'Extended Spell',
              'Heightened Spell', 'Quickened Spell', 'Subtle Spell', 'Twinned Spell'
            ];
            // Use case-insensitive matching for metamagic features
            const isMetamagic = metamagicNames.some(name =>
              name.toLowerCase() === prop.name.toLowerCase()
            );

            // If this is a metamagic action, add it to features (NOT actions)
            if (isMetamagic) {
              const metamagicFeature = {
                name: prop.name,
                description: description,
                uses: prop.uses
              };
              characterData.features.push(metamagicFeature);
              debug.log(`🔮 Added metamagic action to features: ${prop.name}`);
            }

            // Add action if it has attack roll OR if it's a non-attack action (bonus action, reaction, etc.)
            // BUT skip metamagic features (they're handled in spell casting UI)
            // Filter out modifiers, effects, recharge buttons by requiring attackRoll or explicit actionType
            const validActionTypes = ['action', 'bonus', 'reaction', 'free', 'legendary', 'lair', 'other'];
            const hasValidActionType = prop.actionType && validActionTypes.includes(prop.actionType.toLowerCase());

            if (!isMetamagic && (attackRoll || hasValidActionType)) {
              const action = {
                _id: prop._id, // Include DiceCloud property ID for syncing
                name: prop.name,
                actionType: prop.actionType || (attackRoll ? 'action' : 'other'), // Attacks default to 'action'
                attackRoll: attackRoll,
                damage: damage,
                damageType: damageType,
                summary: summary, // Preserve summary separately
                description: description, // Preserve description separately
                uses: prop.uses || null,
                usesUsed: prop.usesUsed || 0,
                usesLeft: prop.usesLeft, // DiceCloud's computed uses remaining field
                resources: prop.resources || null // Store DiceCloud's structured resource consumption data
              };

              characterData.actions.push(action);

              if (attackRoll) {
                debug.log(`⚔️ Added attack action: ${action.name} (attack: ${attackRoll}, damage: ${damage} ${damageType})`);
              } else {
                debug.log(`✨ Added non-attack action: ${action.name} (${prop.actionType || 'other'})`);
              }
            }
          } else if (prop.inactive || prop.disabled) {
            debug.log(`⏭️ Skipped action: ${prop.name} (inactive: ${!!prop.inactive}, disabled: ${!!prop.disabled})`);
          }
          break;

        case 'attribute':
          // Extract resources like Ki Points, Sorcery Points, Rage, etc.
          // These are attributes with attributeType === 'resource' or 'healthBar'
          // Skip inactive or disabled resources
          if (prop.name && (prop.attributeType === 'resource' || prop.attributeType === 'healthBar') &&
              !prop.inactive && !prop.disabled) {
            
            // Debug: Log all potential resources for troubleshooting
            debug.log(`🔍 Potential resource found: ${prop.name} (type: ${prop.attributeType}, variable: ${prop.variableName || 'none'})`);
            
            // Skip Font of Magic trackers (not actual resources) but keep HP resources
            const lowerName = prop.name.toLowerCase();
            if (lowerName.includes('slot level to create')) {
              debug.log(`⏭️ Skipping filtered resource: ${prop.name}`);
              break;
            }

            // Helper function to extract numeric value from potentially complex property
            const extractNumericValue = (val, depth = 0) => {
              // Prevent infinite recursion
              if (depth > 5) return 0;

              if (typeof val === 'number') return val;
              if (typeof val === 'string') {
                const parsed = parseFloat(val);
                return isNaN(parsed) ? 0 : parsed;
              }
              if (typeof val === 'object' && val !== null) {
                // Try common properties in order of preference, recursively
                if (val.value !== undefined) {
                  const extracted = extractNumericValue(val.value, depth + 1);
                  if (extracted !== 0) return extracted;
                }
                if (val.total !== undefined) {
                  const extracted = extractNumericValue(val.total, depth + 1);
                  if (extracted !== 0) return extracted;
                }
                if (val.calculation !== undefined) {
                  const parsed = parseFloat(val.calculation);
                  if (!isNaN(parsed) && parsed !== 0) return parsed;
                }
                if (val.text !== undefined) {
                  const parsed = parseFloat(val.text);
                  if (!isNaN(parsed) && parsed !== 0) return parsed;
                }
                return 0;
              }
              return 0;
            };

            // Extract current value
            let currentValue = extractNumericValue(prop.value);
            if (currentValue === 0 && prop.damage !== undefined) {
              currentValue = extractNumericValue(prop.damage);
            }

            // Extract max value
            let maxValue = extractNumericValue(prop.baseValue);
            if (maxValue === 0 && prop.total !== undefined) {
              maxValue = extractNumericValue(prop.total);
            }

            const resource = {
              name: prop.name,
              variableName: prop.variableName || '',
              current: currentValue,
              max: maxValue,
              description: prop.description || ''
            };

            // For resources that track usage (like consumed resources), current = max - damage
            const damageValue = extractNumericValue(prop.damage);
            const baseValue = extractNumericValue(prop.baseValue);
            if (damageValue > 0 && baseValue > 0) {
              resource.current = Math.max(0, baseValue - damageValue);
            }

            // Use variableName or name as unique key (variableName is more reliable in DiceCloud)
            const resourceKey = (prop.variableName || prop.name).toLowerCase();

            // Skip resources with max of 0 (utility variables, not real resources)
            if (resource.max <= 0) {
              debug.log(`  ⏭️  Skipping utility resource (max=0): ${resource.name}`);
              break;
            }

            // Only add if we haven't seen this resource before
            if (!uniqueResources.has(resourceKey)) {
              uniqueResources.add(resourceKey);
              characterData.resources.push(resource);
              debug.log(`💎 Added resource: ${resource.name} (${resource.current}/${resource.max})`);
            } else {
              debug.log(`  ⏭️  Skipping duplicate resource: ${resource.name}`);
            }
          }
          break;
      }
    });

    // Debug: Log all property types found
    debug.log('🔍 All property types found in character:', Array.from(propertyTypes).sort());

    // Extract companions from features (Animal Companions, Familiars, Summons, etc.)
    extractCompanions(characterData, apiData);

    // 🔍 DEBUG: Check what companion data exists
    debug.log('🔍 DEBUG: Checking for companions');
    debug.log('📊 Properties with type=creature:', 
      apiData.creatureProperties.filter(p => p.type === 'creature').map(p => ({
        name: p.name,
        type: p.type,
        tags: p.tags
      }))
    );
    debug.log('📊 Features with "companion" in name:', 
      characterData.features.filter(f => /companion|beast/i.test(f.name)).map(f => f.name)
    );

    // Second pass: look for subrace as a child of the race property
    if (racePropertyId && raceName) {
      debug.log('🔍 Looking for subrace children of race property ID:', racePropertyId);
      const subraceProps = apiData.creatureProperties.filter(prop => {
        const isChild = prop.parent && prop.parent.id === racePropertyId;
        const hasSubraceTag = prop.tags && Array.isArray(prop.tags) && prop.tags.some(tag =>
          tag.toLowerCase().includes('subrace')
        );
        const isFolder = prop.type === 'folder';
        if (isChild) {
          debug.log('🔍 Found child of race:', {
            name: prop.name,
            type: prop.type,
            tags: prop.tags,
            hasSubraceTag: hasSubraceTag,
            isFolder: isFolder
          });
        }
        // Look for folders that are children of the race and have subrace tags
        return isChild && hasSubraceTag && isFolder;
      });

      if (subraceProps.length > 0) {
        const subraceProp = subraceProps[0];
        debug.log('🔍 Found subrace child property:', subraceProp.name, 'with tags:', subraceProp.tags);
        characterData.race = `${raceName} - ${subraceProp.name}`;
        debug.log('🔍 Combined race with subrace:', characterData.race);
      } else {
        debug.log('🔍 No subrace children found for race');
      }
    }

    // Fallback: Check for race in otherVariables if not found in properties
    if (!raceFound && !characterData.race) {
      debug.log('🔍 Race not found in properties, checking otherVariables...');
      const raceVars = Object.keys(characterData.otherVariables).filter(key =>
        key.toLowerCase().includes('race') || key.toLowerCase().includes('species')
      );

      if (raceVars.length > 0) {
        // Helper function to format camelCase race names
        // e.g., "highElf" -> "High Elf", "elf" -> "Elf"
        const formatRaceName = (name) => {
          if (!name) return null;

          // Special handling for "custom" -> "Custom Lineage"
          if (name.toLowerCase() === 'custom' || name.toLowerCase() === 'customlineage') {
            return 'Custom Lineage';
          }

          // Convert camelCase to space-separated (highElf -> high Elf)
          let formatted = name.replace(/([a-z])([A-Z])/g, '$1 $2');
          // Capitalize first letter of each word
          formatted = formatted.split(' ').map(word =>
            word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
          ).join(' ');
          return formatted;
        };

        // Helper function to extract race name from variable name
        // e.g., "elfRace" -> "Elf", "humanRace" -> "Human"
        const extractRaceFromVarName = (varName) => {
          const raceName = varName.replace(/race$/i, '').replace(/^race$/i, '');
          if (raceName && raceName !== varName.toLowerCase()) {
            // Capitalize first letter
            return raceName.charAt(0).toUpperCase() + raceName.slice(1);
          }
          return null;
        };

        // Try to find the best race information
        // Priority: 1) subRace with name, 2) race with name, 3) specific race variable (e.g., elfRace)
        let raceName = null;
        let suberaceName = null;

        // Check for subRace first
        const subRaceVar = raceVars.find(key => key.toLowerCase() === 'subrace');
        if (subRaceVar) {
          const subRaceValue = characterData.otherVariables[subRaceVar];
          debug.log(`🔍 DEBUG: subRace value:`, subRaceValue, `type:`, typeof subRaceValue);
          if (typeof subRaceValue === 'object' && subRaceValue !== null) {
            debug.log(`🔍 DEBUG: subRace object keys:`, Object.keys(subRaceValue));
            if (subRaceValue.name) {
              suberaceName = formatRaceName(subRaceValue.name);
              debug.log(`🔍 Found subrace name: ${suberaceName}`);
            } else if (subRaceValue.text) {
              suberaceName = formatRaceName(subRaceValue.text);
              debug.log(`🔍 Found subrace text: ${suberaceName}`);
            } else if (subRaceValue.value) {
              // Try value property
              suberaceName = formatRaceName(subRaceValue.value);
              debug.log(`🔍 Found subrace value: ${suberaceName}`);
            }
          } else if (typeof subRaceValue === 'string') {
            suberaceName = formatRaceName(subRaceValue);
            debug.log(`🔍 Found subrace string: ${suberaceName}`);
          }
        }

        // Check for race variable
        const raceVar = raceVars.find(key => key.toLowerCase() === 'race');
        if (raceVar) {
          const raceValue = characterData.otherVariables[raceVar];
          debug.log(`🔍 DEBUG: race value:`, raceValue, `type:`, typeof raceValue);
          if (typeof raceValue === 'object' && raceValue !== null) {
            debug.log(`🔍 DEBUG: race object keys:`, Object.keys(raceValue));
            if (raceValue.name) {
              raceName = formatRaceName(raceValue.name);
              debug.log(`🔍 Found race name: ${raceName}`);
            } else if (raceValue.text) {
              raceName = formatRaceName(raceValue.text);
              debug.log(`🔍 Found race text: ${raceName}`);
            } else if (raceValue.value) {
              raceName = formatRaceName(raceValue.value);
              debug.log(`🔍 Found race value: ${raceName}`);
            }
          } else if (typeof raceValue === 'string') {
            raceName = formatRaceName(raceValue);
            debug.log(`🔍 Found race string: ${raceName}`);
          }
        }

        // If we didn't find race/subrace with names, look for specific race variables (e.g., elfRace, humanRace)
        if (!raceName) {
          for (const varName of raceVars) {
            const varValue = characterData.otherVariables[varName];
            // Check if this is a specific race variable (e.g., elfRace = true)
            if (typeof varValue === 'object' && varValue !== null && varValue.value === true) {
              const extracted = extractRaceFromVarName(varName);
              if (extracted) {
                raceName = extracted;
                debug.log(`🔍 Extracted race from variable name: ${varName} -> ${raceName}`);
                break;
              }
            }
          }
        }

        // Combine race and subrace if we have both
        if (raceName && suberaceName) {
          characterData.race = `${raceName} - ${suberaceName}`;
          debug.log(`🔍 Combined race and subrace: ${characterData.race}`);
        } else if (suberaceName) {
          characterData.race = suberaceName;
          debug.log(`🔍 Using subrace as race: ${characterData.race}`);
        } else if (raceName) {
          characterData.race = raceName;
          debug.log(`🔍 Using race: ${characterData.race}`);
        } else {
          debug.log('🔍 Could not determine race from variables:', raceVars);
        }
      } else {
        debug.log('🔍 No race found in otherVariables either');
      }
    }

    // Post-process HP resources to map them to hitPoints structure
    if (characterData.resources && characterData.resources.length > 0) {
      debug.log(`🔍 Found ${characterData.resources.length} resources:`, characterData.resources.map(r => r.name));
      
      const hpResource = characterData.resources.find(r => 
        r.name.toLowerCase().includes('hit points') || 
        r.name.toLowerCase() === 'hp' ||
        r.variableName?.toLowerCase() === 'hitpoints'
      );
      
      const tempHpResource = characterData.resources.find(r => 
        r.name.toLowerCase().includes('temporary hit points') || 
        r.name.toLowerCase().includes('temp hp') ||
        r.variableName?.toLowerCase() === 'temphitpoints'
      );

      debug.log(`🔍 HP resource found: ${hpResource ? hpResource.name : 'none'}`);
      debug.log(`🔍 Temp HP resource found: ${tempHpResource ? tempHpResource.name : 'none'}`);

      if (hpResource) {
        characterData.hitPoints = {
          current: hpResource.current,
          max: hpResource.max
        };
        debug.log(`💚 Mapped HP resource: ${hpResource.name} (${hpResource.current}/${hpResource.max})`);
      }

      if (tempHpResource) {
        characterData.temporaryHP = tempHpResource.current;
        debug.log(`💙 Mapped Temp HP resource: ${tempHpResource.name} (${tempHpResource.current})`);
      }
    } else {
      debug.log('🔍 No resources found in character data');
    }

    debug.log('Parsed character data:', characterData);
    return characterData;
  }

  /**
   * Extracts companion creatures from features
   */
  function extractCompanions(characterData, apiData) {
    debug.log('🐾🐾🐾 extractCompanions FUNCTION STARTED 🐾🐾🐾');
    debug.log('🐾 Searching for companion creatures in features...');

    // Look for features that appear to be companions
    // Common patterns: "Companion:", "Beast of", "Familiar", "Summon", "Mount"
    const companionPatterns = [
      /companion/i,
      /beast of/i,
      /familiar/i,
      /summon/i,
      /mount/i,
      /steel defender/i,
      /homunculus/i,
      /drake/i,
      /drake warden/i,
      /primal companion/i,
      /beast master/i,
      /ranger's companion/i
    ];

    debug.log('🐾 Total features to check:', characterData.features.length);

    characterData.features.forEach((feature, index) => {
      const isCompanion = companionPatterns.some(pattern => pattern.test(feature.name));

      if (isCompanion) {
        debug.log(`🐾 Found potential companion: ${feature.name} (index ${index})`);
        debug.log(`🔍 DEBUG: Feature object keys:`, Object.keys(feature));
        debug.log(`🔍 DEBUG: Has description:`, !!feature.description);
        debug.log(`🔍 DEBUG: Description value:`, feature.description);
        
        if (feature.description) {
          debug.log(`🔍 DEBUG: Companion description:`, feature.description);

          const companion = parseCompanionStatBlock(feature.name, feature.description);
          if (companion) {
            characterData.companions.push(companion);
            debug.log(`✅ Added companion: ${companion.name}`);
          } else {
            debug.log(`❌ Failed to parse companion: ${feature.name} - no valid stat block found`);
          }
        } else {
          debug.log(`⚠️ Companion ${feature.name} has no description - skipping (no stat block)`);
          // Don't add companions without descriptions/stat blocks
        }
      }
    });

    debug.log(`🐾 Total companions found: ${characterData.companions.length}`);
  }

  /**
   * Parses a companion stat block from description text
   */
  function parseCompanionStatBlock(name, description) {
    // Convert description to string if it's an object
    let descText = description;
    if (typeof description === 'object' && description !== null) {
      descText = description.value || description.text || '';
    } else if (typeof description !== 'string') {
      debug.log(`⚠️ Companion "${name}" has invalid description type:`, typeof description);
      return null;
    }

    if (!descText || descText.trim() === '') {
      debug.log(`⚠️ Companion "${name}" has empty description`);
      return null;
    }

    debug.log(`🔍 DEBUG: Parsing companion "${name}" with description:`, descText);

    const companion = {
      name: name,
      size: '',
      type: '',
      alignment: '',
      ac: 0,
      hp: '',
      speed: '',
      abilities: {},
      senses: '',
      languages: '',
      proficiencyBonus: 0,
      features: [],
      actions: [],
      rawDescription: descText
    };

    // Parse size and type (e.g., "Small beast, neutral")
    const sizeTypeMatch = descText.match(/(Tiny|Small|Medium|Large|Huge|Gargantuan)\s+(\w+),\s*(\w+)/i);
    if (sizeTypeMatch) {
      companion.size = sizeTypeMatch[1];
      companion.type = sizeTypeMatch[2];
      companion.alignment = sizeTypeMatch[3];
      debug.log(`✅ Parsed size/type: ${companion.size} ${companion.type}, ${companion.alignment}`);
    }

    // Parse AC - try multiple patterns including markdown
    const acPatterns = [
      /\*\*AC\*\*\s+(\d+)/i,
      /\*\*Armor Class\*\*\s+\*\*(\d+)\*\*/i,
      /AC\s+(\d+)/i,
      /Armor Class\s+(\d+)/i
    ];
    for (const pattern of acPatterns) {
      const acMatch = descText.match(pattern);
      if (acMatch) {
        companion.ac = parseInt(acMatch[1]);
        debug.log(`✅ Parsed AC: ${companion.ac}`);
        break;
      }
    }

    // Parse HP - try multiple patterns including markdown
    const hpPatterns = [
      /\*\*HP\*\*\s+(\d+\s*\([^)]+\))/i,
      /\*\*Hit Points\*\*\s+\*\*(\d+\s*\([^)]+\))\*\*/i,
      /\*\*Hit Points\*\*\s+(\d+\s*\([^)]+\))/i,
      /HP\s+(\d+\s*\([^)]+\))/i,
      /Hit Points\s+(\d+\s*\([^)]+\))/i
    ];
    for (const pattern of hpPatterns) {
      const hpMatch = descText.match(pattern);
      if (hpMatch) {
        companion.hp = hpMatch[1];
        debug.log(`✅ Parsed HP: ${companion.hp}`);
        break;
      }
    }

    // Parse Speed - try multiple patterns
    const speedPatterns = [
      /Speed\s+([^•\n]+)/i,
      /\*\*Speed\*\*\s+([^•\n]+)/i
    ];
    for (const pattern of speedPatterns) {
      const speedMatch = descText.match(pattern);
      if (speedMatch) {
        companion.speed = speedMatch[1].trim();
        debug.log(`✅ Parsed Speed: ${companion.speed}`);
        break;
      }
    }

    // Parse Abilities (STR, DEX, CON, INT, WIS, CHA) - handle markdown table format
    const abilities = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
    
    // Try to find the ability values row in the markdown table
    // Look for a line that starts with | and has 6 columns with ability scores
    const lines = descText.split('\n');
    let abilityLine = null;
    
    debug.log(`🔍 DEBUG: Checking ${lines.length} lines for ability table`);
    for (const line of lines) {
      if (line.match(/^>?\s*\|\s*\d+\s*\([+\-]\d+\)\s*\|\s*\d+\s*\([+\-]\d+\)\s*\|\s*\d+\s*\([+\-]\d+\)\s*\|\s*\d+\s*\([+\-]\d+\)\s*\|\s*\d+\s*\([+\-]\d+\)\s*\|\s*\d+\s*\([+\-]\d+\)\s*\|/)) {
        abilityLine = line;
        debug.log(`🔍 DEBUG: Found matching ability line`);
      }
    }
    
    if (abilityLine) {
      debug.log(`🔍 Found ability line: ${abilityLine}`);
      // Extract the 6 ability values from the table row - simpler approach
      // Remove the >| prefix and split by |
      const cleanLine = abilityLine.replace(/^>\|/, '');
      const abilityValues = cleanLine.split('|').filter(val => val.trim());
      
      debug.log(`🔍 Split ability values:`, abilityValues);
      
      if (abilityValues.length >= 6) {
        // Take the last 6 values (in case there are extra columns)
        const abilityScores = abilityValues.slice(-6);
        debug.log(`🔍 Using ability scores:`, abilityScores);
        
        abilities.forEach((ability, index) => {
          if (index < abilityScores.length) {
            const abilityText = abilityScores[index].trim();
            debug.log(`🔍 DEBUG: Processing ${ability} with text: "${abilityText}"`);
            const abilityMatch = abilityText.match(/(\d+)\s*\(([+\-]\d+)\)/);
            debug.log(`🔍 DEBUG: ${ability} regex result:`, abilityMatch);
            if (abilityMatch) {
              companion.abilities[ability.toLowerCase()] = {
                score: parseInt(abilityMatch[1]),
                modifier: parseInt(abilityMatch[2])
              };
              debug.log(`✅ Parsed ${ability}: ${abilityMatch[1]} (${abilityMatch[2]})`);
            } else {
              debug.log(`❌ Failed to parse ${ability} from "${abilityText}"`);
            }
          }
        });
      } else {
        debug.log(`❌ Not enough ability values found. Found ${abilityValues.length} values`);
      }
    } else {
      debug.log(`❌ No ability line found, trying fallback`);
      // Fallback to original format
      abilities.forEach(ability => {
        const regex = new RegExp(ability + '\\s+(\\d+)\\s*\\(([+\\-]\\d+)\\)', 'i');
        const match = descText.match(regex);
        if (match) {
          companion.abilities[ability.toLowerCase()] = {
            score: parseInt(match[1]),
            modifier: parseInt(match[2])
          };
          debug.log(`✅ Parsed ${ability}: ${match[1]} (${match[2]})`);
        }
      });
    }

    // Parse Senses - try multiple patterns
    const sensesPatterns = [
      /Senses\s+([^•\n]+)/i,
      /\*\*Senses\*\*\s+([^•\n]+)/i
    ];
    for (const pattern of sensesPatterns) {
      const sensesMatch = descText.match(pattern);
      if (sensesMatch) {
        companion.senses = sensesMatch[1].trim();
        debug.log(`✅ Parsed Senses: ${companion.senses}`);
        break;
      }
    }

    // Parse Languages - try multiple patterns
    const languagesPatterns = [
      /Languages\s+([^•\n]+)/i,
      /\*\*Languages\*\*\s+([^•\n]+)/i
    ];
    for (const pattern of languagesPatterns) {
      const languagesMatch = descText.match(pattern);
      if (languagesMatch) {
        companion.languages = languagesMatch[1].trim();
        debug.log(`✅ Parsed Languages: ${companion.languages}`);
        break;
      }
    }

    // Parse Proficiency Bonus - try multiple patterns
    const pbPatterns = [
      /Proficiency Bonus\s+(\d+)/i,
      /\*\*Proficiency Bonus\*\*\s+(\d+)/i
    ];
    for (const pattern of pbPatterns) {
      const pbMatch = descText.match(pattern);
      if (pbMatch) {
        companion.proficiencyBonus = parseInt(pbMatch[1]);
        debug.log(`✅ Parsed Proficiency Bonus: ${companion.proficiencyBonus}`);
        break;
      }
    }

    // Parse special features (e.g., "Flyby.", "Primal Bond.")
    const featurePattern = /\*\*\*([^*\n.]+)\.\*\*\*\s*([^*\n]+)/gi;
    let featureMatch;
    while ((featureMatch = featurePattern.exec(descText)) !== null) {
      companion.features.push({
        name: featureMatch[1].trim(),
        description: featureMatch[2].trim()
      });
      debug.log(`✅ Parsed Feature: ${featureMatch[1].trim()}`);
    }

    // Parse Actions section
    const actionsMatch = descText.match(/###?\s*Actions\s+([\s\S]+)/i);
    if (actionsMatch) {
      const actionsText = actionsMatch[1];
      debug.log(`🔍 DEBUG: Found actions section:`, actionsText);

      // Simple approach: extract attack data using basic string matching
      const attackLines = actionsText.split('\n').filter(line => line.includes('***') && line.includes('Melee Weapon Attack'));
      
      attackLines.forEach(attackLine => {
        debug.log(`🔍 DEBUG: Processing attack line:`, attackLine);
        
        // Extract name (between *** and ***)
        const nameMatch = attackLine.match(/\*\*\*(\w+)\.\*\*\*/);
        // Extract attack bonus (between **+ and **)
        const bonusMatch = attackLine.match(/\*\*(\+\d+)\*\*/);
        // Extract reach (after "reach" and before comma)
        const reachMatch = attackLine.match(/reach\s*([\d\s]+ft\.)/);
        // Extract damage (after *Hit:* and **)
        // Try multiple patterns for damage extraction
        let damageMatch = attackLine.match(/\*?Hit:\*?\s*\*\*([^*]+?)\*\*/);
        debug.log(`🔍 DEBUG: Damage pattern 1 result:`, damageMatch);
        if (!damageMatch) {
          // Fallback: capture everything after Hit: and ** up to the next word
          damageMatch = attackLine.match(/\*?Hit:\*?\s*\*\*([^*]+?)(?:\s+[a-z]+|$)/i);
          debug.log(`🔍 DEBUG: Damage pattern 2 result:`, damageMatch);
        }
        if (!damageMatch) {
          // Another fallback: just capture after Hit: and **
          damageMatch = attackLine.match(/\*?Hit:\*?\s*\*\*([^*]+)/);
          debug.log(`🔍 DEBUG: Damage pattern 3 result:`, damageMatch);
        }
        debug.log(`🔍 DEBUG: Final damage match:`, damageMatch);
        
        if (nameMatch && bonusMatch && reachMatch && damageMatch) {
          companion.actions.push({
            name: nameMatch[1].trim(),
            type: 'attack',
            attackBonus: parseInt(bonusMatch[1]),
            reach: reachMatch[1].trim(),
            damage: damageMatch[1].trim()
          });
          debug.log(`✅ Parsed Action: ${nameMatch[1].trim()}`);
          debug.log(`🔍 DEBUG: Parsed damage: "${damageMatch[1].trim()}"`);
        } else {
          debug.log(`❌ Failed to parse attack. Matches:`, {nameMatch, bonusMatch, reachMatch, damageMatch});
        }
      });
    } else {
      debug.log(`🔍 DEBUG: No actions section found`);
    }

    // Only return if we found at least some stats
    if (companion.ac > 0 || companion.hp || Object.keys(companion.abilities).length > 0) {
      debug.log(`✅ Successfully parsed companion "${name}"`);
      debug.log(`🔍 DEBUG: Final companion object:`, companion);
      return companion;
    }

    debug.log(`❌ Failed to parse any stats for companion "${name}"`);
    return null;
  }

  /**
   * Extracts character data from the current page
   */
  async function extractCharacterData() {
    try {
      debug.log('🚀 Starting character extraction...');
      
      // Try API first (this returns parsed data directly)
      const characterData = await fetchCharacterDataFromAPI();
      if (characterData) {
        debug.log('✅ Character data extracted via API:', characterData.name);
        return characterData;
      }
      
      // Fallback to DOM extraction
      debug.log('🔄 API failed, trying DOM extraction...');
      const domData = extractCharacterDataFromDOM();
      if (domData) {
        debug.log('✅ Character data extracted via DOM:', domData.name);
        return domData;
      }
      
      debug.error('❌ Both API and DOM extraction failed');
      return null;
    } catch (error) {
      debug.error('❌ Error extracting character data:', error);
      throw error;
    }
  }

  /**
   * Handles roll requests from Roll20 character sheet
   */
  function handleRollRequest(name, formula) {
    return new Promise((resolve, reject) => {
      debug.log(`🎲 Handling roll request: ${name} with formula ${formula}`);
      
      // Create a mock roll entry to simulate the roll
      const rollResult = Math.floor(Math.random() * 20) + 1;
      const totalResult = rollResult + (formula.includes('+') ? parseInt(formula.split('+')[1]) : 0);
      
      const rollData = {
        name: name,
        formula: formula,
        result: totalResult.toString(),
        baseRoll: rollResult.toString(),  // Add the raw d20 roll!
        timestamp: Date.now()
      };
      
      debug.log('🎲 Simulated roll:', rollData);
      
      // Send the roll to Roll20 (this will trigger the existing roll forwarding)
      sendRollToRoll20(rollData);
      
      // Show a notification in Dice Cloud
      showNotification(`Rolled ${name}: ${formula} = ${totalResult} 🎲`, 'success');
      
      resolve();
    });
  }

  /**
   * Extracts spell descriptions from Dice Cloud DOM
   */
  function extractSpellsFromDOM(characterData) {
    try {
      debug.log('🔍 Extracting spells from DOM...');
      debug.log('🔍 Current hostname:', window.location.hostname);
      debug.log('🔍 Current URL:', window.location.href);
      
      // Look for spell sections in Dice Cloud
      const spellSelectors = [
        '[class*="spell"]',
        '[class*="magic"]',
        '.spell-item',
        '.spell-card',
        '[data-spell]',
        'div:contains("spell")',
        'li:contains("spell")',
        // Dice Cloud specific selectors
        '.v-card', // Vue.js cards
        '.v-sheet', // Vue.js sheets
        '[data-v-]', // Vue.js components
        '.ma-2', // Margin classes
        '.pa-2', // Padding classes
        '.text-h6', // Header text
        '.subtitle-1', // Subtitle text
        '.caption' // Caption text
      ];
      
      const spellElements = [];
      spellSelectors.forEach(selector => {
        try {
          const elements = document.querySelectorAll(selector);
          elements.forEach(el => spellElements.push(el));
        } catch (e) {
          // Some selectors might not be supported
        }
      });
      
      debug.log(`🔍 Found ${spellElements.length} potential spell elements`);
      
      // If we're not in Dice Cloud, try a broader search
      if (window.location.hostname !== 'dicecloud.com' && !window.location.hostname.includes('dicecloud')) {
        debug.log('🔍 Not in Dice Cloud, trying broader search...');
        
        // Look for any text that might contain spell information
        const allElements = document.querySelectorAll('*');
        let spellTextElements = [];
        
        allElements.forEach(element => {
          const text = element.textContent || element.innerText || '';
          if (text.toLowerCase().includes('spell') || 
              text.toLowerCase().includes('level') && 
              text.toLowerCase().includes('cantrip') ||
              text.toLowerCase().includes('casting') ||
              text.toLowerCase().includes('range') ||
              text.toLowerCase().includes('duration')) {
            spellTextElements.push(element);
          }
        });
        
        debug.log(`🔍 Found ${spellTextElements.length} elements with spell-related text`);
        spellElements.push(...spellTextElements);
      }
      
      // Extract spell data from each element
      spellElements.forEach((element, index) => {
        try {
          const text = element.textContent || element.innerText || '';
          const lowerText = text.toLowerCase();
          
          // Skip if this doesn't look like a spell
          if (!lowerText.includes('spell') && !lowerText.includes('level') && !lowerText.includes('cantrip')) {
            return;
          }
          
          // Skip spell slot elements
          if (lowerText.includes('spell slots') || lowerText.includes('slot') || lowerText.includes('slots')) {
            debug.log(`🔍 Skipping spell slot element: ${text.substring(0, 50)}`);
            return;
          }
          
          // Skip navigation/menu elements
          if (lowerText.includes('stats') || lowerText.includes('actions') || lowerText.includes('inventory') || 
              lowerText.includes('features') || lowerText.includes('journal') || lowerText.includes('build') ||
              lowerText.includes('hit points') || lowerText.includes('armor class') || lowerText.includes('speed')) {
            debug.log(`🔍 Skipping navigation element: ${text.substring(0, 50)}`);
            return;
          }
          
          // Skip elements that are too short or don't have meaningful content
          if (text.length < 20) {
            return;
          }
          
          // Skip if it looks like a character name or general navigation
          if (text.includes(characterData.name) || lowerText.includes('grey')) {
            debug.log(`🔍 Skipping character name element: ${text.substring(0, 50)}`);
            return;
          }
          
          debug.log(`🔍 Processing element ${index}:`, text.substring(0, 100));
          
          // Try to extract spell name (first line or bold text)
          let spellName = '';
          const boldText = element.querySelector('strong, b, [class*="name"], [class*="title"], .text-h6, .subtitle-1');
          if (boldText) {
            spellName = boldText.textContent.trim();
          } else {
            const lines = text.split('\n').filter(line => line.trim());
            spellName = lines[0]?.trim() || '';
          }
          
          // Skip if no spell name found or if it's just generic text
          if (!spellName || spellName.length < 2 || spellName.toLowerCase().includes('level') || spellName.toLowerCase().includes('spell')) {
            return;
          }
          
          // Skip if it's a known D&D spell name that should have more content
          const knownSpells = ['detect magic', 'disguise self', 'summon fey', 'fireball', 'magic missile', 'cure wounds'];
          if (knownSpells.includes(spellName.toLowerCase()) && text.length < 100) {
            debug.log(`🔍 Skipping incomplete spell entry for "${spellName}"`);
            return;
          }
          
          // Extract level information
          let spellLevel = 0;
          const levelMatch = text.match(/level\s*(\d+)|cantrip|(\d+)(?:st|nd|rd|th)\s*level/i);
          if (levelMatch) {
            spellLevel = levelMatch[1] ? parseInt(levelMatch[1]) : (levelMatch[2] ? parseInt(levelMatch[2]) : 0);
          }
          
          // Extract description (everything after the first few lines)
          let description = '';
          const lines = text.split('\n').filter(line => line.trim());
          if (lines.length > 2) {
            // Skip first 1-2 lines (usually name/level info)
            description = lines.slice(2).join('\n').trim();
          }
          
          // Clean up description - remove any [object Object] text
          description = description.replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '').replace(/\[object Object\]/g, '').trim();

          // Strip conditional expressions from description
          description = stripConditionalExpressions(description);

          // Only add if we have meaningful content
          if (description && description.length > 10) {
            // Check if we already have this spell
            const existingSpell = characterData.spells.find(s =>
              s.name.toLowerCase() === spellName.toLowerCase()
            );

            if (existingSpell) {
              // Update existing spell with description
              existingSpell.description = description;
              debug.log(`✅ Updated description for "${spellName}": "${description.substring(0, 50)}..."`);
            } else {
              // Add new spell
              characterData.spells.push({
                name: spellName,
                level: spellLevel,
                description: description,
                school: '',
                castingTime: '',
                range: '',
                components: '',
                duration: '',
                prepared: false
              });
              debug.log(`✅ Added new spell "${spellName}" (Level ${spellLevel}): "${description.substring(0, 50)}..."`);
            }
          } else {
            debug.log(`🔍 No meaningful description found for "${spellName}"`);
          }
        } catch (error) {
          debug.error(`❌ Error processing spell element ${index}:`, error);
        }
      });
      
      debug.log(`✅ Spell extraction complete. Found ${characterData.spells.length} spells with descriptions.`);
    } catch (error) {
      debug.error('❌ Error extracting spells from DOM:', error);
    }
  }

  /**
   * Extracts character data from DOM elements (fallback method)
   */
  function extractCharacterDataFromDOM() {
    try {
      debug.log('🔍 Extracting character data from DOM...');

      const characterData = {
        id: getCharacterIdFromUrl(),  // CRITICAL: Store character ID for proper persistence
        name: '',
        level: 1,
        class: '',
        race: '',
        attributes: {},
        attributeMods: {},
        skills: {},
        savingThrows: {},
        hitPoints: 0,
        armorClass: 10,
        speed: 30,
        proficiencyBonus: 2,
        initiative: 0,
        otherVariables: {},
        features: [],
        spells: []
      };

      // Try to find character name
      const nameElement = document.querySelector('[class*="name"], [class*="character"], h1, h2');
      if (nameElement) {
        characterData.name = nameElement.textContent.trim() || 'Unknown Character';
      }

      // Try to find basic stats from common selectors
      const statElements = document.querySelectorAll('[class*="stat"], [class*="attribute"], [class*="ability"]');
      statElements.forEach(element => {
        const text = element.textContent.trim();
        if (text.includes('STR') || text.includes('Strength')) {
          const match = text.match(/(\d+)/);
          if (match) characterData.attributes.strength = parseInt(match[1]);
        }
        if (text.includes('DEX') || text.includes('Dexterity')) {
          const match = text.match(/(\d+)/);
          if (match) characterData.attributes.dexterity = parseInt(match[1]);
        }
        if (text.includes('CON') || text.includes('Constitution')) {
          const match = text.match(/(\d+)/);
          if (match) characterData.attributes.constitution = parseInt(match[1]);
        }
        if (text.includes('INT') || text.includes('Intelligence')) {
          const match = text.match(/(\d+)/);
          if (match) characterData.attributes.intelligence = parseInt(match[1]);
        }
        if (text.includes('WIS') || text.includes('Wisdom')) {
          const match = text.match(/(\d+)/);
          if (match) characterData.attributes.wisdom = parseInt(match[1]);
        }
        if (text.includes('CHA') || text.includes('Charisma')) {
          const match = text.match(/(\d+)/);
          if (match) characterData.attributes.charisma = parseInt(match[1]);
        }
      });

      // Calculate modifiers (standard D&D 5e formula)
      Object.keys(characterData.attributes).forEach(attr => {
        const score = characterData.attributes[attr] || 10;
        characterData.attributeMods[attr] = Math.floor((score - 10) / 2);
      });

      // Extract spells from the page
      extractSpellsFromDOM(characterData);

      debug.log('✅ DOM extraction completed:', characterData);
      return characterData;
    } catch (error) {
      debug.error('❌ Error extracting from DOM:', error);
      return null;
    }
  }

  /**
   * Extracts character data from the current page
   */
  async function extractAndStoreCharacterData() {
    try {
      debug.log('🚀 Starting character extraction...');
      showNotification('Extracting character data...', 'info');

      const characterData = await fetchCharacterDataFromAPI();

      if (characterData && characterData.name) {
        // Send to background script for storage
        try {
          browserAPI.runtime.sendMessage({
            action: 'storeCharacterData',
            data: characterData
          }, (response) => {
            if (browserAPI.runtime.lastError) {
              debug.error('❌ Extension context error:', browserAPI.runtime.lastError);
              showNotification('Extension reloaded. Please refresh the page.', 'error');
              return;
            }
            
            if (response && response.success) {
              debug.log('✅ Character data stored successfully');
              showNotification(`${characterData.name} extracted! Navigate to Roll20 to import.`, 'success');
            } else {
              debug.error('❌ Failed to store character data:', response && response.error);
              showNotification('Failed to store character data', 'error');
            }
          });
        } catch (error) {
          debug.error('❌ Extension context invalidated:', error);
          showNotification('Extension reloaded. Please refresh the page.', 'error');
        }
      } else {
        debug.error('❌ No character name found');
        showNotification('Failed to extract character data', 'error');
      }
    } catch (error) {
      debug.error('❌ Error extracting character:', error);
      debug.error('Stack trace:', error.stack);
      showNotification(error.message, 'error');
    }
  }

  /**
   * Shows a notification to the user
   */
  function showNotification(message, type = 'info', duration = 5000) {
    const colors = {
      success: '#FC57F9',
      error: '#f44336',
      info: '#2196F3'
    };

    const notification = document.createElement('div');
    notification.textContent = message;
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: ${colors[type] || colors.info};
      color: white;
      padding: 16px;
      border-radius: 4px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
      z-index: 10000;
      font-family: Arial, sans-serif;
      font-size: 14px;
      max-width: 300px;
    `;
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), duration);
  }

  /**
   * Adds an export button to the Dice Cloud UI
   */
  function addCheckStructureButton() {
    // Wait for page to fully load
    if (document.readyState !== 'complete') {
      window.addEventListener('load', addCheckStructureButton);
      return;
    }

    // Only add if not already present
    if (!document.getElementById('dc-check-structure-btn')) {
      const debugButton = document.createElement('button');
      debugButton.id = 'dc-check-structure-btn';
      debugButton.textContent = '🔍 Check Structure';
      debugButton.style.cssText = `
        position: fixed;
        top: 10px;
        right: 10px;
        z-index: 10000;
        background: #ff6b6b;
        color: white;
        border: none;
        padding: 10px;
        border-radius: 5px;
        cursor: pointer;
        font-size: 12px;
      `;

      debugButton.addEventListener('click', async () => {
        console.log('🔍 [DiceCloud Structure] Fetching complete property structure...');

        // Get current character ID from URL - handle different URL formats
        const pathParts = window.location.pathname.split('/');
        let characterId = null;

        // Try different URL patterns
        if (pathParts.includes('character')) {
          // Format: /character/obDHmmtRdhNMkF9a7/New-Character
          const characterIndex = pathParts.indexOf('character');
          if (characterIndex + 1 < pathParts.length) {
            characterId = pathParts[characterIndex + 1];
          }
        } else {
          // Fallback: assume last part is the ID
          characterId = pathParts[pathParts.length - 1];
        }

        console.log('🔍 [DiceCloud Structure] Extracted character ID:', characterId);

        if (characterId && characterId !== 'New-Character') {
          try {
            // Fetch current character data
            const response = await fetch(`https://dicecloud.com/api/creature/${characterId}`, {
              headers: {
                'Authorization': `Bearer ${localStorage.getItem('Meteor.loginToken')}`
              }
            });

            if (response.ok) {
              const data = await response.json();
              const properties = data.creatureProperties || [];

              console.log(`🔍 [DiceCloud Structure] Total properties: ${properties.length}`);

              // Build property map for quick lookup
              const propertyMap = new Map();
              properties.forEach(p => {
                if (p._id) {
                  propertyMap.set(p._id, p);
                }
              });

              // Build hierarchical structure with children
              const buildHierarchy = (propId, visited = new Set()) => {
                if (visited.has(propId)) return { _circular: true };
                visited.add(propId);

                const prop = propertyMap.get(propId);
                if (!prop) return null;

                // Create a copy of the property with all its data
                const propCopy = { ...prop };

                // Find all children of this property
                const children = properties.filter(p => p.parent && p.parent.id === propId);
                if (children.length > 0) {
                  propCopy.children = children.map(child => buildHierarchy(child._id, new Set(visited)));
                }

                return propCopy;
              };

              // Find root properties (no parent or parent doesn't exist)
              const rootProperties = properties.filter(p => !p.parent || !p.parent.id || !propertyMap.has(p.parent.id));

              // Build complete hierarchical structure
              const hierarchicalStructure = rootProperties.map(root => buildHierarchy(root._id));

              // Create export data
              const exportData = {
                characterId: characterId,
                exportDate: new Date().toISOString(),
                totalProperties: properties.length,
                propertyTypes: Object.entries(
                  properties.reduce((acc, p) => {
                    const type = p.type || 'unknown';
                    acc[type] = (acc[type] || 0) + 1;
                    return acc;
                  }, {})
                ).map(([type, count]) => ({ type, count })),
                properties: hierarchicalStructure,
                allPropertiesFlat: properties
              };

              // Create JSON blob
              const jsonString = JSON.stringify(exportData, null, 2);
              const blob = new Blob([jsonString], { type: 'application/json' });
              const url = URL.createObjectURL(blob);

              // Create download link
              const downloadLink = document.createElement('a');
              downloadLink.href = url;
              downloadLink.download = `dicecloud-structure-${characterId}-${new Date().toISOString().split('T')[0]}.json`;
              document.body.appendChild(downloadLink);
              downloadLink.click();
              document.body.removeChild(downloadLink);

              // Clean up
              URL.revokeObjectURL(url);

              console.log('🔍 [DiceCloud Structure] JSON file generated and download initiated');
              alert(`Structure exported!\n\nFound ${properties.length} total properties\n\nProperty types: ${exportData.propertyTypes.map(t => `${t.type}: ${t.count}`).join(', ')}\n\nJSON file will download shortly.`);
            } else {
              console.error('🔍 [DiceCloud Structure] Failed to fetch character data:', response.status);
              alert('Failed to fetch character data. Make sure you\'re logged in.');
            }
          } catch (error) {
            console.error('🔍 [DiceCloud Structure] Error checking structure:', error);
            alert('Error fetching structure. Check console for details.');
          }
        } else {
          console.error('🔍 [DiceCloud Structure] Could not extract valid character ID from URL');
          alert('Could not extract character ID from URL. Make sure you\'re on a character page.');
        }
      });

      document.body.appendChild(debugButton);
      debug.log('🔍 Check Structure button added');
    }
  }

  /**
   * Listens for messages from popup and other parts of the extension
   */
  browserAPI.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
    debug.log('DiceCloud received message:', request);

    switch (request.action) {
      case 'syncCharacter':
        syncCharacterData(request.slotId)
          .then(() => {
            sendResponse({ success: true });
          })
          .catch((error) => {
            debug.error('Error syncing character:', error);
            sendResponse({ success: false, error: error.message });
          });
        return true; // Keep channel open for async response

      case 'rollInDiceCloud':
        // Handle roll request from Roll20 character sheet
        handleRollRequest(request.roll.name, request.roll.formula)
          .then(() => {
            debug.log('✅ Roll handled in Dice Cloud');
            sendResponse({ success: true });
          })
          .catch((error) => {
            debug.error('❌ Failed to handle roll in Dice Cloud:', error);
            sendResponse({ success: false, error: error.message });
          });
        return true;

      case 'extractCharacter':
        extractCharacterData()
          .then((data) => {
            sendResponse({ success: true, data });
          })
          .catch((error) => {
            debug.error('Error extracting character:', error);
            sendResponse({ success: false, error: error.message });
          });
        return true;

      case 'discordLink':
        // Handle Discord linking from bot
        handleDiscordLink(request.dicecloudUserId, request.discordInfo)
          .then(() => {
            sendResponse({ success: true });
          })
          .catch((error) => {
            debug.error('Error handling Discord link:', error);
            sendResponse({ success: false, error: error.message });
          });
        return true;

      case 'showSyncButton':
        // Show the sync button
        const syncButton = document.getElementById('dc-sync-btn');
        if (syncButton) {
          syncButton.style.display = '';
          sessionStorage.removeItem('dc-sync-btn_hidden');
          localStorage.removeItem('dc-sync-btn_hidden'); // Also clear old localStorage value if it exists
          showNotification('Sync button shown', 'success');
          sendResponse({ success: true });
        } else {
          sendResponse({ success: false, error: 'Sync button not found' });
        }
        return true;

      case 'showLoginHint':
        // Show a login hint on the DiceCloud page
        try {
          // Create a simple overlay to guide the user
          const hintOverlay = document.createElement('div');
          hintOverlay.id = 'rollcloud-login-hint';
          hintOverlay.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #FC57F9;
            color: white;
            padding: 15px 20px;
            border-radius: 8px;
            font-family: Arial, sans-serif;
            font-size: 14px;
            z-index: 10000;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            max-width: 300px;
          `;
          hintOverlay.innerHTML = `
            <div style="display: flex; align-items: center; margin-bottom: 8px;">
              <span style="font-size: 18px; margin-right: 8px;">🎲</span>
              <strong>RollCloud Extension</strong>
            </div>
            <div>Please log in to DiceCloud (Google Sign-In or username/password), then click the "Connect with DiceCloud" button again.</div>
            <button onclick="this.parentElement.remove()" style="
              margin-top: 10px;
              background: white;
              color: #FC57F9;
              border: none;
              padding: 5px 10px;
              border-radius: 4px;
              cursor: pointer;
            ">Got it</button>
          `;
          
          // Remove any existing hint
          const existingHint = document.getElementById('rollcloud-login-hint');
          if (existingHint) {
            existingHint.remove();
          }
          
          document.body.appendChild(hintOverlay);
          
          // Auto-remove after 10 seconds
          setTimeout(() => {
            if (hintOverlay.parentElement) {
              hintOverlay.remove();
            }
          }, 10000);
          
          sendResponse({ success: true });
        } catch (error) {
          debug.error('Error showing login hint:', error);
          sendResponse({ success: false, error: error.message });
        }
        return true;

      case 'extractAuthToken':
        // Extract authentication token from DiceCloud session
        try {
          // Try to get token from localStorage (Meteor.loginToken)
          // Use page context access for Opera compatibility
          const localStorageData = await getPageLocalStorage();
          const loginToken = localStorageData['Meteor.loginToken'];
          const loginTokenExpires = localStorageData['Meteor.loginTokenExpires'];
          const userId = localStorageData['Meteor.userId'];

          if (loginToken && userId) {
            debug.log('✅ Found auth token in localStorage');

            // Separate auth ID (for database) from display username (for UI)
            const authId = userId; // Meteor user ID for authentication/database
            
            // Try to extract display username (for user recognition)
            let displayUsername = 'DiceCloud User';
            
            // Method 1: Check if Meteor.user() is available
            try {
              debug.log('🔍 Checking for Meteor.user()...');
              if (typeof window.Meteor !== 'undefined' && window.Meteor.user) {
                debug.log('✅ Meteor object available:', typeof window.Meteor);
                const meteorUser = window.Meteor.user();
                debug.log('📦 Meteor.user() result:', meteorUser);
                
                if (meteorUser) {
                  displayUsername = meteorUser.username || 
                                    meteorUser.emails?.[0]?.address ||
                                    meteorUser.profile?.username ||
                                    meteorUser.profile?.name ||
                                    meteorUser.services?.google?.email ||
                                    meteorUser.services?.facebook?.email ||
                                    'DiceCloud User';
                  debug.log('✅ Found display username via Meteor.user():', displayUsername);
                } else {
                  debug.log('❌ Meteor.user() returned null/undefined');
                }
              } else {
                debug.log('❌ Meteor.user() not available. window.Meteor:', typeof window.Meteor);
                debug.log('🔍 Available window properties:', Object.keys(window).filter(k => k.toLowerCase().includes('meteor')).slice(0, 10));
              }
            } catch (e) {
              debug.log('⚠️ Meteor.user() error:', e.message);
            }
            
            // Method 2: Check localStorage for user data
            if (displayUsername === 'DiceCloud User') {
              try {
                debug.log('🔍 Checking localStorage for user data...');
                // Get all localStorage keys from page context
                const allLocalStorageData = await getAllPageLocalStorage();
                const allKeys = Object.keys(allLocalStorageData);
                debug.log('📋 All localStorage keys:', allKeys);

                const meteorUserKeys = allKeys.filter(key =>
                  (key.includes('Meteor.user') || key.includes('user') || key.includes('User')) &&
                  !key.includes('Meteor.userId') &&
                  !key.includes('Meteor.loginToken')
                );

                debug.log('🔍 Found user-related localStorage keys:', meteorUserKeys);

                for (const meteorUserKey of meteorUserKeys) {
                  try {
                    const userData = allLocalStorageData[meteorUserKey];
                    debug.log(`📦 Raw data from key "${meteorUserKey}":`, userData?.substring(0, 200));
                    
                    if (userData) {
                      let parsed;
                      try {
                        parsed = JSON.parse(userData);
                        debug.log(`📦 Parsed data from key "${meteorUserKey}":`, parsed);
                      } catch (parseError) {
                        debug.log(`⚠️ Key "${meteorUserKey}" is not JSON, trying raw value`);
                        // Try raw string if not JSON
                        if (userData.length > 2 && userData !== 'Chepi' && !userData.match(/^[a-zA-Z0-9]{10,}$/)) {
                          displayUsername = userData.trim();
                          debug.log(`✅ Found display username from localStorage key "${meteorUserKey}":`, displayUsername);
                          break;
                        }
                        continue;
                      }
                      
                      displayUsername = parsed.username || 
                                        parsed.emails?.[0]?.address ||
                                        parsed.profile?.username ||
                                        parsed.profile?.name ||
                                        parsed.name ||
                                        parsed.email ||
                                        'DiceCloud User';
                      if (displayUsername !== 'DiceCloud User') {
                        debug.log('✅ Found display username in localStorage:', displayUsername);
                        break;
                      }
                    }
                  } catch (keyError) {
                    debug.log(`⚠️ Error processing key "${meteorUserKey}":`, keyError.message);
                  }
                }
                
                if (meteorUserKeys.length === 0) {
                  debug.log('ℹ️ No additional user data keys found in localStorage (only Meteor.userId and tokens)');
                }
              } catch (e) {
                debug.log('⚠️ Failed to check localStorage user data:', e.message);
              }
            }
            
            // Method 3: Try window objects
            if (displayUsername === 'DiceCloud User') {
              try {
                const possibleUserObjects = [
                  window.currentUser, window.user, window.app?.currentUser,
                  window.app?.user, window.$root?.currentUser, window.$root?.user
                ];
                
                for (const userObj of possibleUserObjects) {
                  if (userObj) {
                    const candidateUsername = userObj.username || userObj.email || userObj.name;
                    if (candidateUsername && candidateUsername !== 'Chepi') {
                      displayUsername = candidateUsername;
                      debug.log('✅ Found display username in window object:', displayUsername);
                      break;
                    }
                  }
                }
              } catch (e) {
                debug.log('⚠️ Failed to check window objects:', e.message);
              }
            }
            
            // Method 4: DOM extraction as last resort
            if (displayUsername === 'DiceCloud User') {
              const possibleElements = [
                '.user-menu .username', '.user-info .username', '.navbar .user-display-name',
                'header .user-name', '.profile .name', '.avatar + span', '.user-avatar + *'
              ];
              
              for (const selector of possibleElements) {
                const el = document.querySelector(selector);
                if (el && el.textContent && el.textContent.trim()) {
                  const candidate = el.textContent.trim();
                  if (candidate !== 'Chepi' && candidate.length > 2 && !candidate.match(/^[A-Z][a-z]+$/)) {
                    displayUsername = candidate;
                    debug.log(`✅ Found display username with selector "${selector}":`, displayUsername);
                    break;
                  }
                }
              }
            }
            
            debug.log('✅ Auth ID for database:', authId);
            debug.log('✅ Display username for UI:', displayUsername);

            const responseData = {
              success: true,
              token: loginToken,
              userId: userId,
              tokenExpires: loginTokenExpires,
              username: displayUsername, // Display username for UI
              authId: authId // Auth ID for database storage
            };

            debug.log('📤 About to send response:', responseData);
            // Return directly for Firefox async listener compatibility
            return responseData;
          } else {
            debug.warn('⚠️ No auth token found - user may not be logged in');
            // Return directly for Firefox async listener compatibility
            return {
              success: false,
              error: 'Not logged in to DiceCloud. Please log in first.'
            };
          }
        } catch (error) {
          debug.error('❌ Error extracting auth token:', error);
          // Return directly for Firefox async listener compatibility
          return {
            success: false,
            error: 'Failed to extract token: ' + error.message
          };
        }

      default:
        debug.warn('Unknown action:', request.action);
        sendResponse({ success: false, error: 'Unknown action' });
    }
  });

  /**
   * Debug: Analyzes the page structure to find roll-related elements
   */
  function debugPageStructure() {
    debug.log('=== DICECLOUD ROLL LOG DEBUG ===');

    // Find all elements that might be the roll log
    const potentialSelectors = [
      '.dice-stream',
      '[class*="dice"]',
      '[class*="roll"]',
      '[class*="log"]',
      '[class*="sidebar"]',
      '[class*="right"]',
      'aside',
      '[role="complementary"]'
    ];

    debug.log('Searching for roll log container...');
    potentialSelectors.forEach(selector => {
      const elements = document.querySelectorAll(selector);
      if (elements.length > 0) {
        debug.log(`Found ${elements.length} element(s) matching "${selector}":`);
        elements.forEach((el, i) => {
          debug.log(`  [${i}] Classes:`, el.className);
          debug.log(`  [${i}] ID:`, el.id);
          debug.log(`  [${i}] Tag:`, el.tagName);
          debug.log(`  [${i}] Text preview:`, el.textContent && el.textContent.substring(0, 100));
        });
      }
    });

    // Look for elements containing dice notation patterns
    debug.log('\nSearching for elements with dice notation (e.g., "1d20 [ 6 ]", "2d6+3")...');
    const allElements = document.querySelectorAll('*');
    const dicePattern = /\d+d\d+\s*\[/i; // DiceCloud format: 1d20 [ 6 ]
    const elementsWithDice = [];

    allElements.forEach(el => {
      const text = el.textContent || '';
      if (text.match(dicePattern)) {
        elementsWithDice.push({
          tag: el.tagName,
          classes: el.className,
          id: el.id,
          text: text.substring(0, 100),
          parent: el.parentElement && el.parentElement.className,
          childCount: el.children.length,
          element: el // Store reference for inspection
        });
      }
    });

    if (elementsWithDice.length > 0) {
      debug.log(`Found ${elementsWithDice.length} elements with dice notation:`);
      debug.table(elementsWithDice.slice(0, 20));
      debug.log('\n📋 Full element details (expand to inspect):');
      elementsWithDice.slice(0, 5).forEach((item, i) => {
        debug.log(`\n[${i}] Element:`, item.element);
        debug.log(`[${i}] Full text (first 200 chars):\n`, item.element.textContent.substring(0, 200));
        debug.log(`[${i}] Parent chain:`, getParentChain(item.element));
      });
    } else {
      debug.log('❌ No elements with dice notation found!');
      debug.log('This might mean:');
      debug.log('1. No rolls have been made yet - try making a roll');
      debug.log('2. Rolls appear in a different format');
      debug.log('3. Rolls are in a shadow DOM or iframe');
    }

    // Helper to show parent chain
    function getParentChain(el) {
      const chain = [];
      let current = el;
      for (let i = 0; i < 5 && current; i++) {
        chain.push({
          tag: current.tagName,
          class: current.className,
          id: current.id
        });
        current = current.parentElement;
      }
      return chain;
    }

    debug.log('\n=== END DEBUG ===');
    debug.log('Instructions:');
    debug.log('1. Make a test roll in DiceCloud');
    debug.log('2. Run debugPageStructure() again to see the new elements');
    debug.log('3. Right-click on the roll in the page and select "Inspect" to see its HTML structure');
  }

  /**
   * Observes the DiceCloud roll log and sends rolls to Roll20
   */
  function observeRollLog() {
    // Find the roll log container - DiceCloud uses .card-raised-background
    const findRollLog = () => {
      // DiceCloud v2+ roll log structure
      const selectors = [
        '.card-raised-background', // Primary roll log container
        '.character-log',          // Alternative log container
        '[class*="log"]'           // Fallback
      ];

      for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (element) {
          debug.log('✓ Roll log detection: Found roll log using selector:', selector);
          debug.log('Roll log element:', element);
          return element;
        }
      }
      return null;
    };

    const rollLog = findRollLog();
    if (!rollLog) {
      debug.log('⏳ Roll log not found, will retry in 2 seconds...');
      debug.log('💡 Run window.debugDiceCloudRolls() in console for detailed debug info');
      setTimeout(observeRollLog, 2000);
      return;
    }

    debug.log('✅ Observing DiceCloud roll log for new rolls');
    debug.log('📋 Roll log classes:', rollLog.className);
    debug.log('🎲 Ready to detect rolls!');

    // Track when we start observing to ignore existing nodes
    const observerStartTime = Date.now();

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            // Check if this is a log-entry (individual roll)
            if (node.className && node.className.includes('log-entry')) {
              // Only process rolls that were added after we started observing
              // This prevents processing existing rolls on page load/reload
              const nodeTimestamp = node.getAttribute('data-timestamp') || 
                                 node.querySelector('[data-timestamp]')?.getAttribute('data-timestamp');
              
              // Only process if we can find a valid timestamp
              if (nodeTimestamp && parseInt(nodeTimestamp) > observerStartTime) {
                debug.log('🎲 New roll detected:', node);

                // Try to parse the roll from the added node
                const rollData = parseRollFromElement(node);
                if (rollData) {
                  debug.log('✅ Successfully parsed roll:', rollData);
                  sendRollToRoll20(rollData);
                } else {
                  debug.log('⚠️  Could not parse roll data from element');
                }
              } else if (!nodeTimestamp) {
                debug.log('🔄 Ignoring node without timestamp (likely existing content)');
              } else {
                debug.log('🔄 Ignoring existing roll entry (added before observer started)');
              }
            }
          }
        });
      });
    });

    observer.observe(rollLog, {
      childList: true,
      subtree: true
    });

    debug.log('💡 TIP: Make a test roll to see if it gets detected');
  }

  // Expose debug function globally for console access
  window.debugDiceCloudRolls = debugPageStructure;

  /**
   * Parses roll data from a DOM element
   * DiceCloud v2 format:
   * <div class="log-entry">
   *   <h4 class="content-name">Strength check</h4>
   *   <div class="content-value"><p>1d20 [ 6 ] + 0 = <strong>6</strong></p></div>
   * </div>
   */
  function parseRollFromElement(element) {
    try {
      // Extract roll name from the text content
      const fullText = element.textContent || element.innerText || '';
      debug.log('🔍 Full roll text:', fullText);
      
      // Extract the roll name (first line before the formula)
      const lines = fullText.split('\n').filter(line => line.trim());
      const name = lines[0]?.trim() || 'Unknown Roll';
      
      // Find the formula line (contains dice notation)
      const formulaLine = lines.find(line => line.includes('d20') || line.includes('d6') || line.includes('d8') || line.includes('d10') || line.includes('d12') || line.includes('d4'));
      
      if (!formulaLine) {
        debug.log('⚠️  No dice formula found in roll text');
        return null;
      }

      debug.log('📊 Formula line:', formulaLine);

      // Parse DiceCloud format: "Strength check\n1d20 [ 17 ] + 0 = 17"
      // Extract the formula and result
      const formulaMatch = formulaLine.match(/^(.+?)\s*=\s*(.+)$/);

      if (!formulaMatch) {
        debug.log('⚠️  Could not parse formula from:', formulaLine);
        return null;
      }

      // Extract the base d20 roll from brackets BEFORE removing them
      // DiceCloud format: "1d20 [ 17 ] + 0" where 17 is the actual d20 roll
      const baseRollMatch = formulaMatch[1].match(/\[\s*(\d+)\s*\]/);
      const baseRoll = baseRollMatch ? baseRollMatch[1] : null;

      // Clean up the formula - remove the [ actual roll ] part for Roll20
      // "1d20 [ 17 ] + 0" -> "1d20+0"
      let formula = formulaMatch[1].replace(/\s*\[\s*\d+\s*\]\s*/g, '').trim();

      // Remove extra spaces
      formula = formula.replace(/\s+/g, '');

      const result = formulaMatch[2].trim();

      debug.log(`📊 Parsed: name="${name}", formula="${formula}", result="${result}", baseRoll="${baseRoll}"`);

      return {
        name: name,
        formula: formula,
        result: result,
        baseRoll: baseRoll, // The actual die roll (e.g., "17" from "1d20 [ 17 ]")
        timestamp: Date.now()
      };
    } catch (error) {
      debug.error('❌ Error parsing roll element:', error);
      return null;
    }
  }

  /**
   * Draggable Element System
   */
  const dragState = {
    positions: {},
    isDragging: false,
    currentElement: null,
    startX: 0,
    startY: 0,
    elementX: 0,
    elementY: 0
  };

  // Load saved positions from storage (Promise-based for Chrome compatibility)
  browserAPI.storage.local.get(['panelPositions']).then((result) => {
    if (result.panelPositions) {
      dragState.positions = result.panelPositions;
    }
  }).catch((error) => {
    debug.error('Failed to load panel positions:', error);
  });

  function savePositions() {
    browserAPI.storage.local.set({ panelPositions: dragState.positions });
  }

  function makeDraggable(element, handleSelector) {
    const elementId = element.id;
    let hasMoved = false;
    let clickTimeout = null;

    // Restore saved position
    if (dragState.positions[elementId]) {
      const pos = dragState.positions[elementId];
      element.style.left = pos.x + 'px';
      element.style.top = pos.y + 'px';
      element.style.right = 'auto';
      element.style.bottom = 'auto';
    }

    const handle = handleSelector ? element.querySelector(handleSelector) : element;
    if (!handle) return;

    handle.addEventListener('mousedown', (e) => {
      // Don't drag if clicking toggle button
      if (e.target.classList.contains('history-toggle') ||
          e.target.classList.contains('stats-toggle') ||
          e.target.classList.contains('settings-toggle')) {
        return;
      }

      hasMoved = false;
      dragState.isDragging = false;
      dragState.currentElement = element;
      dragState.startX = e.clientX;
      dragState.startY = e.clientY;

      // Get current position
      const rect = element.getBoundingClientRect();
      dragState.elementX = rect.left;
      dragState.elementY = rect.top;

      // Wait a bit before starting drag (prevents accidental drags on click)
      clickTimeout = setTimeout(() => {
        if (dragState.currentElement === element) {
          dragState.isDragging = true;
          element.style.transition = 'none';
          element.style.opacity = '0.8';
          handle.style.cursor = 'grabbing';
        }
      }, 100);

      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (dragState.currentElement !== element) return;

      const dx = e.clientX - dragState.startX;
      const dy = e.clientY - dragState.startY;

      // Check if we've moved enough to count as dragging
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
        hasMoved = true;

        if (dragState.isDragging) {
          const newX = dragState.elementX + dx;
          const newY = dragState.elementY + dy;

          // Use requestAnimationFrame to batch layout reads and style writes
          requestAnimationFrame(() => {
            // Keep element on screen - batch layout reads
            const maxX = window.innerWidth - element.offsetWidth;
            const maxY = window.innerHeight - element.offsetHeight;

            const clampedX = Math.max(0, Math.min(newX, maxX));
            const clampedY = Math.max(0, Math.min(newY, maxY));

            // Batch style writes
            element.style.left = clampedX + 'px';
            element.style.top = clampedY + 'px';
            element.style.right = 'auto';
          });
          element.style.bottom = 'auto';
        }
      }

      e.preventDefault();
    });

    document.addEventListener('mouseup', (e) => {
      if (dragState.currentElement !== element) return;

      clearTimeout(clickTimeout);

      const wasDragging = dragState.isDragging && hasMoved;

      dragState.isDragging = false;
      dragState.currentElement = null;

      // Read layout before writing styles to avoid forced reflow
      let positionToSave = null;
      if (wasDragging) {
        const rect = element.getBoundingClientRect();
        positionToSave = {
          x: rect.left,
          y: rect.top
        };
      }

      // Now safe to write styles
      element.style.transition = '';
      element.style.opacity = '1';
      handle.style.cursor = 'move';

      // Save position if we actually dragged
      if (positionToSave) {
        dragState.positions[elementId] = positionToSave;
        savePositions();
      }
    });
  }

  /**
   * Roll Statistics and History Tracking
   */
  const rollStats = {
    history: [],
    settings: {
      enabled: true,
      showNotifications: true,
      showHistory: true,
      maxHistorySize: 20,
      advantageMode: 'normal' // 'normal', 'advantage', 'disadvantage'
    },
    stats: {
      totalRolls: 0,
      averageRoll: 0,
      highestRoll: 0,
      lowestRoll: Infinity,
      criticalSuccesses: 0,
      criticalFailures: 0
    }
  };

  // Load settings from storage (Promise-based for Chrome compatibility)
  browserAPI.storage.local.get(['rollSettings']).then((result) => {
    if (result.rollSettings) {
      Object.assign(rollStats.settings, result.rollSettings);
    }
    // Update settings panel if it exists
    updateSettingsPanel();
  }).catch((error) => {
    debug.error('Failed to load roll settings:', error);
    // Update settings panel even if loading failed
    updateSettingsPanel();
  });

  function saveSettings() {
    browserAPI.storage.local.set({ rollSettings: rollStats.settings });
  }

  function detectAdvantageDisadvantage(rollData) {
    const name = rollData.name.toLowerCase();
    if (name.includes('advantage') || name.includes('adv')) {
      return 'advantage';
    } else if (name.includes('disadvantage') || name.includes('dis')) {
      return 'disadvantage';
    }
    return 'normal';
  }

  function detectCritical(rollData) {
    const result = parseInt(rollData.result);
    const formula = rollData.formula.toLowerCase();

    // Check for d20 rolls
    if (formula.includes('d20') || formula.includes('1d20')) {
      if (result === 20) return 'critical-success';
      if (result === 1) return 'critical-failure';
    }
    return null;
  }

  function updateRollStatistics(rollData) {
    const result = parseInt(rollData.result);
    if (isNaN(result)) return;

    rollStats.stats.totalRolls++;
    rollStats.stats.highestRoll = Math.max(rollStats.stats.highestRoll, result);
    rollStats.stats.lowestRoll = Math.min(rollStats.stats.lowestRoll, result);

    // Update average (running average)
    rollStats.stats.averageRoll =
      (rollStats.stats.averageRoll * (rollStats.stats.totalRolls - 1) + result) /
      rollStats.stats.totalRolls;

    const critical = detectCritical(rollData);
    if (critical === 'critical-success') rollStats.stats.criticalSuccesses++;
    if (critical === 'critical-failure') rollStats.stats.criticalFailures++;
  }

  function addToRollHistory(rollData) {
    const advantageType = detectAdvantageDisadvantage(rollData);
    const criticalType = detectCritical(rollData);

    rollStats.history.unshift({
      ...rollData,
      advantageType,
      criticalType,
      timestamp: Date.now()
    });

    // Trim history
    if (rollStats.history.length > rollStats.settings.maxHistorySize) {
      rollStats.history = rollStats.history.slice(0, rollStats.settings.maxHistorySize);
    }

    updateRollStatistics(rollData);
    updateRollHistoryPanel();
    updateStatsPanel();
  }

  /**
   * Animated Roll Notification
   */
  function showRollNotification(rollData) {
    if (!rollStats.settings.showNotifications) return;

    const critical = detectCritical(rollData);
    const advantage = detectAdvantageDisadvantage(rollData);

    let bgGradient = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
    let icon = '🎲';

    if (critical === 'critical-success') {
      bgGradient = 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)';
      icon = '⭐';
    } else if (critical === 'critical-failure') {
      bgGradient = 'linear-gradient(135deg, #4e54c8 0%, #8f94fb 100%)';
      icon = '💀';
    }

    const notification = document.createElement('div');
    notification.className = 'dc-roll-notification';
    notification.innerHTML = `
      <div class="notification-icon">${icon}</div>
      <div class="notification-content">
        <div class="notification-title">${rollData.name}</div>
        <div class="notification-formula">${rollData.formula} = <strong>${rollData.result}</strong></div>
        <div class="notification-status">
          ${critical ? `<span class="critical-badge">${critical.toUpperCase().replace('-', ' ')}</span>` : ''}
          ${advantage !== 'normal' ? `<span class="advantage-badge">${advantage.toUpperCase()}</span>` : ''}
          <span>Sent to Roll20! 🚀</span>
        </div>
      </div>
    `;

    notification.style.cssText = `
      position: fixed;
      top: 80px;
      right: -450px;
      background: ${bgGradient};
      color: white;
      padding: 20px;
      border-radius: 16px;
      box-shadow: 0 12px 32px rgba(0,0,0,0.4);
      z-index: 100001;
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      min-width: 350px;
      display: flex;
      align-items: center;
      gap: 16px;
      transition: right 0.5s cubic-bezier(0.68, -0.55, 0.265, 1.55);
      animation: pulse-glow 2s infinite;
    `;

    addNotificationStyles();
    document.body.appendChild(notification);

    // Slide in
    setTimeout(() => {
      notification.style.right = '20px';
    }, 10);

    // Slide out
    setTimeout(() => {
      notification.style.right = '-450px';
      notification.style.opacity = '0';
      setTimeout(() => notification.remove(), 500);
    }, 4000);
  }

  function addNotificationStyles() {
    if (document.querySelector('.dc-roll-notification-styles')) return;

    const style = document.createElement('style');
    style.className = 'dc-roll-notification-styles';
    style.textContent = `
      .dc-roll-notification .notification-icon {
        font-size: 40px;
        animation: roll-bounce 0.8s ease-in-out infinite alternate;
      }

      .dc-roll-notification .notification-title {
        font-weight: bold;
        font-size: 15px;
        margin-bottom: 6px;
        text-shadow: 0 2px 4px rgba(0,0,0,0.3);
      }

      .dc-roll-notification .notification-formula {
        font-size: 18px;
        font-weight: 600;
        margin-bottom: 8px;
        font-family: 'Courier New', monospace;
      }

      .dc-roll-notification .notification-status {
        font-size: 12px;
        opacity: 0.95;
        display: flex;
        gap: 8px;
        align-items: center;
        flex-wrap: wrap;
      }

      .dc-roll-notification .critical-badge,
      .dc-roll-notification .advantage-badge {
        background: rgba(255,255,255,0.3);
        padding: 3px 8px;
        border-radius: 12px;
        font-size: 10px;
        font-weight: bold;
        letter-spacing: 0.5px;
      }

      @keyframes roll-bounce {
        0% { transform: rotate(-5deg) scale(1); }
        100% { transform: rotate(5deg) scale(1.15); }
      }

      @keyframes pulse-glow {
        0%, 100% { box-shadow: 0 12px 32px rgba(0,0,0,0.4); }
        50% { box-shadow: 0 12px 48px rgba(255,255,255,0.3), 0 0 32px rgba(255,255,255,0.2); }
      }
    `;

    document.head.appendChild(style);
  }

  /**
   * Roll History Panel
   */
  function createRollHistoryPanel() {
    if (document.getElementById('dc-roll-history')) return;

    const panel = document.createElement('div');
    panel.id = 'dc-roll-history';
    panel.innerHTML = `
      <div class="history-header">
        <span class="history-title">🎲 Roll History</span>
        <button class="history-toggle">−</button>
      </div>
      <div class="history-content">
        <div class="history-list"></div>
      </div>
    `;

    panel.style.cssText = `
      position: fixed;
      bottom: 180px;
      right: 20px;
      background: rgba(20, 20, 30, 0.98);
      backdrop-filter: blur(12px);
      color: white;
      border-radius: 16px;
      box-shadow: 0 12px 32px rgba(0,0,0,0.5);
      z-index: 10000;
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      width: 380px;
      max-height: 500px;
      overflow: hidden;
      border: 1px solid rgba(255, 255, 255, 0.1);
      display: ${rollStats.settings.showHistory ? 'block' : 'none'};
    `;

    addHistoryStyles();
    document.body.appendChild(panel);

    // Make draggable
    makeDraggable(panel, '.history-header');

    // Toggle functionality
    let isCollapsed = false;
    panel.querySelector('.history-header').addEventListener('click', (e) => {
      // Only toggle if not dragging
      if (e.target === panel.querySelector('.history-toggle')) {
        const content = panel.querySelector('.history-content');
        const toggle = panel.querySelector('.history-toggle');

        if (isCollapsed) {
          content.style.display = 'block';
          toggle.textContent = '−';
        } else {
          content.style.display = 'none';
          toggle.textContent = '+';
        }

        isCollapsed = !isCollapsed;
      }
    });
  }

  function addHistoryStyles() {
    if (document.querySelector('.dc-roll-history-styles')) return;

    const style = document.createElement('style');
    style.className = 'dc-roll-history-styles';
    style.textContent = `
      #dc-roll-history .history-header {
        padding: 16px 20px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        display: flex;
        justify-content: space-between;
        align-items: center;
        cursor: pointer;
        border-radius: 16px 16px 0 0;
      }

      #dc-roll-history .history-title {
        font-weight: bold;
        font-size: 16px;
      }

      #dc-roll-history .history-toggle {
        background: rgba(255,255,255,0.2);
        border: none;
        color: white;
        font-size: 24px;
        cursor: pointer;
        padding: 0;
        width: 32px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 8px;
        transition: background 0.2s;
      }

      #dc-roll-history .history-toggle:hover {
        background: rgba(255,255,255,0.3);
      }

      #dc-roll-history .history-content {
        max-height: 440px;
        overflow-y: auto;
        padding: 12px;
      }

      #dc-roll-history .history-content::-webkit-scrollbar {
        width: 8px;
      }

      #dc-roll-history .history-content::-webkit-scrollbar-track {
        background: rgba(255, 255, 255, 0.05);
        border-radius: 4px;
      }

      #dc-roll-history .history-content::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.2);
        border-radius: 4px;
      }

      #dc-roll-history .history-item {
        background: linear-gradient(135deg, rgba(102, 126, 234, 0.1) 0%, rgba(118, 75, 162, 0.1) 100%);
        padding: 12px 14px;
        border-radius: 12px;
        margin-bottom: 8px;
        animation: slide-in-history 0.4s ease-out;
        border-left: 4px solid #667eea;
        transition: all 0.2s;
      }

      #dc-roll-history .history-item:hover {
        background: linear-gradient(135deg, rgba(102, 126, 234, 0.2) 0%, rgba(118, 75, 162, 0.2) 100%);
        transform: translateX(-4px);
      }

      #dc-roll-history .history-item.critical-success {
        border-left-color: #f5576c;
        background: linear-gradient(135deg, rgba(245, 87, 108, 0.2) 0%, rgba(240, 147, 251, 0.1) 100%);
      }

      #dc-roll-history .history-item.critical-failure {
        border-left-color: #4e54c8;
        background: linear-gradient(135deg, rgba(78, 84, 200, 0.2) 0%, rgba(143, 148, 251, 0.1) 100%);
      }

      #dc-roll-history .history-item-header {
        display: flex;
        justify-content: space-between;
        margin-bottom: 6px;
        align-items: center;
      }

      #dc-roll-history .history-name {
        font-weight: 600;
        font-size: 14px;
      }

      #dc-roll-history .history-time {
        font-size: 11px;
        opacity: 0.6;
      }

      #dc-roll-history .history-formula {
        font-size: 13px;
        opacity: 0.95;
        font-family: 'Courier New', monospace;
        margin-bottom: 4px;
      }

      #dc-roll-history .history-badges {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
      }

      #dc-roll-history .history-badge {
        background: rgba(255,255,255,0.15);
        padding: 2px 8px;
        border-radius: 10px;
        font-size: 10px;
        font-weight: bold;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      @keyframes slide-in-history {
        from {
          opacity: 0;
          transform: translateX(30px);
        }
        to {
          opacity: 1;
          transform: translateX(0);
        }
      }
    `;

    document.head.appendChild(style);
  }

  function updateRollHistoryPanel() {
    const panel = document.getElementById('dc-roll-history');
    if (!panel) return;

    const list = panel.querySelector('.history-list');
    if (!list) return;

    list.innerHTML = rollStats.history.map((roll, index) => {
      const timeAgo = getTimeAgo(roll.timestamp);
      const criticalClass = roll.criticalType ? roll.criticalType : '';

      let badges = '';
      if (roll.criticalType) {
        badges += `<span class="history-badge">${roll.criticalType.replace('-', ' ')}</span>`;
      }
      if (roll.advantageType && roll.advantageType !== 'normal') {
        badges += `<span class="history-badge">${roll.advantageType}</span>`;
      }

      return `
        <div class="history-item ${criticalClass}" style="animation-delay: ${index * 0.03}s">
          <div class="history-item-header">
            <span class="history-name">${roll.name}</span>
            <span class="history-time">${timeAgo}</span>
          </div>
          <div class="history-formula">${roll.formula} = <strong>${roll.result}</strong></div>
          ${badges ? `<div class="history-badges">${badges}</div>` : ''}
        </div>
      `;
    }).join('');
  }

  function getTimeAgo(timestamp) {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  }

  /**
   * Roll Statistics Panel
   */
  function createStatsPanel() {
    if (document.getElementById('dc-roll-stats')) return;

    const panel = document.createElement('div');
    panel.id = 'dc-roll-stats';
    panel.innerHTML = `
      <div class="stats-header">
        <span class="stats-title">📊 Statistics</span>
        <button class="stats-toggle">−</button>
      </div>
      <div class="stats-content">
        <div class="stat-item">
          <span class="stat-label">Total Rolls</span>
          <span class="stat-value" id="stat-total">0</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Average</span>
          <span class="stat-value" id="stat-average">0.0</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Highest</span>
          <span class="stat-value" id="stat-highest">0</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Lowest</span>
          <span class="stat-value" id="stat-lowest">∞</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">⭐ Critical Hits</span>
          <span class="stat-value" id="stat-crits">0</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">💀 Critical Fails</span>
          <span class="stat-value" id="stat-fails">0</span>
        </div>
      </div>
    `;

    panel.style.cssText = `
      position: fixed;
      bottom: 690px;
      right: 20px;
      background: rgba(20, 20, 30, 0.98);
      backdrop-filter: blur(12px);
      color: white;
      border-radius: 16px;
      box-shadow: 0 12px 32px rgba(0,0,0,0.5);
      z-index: 10000;
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      width: 380px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      display: ${rollStats.settings.showHistory ? 'block' : 'none'};
    `;

    addStatsStyles();
    document.body.appendChild(panel);

    // Make draggable
    makeDraggable(panel, '.stats-header');

    // Toggle functionality
    let isCollapsed = false;
    panel.querySelector('.stats-header').addEventListener('click', (e) => {
      // Only toggle if clicking the toggle button
      if (e.target === panel.querySelector('.stats-toggle')) {
        const content = panel.querySelector('.stats-content');
        const toggle = panel.querySelector('.stats-toggle');

        if (isCollapsed) {
          content.style.display = 'grid';
          toggle.textContent = '−';
        } else {
          content.style.display = 'none';
          toggle.textContent = '+';
        }

        isCollapsed = !isCollapsed;
      }
    });
  }

  function addStatsStyles() {
    if (document.querySelector('.dc-roll-stats-styles')) return;

    const style = document.createElement('style');
    style.className = 'dc-roll-stats-styles';
    style.textContent = `
      #dc-roll-stats .stats-header {
        padding: 16px 20px;
        background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
        display: flex;
        justify-content: space-between;
        align-items: center;
        cursor: pointer;
        border-radius: 16px 16px 0 0;
      }

      #dc-roll-stats .stats-title {
        font-weight: bold;
        font-size: 16px;
      }

      #dc-roll-stats .stats-toggle {
        background: rgba(255,255,255,0.2);
        border: none;
        color: white;
        font-size: 24px;
        cursor: pointer;
        padding: 0;
        width: 32px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 8px;
        transition: background 0.2s;
      }

      #dc-roll-stats .stats-toggle:hover {
        background: rgba(255,255,255,0.3);
      }

      #dc-roll-stats .stats-content {
        padding: 16px;
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
      }

      #dc-roll-stats .stat-item {
        background: rgba(255,255,255,0.05);
        padding: 12px;
        border-radius: 12px;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      #dc-roll-stats .stat-label {
        font-size: 12px;
        opacity: 0.7;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      #dc-roll-stats .stat-value {
        font-size: 24px;
        font-weight: bold;
        color: #667eea;
      }
    `;

    document.head.appendChild(style);
  }

  function updateStatsPanel() {
    // Check if stats panel exists before trying to update it
    const statsPanel = document.getElementById('dc-roll-stats');
    if (!statsPanel) return;

    const statTotal = document.getElementById('stat-total');
    const statAverage = document.getElementById('stat-average');
    const statHighest = document.getElementById('stat-highest');
    const statLowest = document.getElementById('stat-lowest');
    const statCrits = document.getElementById('stat-crits');
    const statFails = document.getElementById('stat-fails');

    if (statTotal) {
      statTotal.setAttribute('data-value', rollStats.stats.totalRolls);
      statTotal.textContent = rollStats.stats.totalRolls.toString();
    }
    if (statAverage) statAverage.textContent = rollStats.stats.averageRoll.toFixed(1);
    if (statHighest) statHighest.textContent = rollStats.stats.highestRoll.toString();
    if (statLowest) {
      statLowest.textContent = rollStats.stats.lowestRoll === Infinity ? '∞' : rollStats.stats.lowestRoll.toString();
    }
    if (statCrits) statCrits.textContent = rollStats.stats.criticalSuccesses.toString();
    if (statFails) statFails.textContent = rollStats.stats.criticalFailures.toString();
  }

  /**
   * Roll Settings Panel
   */
  function createSettingsPanel() {
    if (document.getElementById('dc-roll-settings')) return;

    const panel = document.createElement('div');
    panel.id = 'dc-roll-settings';
    panel.innerHTML = `
      <div class="settings-header">
        <span class="settings-title">⚙️ Roll Settings</span>
        <button class="settings-toggle">−</button>
      </div>
      <div class="settings-content">
        <div class="setting-group">
          <label class="setting-label">Roll Mode</label>
          <div class="toggle-buttons">
            <button class="toggle-btn ${rollStats.settings.advantageMode === 'normal' ? 'active' : ''}" data-mode="normal">
              Normal
            </button>
            <button class="toggle-btn ${rollStats.settings.advantageMode === 'advantage' ? 'active' : ''}" data-mode="advantage">
              Advantage
            </button>
            <button class="toggle-btn ${rollStats.settings.advantageMode === 'disadvantage' ? 'active' : ''}" data-mode="disadvantage">
              Disadvantage
            </button>
          </div>
          <div class="setting-description">
            <span id="mode-description">
              ${rollStats.settings.advantageMode === 'advantage' ? '🎲 Rolling with advantage (2d20kh1)' :
                rollStats.settings.advantageMode === 'disadvantage' ? '🎲 Rolling with disadvantage (2d20kl1)' :
                '🎲 Rolling normally (1d20)'}
            </span>
          </div>
        </div>
      </div>
    `;

    panel.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: rgba(20, 20, 30, 0.98);
      backdrop-filter: blur(12px);
      color: white;
      border-radius: 16px;
      box-shadow: 0 12px 32px rgba(0,0,0,0.5);
      z-index: 10001;
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      width: 380px;
      border: 1px solid rgba(255, 255, 255, 0.1);
    `;

    addSettingsStyles();
    document.body.appendChild(panel);

    // Make draggable
    makeDraggable(panel, '.settings-header');

    // Toggle functionality
    let isCollapsed = false;
    panel.querySelector('.settings-header').addEventListener('click', (e) => {
      if (e.target === panel.querySelector('.settings-toggle')) {
        const content = panel.querySelector('.settings-content');
        const toggle = panel.querySelector('.settings-toggle');

        if (isCollapsed) {
          content.style.display = 'block';
          toggle.textContent = '−';
        } else {
          content.style.display = 'none';
          toggle.textContent = '+';
        }

        isCollapsed = !isCollapsed;
      }
    });

    // Advantage/Disadvantage toggle buttons
    panel.querySelectorAll('.toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.getAttribute('data-mode');
        rollStats.settings.advantageMode = mode;

        // Update active state
        panel.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        // Update description
        const description = panel.querySelector('#mode-description');
        if (mode === 'advantage') {
          description.textContent = '🎲 Rolling with advantage (2d20kh1)';
        } else if (mode === 'disadvantage') {
          description.textContent = '🎲 Rolling with disadvantage (2d20kl1)';
        } else {
          description.textContent = '🎲 Rolling normally (1d20)';
        }

        // Save to storage
        browserAPI.storage.local.set({ rollSettings: rollStats.settings });
        debug.log('Roll mode changed to:', mode);
        showNotification(`Roll mode: ${mode.charAt(0).toUpperCase() + mode.slice(1)}`, 'info');
      });
    });
  }

  function addSettingsStyles() {
    if (document.querySelector('.dc-roll-settings-styles')) return;

    const style = document.createElement('style');
    style.className = 'dc-roll-settings-styles';
    style.textContent = `
      #dc-roll-settings .settings-header {
        padding: 16px 20px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        display: flex;
        justify-content: space-between;
        align-items: center;
        cursor: pointer;
        border-radius: 16px 16px 0 0;
      }

      #dc-roll-settings .settings-title {
        font-weight: bold;
        font-size: 16px;
      }

      #dc-roll-settings .settings-toggle {
        background: rgba(255,255,255,0.2);
        border: none;
        color: white;
        font-size: 24px;
        cursor: pointer;
        padding: 0;
        width: 32px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 8px;
        transition: background 0.2s;
      }

      #dc-roll-settings .settings-toggle:hover {
        background: rgba(255,255,255,0.3);
      }

      #dc-roll-settings .settings-content {
        padding: 20px;
      }

      #dc-roll-settings .setting-group {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      #dc-roll-settings .setting-label {
        font-size: 14px;
        font-weight: 600;
        opacity: 0.9;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      #dc-roll-settings .toggle-buttons {
        display: grid;
        grid-template-columns: 1fr 1fr 1fr;
        gap: 8px;
      }

      #dc-roll-settings .toggle-btn {
        background: rgba(255,255,255,0.08);
        border: 2px solid rgba(255,255,255,0.15);
        color: white;
        padding: 12px 16px;
        border-radius: 10px;
        cursor: pointer;
        font-size: 13px;
        font-weight: 600;
        transition: all 0.2s;
        text-align: center;
      }

      #dc-roll-settings .toggle-btn:hover {
        background: rgba(255,255,255,0.15);
        border-color: rgba(255,255,255,0.3);
        transform: translateY(-2px);
      }

      #dc-roll-settings .toggle-btn.active {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        border-color: #667eea;
        box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
      }

      #dc-roll-settings .setting-description {
        background: rgba(255,255,255,0.05);
        padding: 12px;
        border-radius: 8px;
        font-size: 12px;
        opacity: 0.8;
        text-align: center;
      }
    `;

    document.head.appendChild(style);
  }

  function updateSettingsPanel() {
    const panel = document.getElementById('dc-roll-settings');
    if (!panel) return;

    // Update active state on toggle buttons
    panel.querySelectorAll('.toggle-btn').forEach(btn => {
      const mode = btn.getAttribute('data-mode');
      if (mode === rollStats.settings.advantageMode) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    // Update description
    const description = panel.querySelector('#mode-description');
    if (description) {
      if (rollStats.settings.advantageMode === 'advantage') {
        description.textContent = '🎲 Rolling with advantage (2d20kh1)';
      } else if (rollStats.settings.advantageMode === 'disadvantage') {
        description.textContent = '🎲 Rolling with disadvantage (2d20kl1)';
      } else {
        description.textContent = '🎲 Rolling normally (1d20)';
      }
    }
  }

  /**
   * Transforms a roll formula based on advantage mode
   */
  function applyAdvantageMode(formula, mode) {
    if (mode === 'normal') return formula;

    // Transform d20 rolls to advantage/disadvantage
    // 1d20 -> 2d20kh1 (advantage) or 2d20kl1 (disadvantage)
    const d20Regex = /(\d*)d20\b/gi;

    return formula.replace(d20Regex, (match, count) => {
      const diceCount = count ? parseInt(count) : 1;

      if (mode === 'advantage') {
        // Roll twice as many dice, keep highest
        return `${diceCount * 2}d20kh${diceCount}`;
      } else if (mode === 'disadvantage') {
        // Roll twice as many dice, keep lowest
        return `${diceCount * 2}d20kl${diceCount}`;
      }

      return match;
    });
  }

  /**
   * Sends roll data to all Roll20 tabs with visual feedback
   */
  function sendRollToRoll20(rollData) {
    debug.log('🚀 sendRollToRoll20 called with:', rollData);
    
    if (!rollStats.settings.enabled) {
      debug.log('⚠️ Roll forwarding disabled in settings');
      return;
    }

    // Apply advantage/disadvantage to the formula
    const modifiedRoll = {
      ...rollData,
      formula: applyAdvantageMode(rollData.formula, rollStats.settings.advantageMode)
    };

    // Log if formula was modified
    if (modifiedRoll.formula !== rollData.formula) {
      debug.log(`Formula modified: ${rollData.formula} -> ${modifiedRoll.formula} (${rollStats.settings.advantageMode})`);
    }

    // Add visual feedback and tracking
    showRollNotification(modifiedRoll);
    addToRollHistory(modifiedRoll);

    // Send to Roll20
    debug.log('📡 Sending roll to Roll20...');
    try {
      browserAPI.runtime.sendMessage({
        action: 'sendRollToRoll20',
        roll: modifiedRoll
      }, (response) => {
        if (browserAPI.runtime.lastError) {
          debug.error('❌ Chrome runtime error:', browserAPI.runtime.lastError);
          showNotification('Roll20 not available. Is Roll20 open?', 'warning');
          return;
        }
        
        if (response && response.success) {
          debug.log('✅ Roll sent to Roll20:', response);
          showNotification(`${modifiedRoll.name} roll sent to Roll20! 🎲`, 'success');
        } else {
          debug.error('❌ Failed to send roll to Roll20:', response?.error);
          showNotification('Roll20 not available. Is Roll20 open?', 'warning');
        }
      });
    } catch (error) {
      debug.error('Extension context invalidated:', error);
      showNotification('Extension reloaded. Please refresh the page.', 'error');
    }
  }

  /**
   * Makes a button draggable and adds hide/show functionality
   */
  function makeSyncButtonDraggable(button, storageKey) {
    let isDragging = false;
    let startX, startY, initialLeft, initialTop;

    // Load saved position and validate it's within viewport
    const savedPosition = localStorage.getItem(`${storageKey}_position`);
    if (savedPosition) {
      try {
        const { left, top } = JSON.parse(savedPosition);
        const leftPx = parseInt(left);
        const topPx = parseInt(top);

        // Validate position is within reasonable bounds
        // Allow some negative values but not too far off screen
        const isValidPosition =
          !isNaN(leftPx) && !isNaN(topPx) &&
          leftPx >= -100 && leftPx <= window.innerWidth - 50 &&
          topPx >= -100 && topPx <= window.innerHeight - 50;

        if (isValidPosition) {
          button.style.left = left;
          button.style.top = top;
          button.style.bottom = 'auto';
        } else {
          // Invalid position, clear it and use default
          debug.log('🔄 Clearing invalid button position');
          localStorage.removeItem(`${storageKey}_position`);
        }
      } catch (e) {
        debug.error('Error parsing saved position:', e);
        localStorage.removeItem(`${storageKey}_position`);
      }
    }

    // Load saved visibility (sessionStorage instead of localStorage so button reappears on reload)
    const savedVisibility = sessionStorage.getItem(`${storageKey}_hidden`);
    if (savedVisibility === 'true') {
      button.style.display = 'none';
    }

    button.addEventListener('mousedown', (e) => {
      // Only start dragging on left click
      if (e.button === 0) {
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;

        // Batch layout read before style write to avoid forced reflow
        const rect = button.getBoundingClientRect();
        initialLeft = rect.left;
        initialTop = rect.top;

        // Defer style write to next frame
        requestAnimationFrame(() => {
          button.style.cursor = 'grabbing';
        });

        e.preventDefault();
      }
    });

    document.addEventListener('mousemove', (e) => {
      if (isDragging) {
        const deltaX = e.clientX - startX;
        const deltaY = e.clientY - startY;

        const newLeft = initialLeft + deltaX;
        const newTop = initialTop + deltaY;

        button.style.left = `${newLeft}px`;
        button.style.top = `${newTop}px`;
        button.style.bottom = 'auto';
      }
    });

    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        button.style.cursor = 'pointer';

        // Save position
        localStorage.setItem(`${storageKey}_position`, JSON.stringify({
          left: button.style.left,
          top: button.style.top
        }));
      }
    });

    // Right-click context menu
    button.addEventListener('contextmenu', (e) => {
      e.preventDefault();

      // Create context menu
      const existingMenu = document.getElementById('rollcloud-sync-context-menu');
      if (existingMenu) existingMenu.remove();

      const menu = document.createElement('div');
      menu.id = 'rollcloud-sync-context-menu';
      
      // Get adjusted position within viewport bounds
      const position = getPopupPosition(e.clientX, e.clientY, 200, 150);
      
      menu.style.cssText = `
        position: fixed;
        left: ${position.x}px;
        top: ${position.y}px;
        background: white;
        border: 1px solid #ccc;
        border-radius: 4px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.2);
        z-index: 100000;
        padding: 5px 0;
      `;

      const hideOption = document.createElement('div');
      hideOption.textContent = '🙈 Hide Button';
      hideOption.style.cssText = `
        padding: 8px 16px;
        cursor: pointer;
        font-size: 14px;
      `;
      hideOption.addEventListener('mouseenter', () => {
        hideOption.style.background = '#f0f0f0';
      });
      hideOption.addEventListener('mouseleave', () => {
        hideOption.style.background = 'white';
      });
      hideOption.addEventListener('click', () => {
        button.style.display = 'none';
        sessionStorage.setItem(`${storageKey}_hidden`, 'true');
        menu.remove();
        showNotification('Button hidden. Reload page to show it again.', 'info');
      });

      const resetOption = document.createElement('div');
      resetOption.textContent = '🔄 Reset Position';
      resetOption.style.cssText = `
        padding: 8px 16px;
        cursor: pointer;
        font-size: 14px;
        border-top: 1px solid #eee;
      `;
      resetOption.addEventListener('mouseenter', () => {
        resetOption.style.background = '#f0f0f0';
      });
      resetOption.addEventListener('mouseleave', () => {
        resetOption.style.background = 'white';
      });
      resetOption.addEventListener('click', () => {
        localStorage.removeItem(`${storageKey}_position`);
        button.style.left = '20px';
        button.style.top = 'auto';
        button.style.bottom = '20px';
        menu.remove();
        showNotification('Button position reset', 'success');
      });

      menu.appendChild(hideOption);
      menu.appendChild(resetOption);
      document.body.appendChild(menu);

      // Close menu when clicking outside
      setTimeout(() => {
        document.addEventListener('click', () => {
          menu.remove();
        }, { once: true });
      }, 0);
    });
  }

  /**
   * Creates and shows a slot selection modal on the DiceCloud page
   * @returns {Promise<string>} The selected slot ID
   */
  function showSlotSelectionModal() {
    return new Promise((resolve, reject) => {
      // Check if modal already exists
      let modal = document.getElementById('dc-slot-modal');
      if (modal) {
        modal.remove();
      }

      // Create modal overlay
      modal = document.createElement('div');
      modal.id = 'dc-slot-modal';
      modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.7);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 100000;
        backdrop-filter: blur(3px);
      `;

      // Create modal content
      const modalContent = document.createElement('div');
      modalContent.style.cssText = `
        background: #2a2a2a;
        padding: 30px;
        border-radius: 12px;
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
        max-width: 600px;
        max-height: 80vh;
        overflow-y: auto;
        color: #fff;
      `;

      // Create header
      const header = document.createElement('div');
      header.style.cssText = `
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 20px;
      `;

      const title = document.createElement('h2');
      title.textContent = '📦 Choose Character Slot';
      title.style.cssText = `
        margin: 0;
        font-size: 24px;
        color: #FC57F9;
      `;

      const closeBtn = document.createElement('button');
      closeBtn.textContent = '✕';
      closeBtn.style.cssText = `
        background: transparent;
        border: none;
        color: #fff;
        font-size: 28px;
        cursor: pointer;
        padding: 0;
        width: 32px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 4px;
        transition: background 0.2s;
      `;
      closeBtn.addEventListener('mouseenter', () => closeBtn.style.background = 'rgba(255, 255, 255, 0.1)');
      closeBtn.addEventListener('mouseleave', () => closeBtn.style.background = 'transparent');
      closeBtn.addEventListener('click', () => {
        modal.remove();
        reject(new Error('Slot selection cancelled'));
      });

      header.appendChild(title);
      header.appendChild(closeBtn);

      // Create help text
      const helpText = document.createElement('p');
      helpText.textContent = 'Select which slot to save this character to:';
      helpText.style.cssText = `
        margin: 0 0 20px 0;
        color: #aaa;
        font-size: 14px;
      `;

      // Create slot grid
      const slotGrid = document.createElement('div');
      slotGrid.style.cssText = `
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 12px;
      `;

      // Get existing character profiles
      browserAPI.runtime.sendMessage({ action: 'getAllCharacterProfiles' }, (response) => {
        const profiles = response?.success ? response.profiles : {};
        const MAX_SLOTS = 10;

        for (let i = 1; i <= MAX_SLOTS; i++) {
          const slotId = `slot-${i}`;
          const existingChar = profiles[slotId];

          const slotCard = document.createElement('div');
          slotCard.style.cssText = `
            background: ${existingChar ? '#3a3a3a' : '#252525'};
            border: 2px solid ${existingChar ? '#FC57F9' : '#404040'};
            border-radius: 8px;
            padding: 16px;
            cursor: pointer;
            transition: all 0.2s;
          `;

          slotCard.addEventListener('mouseenter', () => {
            slotCard.style.borderColor = '#FC57F9';
            slotCard.style.transform = 'translateY(-2px)';
            slotCard.style.boxShadow = '0 4px 12px rgba(78, 205, 196, 0.3)';
          });

          slotCard.addEventListener('mouseleave', () => {
            slotCard.style.borderColor = existingChar ? '#FC57F9' : '#404040';
            slotCard.style.transform = 'translateY(0)';
            slotCard.style.boxShadow = 'none';
          });

          slotCard.addEventListener('click', () => {
            modal.remove();
            resolve(slotId);
          });

          const slotHeader = document.createElement('div');
          slotHeader.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
          `;

          const slotNumber = document.createElement('span');
          slotNumber.textContent = `Slot ${i}`;
          slotNumber.style.cssText = `
            font-weight: bold;
            color: #fff;
            font-size: 14px;
          `;

          const slotBadge = document.createElement('span');
          slotBadge.textContent = existingChar ? 'Occupied' : 'Empty';
          slotBadge.style.cssText = `
            font-size: 11px;
            padding: 4px 8px;
            border-radius: 4px;
            background: ${existingChar ? 'rgba(78, 205, 196, 0.2)' : 'rgba(255, 255, 255, 0.1)'};
            color: ${existingChar ? '#FC57F9' : '#999'};
          `;

          slotHeader.appendChild(slotNumber);
          slotHeader.appendChild(slotBadge);

          const slotInfo = document.createElement('div');
          if (existingChar) {
            slotInfo.innerHTML = `
              <div style="font-weight: bold; margin-bottom: 4px; font-size: 16px;">${existingChar.name || 'Unknown'}</div>
              <div style="font-size: 13px; color: #999;">${existingChar.class || 'No Class'} ${existingChar.level || '?'} • ${existingChar.race || 'Unknown'}</div>
            `;
          } else {
            slotInfo.textContent = 'Click to save here';
            slotInfo.style.cssText = `
              color: #666;
              font-size: 13px;
              font-style: italic;
            `;
          }

          slotCard.appendChild(slotHeader);
          slotCard.appendChild(slotInfo);
          slotGrid.appendChild(slotCard);
        }
      });

      modalContent.appendChild(header);
      modalContent.appendChild(helpText);
      modalContent.appendChild(slotGrid);
      modal.appendChild(modalContent);
      document.body.appendChild(modal);

      // Close modal when clicking overlay
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          modal.remove();
          reject(new Error('Slot selection cancelled'));
        }
      });
    });
  }

  /**
   * Creates the sync button for character data
   */
  function addSyncButton() {
    // Check if button already exists
    if (document.getElementById('dc-sync-btn')) return;

    const button = document.createElement('button');
    button.id = 'dc-sync-btn';
    button.innerHTML = '🔄 Sync to RollCloud';
    button.style.cssText = `
      position: fixed;
      bottom: 20px;
      left: 20px;
      background: linear-gradient(135deg, #FC57F9 0%, #8E0682 100%);
      color: white;
      border: none;
      padding: 12px 20px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 14px;
      font-weight: bold;
      z-index: 10000;
      box-shadow: 0 4px 15px rgba(78, 205, 196, 0.2);
      transition: transform 0.2s, box-shadow 0.2s;
      user-select: none;
    `;

    button.addEventListener('mouseenter', () => {
      button.style.boxShadow = '0 6px 20px rgba(78, 205, 196, 0.3)';
    });

    button.addEventListener('mouseleave', () => {
      button.style.boxShadow = '0 4px 15px rgba(78, 205, 196, 0.2)';
    });

    button.addEventListener('click', async () => {
      try {
        // Show slot selection modal
        const slotId = await showSlotSelectionModal();
        // Sync with selected slot
        await syncCharacterData(slotId);
      } catch (error) {
        if (error.message !== 'Slot selection cancelled') {
          debug.error('❌ Error during sync:', error);
        }
      }
    });

    document.body.appendChild(button);

    // Make it draggable and add hide/show functionality
    makeSyncButtonDraggable(button, 'dc-sync-btn');

    debug.log('✅ Sync button added to Dice Cloud');
  }

  /**
   * Syncs character data to extension storage
   * @param {string} slotId - Optional slot ID to save character to (e.g., 'slot-1')
   * @returns {Promise<void>}
   */
  function syncCharacterData(slotId) {
    debug.log('🔄 Starting character data sync...', slotId ? `to ${slotId}` : '');

    const button = document.getElementById('dc-sync-btn');
    if (button) {
      button.innerHTML = '⏳ Syncing...';
      button.disabled = true;
    }

    // Return the promise chain
    return extractCharacterData()
      .then(characterData => {
        if (!characterData) {
          debug.error('❌ No character data found to sync');
          showNotification('No character data found. Make sure you have a character open.', 'error');
          if (button) {
            button.innerHTML = '🔄 Sync to RollCloud';
            button.disabled = false;
          }
          throw new Error('No character data found');
        }

        // Store in extension storage - wrap callback in Promise
        return new Promise((resolve, reject) => {
          const storeData = () => {
            browserAPI.runtime.sendMessage({
              action: 'storeCharacterData',
              data: characterData,
              slotId: slotId
            }, (response) => {
              if (browserAPI.runtime.lastError) {
                debug.error('❌ Extension context error:', browserAPI.runtime.lastError);
                debug.log('🔄 Background script not responding, trying direct storage...');
                
                // Fallback: store directly in storage
                browserAPI.storage.local.get(['characterProfiles'], (result) => {
                  if (browserAPI.runtime.lastError) {
                    debug.error('❌ Storage also failed:', browserAPI.runtime.lastError);
                    showNotification('Extension context error. Please refresh the page.', 'error');
                    if (button) {
                      button.innerHTML = '🔄 Sync to RollCloud';
                      button.disabled = false;
                    }
                    reject(new Error('Extension context error'));
                    return;
                  }
                  
                  const profiles = result.characterProfiles || {};
                  profiles[slotId] = characterData;
                  
                  browserAPI.storage.local.set({ characterProfiles: profiles }, () => {
                    if (browserAPI.runtime.lastError) {
                      debug.error('❌ Direct storage failed:', browserAPI.runtime.lastError);
                      showNotification('Storage error. Please refresh the page.', 'error');
                      if (button) {
                        button.innerHTML = '🔄 Sync to RollCloud';
                        button.disabled = false;
                      }
                      reject(new Error('Storage error'));
                    } else {
                      debug.log('✅ Character data synced via direct storage:', characterData.name);
                      showNotification(`✅ ${characterData.name} synced to RollCloud! 🎲`, 'success');
                      if (button) {
                        button.innerHTML = '✅ Synced!';
                        button.disabled = false;
                        setTimeout(() => {
                          button.innerHTML = '🔄 Sync to RollCloud';
                        }, 2000);
                      }
                      
                      // Notify popup to refresh its data
                      try {
                        browserAPI.runtime.sendMessage({
                          action: 'dataSynced',
                          slotId: slotId,
                          characterName: characterData.name
                        }, (response) => {
                          // Don't worry if this fails - the main sync already worked
                          if (browserAPI.runtime.lastError) {
                            debug.log('Popup notification failed (non-critical):', browserAPI.runtime.lastError);
                          } else {
                            debug.log('✅ Popup notified successfully');
                          }
                        });
                      } catch (notifyError) {
                        debug.log('Could not notify popup (non-critical):', notifyError);
                      }
                      
                      resolve();
                    }
                  });
                });
              } else {
                debug.log('✅ Character data synced to extension:', characterData.name);
                showNotification(`✅ ${characterData.name} synced to RollCloud! 🎲`, 'success');
                if (button) {
                  button.innerHTML = '✅ Synced!';
                  button.disabled = false;
                  setTimeout(() => {
                    button.innerHTML = '🔄 Sync to RollCloud';
                  }, 2000);
                }
                resolve();
              }
            });
          };
          
          storeData();
        });
      })
      .catch(error => {
        debug.error('❌ Error during character extraction:', error);

        // Check if this is a login error
        if (error.message && error.message.includes('Not logged in')) {
          showNotification('⚠️ Please login to DiceCloud first! Click the RollCloud extension icon to login.', 'error', 5000);
        } else if (error.message && error.message.includes('Extension reloaded')) {
          showNotification('Extension context error. Please refresh the page.', 'error');
        } else {
          showNotification('Failed to extract character data. Please try again.', 'error');
        }

        if (button) {
          button.innerHTML = '🔄 Sync to RollCloud';
          button.disabled = false;
        }

        // Re-throw to propagate error to caller
        throw error;
      });
  }

  /**
   * Handle Discord linking from bot - update Supabase with Discord information
   */
  async function handleDiscordLink(dicecloudUserId, discordInfo) {
    debug.log(`🔗 Handling Discord link for user: ${dicecloudUserId}`);
    debug.log(`👤 Discord info:`, discordInfo);

    try {
      // Get the current user's DiceCloud token
      const tokenResponse = await browserAPI.runtime.sendMessage({ action: 'getApiToken' });
      if (!tokenResponse.success || !tokenResponse.token) {
        throw new Error('Not logged in to DiceCloud');
      }

      // Use SupabaseTokenManager to update the auth_tokens table
      const { SupabaseTokenManager } = await import('./lib/supabase-client.js');
      const tokenManager = new SupabaseTokenManager();

      // Find the auth_tokens record to update
      const authRecords = await tokenManager.getAuthTokens(dicecloudUserId);
      if (!authRecords || authRecords.length === 0) {
        throw new Error('No auth_tokens record found for user');
      }

      // Update the record with Discord information
      const updateData = {
        discord_user_id: discordInfo.userId,
        discord_username: discordInfo.username,
        discord_global_name: discordInfo.globalName,
        updated_at: new Date().toISOString()
      };

      const success = await tokenManager.updateAuthTokens(dicecloudUserId, updateData);
      if (!success) {
        throw new Error('Failed to update auth_tokens with Discord info');
      }

      debug.log(`✅ Successfully updated Discord link for user: ${dicecloudUserId}`);
      showNotification('🔗 Discord account linked successfully!', 'success');

    } catch (error) {
      debug.error('❌ Error handling Discord link:', error);
      showNotification('Failed to link Discord account', 'error');
      throw error;
    }
  }

  // Auto-extract and save auth token when on DiceCloud
  async function autoRefreshToken() {
    try {
      // Check if user explicitly logged out - don't auto-refresh in that case
      const { explicitlyLoggedOut } = await browserAPI.storage.local.get('explicitlyLoggedOut');
      if (explicitlyLoggedOut) {
        debug.log('⏭️ Skipping auto-refresh: user explicitly logged out');
        return;
      }

      // Check if we already have a valid token - don't overwrite manual logins
      const existingToken = await browserAPI.storage.local.get(['diceCloudToken', 'diceCloudUserId']);
      if (existingToken.diceCloudToken && existingToken.diceCloudUserId) {
        debug.log('📋 Token already exists, skipping auto-refresh to preserve manual login');
        return;
      }

      // Try direct localStorage access (works in Chrome/Firefox when content script has access)
      debug.log('🔍 Attempting direct localStorage access...');
      let loginToken, userId, tokenExpires;

      try {
        loginToken = localStorage.getItem('Meteor.loginToken');
        userId = localStorage.getItem('Meteor.userId');
        tokenExpires = localStorage.getItem('Meteor.loginTokenExpires');
        debug.log('✅ Direct access successful:', { hasToken: !!loginToken, hasUserId: !!userId });
      } catch (directAccessError) {
        debug.log('⚠️ Direct access failed:', directAccessError.message);
        debug.log('ℹ️ Auto-login is not available in this browser due to content script isolation.');
        debug.log('ℹ️ Please use manual login via the extension popup instead.');
        return; // Exit early - cannot access localStorage
      }

      if (loginToken && userId) {
        debug.log('🔄 Auto-refreshing DiceCloud auth token...');
        debug.log('   Token:', loginToken.substring(0, 10) + '...');
        debug.log('   User ID:', userId);

        // Save to extension storage
        await browserAPI.storage.local.set({
          diceCloudToken: loginToken,
          diceCloudUserId: userId,
          tokenExpires: tokenExpires
        });

        debug.log('✅ Auth token auto-refreshed successfully');
      } else {
        debug.log('⚠️ No auth token found in localStorage');
        debug.log('   This is normal if you haven\'t logged into DiceCloud yet');
        debug.log('   Please log in to DiceCloud and refresh the page');
      }
    } catch (error) {
      debug.error('❌ Failed to auto-refresh token:', error);
      debug.error('   Error details:', error.message);
      debug.error('   Stack:', error.stack);
    }
  }

  // Note: Script injection methods removed due to Content Security Policy violations.
  // DiceCloud's CSP blocks inline script execution, so we can only use direct localStorage access.
  // This works in Chrome/Firefox but may not work in Opera or other browsers with strict content script isolation.

  // Initialize
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      debug.log('📄 DOM loaded, adding buttons...');
      addSyncButton();
      observeRollLog();

      // Try auto-refresh immediately
      autoRefreshToken();

      // Retry after 2 seconds in case DiceCloud hasn't loaded yet
      setTimeout(() => {
        debug.log('🔄 Retrying auto-refresh (2s delay)...');
        autoRefreshToken();
      }, 2000);

      // Final retry after 5 seconds for slow connections
      setTimeout(() => {
        debug.log('🔄 Final auto-refresh attempt (5s delay)...');
        autoRefreshToken();
      }, 5000);
    });
  } else {
    debug.log('📄 DOM already loaded, adding buttons...');
    addSyncButton();
    observeRollLog();

    // Try auto-refresh immediately
    autoRefreshToken();

    // Retry after 2 seconds in case DiceCloud hasn't loaded yet
    setTimeout(() => {
      debug.log('🔄 Retrying auto-refresh (2s delay)...');
      autoRefreshToken();
    }, 2000);

    // Final retry after 5 seconds for slow connections
    setTimeout(() => {
      debug.log('🔄 Final auto-refresh attempt (5s delay)...');
      autoRefreshToken();
    }, 5000);
  }
})();
