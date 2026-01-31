/**
 * Effects Manager Module
 *
 * Handles buffs, debuffs, and conditions tracking.
 * Loaded as a plain script (no ES6 modules) to export to globalThis.
 *
 * Functions exported to globalThis:
 * - initConditionsManager()
 * - showEffectsModal()
 * - addEffect(effectName, type)
 * - removeEffect(effectName, type)
 * - addCondition(conditionName) - legacy wrapper
 * - removeCondition(conditionName) - legacy wrapper
 * - updateEffectsDisplay()
 * - updateConditionsDisplay() - legacy wrapper
 * - calculateTotalAC()
 *
 * Constants exported to globalThis:
 * - POSITIVE_EFFECTS
 * - NEGATIVE_EFFECTS
 *
 * State variables exported to globalThis:
 * - activeBuffs
 * - activeConditions
 */

(function() {
  'use strict';

  // ===== EFFECTS CONSTANTS =====

  const POSITIVE_EFFECTS = [
    {
      name: 'Bless',
      icon: '✨',
      color: '#f39c12',
      description: '+1d4 to attack rolls and saving throws',
      modifier: { attack: '1d4', save: '1d4' },
      autoApply: true
    },
    {
      name: 'Guidance',
      icon: '🙏',
      color: '#3498db',
      description: '+1d4 to one ability check',
      modifier: { skill: '1d4' },
      autoApply: false // User choice required
    },
    {
      name: 'Bardic Inspiration (d6)',
      icon: '🎵',
      color: '#9b59b6',
      description: 'Bard levels 1-4: +d6 to ability check, attack, or save',
      modifier: { attack: 'd6', skill: 'd6', save: 'd6' },
      autoApply: false
    },
    {
      name: 'Bardic Inspiration (d8)',
      icon: '🎵',
      color: '#9b59b6',
      description: 'Bard levels 5-9: +d8 to ability check, attack, or save',
      modifier: { attack: 'd8', skill: 'd8', save: 'd8' },
      autoApply: false
    },
    {
      name: 'Bardic Inspiration (d10)',
      icon: '🎵',
      color: '#9b59b6',
      description: 'Bard levels 10-14: +d10 to ability check, attack, or save',
      modifier: { attack: 'd10', skill: 'd10', save: 'd10' },
      autoApply: false
    },
    {
      name: 'Bardic Inspiration (d12)',
      icon: '🎵',
      color: '#9b59b6',
      description: 'Bard levels 15-20: +d12 to ability check, attack, or save',
      modifier: { attack: 'd12', skill: 'd12', save: 'd12' },
      autoApply: false
    },
    {
      name: 'Haste',
      icon: '⚡',
      color: '#3498db',
      description: '+2 AC, advantage on DEX saves, extra action',
      modifier: { ac: 2, dexSave: 'advantage' },
      autoApply: true
    },
    {
      name: 'Enlarge',
      icon: '⬆️',
      color: '#c2185b',
      description: '+1d4 weapon damage, advantage on STR checks/saves',
      modifier: { damage: '1d4', strCheck: 'advantage', strSave: 'advantage' },
      autoApply: true
    },
    {
      name: 'Invisibility',
      icon: '👻',
      color: '#ecf0f1',
      description: 'Advantage on attack rolls, enemies have disadvantage',
      modifier: { attack: 'advantage' },
      autoApply: true
    },
    {
      name: 'Shield of Faith',
      icon: '🛡️',
      color: '#f39c12',
      description: '+2 AC',
      modifier: { ac: 2 },
      autoApply: true
    },
    {
      name: 'Heroism',
      icon: '🦸',
      color: '#e67e22',
      description: 'Immune to frightened, temp HP each turn',
      modifier: { frightened: 'immune' },
      autoApply: true
    },
    {
      name: 'Enhance Ability',
      icon: '💪',
      color: '#c2185b',
      description: 'Advantage on ability checks with chosen ability',
      modifier: { skill: 'advantage' },
      autoApply: false
    },
    {
      name: 'Rage',
      icon: '😡',
      color: '#e74c3c',
      description: '+2 damage on melee attacks, advantage on STR checks/saves, resistance to physical damage',
      modifier: { damage: 2, strCheck: 'advantage', strSave: 'advantage', physicalResistance: true },
      autoApply: true
    },
    {
      name: 'Rage (+3)',
      icon: '😤',
      color: '#c0392b',
      description: 'Level 9-15: +3 damage on melee attacks, advantage on STR checks/saves, resistance to physical damage',
      modifier: { damage: 3, strCheck: 'advantage', strSave: 'advantage', physicalResistance: true },
      autoApply: true
    },
    {
      name: 'Rage (+4)',
      icon: '🔥',
      color: '#8b0000',
      description: 'Level 16+: +4 damage on melee attacks, advantage on STR checks/saves, resistance to physical damage',
      modifier: { damage: 4, strCheck: 'advantage', strSave: 'advantage', physicalResistance: true },
      autoApply: true
    },
    {
      name: 'Aid',
      icon: '❤️',
      color: '#e74c3c',
      description: 'Max HP increased by 5',
      modifier: { maxHp: 5 },
      autoApply: true
    },
    {
      name: 'True Strike',
      icon: '🎯',
      color: '#3498db',
      description: 'Advantage on next attack roll',
      modifier: { attack: 'advantage' },
      autoApply: true
    },
    {
      name: 'Faerie Fire',
      icon: '✨',
      color: '#9b59b6',
      description: 'Attackers have advantage against target',
      modifier: {},
      autoApply: false
    }
  ];

  // NEGATIVE EFFECTS (Debuffs/Conditions)
  const NEGATIVE_EFFECTS = [
    {
      name: 'Bane',
      icon: '💀',
      color: '#e74c3c',
      description: '-1d4 to attack rolls and saving throws',
      modifier: { attack: '-1d4', save: '-1d4' },
      autoApply: true
    },
    {
      name: 'Poisoned',
      icon: '☠️',
      color: '#c2185b',
      description: 'Disadvantage on attack rolls and ability checks',
      modifier: { attack: 'disadvantage', skill: 'disadvantage' },
      autoApply: true
    },
    {
      name: 'Frightened',
      icon: '😱',
      color: '#e67e22',
      description: 'Disadvantage on ability checks and attack rolls',
      modifier: { attack: 'disadvantage', skill: 'disadvantage' },
      autoApply: true
    },
    {
      name: 'Stunned',
      icon: '💫',
      color: '#9b59b6',
      description: 'Incapacitated, auto-fail STR/DEX saves, attackers have advantage',
      modifier: { strSave: 'fail', dexSave: 'fail' },
      autoApply: true
    },
    {
      name: 'Paralyzed',
      icon: '🧊',
      color: '#34495e',
      description: 'Incapacitated, auto-fail STR/DEX saves, attacks within 5ft are crits',
      modifier: { strSave: 'fail', dexSave: 'fail' },
      autoApply: true
    },
    {
      name: 'Restrained',
      icon: '⛓️',
      color: '#7f8c8d',
      description: 'Disadvantage on DEX saves and attack rolls',
      modifier: { attack: 'disadvantage', dexSave: 'disadvantage' },
      autoApply: true
    },
    {
      name: 'Blinded',
      icon: '🙈',
      color: '#34495e',
      description: 'Auto-fail sight checks, disadvantage on attacks',
      modifier: { attack: 'disadvantage', perception: 'disadvantage' },
      autoApply: true
    },
    {
      name: 'Deafened',
      icon: '🙉',
      color: '#7f8c8d',
      description: 'Auto-fail hearing checks',
      modifier: { perception: 'disadvantage' },
      autoApply: true
    },
    {
      name: 'Charmed',
      icon: '💖',
      color: '#e91e63',
      description: 'Cannot attack charmer, charmer has advantage on social checks',
      modifier: {},
      autoApply: false
    },
    {
      name: 'Grappled',
      icon: '🤼',
      color: '#f39c12',
      description: 'Speed becomes 0',
      modifier: { speed: 0 },
      autoApply: true
    },
    {
      name: 'Prone',
      icon: '⬇️',
      color: '#95a5a6',
      description: 'Disadvantage on attack rolls, melee attacks against you have advantage',
      modifier: { attack: 'disadvantage' },
      autoApply: true
    },
    {
      name: 'Incapacitated',
      icon: '😵',
      color: '#c0392b',
      description: 'Cannot take actions or reactions',
      modifier: {},
      autoApply: false
    },
    {
      name: 'Unconscious',
      icon: '😴',
      color: '#34495e',
      description: 'Incapacitated, drop everything, auto-fail STR/DEX saves',
      modifier: { strSave: 'fail', dexSave: 'fail' },
      autoApply: true
    },
    {
      name: 'Petrified',
      icon: '🗿',
      color: '#95a5a6',
      description: 'Incapacitated, auto-fail STR/DEX saves, resistance to all damage',
      modifier: { strSave: 'fail', dexSave: 'fail' },
      autoApply: true
    },
    {
      name: 'Slowed',
      icon: '🐌',
      color: '#95a5a6',
      description: 'Speed halved, -2 AC and DEX saves, no reactions',
      modifier: { ac: -2, dexSave: '-2' },
      autoApply: true
    },
    {
      name: 'Hexed',
      icon: '🔮',
      color: '#9b59b6',
      description: 'Disadvantage on ability checks with chosen ability, extra damage to caster',
      modifier: { skill: 'disadvantage' },
      autoApply: false
    },
    {
      name: 'Cursed',
      icon: '😈',
      color: '#c0392b',
      description: 'Disadvantage on attacks and saves against caster',
      modifier: { attack: 'disadvantage', save: 'disadvantage' },
      autoApply: true
    }
  ];

  // ===== STATE VARIABLES =====

  let activeConditions = [];
  let activeBuffs = [];

  // ===== EFFECTS MANAGEMENT FUNCTIONS =====

  /**
   * Initialize conditions manager UI
   */
  function initConditionsManager() {
    const addConditionBtn = document.getElementById('add-condition-btn');

    if (addConditionBtn) {
      // Open modal when clicking conditions button
      addConditionBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        showEffectsModal();
      });
    }

    debug.log('✅ Effects manager initialized (buffs + debuffs)');
  }

  /**
   * Show effects modal for adding buffs and debuffs
   */
  function showEffectsModal() {
    // Create modal overlay
    const modal = document.createElement('div');
    modal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; z-index: 10000;';

    // Create modal content
    const modalContent = document.createElement('div');
    modalContent.style.cssText = 'background: var(--bg-secondary); color: var(--text-primary); border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,0.3); width: 90%; max-width: 600px; max-height: 80vh; display: flex; flex-direction: column; overflow: hidden;';

    // Modal header
    const header = document.createElement('div');
    header.style.cssText = 'padding: 20px; border-bottom: 2px solid #ecf0f1; background: #f8f9fa;';
    header.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <h3 style="margin: 0; color: var(--text-primary);">🎭 Effects & Conditions</h3>
        <button id="effects-modal-close" style="background: #e74c3c; color: white; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-weight: bold;">✕</button>
      </div>
    `;

    // Tab navigation
    const tabNav = document.createElement('div');
    tabNav.style.cssText = 'display: flex; background: #ecf0f1; border-bottom: 2px solid #bdc3c7;';
    tabNav.innerHTML = `
      <button class="effects-tab-btn" data-tab="buffs" style="flex: 1; padding: 15px; background: var(--bg-tertiary); border: none; border-bottom: 3px solid #c2185b; cursor: pointer; font-weight: bold; font-size: 1em; color: #c2185b; transition: all 0.2s;">✨ Buffs</button>
      <button class="effects-tab-btn" data-tab="debuffs" style="flex: 1; padding: 15px; background: transparent; border: none; border-bottom: 3px solid transparent; cursor: pointer; font-weight: bold; font-size: 1em; color: var(--text-secondary); transition: all 0.2s;">💀 Debuffs</button>
    `;

    // Tab content container
    const tabContent = document.createElement('div');
    tabContent.style.cssText = 'padding: 20px; overflow-y: auto; flex: 1;';

    // Buffs tab
    const buffsTab = document.createElement('div');
    buffsTab.className = 'effects-tab-content';
    buffsTab.dataset.tab = 'buffs';
    buffsTab.style.display = 'block';
    buffsTab.innerHTML = POSITIVE_EFFECTS.map(effect => `
      <div class="effect-option" data-effect="${effect.name}" data-type="positive" style="padding: 12px; margin-bottom: 10px; border: 2px solid ${effect.color}40; border-radius: 8px; cursor: pointer; transition: all 0.2s; background: var(--bg-secondary);">
        <div style="display: flex; align-items: center; gap: 12px;">
          <span class="effect-icon" style="font-size: 1.5em;">${effect.icon}</span>
          <div style="flex: 1;">
            <div class="effect-name" style="font-weight: bold; color: var(--text-primary); margin-bottom: 4px;">${effect.name}</div>
            <div class="effect-description" style="font-size: 0.85em; color: var(--text-secondary);">${effect.description}</div>
          </div>
        </div>
      </div>
    `).join('');

    // Debuffs tab
    const debuffsTab = document.createElement('div');
    debuffsTab.className = 'effects-tab-content';
    debuffsTab.dataset.tab = 'debuffs';
    debuffsTab.style.display = 'none';
    debuffsTab.innerHTML = NEGATIVE_EFFECTS.map(effect => `
      <div class="effect-option" data-effect="${effect.name}" data-type="negative" style="padding: 12px; margin-bottom: 10px; border: 2px solid ${effect.color}40; border-radius: 8px; cursor: pointer; transition: all 0.2s; background: var(--bg-secondary);">
        <div style="display: flex; align-items: center; gap: 12px;">
          <span class="effect-icon" style="font-size: 1.5em;">${effect.icon}</span>
          <div style="flex: 1;">
            <div class="effect-name" style="font-weight: bold; color: var(--text-primary); margin-bottom: 4px;">${effect.name}</div>
            <div class="effect-description" style="font-size: 0.85em; color: var(--text-secondary);">${effect.description}</div>
          </div>
        </div>
      </div>
    `).join('');

    tabContent.appendChild(buffsTab);
    tabContent.appendChild(debuffsTab);

    // Assemble modal
    modalContent.appendChild(header);
    modalContent.appendChild(tabNav);
    modalContent.appendChild(tabContent);
    modal.appendChild(modalContent);
    document.body.appendChild(modal);

    // Tab switching
    const tabButtons = tabNav.querySelectorAll('.effects-tab-btn');
    const tabContents = modalContent.querySelectorAll('.effects-tab-content');

    tabButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const targetTab = btn.dataset.tab;

        // Update button styles
        tabButtons.forEach(b => {
          if (b.dataset.tab === targetTab) {
            b.style.background = 'var(--bg-tertiary)';
            b.style.color = targetTab === 'buffs' ? '#c2185b' : '#e74c3c';
            b.style.borderBottom = `3px solid ${targetTab === 'buffs' ? '#c2185b' : '#e74c3c'}`;
          } else {
            b.style.background = 'transparent';
            b.style.color = '#7f8c8d';
            b.style.borderBottom = '3px solid transparent';
          }
        });

        // Show target tab content
        tabContents.forEach(content => {
          content.style.display = content.dataset.tab === targetTab ? 'block' : 'none';
        });
      });
    });

    // Add hover effects
    modalContent.querySelectorAll('.effect-option').forEach(option => {
      option.addEventListener('mouseenter', () => {
        option.style.transform = 'translateX(5px)';
        option.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
      });
      option.addEventListener('mouseleave', () => {
        option.style.transform = 'translateX(0)';
        option.style.boxShadow = 'none';
      });
    });

    // Add effect when clicking option
    modalContent.querySelectorAll('.effect-option').forEach(option => {
      option.addEventListener('click', () => {
        const effectName = option.dataset.effect;
        const type = option.dataset.type === 'positive' ? 'positive' : 'negative';
        addEffect(effectName, type);
        modal.remove();
      });
    });

    // Close button
    const closeBtn = modalContent.querySelector('#effects-modal-close');
    closeBtn.addEventListener('click', () => modal.remove());

    // Click outside to close
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.remove();
      }
    });
  }

  /**
   * Add an effect (buff or debuff)
   */
  function addEffect(effectName, type) {
    // characterData should be available from global scope
    if (typeof characterData === 'undefined') {
      debug.warn('⚠️ characterData not available');
      return;
    }

    const effectsList = type === 'positive' ? POSITIVE_EFFECTS : NEGATIVE_EFFECTS;
    const activeList = type === 'positive' ? activeBuffs : activeConditions;

    // Don't add if already active
    if (activeList.includes(effectName)) {
      if (typeof showNotification !== 'undefined') {
        showNotification(`⚠️ ${effectName} already active`);
      }
      return;
    }

    const effect = effectsList.find(e => e.name === effectName);
    activeList.push(effectName);

    // Update the correct array reference
    if (type === 'positive') {
      activeBuffs = activeList;
    } else {
      activeConditions = activeList;
    }

    updateEffectsDisplay();
    if (typeof showNotification !== 'undefined') {
      showNotification(`${effect.icon} ${effectName} applied!`);
    }
    debug.log(`✅ Effect added: ${effectName} (${type})`);

    // Announce to Roll20 chat
    const message = type === 'positive'
      ? `${effect.icon} ${characterData.name} gains ${effectName}!`
      : `${effect.icon} ${characterData.name} is now ${effectName}!`;
    if (typeof postToChatIfOpener !== 'undefined') {
      postToChatIfOpener(message);
    }

    // Save to character data
    if (!characterData.activeEffects) {
      characterData.activeEffects = { buffs: [], debuffs: [] };
    }
    if (type === 'positive') {
      characterData.activeEffects.buffs = activeBuffs;
    } else {
      characterData.activeEffects.debuffs = activeConditions;
    }
    if (typeof saveCharacterData !== 'undefined') {
      saveCharacterData();
    }
  }

  /**
   * Remove an effect (buff or debuff)
   */
  function removeEffect(effectName, type) {
    // characterData should be available from global scope
    if (typeof characterData === 'undefined') {
      debug.warn('⚠️ characterData not available');
      return;
    }

    const effectsList = type === 'positive' ? POSITIVE_EFFECTS : NEGATIVE_EFFECTS;
    const effect = effectsList.find(e => e.name === effectName);

    if (type === 'positive') {
      activeBuffs = activeBuffs.filter(e => e !== effectName);
    } else {
      activeConditions = activeConditions.filter(e => e !== effectName);
    }

    updateEffectsDisplay();
    if (typeof showNotification !== 'undefined') {
      showNotification(`✅ ${effectName} removed`);
    }
    debug.log(`🗑️ Effect removed: ${effectName} (${type})`);

    // Announce to Roll20 chat
    const message = type === 'positive'
      ? `✅ ${characterData.name} loses ${effectName}`
      : `✅ ${characterData.name} is no longer ${effectName}`;
    if (typeof postToChatIfOpener !== 'undefined') {
      postToChatIfOpener(message);
    }

    // Save to character data
    if (!characterData.activeEffects) {
      characterData.activeEffects = { buffs: [], debuffs: [] };
    }
    if (type === 'positive') {
      characterData.activeEffects.buffs = activeBuffs;
    } else {
      characterData.activeEffects.debuffs = activeConditions;
    }
    if (typeof saveCharacterData !== 'undefined') {
      saveCharacterData();
    }
  }

  /**
   * Legacy function for backwards compatibility
   */
  function addCondition(conditionName) {
    addEffect(conditionName, 'negative');
  }

  /**
   * Legacy function for backwards compatibility
   */
  function removeCondition(conditionName) {
    removeEffect(conditionName, 'negative');
  }

  /**
   * Update effects display UI
   */
  function updateEffectsDisplay() {
    const container = document.getElementById('active-conditions');
    if (!container) return;

    let html = '';

    // Show buffs section
    if (activeBuffs.length > 0) {
      html += '<div style="margin-bottom: 15px;">';
      html += '<div style="font-size: 0.85em; font-weight: bold; color: #c2185b; margin-bottom: 8px; display: flex; align-items: center; gap: 6px;"><span>✨</span> BUFFS</div>';
      html += activeBuffs.map(effectName => {
        const effect = POSITIVE_EFFECTS.find(e => e.name === effectName);
        return `
          <div class="effect-badge" data-effect="${effectName}" data-type="positive" title="${effect.description} - Click to remove" style="background: ${effect.color}20; border: 2px solid ${effect.color}; cursor: pointer; padding: 8px 12px; border-radius: 6px; margin-bottom: 8px; transition: all 0.2s;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span class="effect-badge-icon" style="font-size: 1.2em;">${effect.icon}</span>
              <div style="flex: 1;">
                <div style="font-weight: bold; color: var(--text-primary);">${effect.name}</div>
                <div style="font-size: 0.75em; color: var(--text-secondary); margin-top: 2px;">${effect.description}</div>
              </div>
              <span class="effect-badge-remove" style="font-weight: bold; opacity: 0.7; color: #e74c3c;">✕</span>
            </div>
          </div>
        `;
      }).join('');
      html += '</div>';
    }

    // Show debuffs section
    if (activeConditions.length > 0) {
      html += '<div style="margin-bottom: 15px;">';
      html += '<div style="font-size: 0.85em; font-weight: bold; color: #e74c3c; margin-bottom: 8px; display: flex; align-items: center; gap: 6px;"><span>💀</span> DEBUFFS</div>';
      html += activeConditions.map(effectName => {
        const effect = NEGATIVE_EFFECTS.find(e => e.name === effectName);
        return `
          <div class="effect-badge" data-effect="${effectName}" data-type="negative" title="${effect.description} - Click to remove" style="background: ${effect.color}20; border: 2px solid ${effect.color}; cursor: pointer; padding: 8px 12px; border-radius: 6px; margin-bottom: 8px; transition: all 0.2s;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span class="effect-badge-icon" style="font-size: 1.2em;">${effect.icon}</span>
              <div style="flex: 1;">
                <div style="font-weight: bold; color: var(--text-primary);">${effect.name}</div>
                <div style="font-size: 0.75em; color: var(--text-secondary); margin-top: 2px;">${effect.description}</div>
              </div>
              <span class="effect-badge-remove" style="font-weight: bold; opacity: 0.7; color: #e74c3c;">✕</span>
            </div>
          </div>
        `;
      }).join('');
      html += '</div>';
    }

    // Show empty state if no effects
    if (activeBuffs.length === 0 && activeConditions.length === 0) {
      html = '<div style="text-align: center; color: #888; padding: 15px; font-size: 0.9em;">No active effects</div>';
    }

    container.innerHTML = html;

    // Update AC display to reflect any changes
    const acElement = document.getElementById('char-ac');
    if (acElement && typeof calculateTotalAC !== 'undefined') {
      acElement.textContent = calculateTotalAC();
    }

    // Add click handlers to remove effects
    container.querySelectorAll('.effect-badge').forEach(badge => {
      const effectName = badge.dataset.effect;
      const type = badge.dataset.type;

      // Add hover effect
      badge.addEventListener('mouseenter', () => {
        badge.style.transform = 'translateX(3px)';
        badge.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)';
      });
      badge.addEventListener('mouseleave', () => {
        badge.style.transform = 'translateX(0)';
        badge.style.boxShadow = 'none';
      });

      // Remove on click
      badge.addEventListener('click', () => {
        removeEffect(effectName, type);
      });
    });
  }

  /**
   * Legacy function for backwards compatibility
   */
  function updateConditionsDisplay() {
    updateEffectsDisplay();
  }

  /**
   * Calculate total AC including active effects
   * @returns {number} Total AC with effect modifiers applied
   */
  function calculateTotalAC() {
    const baseAC = characterData.armorClass || 10;
    let totalAC = baseAC;

    // Combine all active effects
    const allEffects = [
      ...activeBuffs.map(name => ({ ...POSITIVE_EFFECTS.find(e => e.name === name), type: 'buff' })),
      ...activeConditions.map(name => ({ ...NEGATIVE_EFFECTS.find(e => e.name === name), type: 'debuff' }))
    ].filter(e => e && e.autoApply && e.modifier && e.modifier.ac);

    // Apply AC modifiers from active effects
    for (const effect of allEffects) {
      const acMod = effect.modifier.ac;
      if (typeof acMod === 'number') {
        totalAC += acMod;
        debug.log(`🛡️ Applied AC modifier: ${acMod} from ${effect.name} (${effect.type})`);
      }
    }

    debug.log(`🛡️ Total AC calculation: ${baseAC} (base) + modifiers = ${totalAC}`);
    return totalAC;
  }

  // ===== EXPORTS =====

  globalThis.initConditionsManager = initConditionsManager;
  globalThis.showEffectsModal = showEffectsModal;
  globalThis.addEffect = addEffect;
  globalThis.removeEffect = removeEffect;
  globalThis.addCondition = addCondition;
  globalThis.removeCondition = removeCondition;
  globalThis.updateEffectsDisplay = updateEffectsDisplay;
  globalThis.updateConditionsDisplay = updateConditionsDisplay;
  globalThis.calculateTotalAC = calculateTotalAC;

  // Export constants
  globalThis.POSITIVE_EFFECTS = POSITIVE_EFFECTS;
  globalThis.NEGATIVE_EFFECTS = NEGATIVE_EFFECTS;

  // Export state variables with getters and setters
  Object.defineProperty(globalThis, 'activeBuffs', {
    get: () => activeBuffs,
    set: (value) => { activeBuffs = value; }
  });

  Object.defineProperty(globalThis, 'activeConditions', {
    get: () => activeConditions,
    set: (value) => { activeConditions = value; }
  });

})();
