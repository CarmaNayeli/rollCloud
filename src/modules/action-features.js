/**
 * Action Features Module
 *
 * Handles special feature toggles and buttons for actions (Sneak Attack, Elemental Weapon, Lucky).
 * Loaded as a plain script (no ES6 modules) to export to globalThis.
 *
 * Functions exported to globalThis:
 * - addSneakAttackToggle(container, deduplicatedActions)
 * - addElementalWeaponToggle(container)
 * - addLuckyFeatButton(container)
 *
 * State exported to globalThis:
 * - sneakAttackEnabled (via Object.defineProperty)
 * - sneakAttackDamage (via Object.defineProperty)
 * - elementalWeaponEnabled (via Object.defineProperty)
 * - elementalWeaponDamage (via Object.defineProperty)
 */

(function() {
  'use strict';

  // ===== STATE VARIABLES =====

  // Sneak Attack toggle state (independent from DiceCloud - controlled only by our sheet)
  let sneakAttackEnabled = false;  // Always starts unchecked - user manually enables when needed
  let sneakAttackDamage = '';

  // Elemental Weapon toggle state (independent from DiceCloud - controlled only by our sheet)
  let elementalWeaponEnabled = false;  // Always starts unchecked - user manually enables when needed
  let elementalWeaponDamage = '1d4';  // Default to level 3 (base damage)

  // Export state variables with getter/setter
  Object.defineProperty(globalThis, 'sneakAttackEnabled', {
    get: () => sneakAttackEnabled,
    set: (value) => { sneakAttackEnabled = value; },
    configurable: true
  });

  Object.defineProperty(globalThis, 'sneakAttackDamage', {
    get: () => sneakAttackDamage,
    set: (value) => { sneakAttackDamage = value; },
    configurable: true
  });

  Object.defineProperty(globalThis, 'elementalWeaponEnabled', {
    get: () => elementalWeaponEnabled,
    set: (value) => { elementalWeaponEnabled = value; },
    configurable: true
  });

  Object.defineProperty(globalThis, 'elementalWeaponDamage', {
    get: () => elementalWeaponDamage,
    set: (value) => { elementalWeaponDamage = value; },
    configurable: true
  });

  // ===== SNEAK ATTACK TOGGLE =====

  /**
   * Add Sneak Attack toggle if character has it
   */
  function addSneakAttackToggle(container, deduplicatedActions) {
    // Check if character has Sneak Attack available (from DiceCloud)
    // We only check if it EXISTS, not whether it's enabled on DiceCloud
    // The toggle state on our sheet is independent and user-controlled
    // Use flexible matching in case the name has slight variations
    const sneakAttackAction = deduplicatedActions.find(a =>
      a.name === 'Sneak Attack' ||
      a.name.toLowerCase().includes('sneak attack')
    );
    if (typeof debug !== 'undefined') {
      debug.log('🎯 Sneak Attack search result:', sneakAttackAction);
    }
    if (sneakAttackAction && sneakAttackAction.damage) {
      sneakAttackDamage = sneakAttackAction.damage;

      // Resolve variables in the damage formula for display
      const resolvedDamage = typeof resolveVariablesInFormula !== 'undefined'
        ? resolveVariablesInFormula(sneakAttackDamage)
        : sneakAttackDamage;
      if (typeof debug !== 'undefined') {
        debug.log(`🎯 Sneak Attack damage: "${sneakAttackDamage}" resolved to "${resolvedDamage}"`);
      }

      // Add toggle section at the top of actions
      const toggleSection = document.createElement('div');
      toggleSection.style.cssText = 'background: #2c3e50; color: white; padding: 10px; border-radius: 5px; margin-bottom: 10px; display: flex; align-items: center; gap: 10px;';

      const toggleLabel = document.createElement('label');
      toggleLabel.style.cssText = 'display: flex; align-items: center; gap: 8px; cursor: pointer; font-weight: bold;';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.id = 'sneak-attack-toggle';
      checkbox.checked = sneakAttackEnabled;  // Always starts false - IGNORES DiceCloud toggle state
      checkbox.style.cssText = 'width: 18px; height: 18px; cursor: pointer;';
      checkbox.addEventListener('change', (e) => {
        sneakAttackEnabled = e.target.checked;
        if (typeof debug !== 'undefined') {
          debug.log(`🎯 Sneak Attack toggle on our sheet: ${sneakAttackEnabled ? 'ON' : 'OFF'} (independent of DiceCloud)`);
        }
      });

      const labelText = document.createElement('span');
      labelText.textContent = `Add Sneak Attack (${resolvedDamage}) to weapon damage`;

      toggleLabel.appendChild(checkbox);
      toggleLabel.appendChild(labelText);
      toggleSection.appendChild(toggleLabel);
      container.appendChild(toggleSection);
    }
  }

  // ===== ELEMENTAL WEAPON TOGGLE =====

  /**
   * Add Elemental Weapon toggle if character has the spell
   */
  function addElementalWeaponToggle(container) {
    // Check if character has Elemental Weapon spell prepared (check spells list)
    // We only check if it EXISTS, the toggle is user-controlled
    const hasElementalWeapon = typeof characterData !== 'undefined'
      && characterData.spells
      && characterData.spells.some(s =>
        s.name === 'Elemental Weapon' || (s.spell && s.spell.name === 'Elemental Weapon')
      );

    if (hasElementalWeapon) {
      if (typeof debug !== 'undefined') {
        debug.log(`⚔️ Elemental Weapon spell found, adding toggle`);
      }

      // Add toggle section for Elemental Weapon
      const elementalToggleSection = document.createElement('div');
      elementalToggleSection.style.cssText = 'background: #8b4513; color: white; padding: 10px; border-radius: 5px; margin-bottom: 10px; display: flex; align-items: center; gap: 10px;';

      const elementalToggleLabel = document.createElement('label');
      elementalToggleLabel.style.cssText = 'display: flex; align-items: center; gap: 8px; cursor: pointer; font-weight: bold;';

      const elementalCheckbox = document.createElement('input');
      elementalCheckbox.type = 'checkbox';
      elementalCheckbox.id = 'elemental-weapon-toggle';
      elementalCheckbox.checked = elementalWeaponEnabled;  // Always starts false
      elementalCheckbox.style.cssText = 'width: 18px; height: 18px; cursor: pointer;';
      elementalCheckbox.addEventListener('change', (e) => {
        elementalWeaponEnabled = e.target.checked;
        if (typeof debug !== 'undefined') {
          debug.log(`⚔️ Elemental Weapon toggle: ${elementalWeaponEnabled ? 'ON' : 'OFF'}`);
        }
      });

      const elementalLabelText = document.createElement('span');
      elementalLabelText.textContent = `Add Elemental Weapon (${elementalWeaponDamage}) to weapon damage`;

      elementalToggleLabel.appendChild(elementalCheckbox);
      elementalToggleLabel.appendChild(elementalLabelText);
      elementalToggleSection.appendChild(elementalToggleLabel);
      container.appendChild(elementalToggleSection);
    }
  }

  // ===== LUCKY FEAT BUTTON =====

  /**
   * Add Lucky feat button if character has it
   */
  function addLuckyFeatButton(container) {
    // Check if character has Lucky feat
    const hasLuckyFeat = typeof characterData !== 'undefined'
      && characterData.features
      && characterData.features.some(f =>
        f.name && f.name.toLowerCase().includes('lucky')
      );

    if (hasLuckyFeat) {
      if (typeof debug !== 'undefined') {
        debug.log(`🎖️ Lucky feat found, adding action button`);
      }

      // Add action button for Lucky feat
      const luckyActionSection = document.createElement('div');
      luckyActionSection.style.cssText = 'background: #f39c12; color: white; padding: 12px; border-radius: 5px; margin-bottom: 10px;';

      const luckyButton = document.createElement('button');
      luckyButton.id = 'lucky-action-button';
      luckyButton.style.cssText = `
        background: #e67e22;
        color: white;
        border: none;
        padding: 10px 16px;
        border-radius: 5px;
        cursor: pointer;
        font-size: 14px;
        font-weight: bold;
        width: 100%;
        transition: background 0.2s;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
      `;
      luckyButton.onmouseover = () => luckyButton.style.background = '#d35400';
      luckyButton.onmouseout = () => luckyButton.style.background = '#e67e22';

      // Update button text based on available luck points
      const luckyResource = typeof getLuckyResource !== 'undefined' ? getLuckyResource() : null;
      const luckPointsAvailable = luckyResource ? luckyResource.current : 0;
      luckyButton.innerHTML = `
        <span style="font-size: 16px;">🎖️</span>
        <span>Use Lucky Point (${luckPointsAvailable}/3)</span>
      `;

      luckyButton.addEventListener('click', () => {
        const currentLuckyResource = typeof getLuckyResource !== 'undefined' ? getLuckyResource() : null;
        if (!currentLuckyResource || currentLuckyResource.current <= 0) {
          if (typeof showNotification !== 'undefined') {
            showNotification('❌ No luck points available!', 'error');
          }
          return;
        }

        // Show simple Lucky modal like metamagic
        if (typeof showLuckyModal !== 'undefined') {
          showLuckyModal();
        }
      });

      luckyActionSection.appendChild(luckyButton);
      container.appendChild(luckyActionSection);
    }
  }

  // ===== EXPORTS =====

  globalThis.addSneakAttackToggle = addSneakAttackToggle;
  globalThis.addElementalWeaponToggle = addElementalWeaponToggle;
  globalThis.addLuckyFeatButton = addLuckyFeatButton;

})();
