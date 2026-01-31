/**
 * DiceCloud Two-Way Sync Module
 *
 * Uses Meteor DDP to synchronize tracking values (uses, resources, HP, etc.)
 * back to DiceCloud character sheets.
 *
 * Based on DiceCloud's Meteor methods found in:
 * /app/imports/api/creature/creatureProperties/methods/
 */

class DiceCloudSync {
  constructor(ddpClient) {
    this.ddp = ddpClient;
    this.characterId = null;
    this.propertyCache = new Map(); // propertyName -> property _id
    this.previousValues = new Map(); // propertyName -> last synced value
    this.enabled = false;

    // Request queue to prevent spamming DDP
    this.requestQueue = [];
    this.isProcessingQueue = false;
    this.minRequestDelay = 250; // Minimum delay between requests (ms)
    this.lastRequestTime = 0;
    this.maxRetries = 3; // Maximum retries for failed requests

    // Property variants map: canonical name -> array of all possible variable names
    // This allows us to find properties regardless of which naming convention DiceCloud uses
    this.propertyVariants = {
      'Channel Divinity': ['channelDivinity', 'channelDivinityCleric', 'channelDivinityPaladin'],
      'Ki Points': ['kiPoints', 'ki', 'kiPoint'],
      'Sorcery Points': ['sorceryPoints', 'sorceryPoint', 'sorceryPt'],
      'Bardic Inspiration': ['bardicInspiration', 'bardic', 'inspiration'],
      'Superiority Dice': ['superiorityDice', 'superiority'],
      'Lay on Hands': ['layOnHands', 'layOnHandsPool'],
      'Wild Shape': ['wildShape', 'wildShapeUses'],
      'Rage': ['rage', 'rageUses', 'rages'],
      'Action Surge': ['actionSurge', 'actionSurgeUses'],
      'Indomitable': ['indomitable', 'indomitableUses'],
      'Second Wind': ['secondWind', 'secondWindUses'],
      'Sneak Attack': ['sneakAttack', 'sneakAttackDice'],
      'Cunning Action': ['cunningAction'],
      'Arcane Recovery': ['arcaneRecovery', 'arcaneRecoveryUses'],
      'Song of Rest': ['songOfRest'],
      'Font of Magic': ['fontOfMagic'],
      'Metamagic': ['metamagic'],
      'Warlock Spell Slots': ['warlockSpellSlots', 'pactMagicSlots'],
      'Pact Magic': ['pactMagic', 'pactMagicSlots'],
      'Divine Sense': ['divineSense', 'divineSenseUses'],
      'Divine Smite': ['divineSmite'],
      'Aura of Protection': ['auraOfProtection'],
      'Cleansing Touch': ['cleansingTouch', 'cleansingTouchUses'],
      'Harness Divine Power': ['harnessDivinePower'],
      'Wild Companion': ['wildCompanion', 'wildCompanionUses'],
      'Natural Recovery': ['naturalRecovery'],
      'Beast Spells': ['beastSpells'],
      'Favored Foe': ['favoredFoe', 'favoredFoeUses'],
      'Deft Explorer': ['deftExplorer'],
      'Primal Awareness': ['primalAwareness'],
      'Eldritch Invocations': ['eldritchInvocations'],
      'Pact Boon': ['pactBoon'],
      'Mystic Arcanum': ['mysticArcanum'],
      'Eldritch Master': ['eldritchMaster'],
      'Signature Spells': ['signatureSpells'],
      'Spell Mastery': ['spellMastery'],
      'Heroic Inspiration': ['heroicInspiration', 'inspiration'],
      'Temporary Hit Points': ['temporaryHitPoints', 'tempHitPoints', 'tempHP'],
      'Hit Points': ['hitPoints', 'hp', 'health'],
      'Death Saves - Success': ['deathSaveSuccesses', 'succeededSaves', 'deathSaves.successes'],
      'Death Saves - Failure': ['deathSaveFails', 'failedSaves', 'deathSaves.failures']
    };
  }

  /**
   * Add a request to the queue
   * @param {Function} requestFn - Async function that makes the DDP call
   * @param {string} description - Description for logging
   * @returns {Promise} - Resolves when request completes
   */
  async queueRequest(requestFn, description = 'DDP Request') {
    return new Promise((resolve, reject) => {
      const queueItem = {
        requestFn,
        description,
        resolve,
        reject,
        retries: 0,
        timestamp: Date.now()
      };

      this.requestQueue.push(queueItem);
      console.log(`[DiceCloud Sync] Queued: ${description} (Queue size: ${this.requestQueue.length})`);

      // Start processing if not already running
      if (!this.isProcessingQueue) {
        this.processQueue();
      }
    });
  }

  /**
   * Process the request queue sequentially
   */
  async processQueue() {
    if (this.isProcessingQueue) {
      return;
    }

    this.isProcessingQueue = true;

    while (this.requestQueue.length > 0) {
      const item = this.requestQueue[0]; // Peek at first item

      try {
        // Rate limiting: ensure minimum delay between requests
        const timeSinceLastRequest = Date.now() - this.lastRequestTime;
        if (timeSinceLastRequest < this.minRequestDelay) {
          const delayNeeded = this.minRequestDelay - timeSinceLastRequest;
          console.log(`[DiceCloud Sync] Rate limiting: waiting ${delayNeeded}ms before next request`);
          await this.sleep(delayNeeded);
        }

        console.log(`[DiceCloud Sync] Processing: ${item.description} (${this.requestQueue.length} remaining)`);

        // Execute the request
        this.lastRequestTime = Date.now();
        const result = await item.requestFn();

        // Success - remove from queue and resolve
        this.requestQueue.shift();
        item.resolve(result);

        console.log(`[DiceCloud Sync] Completed: ${item.description}`);

      } catch (error) {
        console.error(`[DiceCloud Sync] Error: ${item.description}`, error);

        // Check if it's a rate limit error
        const isTooManyRequests =
          error.message?.includes('too many requests') ||
          error.message?.includes('rate limit') ||
          error.error === 'too-many-requests' ||
          error.error === 429;

        if (isTooManyRequests && item.retries < this.maxRetries) {
          // Retry with exponential backoff
          item.retries++;
          const backoffDelay = Math.min(1000 * Math.pow(2, item.retries), 10000); // Max 10s
          console.warn(`[DiceCloud Sync] Rate limited. Retry ${item.retries}/${this.maxRetries} after ${backoffDelay}ms`);

          await this.sleep(backoffDelay);
          // Don't remove from queue - will retry on next iteration
        } else {
          // Max retries reached or different error - remove and reject
          this.requestQueue.shift();
          item.reject(error);

          if (isTooManyRequests) {
            console.error(`[DiceCloud Sync] Max retries reached for: ${item.description}`);
          }
        }
      }
    }

    this.isProcessingQueue = false;
    console.log('[DiceCloud Sync] Queue processing complete');
  }

  /**
   * Sleep utility
   * @param {number} ms - Milliseconds to sleep
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Initialize sync for a character
   * @param {string} characterId - DiceCloud character ID
   */
  async initialize(characterId) {
    this.characterId = characterId;
    this.propertyCache.clear();

    // Subscribe to character data to get property IDs
    // This allows us to cache property _id values for faster updates
    console.log('[DiceCloud Sync] Initializing for character:', characterId);
    console.log('[DiceCloud Sync] DDP client status:', this.ddp.isConnected());

    try {
      // Connect to DDP if not already connected
      if (!this.ddp.isConnected()) {
        console.log('[DiceCloud Sync] Connecting to DDP...');
        await this.ddp.connect();
        console.log('[DiceCloud Sync] DDP connected successfully');
      }

      // Note: We'll need to fetch the full character data to build our cache
      // The DiceCloud API GET /creature/:id returns all properties
      await this.buildPropertyCache();

      // Check user preference for auto backwards sync
      const result = await browserAPI.storage.local.get(['autoBackwardsSync']);
      const autoBackwardsSync = result.autoBackwardsSync !== false; // Default to true
      this.enabled = autoBackwardsSync;

      console.log('[DiceCloud Sync] Initialized successfully');
      console.log('[DiceCloud Sync] Auto backwards sync preference:', autoBackwardsSync);
      console.log('[DiceCloud Sync] Sync enabled:', this.enabled);
    } catch (error) {
      console.error('[DiceCloud Sync] Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Map all variant names to a single property ID
   * @param {string} canonicalName - The canonical property name
   * @param {string} foundVariableName - The variable name that was actually found in DiceCloud
   * @param {string} propertyId - The property _id from DiceCloud
   */
  cachePropertyWithVariants(canonicalName, foundVariableName, propertyId) {
    // Cache the canonical name
    this.propertyCache.set(canonicalName, propertyId);

    // Cache ALL possible variants for this property
    const variants = this.propertyVariants[canonicalName];
    if (variants) {
      for (const variant of variants) {
        this.propertyCache.set(variant, propertyId);
      }
      console.log(`[DiceCloud Sync] 🗺️  Mapped ${canonicalName} (found as "${foundVariableName}") to ${propertyId}`);
      console.log(`[DiceCloud Sync]     All variants cached: ${variants.join(', ')}`);
    } else {
      // No variants defined, just cache the canonical name
      console.log(`[DiceCloud Sync] Cached property: ${canonicalName} -> ${propertyId}`);
    }
  }

  /**
   * Find a property in the raw API data by checking all possible variant names
   * @param {Array} properties - Array of properties from DiceCloud API
   * @param {string} canonicalName - The canonical property name to search for
   * @param {Object} filter - Optional filter criteria (type, attributeType, etc.)
   * @returns {Object|null} The found property or null
   */
  findPropertyByVariants(properties, canonicalName, filter = {}) {
    const variants = this.propertyVariants[canonicalName];
    if (!variants) {
      // No variants defined, just search by canonical name
      return properties.find(p => {
        if (p.removed || p.inactive) return false;
        if (p.name !== canonicalName && p.variableName !== canonicalName) return false;

        // Apply additional filters
        for (const [key, value] of Object.entries(filter)) {
          if (p[key] !== value) return false;
        }
        return true;
      });
    }

    // Search for any variant
    for (const variant of variants) {
      const property = properties.find(p => {
        if (p.removed || p.inactive) return false;
        if (p.variableName !== variant && p.name !== variant) return false;

        // Apply additional filters
        for (const [key, value] of Object.entries(filter)) {
          if (p[key] !== value) return false;
        }
        return true;
      });

      if (property) {
        console.log(`[DiceCloud Sync] 🔍 Found ${canonicalName} using variant "${variant}" (variableName: ${property.variableName})`);
        return property;
      }
    }

    return null;
  }

  /**
   * Build cache of property names to IDs
   */
  async buildPropertyCache() {
    console.log('[DiceCloud Sync] Building property cache...');

    // First, try to get the stored character data
    const result = await browserAPI.storage.local.get(['activeCharacterId', 'characterProfiles']);
    const { activeCharacterId, characterProfiles } = result;
    console.log('[DiceCloud Sync] Storage result:', { activeCharacterId, characterProfilesKeys: characterProfiles ? Object.keys(characterProfiles) : null });

    if (activeCharacterId && characterProfiles && characterProfiles[activeCharacterId]) {
      const characterData = characterProfiles[activeCharacterId];
      console.log('[DiceCloud Sync] Building cache from character data:', characterData.name);

      // CRITICAL: Verify this character has DiceCloud data before proceeding
      if (!characterData.id) {
        console.warn('[DiceCloud Sync] Character data has no DiceCloud ID, skipping cache build');
        console.warn('[DiceCloud Sync] This is likely the default/placeholder character');
        return;
      }

      // Object to store current values extracted from API for initialization
      // Declared here so it's in scope for initializePreviousValues call later
      const currentValuesFromAPI = {};

      // Get the DiceCloud API token for fetching raw data
      const tokenResult = await browserAPI.storage.local.get(['diceCloudToken']);
      const { diceCloudToken } = tokenResult;

      if (diceCloudToken && characterData.id) {
        console.log('[DiceCloud Sync] Fetching raw DiceCloud API data for property cache...');

        try {
          // Route API request through background script to avoid CORS
          const response = await browserAPI.runtime.sendMessage({
            action: 'fetchDiceCloudAPI',
            url: `https://dicecloud.com/api/creature/${characterData.id}`,
            token: diceCloudToken
          });

          if (response.success && response.data) {
            const apiData = response.data;
            console.log('[DiceCloud Sync] Received API data for property cache');
            
            // Build cache from raw creatureProperties
            if (apiData.creatureProperties && Array.isArray(apiData.creatureProperties)) {
              console.log(`[DiceCloud Sync] Processing ${apiData.creatureProperties.length} raw properties`);
              
              // First pass: collect all properties
              const allProperties = {};
              for (const property of apiData.creatureProperties) {
                if (property._id && property.name) {
                  if (!allProperties[property.name]) {
                    allProperties[property.name] = [];
                  }
                  allProperties[property.name].push(property);
                }
              }
              
              /**
               * Helper function to select the best property from duplicates
               * Uses priority-based matching like we do for Hit Points
               * @param {string} name - Property name
               * @param {Array} properties - Array of properties with this name
               * @param {object} criteria - Selection criteria
               * @returns {object|null} - Best matching property
               */
              const selectBestProperty = (name, properties, criteria = {}) => {
                if (properties.length === 1) return properties[0];

                const {
                  requiredType,
                  requiredAttributeType,
                  requiredFields = [],
                  sortBy = null,
                  debug = false
                } = criteria;

                if (debug) {
                  console.log(`[DiceCloud Sync] All ${name} properties found:`);
                  properties.forEach(p => {
                    console.log(`  - ${p.name} (${p.type}): id=${p._id}, value=${p.value}, baseValue=${p.baseValue}, total=${p.total}, damage=${p.damage}, attributeType=${p.attributeType || 'none'}`);
                  });
                }

                // Priority 1: Exact type + attributeType + has all required fields
                if (requiredType && requiredAttributeType && requiredFields.length > 0) {
                  const exactMatches = properties.filter(p =>
                    p.type === requiredType &&
                    p.attributeType === requiredAttributeType &&
                    requiredFields.every(field => p[field] !== undefined) &&
                    !p.removed &&
                    !p.inactive
                  );
                  if (exactMatches.length > 0) {
                    return sortBy ? exactMatches.sort(sortBy)[0] : exactMatches[0];
                  }
                }

                // Priority 2: Exact type + attributeType
                if (requiredType && requiredAttributeType) {
                  const typeMatches = properties.filter(p =>
                    p.type === requiredType &&
                    p.attributeType === requiredAttributeType &&
                    !p.removed &&
                    !p.inactive
                  );
                  if (typeMatches.length > 0) {
                    return sortBy ? typeMatches.sort(sortBy)[0] : typeMatches[0];
                  }
                }

                // Priority 3: Just type match
                if (requiredType) {
                  const typeOnly = properties.filter(p =>
                    p.type === requiredType &&
                    !p.removed &&
                    !p.inactive
                  );
                  if (typeOnly.length > 0) {
                    return sortBy ? typeOnly.sort(sortBy)[0] : typeOnly[0];
                  }
                }

                // Priority 4: Any property with required fields
                if (requiredFields.length > 0) {
                  const withFields = properties.filter(p =>
                    requiredFields.every(field => p[field] !== undefined) &&
                    !p.removed &&
                    !p.inactive
                  );
                  if (withFields.length > 0) {
                    return sortBy ? withFields.sort(sortBy)[0] : withFields[0];
                  }
                }

                // Fallback: First non-removed, non-inactive property
                const active = properties.find(p => !p.removed && !p.inactive);
                return active || properties[0];
              };

              // Second pass: cache the best property for each name
              for (const [propertyName, properties] of Object.entries(allProperties)) {
                let selectedProperty = properties[0]; // default to first

                // Handle Hit Points - find the healthBar that tracks current HP
                if (propertyName === 'Hit Points') {
                  selectedProperty = selectBestProperty('Hit Points', properties, {
                    requiredType: 'attribute',
                    requiredAttributeType: 'healthBar',
                    requiredFields: ['damage'],
                    sortBy: (a, b) => (b.total || 0) - (a.total || 0),
                    debug: true
                  });

                  if (selectedProperty) {
                    this.propertyCache.set('Hit Points', selectedProperty._id);
                    console.log(`[DiceCloud Sync] Selected Hit Points property: ${selectedProperty.name} -> ${selectedProperty._id} (type: ${selectedProperty.type}, attributeType: ${selectedProperty.attributeType || 'none'}, value: ${selectedProperty.value}, total: ${selectedProperty.total}, baseValue: ${selectedProperty.baseValue}, damage: ${selectedProperty.damage})`);

                    // Extract current HP value for initialization
                    // Current HP = total - damage
                    const currentHP = (selectedProperty.total || 0) - (selectedProperty.damage || 0);
                    currentValuesFromAPI['Hit Points'] = currentHP;
                    console.log(`[DiceCloud Sync] 📊 Extracted current HP value: ${currentHP} (total: ${selectedProperty.total}, damage: ${selectedProperty.damage})`);
                  } else {
                    console.log(`[DiceCloud Sync] No suitable Hit Points property found`);
                  }
                  continue;
                }
                
                // Cache class-specific HP as the main "Hit Points" if no main HP was found
                // BUT: Don't cache Temporary Hit Points - only class-specific ones like "Hit Points: Monk"
                if (propertyName.includes('Hit Points') &&
                    propertyName !== 'Hit Points' &&
                    !propertyName.includes('Temporary')) {
                  const classHP = properties.find(p =>
                    p.type !== 'skill' &&
                    (p.value !== undefined || p.skillValue !== undefined)
                  );

                  if (classHP) {
                    this.propertyCache.set('Hit Points', classHP._id);
                    console.log(`[DiceCloud Sync] Cached class-specific HP as main Hit Points: ${propertyName} -> ${classHP._id} (type: ${classHP.type})`);
                  }
                  continue;
                }

                // Cache spell slots (1st Level, 2nd Level, etc.)
                const spellSlotMatch = propertyName.match(/^(\d+(?:st|nd|rd|th)) Level$/);
                if (spellSlotMatch) {
                  selectedProperty = selectBestProperty(propertyName, properties, {
                    requiredType: 'attribute',
                    requiredAttributeType: 'spellSlot',
                    requiredFields: ['value'],
                    debug: properties.length > 1
                  });

                  if (selectedProperty) {
                    // Cache with both the full name and a short key
                    this.propertyCache.set(propertyName, selectedProperty._id);
                    const slotLevel = spellSlotMatch[1].replace(/\D/g, '');
                    this.propertyCache.set(`spellSlot${slotLevel}`, selectedProperty._id);
                    console.log(`[DiceCloud Sync] Cached spell slot: ${propertyName} -> ${selectedProperty._id} (attributeType: ${selectedProperty.attributeType})`);

                    // Extract current spell slot value for initialization
                    const currentSlots = selectedProperty.value || 0;
                    currentValuesFromAPI[`spellSlot${slotLevel}`] = currentSlots;
                    console.log(`[DiceCloud Sync] 📊 Extracted current spell slot value for level ${slotLevel}: ${currentSlots}`);
                  }
                  continue;
                }

                // Cache Channel Divinity
                if (propertyName === 'Channel Divinity') {
                  selectedProperty = selectBestProperty('Channel Divinity', properties, {
                    requiredType: 'attribute',
                    requiredAttributeType: 'resource',
                    requiredFields: ['damage'],
                    debug: properties.length > 1
                  });

                  if (selectedProperty) {
                    this.propertyCache.set('Channel Divinity', selectedProperty._id);
                    console.log(`[DiceCloud Sync] Cached Channel Divinity: ${selectedProperty._id} (attributeType: ${selectedProperty.attributeType})`);

                    const currentCD = selectedProperty.value || 0;
                    currentValuesFromAPI['Channel Divinity'] = currentCD;
                    console.log(`[DiceCloud Sync] 📊 Extracted current Channel Divinity value: ${currentCD}`);
                  }
                  continue;
                }

                // Cache all other properties normally
                this.propertyCache.set(propertyName, selectedProperty._id);
                console.log(`[DiceCloud Sync] Cached property: ${propertyName} -> ${selectedProperty._id}`);
              }

            // Note: Removed a closing brace that was here at line 521
            // It was ending the apiData.creatureProperties if block too early,
            // causing allProperties to go out of scope. The block continues below.

            // Cache actions with limited uses from the raw API data
            // Group by name first, then use comprehensive matching
            const actionsByName = {};
            apiData.creatureProperties.forEach(p => {
              if (p.type === 'action' &&
                  p.name &&
                  p.uses !== undefined &&
                  p.uses !== null &&
                  !p.removed &&
                  !p.inactive &&
                  !this.propertyCache.has(p.name)) {
                if (!actionsByName[p.name]) {
                  actionsByName[p.name] = [];
                }
                actionsByName[p.name].push(p);
              }
            });

            let actionCount = 0;
            for (const [actionName, actions] of Object.entries(actionsByName)) {
              const action = selectBestProperty(actionName, actions, {
                requiredType: 'action',
                requiredFields: ['uses'],
                debug: actions.length > 1
              });
              if (action) {
                this.propertyCache.set(action.name, action._id);
                const maxUses = action.uses?.value ?? action.uses;
                const usedUses = action.usesUsed ?? 0;
                console.log(`[DiceCloud Sync] Cached action with uses: ${action.name} -> ${action._id} (${usedUses}/${maxUses} used)`);
                actionCount++;
              }
            }
            console.log(`[DiceCloud Sync] Found ${actionCount} actions with limited uses`);

            // Cache Temporary Hit Points using comprehensive matching
            if (allProperties['Temporary Hit Points']) {
              const tempHP = selectBestProperty('Temporary Hit Points', allProperties['Temporary Hit Points'], {
                requiredType: 'attribute',
                requiredAttributeType: 'healthBar',
                requiredFields: ['value'],
                debug: allProperties['Temporary Hit Points'].length > 1
              });
              if (tempHP) {
                this.propertyCache.set('Temporary Hit Points', tempHP._id);
                console.log(`[DiceCloud Sync] Cached Temporary Hit Points: ${tempHP._id} (attributeType: ${tempHP.attributeType})`);

                const currentTempHP = tempHP.value || 0;
                currentValuesFromAPI['Temporary Hit Points'] = currentTempHP;
                console.log(`[DiceCloud Sync] 📊 Extracted current Temp HP value: ${currentTempHP}`);
              }
            }

            // Cache Death Saves using comprehensive matching
            ['Succeeded Saves', 'Failed Saves'].forEach(saveName => {
              if (allProperties[saveName]) {
                const deathSave = selectBestProperty(saveName, allProperties[saveName], {
                  requiredType: 'attribute',
                  requiredAttributeType: 'spellSlot',
                  debug: allProperties[saveName].length > 1
                });
                if (deathSave) {
                  this.propertyCache.set(saveName, deathSave._id);
                  console.log(`[DiceCloud Sync] Cached Death Save: ${saveName} -> ${deathSave._id} (attributeType: ${deathSave.attributeType})`);
                }
              }
            });

            // Cache Hit Dice using comprehensive matching
            ['d6 Hit Dice', 'd8 Hit Dice', 'd10 Hit Dice', 'd12 Hit Dice'].forEach(diceName => {
              if (allProperties[diceName]) {
                const hitDie = selectBestProperty(diceName, allProperties[diceName], {
                  requiredType: 'attribute',
                  requiredAttributeType: 'hitDice',
                  debug: allProperties[diceName].length > 1
                });
                if (hitDie) {
                  this.propertyCache.set(diceName, hitDie._id);
                  console.log(`[DiceCloud Sync] Cached Hit Die: ${diceName} -> ${hitDie._id} (attributeType: ${hitDie.attributeType})`);
                }
              }
            });

            // Cache Heroic Inspiration using comprehensive matching
            if (allProperties['Heroic Inspiration'] || allProperties['Inspiration']) {
              const inspirationProps = allProperties['Heroic Inspiration'] || allProperties['Inspiration'];
              const inspiration = selectBestProperty('Inspiration', inspirationProps, {
                requiredType: 'attribute',
                requiredAttributeType: 'resource',
                debug: inspirationProps.length > 1
              });
              if (inspiration) {
                this.propertyCache.set('Heroic Inspiration', inspiration._id);
                this.propertyCache.set('Inspiration', inspiration._id);
                console.log(`[DiceCloud Sync] Cached Inspiration: ${inspiration._id} (attributeType: ${inspiration.attributeType})`);
              }
            }

            // Cache common class resources using comprehensive matching
            const classResourceNames = [
              'Ki Points', 'Sorcery Points', 'Bardic Inspiration', 'Superiority Dice',
              'Lay on Hands', 'Wild Shape', 'Rage', 'Action Surge', 'Indomitable',
              'Second Wind', 'Sneak Attack', 'Cunning Action', 'Arcane Recovery',
              'Song of Rest', 'Font of Magic', 'Metamagic', 'Sorcery Point',
              'Warlock Spell Slots', 'Pact Magic', 'Eldritch Invocations'
            ];

            let classResourceCount = 0;
            for (const resourceName of classResourceNames) {
              if (allProperties[resourceName] && !this.propertyCache.has(resourceName)) {
                const resource = selectBestProperty(resourceName, allProperties[resourceName], {
                  requiredType: 'attribute',
                  requiredAttributeType: 'resource',
                  requiredFields: ['damage'],
                  debug: allProperties[resourceName].length > 1
                });
                if (resource) {
                  this.propertyCache.set(resourceName, resource._id);
                  console.log(`[DiceCloud Sync] Cached class resource: ${resourceName} -> ${resource._id} (attributeType: ${resource.attributeType})`);

                  const currentValue = resource.value || 0;
                  currentValuesFromAPI[resourceName] = currentValue;
                  console.log(`[DiceCloud Sync] 📊 Extracted current value for ${resourceName}: ${currentValue}`);
                  classResourceCount++;
                }
              }
            }
            console.log(`[DiceCloud Sync] Found ${classResourceCount} class resources`);

            // Cache any other attributes with reset fields (short/long rest resources)
            // Group by name first, then use comprehensive matching
            const restorableByName = {};
            apiData.creatureProperties.forEach(p => {
              if (p.type === 'attribute' &&
                  p.name &&
                  p.reset &&
                  p.reset !== 'none' &&
                  !p.removed &&
                  !p.inactive &&
                  !this.propertyCache.has(p.name)) {
                if (!restorableByName[p.name]) {
                  restorableByName[p.name] = [];
                }
                restorableByName[p.name].push(p);
              }
            });

            let restorableCount = 0;
            for (const [attrName, attrs] of Object.entries(restorableByName)) {
              const attr = selectBestProperty(attrName, attrs, {
                requiredType: 'attribute',
                requiredFields: ['reset'],
                debug: attrs.length > 1
              });
              if (attr) {
                this.propertyCache.set(attr.name, attr._id);
                console.log(`[DiceCloud Sync] Cached restorable attribute: ${attr.name} (resets on ${attr.reset}) -> ${attr._id}`);
                restorableCount++;
              }
            }
            console.log(`[DiceCloud Sync] Found ${restorableCount} additional restorable attributes`);

            // IMPROVEMENT: Cache ALL remaining attributes (even without reset fields)
            // This ensures custom resources and homebrew attributes sync properly
            const customAttrsByName = {};
            apiData.creatureProperties.forEach(p => {
              if (p.type === 'attribute' &&
                  p.name &&
                  !p.removed &&
                  !p.inactive &&
                  !this.propertyCache.has(p.name) &&
                  (p.value !== undefined || p.baseValue !== undefined)) {
                if (!customAttrsByName[p.name]) {
                  customAttrsByName[p.name] = [];
                }
                customAttrsByName[p.name].push(p);
              }
            });

            let customAttrCount = 0;
            for (const [attrName, attrs] of Object.entries(customAttrsByName)) {
              const attr = selectBestProperty(attrName, attrs, {
                requiredType: 'attribute',
                requiredFields: ['value'],
                debug: attrs.length > 1
              });
              if (attr) {
                this.propertyCache.set(attr.name, attr._id);
                console.log(`[DiceCloud Sync] Cached custom attribute: ${attr.name} -> ${attr._id} (value: ${attr.value}, baseValue: ${attr.baseValue})`);

                // Extract current value for initialization
                const currentValue = attr.value !== undefined ? attr.value : (attr.baseValue || 0);
                currentValuesFromAPI[attr.name] = currentValue;
                console.log(`[DiceCloud Sync] 📊 Extracted current value for ${attr.name}: ${currentValue}`);
                customAttrCount++;
              }
            }
            console.log(`[DiceCloud Sync] Found ${customAttrCount} additional custom attributes to cache`);

            // Cache important toggles (conditions, active features, etc.)
            // Group by name first, then use comprehensive matching
            const togglesByName = {};
            apiData.creatureProperties.forEach(p => {
              if (p.type === 'toggle' &&
                  p.name &&
                  !p.removed &&
                  !p.inactive &&
                  !this.propertyCache.has(p.name)) {
                if (!togglesByName[p.name]) {
                  togglesByName[p.name] = [];
                }
                togglesByName[p.name].push(p);
              }
            });

            let toggleCount = 0;
            for (const [toggleName, toggles] of Object.entries(togglesByName)) {
              const toggle = selectBestProperty(toggleName, toggles, {
                requiredType: 'toggle',
                debug: toggles.length > 1
              });
              if (toggle) {
                this.propertyCache.set(toggle.name, toggle._id);
                console.log(`[DiceCloud Sync] Cached toggle: ${toggle.name} -> ${toggle._id}`);
                toggleCount++;
              }
            }
            console.log(`[DiceCloud Sync] Found ${toggleCount} toggles`);

            // COMPREHENSIVE VARIANT MAPPING
            // Search for all properties that match any variant name in our mapping
            // This ensures we catch properties regardless of naming convention
            console.log('[DiceCloud Sync] 🗺️  Starting comprehensive variant mapping...');

            for (const [canonicalName, variants] of Object.entries(this.propertyVariants)) {
              // Search for a property matching any variant
              let foundProperty = null;
              let foundVariant = null;

              // Try each variant
              for (const variant of variants) {
                const property = apiData.creatureProperties.find(p => {
                  if (p.removed || p.inactive) return false;

                  // Check both name and variableName fields
                  if (p.variableName === variant || p.name === variant) {
                    // For resources and specific types, verify the type
                    if (canonicalName === 'Channel Divinity' ||
                        canonicalName === 'Ki Points' ||
                        canonicalName === 'Sorcery Points' ||
                        canonicalName === 'Bardic Inspiration') {
                      // Must be attribute with resource type
                      return p.type === 'attribute' && p.attributeType === 'resource';
                    }

                    if (canonicalName === 'Temporary Hit Points') {
                      return p.type === 'attribute' && p.attributeType === 'healthBar';
                    }

                    if (canonicalName === 'Hit Points') {
                      return p.type === 'attribute' && p.attributeType === 'healthBar';
                    }

                    // For other properties, just check it's an attribute
                    return p.type === 'attribute' || p.type === 'action';
                  }

                  return false;
                });

                if (property) {
                  foundProperty = property;
                  foundVariant = variant;
                  break;
                }
              }

              // If we found a property, cache ALL variants to point to this ID
              if (foundProperty) {
                this.cachePropertyWithVariants(canonicalName, foundVariant, foundProperty._id);

                // Extract current value for initialization
                if (foundProperty.value !== undefined) {
                  currentValuesFromAPI[canonicalName] = foundProperty.value;
                  console.log(`[DiceCloud Sync] 📊 Extracted current value for ${canonicalName}: ${foundProperty.value}`);
                }
              }
            }

            console.log('[DiceCloud Sync] ✅ Comprehensive variant mapping complete');
            } // Closes if (apiData.creatureProperties && Array.isArray(apiData.creatureProperties)) from line 330
          } else {
            console.warn('[DiceCloud Sync] Failed to fetch API data for property cache:', response.error);
          }
        } catch (error) {
          console.error('[DiceCloud Sync] Error fetching API data for property cache:', error);
        }
      }
      
      // Also cache actions by name (fallback)
      if (characterData.actions && Array.isArray(characterData.actions)) {
        console.log(`[DiceCloud Sync] Processing ${characterData.actions.length} actions`);
        for (const action of characterData.actions) {
          if (action.name) {
            // Check if we already have this property in cache
            if (!this.propertyCache.has(action.name)) {
              // Try to find matching property in cached properties by name
              const propertyId = this.findPropertyId(action.name);
              if (propertyId) {
                this.propertyCache.set(action.name, propertyId);
                console.log(`[DiceCloud Sync] Cached action: ${action.name} -> ${propertyId}`);
              } else {
                console.warn(`[DiceCloud Sync] No property ID found for action: ${action.name}`);
              }
            }
          }
        }
      }

      console.log(`[DiceCloud Sync] Property cache built with ${this.propertyCache.size} entries`);
      console.log('[DiceCloud Sync] Available properties:', Array.from(this.propertyCache.keys()));

      // Initialize previousValues from current character data to avoid syncing everything on first update
      console.log('[DiceCloud Sync] Initializing previousValues from current character data...');
      await this.initializePreviousValues(characterData, currentValuesFromAPI);
    } else {
      console.warn('[DiceCloud Sync] No character data available for cache building');
      console.warn('[DiceCloud Sync] activeCharacterId:', activeCharacterId);
      console.warn('[DiceCloud Sync] characterProfiles:', characterProfiles);
    }
  }

  /**
   * Initialize previousValues from character data to avoid syncing everything on first update
   * @param {Object} characterData - Character data object
   * @param {Object} apiValues - Current values extracted from DiceCloud API (optional)
   */
  async initializePreviousValues(characterData, apiValues = {}) {
    console.log('[DiceCloud Sync] Populating previousValues to establish baseline...');

    // HP values - prefer API values if available, otherwise use stored character data
    if (apiValues['Hit Points'] !== undefined) {
      this.previousValues.set('Hit Points', apiValues['Hit Points']);
      console.log(`[DiceCloud Sync] 📊 Initialized Hit Points from API: ${apiValues['Hit Points']}`);
    } else if (characterData.hp !== undefined) {
      this.previousValues.set('Hit Points', characterData.hp);
    }

    if (apiValues['Temporary Hit Points'] !== undefined) {
      this.previousValues.set('Temporary Hit Points', apiValues['Temporary Hit Points']);
      console.log(`[DiceCloud Sync] 📊 Initialized Temp HP from API: ${apiValues['Temporary Hit Points']}`);
    } else if (characterData.tempHp !== undefined) {
      this.previousValues.set('Temporary Hit Points', characterData.tempHp);
    }

    if (characterData.maxHp !== undefined) {
      this.previousValues.set('Max Hit Points', characterData.maxHp);
    }

    // Spell slots - use character data values (extension is source of truth)
    // This ensures spell slots sync properly on first update if they differ from DiceCloud
    for (let level = 1; level <= 9; level++) {
      const cacheKey = `spellSlot${level}`;

      if (characterData.spellSlots) {
        const currentKey = `level${level}SpellSlots`;
        const maxKey = `level${level}SpellSlotsMax`;

        if (characterData.spellSlots[currentKey] !== undefined && characterData.spellSlots[maxKey] !== undefined) {
          if (characterData.spellSlots[maxKey] > 0) {
            this.previousValues.set(cacheKey, characterData.spellSlots[currentKey]);
            console.log(`[DiceCloud Sync] 📊 Initialized spell slot level ${level} from extension: ${characterData.spellSlots[currentKey]}`);
          }
        }
      } else if (apiValues[cacheKey] !== undefined) {
        // Fallback to API values only if character data doesn't have spell slots
        this.previousValues.set(cacheKey, apiValues[cacheKey]);
        console.log(`[DiceCloud Sync] 📊 Initialized spell slot level ${level} from API (fallback): ${apiValues[cacheKey]}`);
      }
    }

    // Channel Divinity - prefer API values if available
    if (apiValues['Channel Divinity'] !== undefined) {
      this.previousValues.set('Channel Divinity', apiValues['Channel Divinity']);
      console.log(`[DiceCloud Sync] 📊 Initialized Channel Divinity from API: ${apiValues['Channel Divinity']}`);
    } else if (characterData.channelDivinity && characterData.channelDivinity.current !== undefined) {
      this.previousValues.set('Channel Divinity', characterData.channelDivinity.current);
    }

    // Resources
    if (characterData.resources && Array.isArray(characterData.resources)) {
      for (const resource of characterData.resources) {
        if (resource.name && resource.current !== undefined) {
          this.previousValues.set(resource.name, resource.current);
        }
      }
    }

    // Actions with uses
    if (characterData.actions && Array.isArray(characterData.actions)) {
      for (const action of characterData.actions) {
        if (action.name && action.uses && action.usesUsed !== undefined) {
          const cacheKey = `action_${action.name}`;
          this.previousValues.set(cacheKey, action.usesUsed);
        }
      }
    }

    // Death saves
    if (characterData.deathSaves) {
      if (characterData.deathSaves.successes !== undefined) {
        this.previousValues.set('Succeeded Saves', characterData.deathSaves.successes);
      }
      if (characterData.deathSaves.failures !== undefined) {
        this.previousValues.set('Failed Saves', characterData.deathSaves.failures);
      }
    }

    // Inspiration
    if (characterData.inspiration !== undefined) {
      this.previousValues.set('Inspiration', characterData.inspiration);
    }

    // Initialize any remaining values from API that weren't explicitly handled above
    // This catches class resources (Ki Points, Sorcery Points, etc.) and custom attributes
    if (apiValues && Object.keys(apiValues).length > 0) {
      for (const [key, value] of Object.entries(apiValues)) {
        // Only set if not already set above
        if (!this.previousValues.has(key)) {
          this.previousValues.set(key, value);
          console.log(`[DiceCloud Sync] 📊 Initialized ${key} from API: ${value}`);
        }
      }
    }

    console.log(`[DiceCloud Sync] Initialized ${this.previousValues.size} previous values`);
  }

  /**
   * Increment action uses (e.g., used 1 of 3 uses)
   * @param {string} actionName - Name of the action
   * @param {number} amount - Amount to increment (usually 1)
   */
  async incrementActionUses(actionName, amount = 1) {
    if (!this.enabled) {
      console.warn('[DiceCloud Sync] Sync not enabled');
      return;
    }

    const propertyId = this.findPropertyId(actionName);
    if (!propertyId) {
      console.warn(`[DiceCloud Sync] Property not found: ${actionName}`);
      return;
    }

    // Queue the request instead of calling directly
    return this.queueRequest(
      async () => {
        console.log(`[DiceCloud Sync] Incrementing uses for ${actionName} (${propertyId}) by ${amount}`);

        const result = await this.ddp.call('creatureProperties.update', {
          _id: propertyId,
          path: ['usesUsed'],
          value: amount
        });

        console.log('[DiceCloud Sync] ⏳ Increment request sent:', result);
        return result;
      },
      `Increment ${actionName} uses`
    );
  }

  /**
   * Set action uses to a specific value
   * @param {string} actionName - Name of the action
   * @param {number} value - New value for usesUsed
   */
  async setActionUses(actionName, value) {
    if (!this.enabled) {
      console.warn('[DiceCloud Sync] Sync not enabled');
      return;
    }

    const propertyId = this.findPropertyId(actionName);
    if (!propertyId) {
      console.warn(`[DiceCloud Sync] Property not found: ${actionName}`);
      return;
    }

    // Queue the request instead of calling directly
    return this.queueRequest(
      async () => {
        console.log(`[DiceCloud Sync] Setting uses for ${actionName} (${propertyId}) to ${value}`);

        const result = await this.ddp.call('creatureProperties.update', {
          _id: propertyId,
          path: ['usesUsed'],
          value: value
        });

        console.log('[DiceCloud Sync] ⏳ Set uses request sent:', result);
        return result;
      },
      `Set ${actionName} uses to ${value}`
    );
  }

  /**
   * Update attribute value (HP, Ki Points, Sorcery Points, etc.)
   * @param {string} attributeName - Name of the attribute
   * @param {number} value - New value
   */
  async updateAttributeValue(attributeName, value) {
    if (!this.enabled) {
      console.warn('[DiceCloud Sync] Sync not enabled');
      return;
    }

    const propertyId = this.findPropertyId(attributeName);
    if (!propertyId) {
      console.warn(`[DiceCloud Sync] Property not found: ${attributeName}`);
      return;
    }

    console.log(`[DiceCloud Sync] Updating attribute ${attributeName} (${propertyId}) to ${value}`);

    // Prepare the update - this runs BEFORE queueing
    const updatePayload = {
      _id: propertyId,
      path: ['value'],  // Default, will be updated based on property type
      value: value
    };

    // Check current value before update and determine correct field name
    try {
      const tokenResult = await browserAPI.storage.local.get(['diceCloudToken']);
      const { diceCloudToken } = tokenResult;

      if (diceCloudToken) {
        // Use the character endpoint like the debug button does
        const characterId = this.characterId;
        const currentResponse = await browserAPI.runtime.sendMessage({
          action: 'fetchDiceCloudAPI',
          url: `https://dicecloud.com/api/creature/${characterId}`,
          token: diceCloudToken
        });

        if (currentResponse.success && currentResponse.data) {
          // Find the property in the full character data
          const property = currentResponse.data.creatureProperties.find(p => p._id === propertyId);
          if (property) {
            console.log('[DiceCloud Sync] Property before update:', {
              id: property._id,
              name: property.name,
              type: property.type,
              attributeType: property.attributeType,
              value: property.value,
              baseValue: property.baseValue,
              total: property.total,
              damage: property.damage,
              skillValue: property.skillValue,
              dirty: property.dirty
            });

            // Determine the correct field name and value based on property type
            let fieldName = 'value'; // default
            let updateValue = value; // default to the passed value
            let useHealthBarMethod = false; // Flag to use creatureProperties.damage method

            if (property.type === 'skill') {
              fieldName = 'skillValue';
            } else if (property.type === 'effect') {
              // For effects, check if there's a calculation or if it uses value
              fieldName = property.calculation ? 'calculation' : 'value';
            } else if (property.type === 'attribute' && property.attributeType === 'healthBar') {
              // For healthBar attributes (like HP), we must use creatureProperties.damage method
              // The damage field cannot be updated directly via creatureProperties.update
              // Instead, use operation: 'set' with the new current HP value
              console.log(`[DiceCloud Sync] HealthBar update: currentHP=${property.value}, newCurrentHP=${value}, total=${property.total}, currentDamage=${property.damage}`);
              useHealthBarMethod = true;
              updateValue = value; // Pass the new current HP value directly
            } else if (property.type === 'attribute') {
              // For other attributes, update the value directly
              fieldName = 'value';
            }
            console.log(`[DiceCloud Sync] Using field name: ${fieldName} for property type: ${property.type}, attributeType: ${property.attributeType || 'none'}`);
            console.log(`[DiceCloud Sync] Use healthBar method: ${useHealthBarMethod}`);

            // Update the payload with the correct field name and value
            if (useHealthBarMethod) {
              // For healthBar, use different payload structure for creatureProperties.damage
              updatePayload.operation = 'set';
              updatePayload.value = updateValue;
              delete updatePayload.path; // Remove path field, not used in damage method
            } else {
              updatePayload.path = [fieldName];
              updatePayload.value = updateValue;
            }
          }
        }
      } else {
        console.warn('[DiceCloud Sync] No DiceCloud token available for verification');
      }
    } catch (error) {
      console.error('[DiceCloud Sync] Failed to get current property value:', error);
    }

    // Determine which DDP method to use based on property type
    let methodName = 'creatureProperties.update';
    if (updatePayload.operation === 'set' && !updatePayload.path) {
      // For healthBar attributes, use the damage method
      methodName = 'creatureProperties.damage';
    }

    console.log(`[DiceCloud Sync] Using DDP method: ${methodName}`);
    console.log('[DiceCloud Sync] DDP update payload:', JSON.stringify(updatePayload, null, 2));

    // Queue the actual DDP call
    return this.queueRequest(
      async () => {
        const result = await this.ddp.call(methodName, updatePayload);

        console.log(`[DiceCloud Sync] ⏳ Update request sent using ${methodName}:`, result);
        console.log('[DiceCloud Sync] Checking if update was applied...');

        // Verify the update by checking the property again
        setTimeout(async () => {
          try {
            const tokenResult = await browserAPI.storage.local.get(['diceCloudToken']);
            const { diceCloudToken } = tokenResult;

            if (diceCloudToken) {
              console.log('[DiceCloud Sync] Verifying update for property:', propertyId);
              console.log('[DiceCloud Sync] Character ID available:', this.characterId);

              // Use the character endpoint like the debug button does
              const characterId = this.characterId;
              if (!characterId) {
                console.error('[DiceCloud Sync] No character ID available for verification');
                return;
              }

              const verifyResponse = await browserAPI.runtime.sendMessage({
                action: 'fetchDiceCloudAPI',
                url: `https://dicecloud.com/api/creature/${characterId}`,
                token: diceCloudToken
              });

              console.log('[DiceCloud Sync] Verification API response:', verifyResponse);

              if (verifyResponse.success && verifyResponse.data) {
                console.log('[DiceCloud Sync] Verification API data received, looking for property:', propertyId);
                console.log('[DiceCloud Sync] Total properties in response:', verifyResponse.data.creatureProperties?.length);

                // Find the property in the full character data
                const property = verifyResponse.data.creatureProperties.find(p => p._id === propertyId);
                if (property) {
                  console.log('[DiceCloud Sync] Property after update:', {
                    id: property._id,
                    name: property.name,
                    type: property.type,
                    attributeType: property.attributeType,
                    value: property.value,
                    total: property.total,
                    baseValue: property.baseValue,
                    damage: property.damage,
                    dirty: property.dirty,
                    lastUpdated: property.lastUpdated
                  });

                  // Check if the value actually changed
                  if (property.value === value) {
                    console.log('[DiceCloud Sync] ✅ SUCCESS: Value updated correctly!');
                  } else {
                    console.warn('[DiceCloud Sync] ❌ ISSUE: Value did not change. Expected:', value, 'Actual:', property.value);
                    if (property.total && property.damage !== undefined) {
                      const calculatedValue = property.total - property.damage;
                      console.log(`[DiceCloud Sync] Calculated value: ${property.total} - ${property.damage} = ${calculatedValue}`);
                    }
                  }
                } else {
                  console.warn('[DiceCloud Sync] Property not found in character data');
                  console.log('[DiceCloud Sync] Available HP properties:', verifyResponse.data.creatureProperties
                    .filter(p => p.name && p.name.toLowerCase().includes('hit points'))
                    .map(p => ({ id: p._id, name: p.name, value: p.value }))
                  );
                }
              } else {
                console.error('[DiceCloud Sync] Failed to verify update:', verifyResponse.error);
              }
            } else {
              console.warn('[DiceCloud Sync] No DiceCloud token available for verification');
            }
          } catch (error) {
            console.error('[DiceCloud Sync] Failed to verify update:', error);
          }
        }, 1000);

        return result;
      },
      `Update ${attributeName} to ${value}`
    );
  }

  /**
   * Update spell slot current value
   * @param {number} level - Spell level (1-9)
   * @param {number} slotsRemaining - Number of slots remaining
   */
  async updateSpellSlot(level, slotsRemaining) {
    if (!this.enabled) {
      console.warn('[DiceCloud Sync] Sync not enabled');
      return;
    }

    try {
      // Try both naming conventions
      const slotKey = `spellSlot${level}`;
      const slotName = `${level}${this.getOrdinalSuffix(level)} Level`;

      let propertyId = this.findPropertyId(slotKey);
      if (!propertyId) {
        propertyId = this.findPropertyId(slotName);
      }

      if (!propertyId) {
        console.warn(`[DiceCloud Sync] ❌ Spell slot level ${level} not found in property cache`);
        console.warn(`[DiceCloud Sync] Tried keys: "${slotKey}", "${slotName}"`);

        // Show spell slots that ARE cached
        const spellSlotProps = Array.from(this.propertyCache.keys())
          .filter(name => name.toLowerCase().includes('level') || name.toLowerCase().includes('spell'));
        console.warn(`[DiceCloud Sync] Cached spell-related properties:`, spellSlotProps);

        return;
      }

      console.log(`[DiceCloud Sync] Updating spell slot level ${level} to ${slotsRemaining} remaining`);

      // First, let's debug what the spell slot property looks like
      const debugTokenResult = await browserAPI.storage.local.get(['diceCloudToken']);
      if (debugTokenResult.diceCloudToken && this.characterId) {
        const debugResponse = await browserAPI.runtime.sendMessage({
          action: 'fetchDiceCloudAPI',
          url: `https://dicecloud.com/api/creature/${this.characterId}`,
          token: debugTokenResult.diceCloudToken
        });

        if (debugResponse.success && debugResponse.data) {
          const spellSlotProp = debugResponse.data.creatureProperties.find(p => p._id === propertyId);
          if (spellSlotProp) {
            // Log as JSON for easy reading (all fields auto-expanded)
            console.log(`[DiceCloud Sync] 🔍 Spell slot property structure:\n` +
              JSON.stringify(spellSlotProp, null, 2));
          }
        }
      }

      const result = await this.queueRequest(
        () => this.ddp.call('creatureProperties.update', {
          _id: propertyId,
          path: ['value'],
          value: slotsRemaining
        }),
        `Update spell slot level ${level} to ${slotsRemaining}`
      );

      console.log(`[DiceCloud Sync] ⏳ Spell slot level ${level} update request sent:`, result);
      return result;
    } catch (error) {
      console.error(`[DiceCloud Sync] ❌ Failed to update spell slot level ${level}:`, error);
      throw error;
    }
  }

  /**
   * Fetch character data from DiceCloud API
   * @param {string} characterId - The character ID
   * @returns {Promise<object>} The API response data
   */
  async fetchDiceCloudData(characterId) {
    const tokenResult = await browserAPI.storage.local.get(['diceCloudToken']);
    if (!tokenResult.diceCloudToken) {
      throw new Error('No DiceCloud token found');
    }

    const response = await browserAPI.runtime.sendMessage({
      action: 'fetchDiceCloudAPI',
      url: `https://dicecloud.com/api/creature/${characterId}`,
      token: tokenResult.diceCloudToken
    });

    if (!response.success) {
      throw new Error('API request failed');
    }

    return response.data;
  }

  /**
   * Update Channel Divinity uses
   * @param {number} usesRemaining - Number of uses remaining
   */
  async updateChannelDivinity(usesRemaining) {
    if (!this.enabled) {
      console.warn('[DiceCloud Sync] Sync not enabled');
      return;
    }

    try {
      const propertyId = this.findPropertyId('Channel Divinity');
      if (!propertyId) {
        console.warn('[DiceCloud Sync] Channel Divinity not found');
        return;
      }

      console.log(`[DiceCloud Sync] Updating Channel Divinity to ${usesRemaining} uses remaining`);

      // Fetch the property to get its total
      const apiData = await this.fetchDiceCloudData(this.characterId);
      const property = apiData?.creatureProperties?.find(p => p._id === propertyId);

      if (!property) {
        console.error('[DiceCloud Sync] Could not find Channel Divinity property in API data');
        return;
      }

      // Resources work like health bars: value = total - damage
      // To set uses remaining, we use the damage method just like HP
      const total = property.total || property.baseValue?.value || 3;

      console.log(`[DiceCloud Sync] Resource calculation: total=${total}, usesRemaining=${usesRemaining}, damage=${property.damage || 0}`);
      console.log(`[DiceCloud Sync] Channel Divinity before update:`, {
        value: property.value,
        damage: property.damage,
        total: property.total
      });

      // Update the damage field using the damage method (same as HP sync)
      // Resources work like health bars: we set the current value directly
      const result = await this.queueRequest(
        () => this.ddp.call('creatureProperties.damage', {
          _id: propertyId,
          value: usesRemaining,
          operation: 'set'
        }),
        `Update Channel Divinity to ${usesRemaining}`
      );

      console.log('[DiceCloud Sync] ⏳ Channel Divinity update request sent:', result);

      // Verify the update was applied
      if (this.characterId) {
        console.log('[DiceCloud Sync] Verifying Channel Divinity update...');
        try {
          const verifyData = await this.fetchDiceCloudData(this.characterId);
          if (verifyData && verifyData.creatureProperties) {
            const verifiedProperty = verifyData.creatureProperties.find(p => p._id === propertyId);
            if (verifiedProperty) {
              const actualUsesRemaining = (verifiedProperty.total || total) - (verifiedProperty.damage || 0);
              console.log(`[DiceCloud Sync] Channel Divinity after update:`, {
                value: verifiedProperty.value,
                damage: verifiedProperty.damage,
                total: verifiedProperty.total,
                calculatedUsesRemaining: actualUsesRemaining
              });
              if (actualUsesRemaining === usesRemaining || verifiedProperty.value === usesRemaining) {
                console.log('[DiceCloud Sync] ✅ SUCCESS: Channel Divinity updated correctly!');
              } else {
                console.warn(`[DiceCloud Sync] ⚠️ WARNING: Channel Divinity value mismatch! Expected ${usesRemaining}, got ${actualUsesRemaining}`);
              }
            }
          }
        } catch (verifyError) {
          console.warn('[DiceCloud Sync] Could not verify Channel Divinity update:', verifyError);
        }
      }

      return result;
    } catch (error) {
      console.error('[DiceCloud Sync] Failed to update Channel Divinity:', error);
      throw error;
    }
  }

  /**
   * Update any generic resource by name
   * @param {string} resourceName - Name of the resource (Ki Points, Sorcery Points, etc.)
   * @param {number} value - New value
   */
  async updateResource(resourceName, value) {
    if (!this.enabled) {
      console.warn('[DiceCloud Sync] Sync not enabled');
      return;
    }

    try {
      const propertyId = this.findPropertyId(resourceName);
      if (!propertyId) {
        console.warn(`[DiceCloud Sync] ❌ Resource "${resourceName}" not found in property cache`);
        console.warn(`[DiceCloud Sync] Available cached properties:`, Array.from(this.propertyCache.keys()).sort());

        // Suggest similar property names (fuzzy matching)
        const similarNames = Array.from(this.propertyCache.keys())
          .filter(name => name.toLowerCase().includes(resourceName.toLowerCase()) ||
                          resourceName.toLowerCase().includes(name.toLowerCase()))
          .slice(0, 5);

        if (similarNames.length > 0) {
          console.warn(`[DiceCloud Sync] 💡 Did you mean one of these? ${similarNames.join(', ')}`);
        }

        return;
      }

      console.log(`[DiceCloud Sync] Updating ${resourceName} to ${value}`);

      const result = await this.queueRequest(
        () => this.ddp.call('creatureProperties.update', {
          _id: propertyId,
          path: ['value'],
          value: value
        }),
        `Update ${resourceName} to ${value}`
      );

      console.log(`[DiceCloud Sync] ⏳ ${resourceName} update request sent:`, result);
      return result;
    } catch (error) {
      console.error(`[DiceCloud Sync] ❌ Failed to update ${resourceName}:`, error);
      throw error;
    }
  }

  /**
   * Update Temporary Hit Points
   * @param {number} tempHP - Temporary HP value
   */
  async updateTemporaryHP(tempHP) {
    return this.updateResource('Temporary Hit Points', tempHP);
  }

  /**
   * Update Death Saves
   * @param {number} succeeded - Number of succeeded death saves
   * @param {number} failed - Number of failed death saves
   */
  async updateDeathSaves(succeeded, failed) {
    const results = [];

    if (succeeded !== undefined) {
      results.push(await this.updateResource('Succeeded Saves', succeeded));
    }

    if (failed !== undefined) {
      results.push(await this.updateResource('Failed Saves', failed));
    }

    return results;
  }

  /**
   * Update Hit Dice remaining
   * @param {string} dieType - Die type ('d6', 'd8', 'd10', 'd12')
   * @param {number} remaining - Number of hit dice remaining
   */
  async updateHitDice(dieType, remaining) {
    const resourceName = `${dieType} Hit Dice`;
    return this.updateResource(resourceName, remaining);
  }

  /**
   * Update Inspiration/Heroic Inspiration
   * @param {number} value - Inspiration value (typically 0 or 1)
   */
  async updateInspiration(value) {
    return this.updateResource('Heroic Inspiration', value);
  }

  /**
   * Update toggle state (conditions, active features, etc.)
   * @param {string} toggleName - Name of the toggle
   * @param {boolean} enabled - Whether the toggle is enabled
   */
  async updateToggle(toggleName, enabled) {
    if (!this.enabled) {
      console.warn('[DiceCloud Sync] Sync not enabled');
      return;
    }

    try {
      const propertyId = this.findPropertyId(toggleName);
      if (!propertyId) {
        console.warn(`[DiceCloud Sync] Toggle "${toggleName}" not found`);
        return;
      }

      console.log(`[DiceCloud Sync] Setting toggle ${toggleName} to ${enabled ? 'enabled' : 'disabled'}`);

      // Toggles use the 'enabled' field instead of 'value'
      const result = await this.queueRequest(
        () => this.ddp.call('creatureProperties.update', {
          _id: propertyId,
          path: ['enabled'],
          value: enabled
        }),
        `Update toggle ${toggleName} to ${enabled ? 'enabled' : 'disabled'}`
      );

      console.log(`[DiceCloud Sync] ⏳ Toggle ${toggleName} update request sent:`, result);
      return result;
    } catch (error) {
      console.error(`[DiceCloud Sync] Failed to update toggle ${toggleName}:`, error);
      throw error;
    }
  }

  /**
   * Helper to get ordinal suffix (1st, 2nd, 3rd, etc.)
   */
  getOrdinalSuffix(num) {
    const j = num % 10;
    const k = num % 100;
    if (j === 1 && k !== 11) return 'st';
    if (j === 2 && k !== 12) return 'nd';
    if (j === 3 && k !== 13) return 'rd';
    return 'th';
  }

  findPropertyId(attributeName) {
    // Direct cache lookup (handles all mapped variants)
    const propertyId = this.propertyCache.get(attributeName);
    if (propertyId) {
      console.log(`[DiceCloud Sync] ✅ Found property ID for "${attributeName}": ${propertyId}`);
      return propertyId;
    }

    // Try to find the canonical name for this attribute
    // (in case the attribute name is a variant we haven't seen before)
    for (const [canonicalName, variants] of Object.entries(this.propertyVariants)) {
      if (variants.includes(attributeName) || canonicalName === attributeName) {
        // Try to find the property by canonical name
        const canonicalId = this.propertyCache.get(canonicalName);
        if (canonicalId) {
          console.log(`[DiceCloud Sync] 🔍 Found "${attributeName}" via canonical name "${canonicalName}": ${canonicalId}`);
          // Cache this variant for future lookups
          this.propertyCache.set(attributeName, canonicalId);
          return canonicalId;
        }

        // Try each variant
        for (const variant of variants) {
          const variantId = this.propertyCache.get(variant);
          if (variantId) {
            console.log(`[DiceCloud Sync] 🔍 Found "${attributeName}" via variant "${variant}": ${variantId}`);
            // Cache this variant for future lookups
            this.propertyCache.set(attributeName, variantId);
            return variantId;
          }
        }
      }
    }

    // Handle special cases for Hit Points (use class-specific HP instead of calculated base HP)
    if (attributeName === 'Hit Points' || attributeName === 'hitPoints' || attributeName === 'hp') {
      console.log('[DiceCloud Sync] Looking for Hit Points alternatives...');
      const hpRelatedProps = Array.from(this.propertyCache.keys()).filter(name =>
        name.toLowerCase().includes('hit points') ||
        name.toLowerCase().includes('hp') ||
        name.toLowerCase().includes('health')
      );
      console.log('[DiceCloud Sync] HP-related properties found:', hpRelatedProps);

      // Try class-specific HP first (like "Hit Points: Monk")
      const classSpecificHP = hpRelatedProps.find(name => name !== 'Hit Points' && name.includes('Hit Points'));
      if (classSpecificHP) {
        const classSpecificId = this.propertyCache.get(classSpecificHP);
        console.log(`[DiceCloud Sync] Using class-specific HP: ${classSpecificHP} -> ${classSpecificId}`);
        return classSpecificId;
      }
    }

    // Handle special cases for Channel Divinity (search for class-specific variants)
    if (attributeName === 'Channel Divinity' || attributeName === 'channelDivinity' ||
        attributeName === 'channelDivinityCleric' || attributeName === 'channelDivinityPaladin') {
      console.log('[DiceCloud Sync] Looking for Channel Divinity alternatives...');
      const cdRelatedProps = Array.from(this.propertyCache.keys()).filter(name =>
        name.toLowerCase().includes('channel divinity') ||
        name.toLowerCase().includes('channeldivinity')
      );
      console.log('[DiceCloud Sync] Channel Divinity-related properties found:', cdRelatedProps);

      // Try class-specific Channel Divinity first (like "Channel Divinity: Cleric" or "Channel Divinity: Paladin")
      const classSpecificCD = cdRelatedProps.find(name =>
        name !== 'Channel Divinity' &&
        (name.includes('Channel Divinity') || name.includes('channelDivinity'))
      );
      if (classSpecificCD) {
        const classSpecificId = this.propertyCache.get(classSpecificCD);
        console.log(`[DiceCloud Sync] Using class-specific Channel Divinity: ${classSpecificCD} -> ${classSpecificId}`);
        return classSpecificId;
      }

      // Fall back to any Channel Divinity variant found
      if (cdRelatedProps.length > 0) {
        const anyCD = cdRelatedProps[0];
        const anyCDId = this.propertyCache.get(anyCD);
        console.log(`[DiceCloud Sync] Using Channel Divinity variant: ${anyCD} -> ${anyCDId}`);
        return anyCDId;
      }
    }

    console.warn(`[DiceCloud Sync] ❌ Property ID not found for: "${attributeName}"`);
    console.warn(`[DiceCloud Sync] Available properties (showing first 20):`, Array.from(this.propertyCache.keys()).slice(0, 20));

    // Show potential matches
    const potentialMatches = Array.from(this.propertyCache.keys()).filter(name =>
      name.toLowerCase().includes(attributeName.toLowerCase()) ||
      attributeName.toLowerCase().includes(name.toLowerCase())
    );
    if (potentialMatches.length > 0) {
      console.warn(`[DiceCloud Sync] 💡 Potential matches:`, potentialMatches);
    }

    return null;
  }

  setupRoll20EventListeners() {
    console.log('[DiceCloud Sync] Setting up Roll20 event listeners...');
    
    // Listen for character data updates from popup
    window.addEventListener('message', (event) => {
      if (event.data.type === 'characterDataUpdate') {
        console.log('[SYNC DEBUG] Received characterDataUpdate message');
        console.log('[SYNC DEBUG] Full event.data:', event.data);
        console.log('[SYNC DEBUG] event.data.characterData:', event.data.characterData);
        console.log('[SYNC DEBUG] channelDivinity in message:', event.data.characterData?.channelDivinity);
        console.log('[SYNC DEBUG] resources in message:', event.data.characterData?.resources);
        this.handleCharacterDataUpdate(event.data.characterData);
      }
    });

    // Listen for action usage updates
    window.addEventListener('message', (event) => {
      if (event.data.type === 'actionUsageUpdate') {
        this.handleActionUsageUpdate(event.data.actionName, event.data.usesUsed);
      }
    });

    // Listen for attribute updates
    window.addEventListener('message', (event) => {
      if (event.data.type === 'attributeUpdate') {
        this.handleAttributeUpdate(event.data.attributeName, event.data.value);
      }
    });

    console.log('[DiceCloud Sync] Roll20 event listeners set up');
  }

  /**
   * Handle character data updates from Roll20
   * @param {Object} characterData - Updated character data
   */
  async handleCharacterDataUpdate(characterData) {
    if (!this.enabled) {
      console.warn('[DiceCloud Sync] Sync not enabled, ignoring update');
      return;
    }

    console.log('[DiceCloud Sync] ========== HANDLING CHARACTER DATA UPDATE ==========');
    console.log('[DiceCloud Sync] Character:', characterData.name);
    console.log('[DiceCloud Sync] Received data keys:', Object.keys(characterData));
    console.log('[DiceCloud Sync] Resources:', characterData.resources);
    console.log('[DiceCloud Sync] Channel Divinity:', characterData.channelDivinity);
    console.log('[DiceCloud Sync] Death Saves:', characterData.deathSaves);
    console.log('[DiceCloud Sync] Inspiration:', characterData.inspiration);
    console.log('[DiceCloud Sync] Actions:', characterData.actions);
    console.log('[DiceCloud Sync] Property Cache size:', this.propertyCache.size);
    console.log('[DiceCloud Sync] Property Cache keys:', Array.from(this.propertyCache.keys()));
    console.log('[DiceCloud Sync] ========================================');

    // If previousValues is completely empty, this is the very first update
    // Initialize all values from this update without syncing
    if (this.previousValues.size === 0) {
      console.log('[DiceCloud Sync] 🔧 previousValues is empty, initializing from first update (no sync)');
      await this.initializePreviousValues(characterData);
      return; // Don't sync anything on first initialization
    }

    // Helper function to check if value has changed
    const hasChanged = (key, newValue) => {
      const oldValue = this.previousValues.get(key);

      // If this is the first time we're seeing this value, initialize it without syncing
      if (oldValue === undefined) {
        console.log(`[DiceCloud Sync] 📥 Initializing ${key}: ${newValue} (no sync)`);
        this.previousValues.set(key, newValue);
        return false; // Don't sync on first initialization
      }

      const changed = oldValue !== newValue;
      if (changed) {
        console.log(`[DiceCloud Sync] ✏️ Value changed for ${key}: ${oldValue} -> ${newValue} (will sync)`);
        this.previousValues.set(key, newValue);
      }
      // Skip logging for unchanged values to reduce console spam
      return changed;
    };

    // Update HP if changed
    if (characterData.hp !== undefined && hasChanged('Hit Points', characterData.hp)) {
      await this.updateAttributeValue('Hit Points', characterData.hp);
    }

    // Update temporary HP if changed
    if (characterData.tempHp !== undefined && hasChanged('Temporary Hit Points', characterData.tempHp)) {
      await this.updateAttributeValue('Temporary Hit Points', characterData.tempHp);
    }

    // Update max HP if changed
    if (characterData.maxHp !== undefined && hasChanged('Max Hit Points', characterData.maxHp)) {
      await this.updateAttributeValue('Max Hit Points', characterData.maxHp);
    }

    // Update spell slots if they exist (level1SpellSlots, level2SpellSlots, etc.)
    if (characterData.spellSlots) {
      for (let level = 1; level <= 9; level++) {
        const currentKey = `level${level}SpellSlots`;
        const maxKey = `level${level}SpellSlotsMax`;

        if (characterData.spellSlots[currentKey] !== undefined && characterData.spellSlots[maxKey] !== undefined) {
          // Only sync if max > 0 (character has slots of this level)
          if (characterData.spellSlots[maxKey] > 0) {
            const cacheKey = `spellSlot${level}`;
            const currentValue = characterData.spellSlots[currentKey];
            const previousValue = this.previousValues.get(cacheKey);

            console.log(`[SYNC DEBUG] Spell Slot Level ${level} - previous: ${previousValue}, current: ${currentValue}`);
            if (hasChanged(cacheKey, currentValue)) {
              console.log(`[DiceCloud Sync] ✅ Syncing spell slot level ${level}: ${currentValue}/${characterData.spellSlots[maxKey]}`);
              await this.updateSpellSlot(level, currentValue);
            } else {
              console.log(`[SYNC DEBUG] ⏭️ Spell slot level ${level} unchanged (${currentValue}), skipping sync`);
            }
          }
        }
      }
    }

    // Update Channel Divinity if it exists
    console.log('[SYNC DEBUG] characterData.channelDivinity:', characterData.channelDivinity);
    console.log('[SYNC DEBUG] characterData.resources:', characterData.resources);
    if (characterData.channelDivinity && characterData.channelDivinity.current !== undefined) {
      const currentValue = characterData.channelDivinity.current;
      const previousValue = this.previousValues.get('Channel Divinity');
      console.log(`[SYNC DEBUG] Channel Divinity - previous: ${previousValue}, current: ${currentValue}`);
      if (hasChanged('Channel Divinity', currentValue)) {
        console.log(`[DiceCloud Sync] ✅ Syncing Channel Divinity: ${currentValue}/${characterData.channelDivinity.max}`);
        await this.updateChannelDivinity(currentValue);
      } else {
        console.log(`[SYNC DEBUG] ⏭️ Channel Divinity unchanged (${currentValue}), skipping sync`);
      }
    } else {
      console.log('[SYNC DEBUG] Channel Divinity check failed - object is null or current is undefined');
    }

    // Update other tracked resources
    console.log('[SYNC DEBUG] Checking resources for sync...');
    if (characterData.resources && Array.isArray(characterData.resources)) {
      console.log(`[SYNC DEBUG] Found ${characterData.resources.length} resources in characterData`);
      for (const resource of characterData.resources) {
        console.log(`[SYNC DEBUG] Resource: ${resource.name} - current: ${resource.current}, max: ${resource.max}`);
        if (resource.name && resource.current !== undefined) {
          const propertyId = this.findPropertyId(resource.name);
          console.log(`[SYNC DEBUG] Property ID for ${resource.name}: ${propertyId || 'NOT FOUND'}`);
          if (hasChanged(resource.name, resource.current)) {
            console.log(`[DiceCloud Sync] ✅ Syncing resource ${resource.name}: ${resource.current}/${resource.max}`);
            await this.updateResource(resource.name, resource.current);
          } else {
            console.log(`[SYNC DEBUG] ⏭️ Resource ${resource.name} unchanged, skipping sync`);
          }
        } else {
          console.log(`[SYNC DEBUG] ❌ Resource ${resource.name} missing name or current value`);
        }
      }
    } else {
      console.log('[SYNC DEBUG] No resources array in characterData');
    }

    // Update death saves if changed
    console.log('[SYNC DEBUG] Checking death saves for sync...');
    if (characterData.deathSaves) {
      console.log(`[SYNC DEBUG] Death saves object:`, characterData.deathSaves);
      if (characterData.deathSaves.successes !== undefined) {
        const propertyId = this.findPropertyId('Succeeded Saves');
        console.log(`[SYNC DEBUG] Property ID for Succeeded Saves: ${propertyId || 'NOT FOUND'}`);
        if (hasChanged('Succeeded Saves', characterData.deathSaves.successes)) {
          console.log(`[DiceCloud Sync] ✅ Syncing Succeeded Saves: ${characterData.deathSaves.successes}`);
          await this.updateDeathSaves(characterData.deathSaves.successes, undefined);
        } else {
          console.log(`[SYNC DEBUG] ⏭️ Succeeded Saves unchanged, skipping sync`);
        }
      }
      if (characterData.deathSaves.failures !== undefined) {
        const propertyId = this.findPropertyId('Failed Saves');
        console.log(`[SYNC DEBUG] Property ID for Failed Saves: ${propertyId || 'NOT FOUND'}`);
        if (hasChanged('Failed Saves', characterData.deathSaves.failures)) {
          console.log(`[DiceCloud Sync] ✅ Syncing Failed Saves: ${characterData.deathSaves.failures}`);
          await this.updateDeathSaves(undefined, characterData.deathSaves.failures);
        } else {
          console.log(`[SYNC DEBUG] ⏭️ Failed Saves unchanged, skipping sync`);
        }
      }
    } else {
      console.log('[SYNC DEBUG] No deathSaves object in characterData');
    }

    // Update inspiration if changed
    console.log('[SYNC DEBUG] Checking inspiration for sync...');
    if (characterData.inspiration !== undefined) {
      const propertyId = this.findPropertyId('Inspiration');
      console.log(`[SYNC DEBUG] Inspiration value: ${characterData.inspiration}, Property ID: ${propertyId || 'NOT FOUND'}`);
      if (hasChanged('Inspiration', characterData.inspiration)) {
        console.log(`[DiceCloud Sync] ✅ Syncing Inspiration: ${characterData.inspiration}`);
        await this.updateInspiration(characterData.inspiration);
      } else {
        console.log(`[SYNC DEBUG] ⏭️ Inspiration unchanged, skipping sync`);
      }
    } else {
      console.log('[SYNC DEBUG] No inspiration value in characterData');
    }

    // Update action uses if changed
    console.log('[SYNC DEBUG] Checking actions for sync...');
    if (characterData.actions && Array.isArray(characterData.actions)) {
      console.log(`[SYNC DEBUG] Found ${characterData.actions.length} actions in characterData`);
      for (const action of characterData.actions) {
        console.log(`[SYNC DEBUG] Action: ${action.name} - uses: ${action.uses}, usesUsed: ${action.usesUsed}, _id: ${action._id}`);
        if (action.name && action.uses && action.usesUsed !== undefined && action._id) {
          const cacheKey = `action_${action.name}`;
          if (hasChanged(cacheKey, action.usesUsed)) {
            console.log(`[DiceCloud Sync] ✅ Syncing action ${action.name}: ${action.usesUsed} uses used`);
            await this.setActionUses(action._id, action.usesUsed);
          } else {
            console.log(`[SYNC DEBUG] ⏭️ Action ${action.name} unchanged, skipping sync`);
          }
        } else {
          console.log(`[SYNC DEBUG] ❌ Action ${action.name} missing required fields (uses: ${action.uses}, usesUsed: ${action.usesUsed}, _id: ${action._id})`);
        }
      }
    } else {
      console.log('[SYNC DEBUG] No actions array in characterData');
    }
  }

  /**
   * Handle action usage updates from Roll20
   * @param {string} actionName - Name of the action
   * @param {number} usesUsed - New uses used value
   */
  async handleActionUsageUpdate(actionName, usesUsed) {
    if (!this.enabled) {
      console.warn('[DiceCloud Sync] Sync not enabled, ignoring action update');
      return;
    }

    console.log(`[DiceCloud Sync] Handling action usage update: ${actionName} -> ${usesUsed}`);
    await this.setActionUses(actionName, usesUsed);
  }

  /**
   * Handle attribute updates from Roll20
   * @param {string} attributeName - Name of the attribute
   * @param {number} value - New value
   */
  async handleAttributeUpdate(attributeName, value) {
    if (!this.enabled) {
      console.warn('[DiceCloud Sync] Sync not enabled, ignoring attribute update');
      return;
    }

    console.log(`[DiceCloud Sync] Handling attribute update: ${attributeName} -> ${value}`);
    await this.updateAttributeValue(attributeName, value);
  }

  /**
   * Check if sync is enabled
   * @returns {boolean} True if sync is enabled
   */
  isEnabled() {
    return this.enabled;
  }

  /**
   * Disable sync
   */
  disable() {
    this.enabled = false;
    console.log('[DiceCloud Sync] Sync disabled');
  }

  /**
   * Enable sync
   */
  enable() {
    if (this.characterId && this.ddp.isConnected()) {
      this.enabled = true;
      console.log('[DiceCloud Sync] Sync enabled');
    } else {
      console.warn('[DiceCloud Sync] Cannot enable sync - not initialized');
    }
  }
}

// Global initialization function
window.initializeDiceCloudSync = async function() {
  console.log('[DiceCloud Sync] Global initialization called');
  console.log('[DiceCloud Sync] Current URL:', window.location.href);

  try {
    // Get DiceCloud token for authentication
    const tokenResult = await browserAPI.storage.local.get(['diceCloudToken']);
    const { diceCloudToken } = tokenResult;

    // Check if we already have a DDP client that's connected
    if (window.diceCloudSync && window.diceCloudSync.ddp && window.diceCloudSync.ddp.isConnected()) {
      console.log('[DiceCloud Sync] DDP already connected, checking authentication...');

      // If we now have a token but weren't authenticated before, authenticate now
      if (diceCloudToken) {
        console.log('[DiceCloud Sync] Authenticating existing DDP connection...');
        try {
          const result = await window.diceCloudSync.ddp.call('login', {
            resume: diceCloudToken
          });
          console.log('[DiceCloud Sync] DDP authentication successful:', result);

          // Re-initialize the sync with character data
          const charResult = await browserAPI.storage.local.get(['activeCharacterId', 'characterProfiles']);
          const { activeCharacterId, characterProfiles } = charResult;

          if (activeCharacterId && characterProfiles && characterProfiles[activeCharacterId]) {
            const profileData = characterProfiles[activeCharacterId];
            if (profileData && profileData.id) {
              console.log('[DiceCloud Sync] Re-initializing with character:', profileData.id);
              await window.diceCloudSync.initialize(profileData.id);
            }
          }

          return; // Don't create a new connection
        } catch (error) {
          console.error('[DiceCloud Sync] Authentication failed:', error);
          // Fall through to create a new connection
        }
      } else {
        console.log('[DiceCloud Sync] Already initialized, skipping');
        return;
      }
    }

    // Create DDP client
    console.log('[DiceCloud Sync] Creating new DDP client...');
    const ddpClient = new DDPClient('wss://dicecloud.com/websocket');
    
    if (diceCloudToken) {
      console.log('[DiceCloud Sync] Setting up DDP authentication...');
      // Set up authentication after connection
      ddpClient.onConnected = async () => {
        console.log('[DiceCloud Sync] DDP connected, authenticating...');
        try {
          const result = await ddpClient.call('login', {
            resume: diceCloudToken
          });
          console.log('[DiceCloud Sync] DDP authentication successful:', result);
        } catch (error) {
          console.error('[DiceCloud Sync] DDP authentication failed:', error);
        }
      };
      
      // Connect to DDP
      console.log('[DiceCloud Sync] About to connect to DDP...');
      try {
        await ddpClient.connect();
        console.log('[DiceCloud Sync] DDP connect() completed');
      } catch (error) {
        console.error('[DiceCloud Sync] DDP connect() failed:', error);
      }
    } else {
      console.warn('[DiceCloud Sync] No DiceCloud token found for DDP authentication');
      // Still connect without authentication
      console.log('[DiceCloud Sync] About to connect to DDP without token...');
      try {
        await ddpClient.connect();
        console.log('[DiceCloud Sync] DDP connect() completed without token');
      } catch (error) {
        console.error('[DiceCloud Sync] DDP connect() failed without token:', error);
      }
    }
    
    // Create sync instance
    const sync = new DiceCloudSync(ddpClient);
    window.diceCloudSync = sync;
    
    console.log('[DiceCloud Sync] Sync instance created, checking for active character...');
    
    // Try to initialize with active character
    const tryInitialize = async () => {
      try {
        console.log('[DiceCloud Sync] Trying to initialize...');
        
        // Check if browser API is available
        if (typeof browserAPI !== 'undefined' && browserAPI && browserAPI.storage && browserAPI.storage.local) {
          console.log('[DiceCloud Sync] Browser API available, checking storage...');

          const result = await browserAPI.storage.local.get(['activeCharacterId', 'characterProfiles']);
          const { activeCharacterId, characterProfiles } = result;
          console.log('[DiceCloud Sync] Storage result:', { activeCharacterId, characterProfilesKeys: characterProfiles ? Object.keys(characterProfiles) : null });
          
          if (activeCharacterId && characterProfiles && characterProfiles[activeCharacterId]) {
            const characterData = characterProfiles[activeCharacterId];
            console.log('[DiceCloud Sync] Character data for key:', activeCharacterId, characterData);
            
            // Check if we have character profiles and find the DiceCloud character ID
            if (characterProfiles && typeof characterProfiles === 'object') {
              console.log('[DiceCloud Sync] Checking characterProfiles object:', Object.keys(characterProfiles));
              
              // Find the character data in characterProfiles
              const profileData = characterProfiles[activeCharacterId] || characterProfiles.default || characterProfiles['slot-1'];
              if (profileData && profileData.id) {
                console.log('[DiceCloud Sync] Found character data in characterProfiles:', profileData);
                console.log('[DiceCloud Sync] Found DiceCloud character ID:', profileData.id);
                
                // Initialize sync with the character ID
                await sync.initialize(profileData.id);
                
                // Set up event listeners
                sync.setupRoll20EventListeners();
                console.log('[DiceCloud Sync] Event listeners set up');
                
                console.log('[DiceCloud Sync] Global initialization complete');
                return;
              }
            }
          } else {
            console.warn('[DiceCloud Sync] No active character found in storage');
            console.log('[DiceCloud Sync] All storage keys:', Object.keys(result));
            console.log('[DiceCloud Sync] All storage data:', result);
          }
        } else {
          console.warn('[DiceCloud Sync] Browser API not available');
        }
        
        // Retry after delay if no character found
        console.log('[DiceCloud Sync] Retrying in 2 seconds...');
        setTimeout(tryInitialize, 2000);
      } catch (error) {
        // Check if the extension context was invalidated (Chrome MV3 service worker terminated)
        if (error.message && error.message.includes('Extension context invalidated')) {
          console.warn('[DiceCloud Sync] Extension context invalidated - service worker terminated.');
          console.warn('[DiceCloud Sync] This happens when Chrome terminates the background service worker.');
          console.warn('[DiceCloud Sync] The extension will reinitialize when the page is refreshed or the extension is reloaded.');
          // Don't retry - the user needs to reload the extension or refresh the page
          return;
        }

        console.error('[DiceCloud Sync] Error during initialization:', error);
        console.log('[DiceCloud Sync] Retrying in 5 seconds...');
        setTimeout(tryInitialize, 5000);
      }
    };
    
    // Start initialization
    tryInitialize();
    
  } catch (error) {
    console.error('[DiceCloud Sync] Failed to create sync instance:', error);
    console.error('[DiceCloud Sync] Error details:', error.stack);
  }
};

// Auto-initialize if we're on Roll20
if (window.location.hostname === 'app.roll20.net') {
  console.log('[DiceCloud Sync] Detected Roll20, initializing sync...');
  // Wait a bit for page to load
  setTimeout(() => {
    window.initializeDiceCloudSync();
  }, 1000);

  // Listen for storage changes (e.g., when user logs in via popup)
  if (typeof browserAPI !== 'undefined' && browserAPI && browserAPI.storage && browserAPI.storage.onChanged) {
    browserAPI.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local' && changes.diceCloudToken) {
        const newToken = changes.diceCloudToken.newValue;
        const oldToken = changes.diceCloudToken.oldValue;

        // If token was added or changed, re-initialize sync with authentication
        if (newToken && newToken !== oldToken) {
          console.log('[DiceCloud Sync] Token detected, re-initializing with authentication...');
          // Re-initialize the sync with the new token
          window.initializeDiceCloudSync();
        }
      }
    });
    console.log('[DiceCloud Sync] Storage listener registered for token changes');
  }
}
