/**
 * Health Modals Module
 *
 * HP adjustment and death saves tracking modals.
 * Handles healing, damage, temporary HP, and death save mechanics.
 *
 * Loaded as a plain script (no ES6 modules) to export to globalThis.
 *
 * Functions exported to globalThis:
 * - showHPModal()
 * - showDeathSavesModal()
 */

(function() {
  'use strict';

  // ===== HP MODAL =====

function showHPModal() {
  // Create modal overlay
  const modal = document.createElement('div');
  modal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; z-index: 10000;';

  // Create modal content
  const modalContent = document.createElement('div');
  modalContent.style.cssText = 'background: var(--bg-secondary); color: var(--text-primary); padding: 30px; border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,0.3); min-width: 300px;';

  const currentHP = characterData.hitPoints.current;
  const maxHP = characterData.hitPoints.max;
  const tempHP = characterData.temporaryHP || 0;

  modalContent.innerHTML = `
    <h3 style="margin: 0 0 20px 0; color: var(--text-primary); text-align: center;">Adjust Hit Points</h3>
    <div style="text-align: center; font-size: 1.2em; margin-bottom: 20px; color: var(--text-secondary);">
      Current: <strong>${currentHP}${tempHP > 0 ? `+${tempHP}` : ''} / ${maxHP}</strong>
    </div>

    <div style="margin-bottom: 20px;">
      <label style="display: block; margin-bottom: 10px; font-weight: bold; color: var(--text-primary);">Amount:</label>
      <input type="number" id="hp-amount" min="1" value="1" style="width: 100%; padding: 10px; font-size: 1.1em; border: 2px solid var(--border-color); border-radius: 6px; box-sizing: border-box; background: var(--bg-tertiary); color: var(--text-primary);">
    </div>

    <div style="margin-bottom: 25px;">
      <label style="display: block; margin-bottom: 10px; font-weight: bold; color: var(--text-primary);">Action:</label>
      <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px;">
        <button id="hp-toggle-heal" style="padding: 12px; font-size: 0.9em; font-weight: bold; border: 2px solid #c2185b; background: #c2185b; color: white; border-radius: 6px; cursor: pointer; transition: all 0.2s;">
          💚 Heal
        </button>
        <button id="hp-toggle-damage" style="padding: 12px; font-size: 0.9em; font-weight: bold; border: 2px solid var(--border-color); background: var(--bg-tertiary); color: var(--text-secondary); border-radius: 6px; cursor: pointer; transition: all 0.2s;">
          💔 Damage
        </button>
        <button id="hp-toggle-temp" style="padding: 12px; font-size: 0.9em; font-weight: bold; border: 2px solid var(--border-color); background: var(--bg-tertiary); color: var(--text-secondary); border-radius: 6px; cursor: pointer; transition: all 0.2s;">
          🛡️ Temp HP
        </button>
      </div>
    </div>

    <div style="display: flex; gap: 10px;">
      <button id="hp-cancel" style="flex: 1; padding: 12px; font-size: 1em; background: #95a5a6; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold;">
        Cancel
      </button>
      <button id="hp-confirm" style="flex: 1; padding: 12px; font-size: 1em; background: #3498db; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold;">
        Confirm
      </button>
    </div>
  `;

  modal.appendChild(modalContent);
  document.body.appendChild(modal);

  // Toggle state: 'heal', 'damage', or 'temp'
  let actionType = 'heal';

  const healBtn = document.getElementById('hp-toggle-heal');
  const damageBtn = document.getElementById('hp-toggle-damage');
  const tempBtn = document.getElementById('hp-toggle-temp');
  const amountInput = document.getElementById('hp-amount');

  // Helper function to reset all buttons
  const resetButtons = () => {
    healBtn.style.background = 'var(--bg-tertiary)';
    healBtn.style.color = '#7f8c8d';
    healBtn.style.borderColor = '#bdc3c7';
    damageBtn.style.background = 'var(--bg-tertiary)';
    damageBtn.style.color = '#7f8c8d';
    damageBtn.style.borderColor = '#bdc3c7';
    tempBtn.style.background = 'var(--bg-tertiary)';
    tempBtn.style.color = '#7f8c8d';
    tempBtn.style.borderColor = '#bdc3c7';
  };

  // Toggle button handlers
  healBtn.addEventListener('click', () => {
    actionType = 'heal';
    resetButtons();
    healBtn.style.background = '#c2185b';
    healBtn.style.color = 'white';
    healBtn.style.borderColor = '#c2185b';
  });

  damageBtn.addEventListener('click', () => {
    actionType = 'damage';
    resetButtons();
    damageBtn.style.background = '#e74c3c';
    damageBtn.style.color = 'white';
    damageBtn.style.borderColor = '#e74c3c';
  });

  tempBtn.addEventListener('click', () => {
    actionType = 'temp';
    resetButtons();
    tempBtn.style.background = '#3498db';
    tempBtn.style.color = 'white';
    tempBtn.style.borderColor = '#3498db';
  });

  // Cancel button
  document.getElementById('hp-cancel').addEventListener('click', () => {
    modal.remove();
  });

  // Confirm button
  document.getElementById('hp-confirm').addEventListener('click', () => {
    const amount = parseInt(amountInput.value);

    if (isNaN(amount) || amount <= 0) {
      showNotification('❌ Please enter a valid amount', 'error');
      return;
    }

    const oldHP = characterData.hitPoints.current;
    const oldTempHP = characterData.temporaryHP || 0;
    const colorBanner = getColoredBanner(characterData);
    let messageData;

    if (actionType === 'heal') {
      // Healing: increase current HP (up to max), doesn't affect temp HP (RAW)
      characterData.hitPoints.current = Math.min(currentHP + amount, maxHP);
      const actualHealing = characterData.hitPoints.current - oldHP;

      // Reset death saves on healing
      if (actualHealing > 0 && characterData.deathSaves && (characterData.deathSaves.successes > 0 || characterData.deathSaves.failures > 0)) {
        characterData.deathSaves.successes = 0;
        characterData.deathSaves.failures = 0;
        debug.log('♻️ Death saves reset due to healing');
      }

      showNotification(`💚 Healed ${actualHealing} HP! (${characterData.hitPoints.current}${characterData.temporaryHP > 0 ? `+${characterData.temporaryHP}` : ''}/${maxHP})`);

      messageData = {
        action: 'announceSpell',
        message: `&{template:default} {{name=${colorBanner}${characterData.name} regains HP}} {{💚 Healing=${actualHealing} HP}} {{Current HP=${characterData.hitPoints.current}${characterData.temporaryHP > 0 ? `+${characterData.temporaryHP}` : ''}/${maxHP}}}`,
        color: characterData.notificationColor
      };
    } else if (actionType === 'damage') {
      // Damage: deplete temp HP first, then current HP (RAW)
      let remainingDamage = amount;
      let tempHPLost = 0;
      let actualDamage = 0;

      if (characterData.temporaryHP > 0) {
        tempHPLost = Math.min(characterData.temporaryHP, remainingDamage);
        characterData.temporaryHP -= tempHPLost;
        remainingDamage -= tempHPLost;
      }

      if (remainingDamage > 0) {
        characterData.hitPoints.current = Math.max(currentHP - remainingDamage, 0);
        actualDamage = oldHP - characterData.hitPoints.current;
      }

      const damageMsg = tempHPLost > 0
        ? `💔 Took ${amount} damage! (${tempHPLost} temp HP${actualDamage > 0 ? ` + ${actualDamage} HP` : ''})`
        : `💔 Took ${actualDamage} damage!`;

      showNotification(`${damageMsg} (${characterData.hitPoints.current}${characterData.temporaryHP > 0 ? `+${characterData.temporaryHP}` : ''}/${maxHP})`);

      const damageDetails = tempHPLost > 0
        ? `{{Temp HP Lost=${tempHPLost}}}${actualDamage > 0 ? ` {{HP Lost=${actualDamage}}}` : ''}`
        : `{{HP Lost=${actualDamage}}}`;

      messageData = {
        action: 'announceSpell',
        message: `&{template:default} {{name=${colorBanner}${characterData.name} takes damage}} {{💔 Total Damage=${amount}}} ${damageDetails} {{Current HP=${characterData.hitPoints.current}${characterData.temporaryHP > 0 ? `+${characterData.temporaryHP}` : ''}/${maxHP}}}`,
        color: characterData.notificationColor
      };
    } else if (actionType === 'temp') {
      // Temp HP: RAW rules - new temp HP replaces old if higher, otherwise keep old
      const newTempHP = amount;
      if (newTempHP > oldTempHP) {
        characterData.temporaryHP = newTempHP;
        showNotification(`🛡️ Gained ${newTempHP} temp HP! (${characterData.hitPoints.current}+${characterData.temporaryHP}/${maxHP})`);

        messageData = {
          action: 'announceSpell',
          message: `&{template:default} {{name=${colorBanner}${characterData.name} gains temp HP}} {{🛡️ Temp HP=${newTempHP}}} {{Current HP=${characterData.hitPoints.current}+${characterData.temporaryHP}/${maxHP}}}`,
          color: characterData.notificationColor
        };
      } else {
        showNotification(`⚠️ Kept ${oldTempHP} temp HP (higher than ${newTempHP})`);
        modal.remove();
        return; // Don't send message if temp HP wasn't gained
      }
    }

    // Send message to Roll20
    if (messageData) {
      // Try window.opener first (Chrome)
      if (window.opener && !window.opener.closed) {
        try {
          window.opener.postMessage(messageData, '*');
        } catch (error) {
          debug.warn('⚠️ Could not send via window.opener:', error.message);
          // Fallback to background script relay
          browserAPI.runtime.sendMessage({
            action: 'relayRollToRoll20',
            roll: messageData
          });
        }
      } else {
        // Fallback: Use background script to relay to Roll20 (Firefox)
        browserAPI.runtime.sendMessage({
          action: 'relayRollToRoll20',
          roll: messageData
        });
      }
    }

    saveCharacterData();
    buildSheet(characterData);
    modal.remove();
  });

  // Focus on input
  amountInput.focus();
  amountInput.select();

  // Allow Enter key to confirm
  amountInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      document.getElementById('hp-confirm').click();
    }
  });

  // Click outside to close
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });
}

function showDeathSavesModal() {
  // Create modal overlay
  const modal = document.createElement('div');
  modal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; z-index: 10000;';

  // Create modal content
  const modalContent = document.createElement('div');
  modalContent.style.cssText = 'background: var(--bg-secondary); color: var(--text-primary); padding: 30px; border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,0.3); min-width: 300px;';

  // Defensive initialization for death saves
  const deathSaves = characterData.deathSaves || { successes: 0, failures: 0 };
  const successes = deathSaves.successes || 0;
  const failures = deathSaves.failures || 0;

  modalContent.innerHTML = `
    <h3 style="margin: 0 0 20px 0; color: var(--text-primary); text-align: center;">Death Saves</h3>
    <div style="text-align: center; font-size: 1.2em; margin-bottom: 20px;">
      <div style="margin-bottom: 10px;">
        <span style="color: #c2185b; font-weight: bold;">Successes: ${successes}/3</span>
      </div>
      <div>
        <span style="color: #e74c3c; font-weight: bold;">Failures: ${failures}/3</span>
      </div>
    </div>

    <div style="margin-bottom: 20px;">
      <button id="roll-death-save" style="width: 100%; padding: 15px; font-size: 1.1em; background: #3498db; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; margin-bottom: 15px;">
        🎲 Roll Death Save
      </button>
    </div>

    <div style="margin-bottom: 20px; border-top: 1px solid #ecf0f1; padding-top: 20px;">
      <label style="display: block; margin-bottom: 10px; font-weight: bold; color: var(--text-primary);">Manual Adjustment:</label>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 15px;">
        <button id="add-success" style="padding: 10px; background: #c2185b; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold;">
          + Success
        </button>
        <button id="add-failure" style="padding: 10px; background: #e74c3c; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold;">
          + Failure
        </button>
      </div>
      <button id="reset-death-saves" style="width: 100%; padding: 10px; background: #95a5a6; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold;">
        Reset All
      </button>
    </div>

    <button id="close-modal" style="width: 100%; padding: 12px; font-size: 1em; background: #7f8c8d; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold;">
      Close
    </button>
  `;

  modal.appendChild(modalContent);
  document.body.appendChild(modal);

  // Roll death save button
  document.getElementById('roll-death-save').addEventListener('click', () => {
    // Roll 1d20 locally to determine outcome
    const rollResult = Math.floor(Math.random() * 20) + 1;
    debug.log(`🎲 Death Save rolled: ${rollResult}`);

    // Determine outcome based on D&D 5e rules
    let message = '';
    let isSuccess = false;

    if (rollResult === 20) {
      // Natural 20: regain 1 HP (represented as 2 successes in death saves)
      if (!characterData.deathSaves) characterData.deathSaves = { successes: 0, failures: 0 };
      if (characterData.deathSaves.successes < 3) {
        characterData.deathSaves.successes += 2;
        if (characterData.deathSaves.successes > 3) characterData.deathSaves.successes = 3;
      }
      message = `💚 NAT 20! Death Save Success x2 (${characterData.deathSaves.successes}/3)`;
      isSuccess = true;
    } else if (rollResult === 1) {
      // Natural 1: counts as 2 failures
      if (!characterData.deathSaves) characterData.deathSaves = { successes: 0, failures: 0 };
      if (characterData.deathSaves.failures < 3) {
        characterData.deathSaves.failures += 2;
        if (characterData.deathSaves.failures > 3) characterData.deathSaves.failures = 3;
      }
      message = `💀 NAT 1! Death Save Failure x2 (${characterData.deathSaves.failures}/3)`;
    } else if (rollResult >= 10) {
      // Success
      if (!characterData.deathSaves) characterData.deathSaves = { successes: 0, failures: 0 };
      if (characterData.deathSaves.successes < 3) {
        characterData.deathSaves.successes++;
      }
      message = `✓ Death Save Success (${characterData.deathSaves.successes}/3)`;
      isSuccess = true;
    } else {
      // Failure
      if (!characterData.deathSaves) characterData.deathSaves = { successes: 0, failures: 0 };
      if (characterData.deathSaves.failures < 3) {
        characterData.deathSaves.failures++;
      }
      message = `✗ Death Save Failure (${characterData.deathSaves.failures}/3)`;
    }

    // Save updated death saves
    saveCharacterData();
    showNotification(message);

    // Send roll result to Roll20 (show result in name since we rolled locally)
    roll(`Death Save: ${rollResult}`, '1d20', rollResult);

    // Rebuild sheet to show updated death saves
    buildSheet(characterData);
    modal.remove();
  });

  // Add success button
  document.getElementById('add-success').addEventListener('click', () => {
    if (!characterData.deathSaves) characterData.deathSaves = { successes: 0, failures: 0 };
    if (characterData.deathSaves.successes < 3) {
      characterData.deathSaves.successes++;
      saveCharacterData();
      showNotification(`✓ Death Save Success (${characterData.deathSaves.successes}/3)`);
      buildSheet(characterData);
      modal.remove();
    }
  });

  // Add failure button
  document.getElementById('add-failure').addEventListener('click', () => {
    if (!characterData.deathSaves) characterData.deathSaves = { successes: 0, failures: 0 };
    if (characterData.deathSaves.failures < 3) {
      characterData.deathSaves.failures++;
      saveCharacterData();
      showNotification(`✗ Death Save Failure (${characterData.deathSaves.failures}/3)`);
      buildSheet(characterData);
      modal.remove();
    }
  });

  // Reset button
  document.getElementById('reset-death-saves').addEventListener('click', () => {
    characterData.deathSaves = { successes: 0, failures: 0 };
    saveCharacterData();
    showNotification('♻️ Death saves reset');
    buildSheet(characterData);
    modal.remove();
  });

  // Close button
  document.getElementById('close-modal').addEventListener('click', () => {
    modal.remove();
  });

  // Click outside to close
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });
}

  // ===== EXPORTS =====

  // Export functions to globalThis
  globalThis.showHPModal = showHPModal;
  globalThis.showDeathSavesModal = showDeathSavesModal;

  debug.log('✅ Health Modals module loaded');

})();
