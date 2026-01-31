/**
 * Spell Macros Module
 *
 * Handles custom macro system for spells.
 * - Get/save custom macros from localStorage
 * - Configure custom macro buttons modal
 * - Allows spells to have custom Roll20 macro buttons
 *
 * Loaded as a plain script (no ES6 modules) to export to globalThis.
 */

(function() {
  'use strict';

  /**
   * Get custom macros for a spell from localStorage
   * @param {string} spellName - Name of the spell
   * @returns {object|null} Custom macros object or null
   */
  function getCustomMacros(spellName) {
    const key = `customMacros_${characterData.name}`;
    const allMacros = JSON.parse(localStorage.getItem(key) || '{}');
    return allMacros[spellName] || null;
  }

  /**
   * Save custom macros for a spell to localStorage
   * @param {string} spellName - Name of the spell
   * @param {object|null} macros - Custom macros object or null to clear
   */
  function saveCustomMacros(spellName, macros) {
    const key = `customMacros_${characterData.name}`;
    const allMacros = JSON.parse(localStorage.getItem(key) || '{}');

    if (macros && macros.buttons && macros.buttons.length > 0) {
      allMacros[spellName] = macros;
    } else {
      delete allMacros[spellName]; // Remove if no macros defined
    }

    localStorage.setItem(key, JSON.stringify(allMacros));

    const debug = window.debug || console;
    debug.log(`💾 Saved custom macros for "${spellName}":`, macros);
  }

  /**
   * Show custom macro configuration modal
   * @param {object} spell - Spell object
   * @param {number} spellIndex - Spell index
   */
  function showCustomMacroModal(spell, spellIndex) {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; z-index: 10000;';

    const modal = document.createElement('div');
    modal.style.cssText = 'background: var(--bg-secondary); color: var(--text-primary); padding: 24px; border-radius: 8px; max-width: 600px; width: 90%; max-height: 80vh; overflow-y: auto; box-shadow: 0 4px 20px rgba(0,0,0,0.3);';

    const existingMacros = getCustomMacros(spell.name);
    const skipNormalButtons = existingMacros?.skipNormalButtons || false;

    modal.innerHTML = `
      <h2 style="margin: 0 0 16px 0; color: #333;">Custom Macros: ${spell.name}</h2>
      <p style="margin: 0 0 16px 0; color: #666; font-size: 14px;">
        Configure custom macro buttons for this spell. Use this for magic item spells or custom variants that don't work with the default buttons.
      </p>

      <div style="margin-bottom: 16px;">
        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
          <input type="checkbox" id="skipNormalButtons" ${skipNormalButtons ? 'checked' : ''} style="width: 18px; height: 18px;">
          <span style="font-weight: bold;">Replace default buttons (hide attack/damage buttons)</span>
        </label>
        <p style="margin: 4px 0 0 26px; color: #666; font-size: 13px;">
          Check this to only show your custom macros, hiding the default spell buttons
        </p>
      </div>

      <div id="macro-buttons-container" style="margin-bottom: 16px;">
        <!-- Macro buttons will be added here -->
      </div>

      <button id="add-macro-btn" style="padding: 8px 16px; background: #c2185b; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; margin-bottom: 16px;">
        ➕ Add Macro Button
      </button>

      <div style="margin-top: 24px; padding-top: 16px; border-top: 2px solid #eee; display: flex; gap: 12px; justify-content: flex-end;">
        <button id="clear-macros-btn" style="padding: 10px 20px; background: #e74c3c; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold;">
          🗑️ Clear All
        </button>
        <button id="cancel-macros-btn" style="padding: 10px 20px; background: #95a5a6; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold;">
          Cancel
        </button>
        <button id="save-macros-btn" style="padding: 10px 20px; background: #3498db; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold;">
          💾 Save
        </button>
      </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const container = modal.querySelector('#macro-buttons-container');
    const addBtn = modal.querySelector('#add-macro-btn');
    const clearBtn = modal.querySelector('#clear-macros-btn');
    const cancelBtn = modal.querySelector('#cancel-macros-btn');
    const saveBtn = modal.querySelector('#save-macros-btn');

    let macroCounter = 0;

    function addMacroButton(label = '', macro = '') {
      const macroDiv = document.createElement('div');
      macroDiv.className = 'macro-button-config';
      macroDiv.style.cssText = 'padding: 12px; background: #f8f9fa; border-radius: 6px; margin-bottom: 12px; border: 2px solid #dee2e6;';
      macroDiv.dataset.macroId = macroCounter++;

      macroDiv.innerHTML = `
        <div style="margin-bottom: 8px;">
          <label style="display: block; font-weight: bold; margin-bottom: 4px; color: #333;">Button Label:</label>
          <input type="text" class="macro-label" value="${label}" placeholder="e.g., ⚔️ Attack, 💥 Damage, ✨ Cast" style="width: 100%; padding: 8px; border: 2px solid #ddd; border-radius: 4px; font-size: 14px;">
        </div>
        <div style="margin-bottom: 8px;">
          <label style="display: block; font-weight: bold; margin-bottom: 4px; color: #333;">Macro Text:</label>
          <textarea class="macro-text" placeholder="&{template:default} {{name=My Spell}} {{effect=Custom effect}}" style="width: 100%; padding: 8px; border: 2px solid #ddd; border-radius: 4px; font-size: 13px; font-family: monospace; min-height: 80px;">${macro}</textarea>
        </div>
        <button class="remove-macro-btn" style="padding: 6px 12px; background: #e74c3c; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;">
          ❌ Remove
        </button>
      `;

      const removeBtn = macroDiv.querySelector('.remove-macro-btn');
      removeBtn.addEventListener('click', () => {
        macroDiv.remove();
      });

      container.appendChild(macroDiv);
    }

    // Add existing macros or one empty macro
    if (existingMacros && existingMacros.buttons && existingMacros.buttons.length > 0) {
      existingMacros.buttons.forEach(btn => {
        addMacroButton(btn.label, btn.macro);
      });
    } else {
      addMacroButton();
    }

    addBtn.addEventListener('click', () => addMacroButton());

    clearBtn.addEventListener('click', () => {
      if (confirm(`Clear all custom macros for "${spell.name}"?`)) {
        saveCustomMacros(spell.name, null);
        document.body.removeChild(overlay);
        if (typeof showNotification === 'function') {
          showNotification(`🗑️ Cleared custom macros for ${spell.name}`, 'success');
        }
      }
    });

    cancelBtn.addEventListener('click', () => {
      document.body.removeChild(overlay);
    });

    saveBtn.addEventListener('click', () => {
      const macroConfigs = Array.from(container.querySelectorAll('.macro-button-config'));
      const buttons = macroConfigs.map(config => {
        const label = config.querySelector('.macro-label').value.trim();
        const macro = config.querySelector('.macro-text').value.trim();
        return { label, macro };
      }).filter(btn => btn.label && btn.macro); // Only save if both label and macro are provided

      const skipNormalButtons = modal.querySelector('#skipNormalButtons').checked;

      saveCustomMacros(spell.name, {
        buttons,
        skipNormalButtons
      });

      document.body.removeChild(overlay);
      if (typeof showNotification === 'function') {
        showNotification(`💾 Saved custom macros for ${spell.name}`, 'success');
      }
    });

    // Close on overlay click
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        document.body.removeChild(overlay);
      }
    });
  }

  // Export functions to globalThis
  Object.assign(globalThis, {
    getCustomMacros,
    saveCustomMacros,
    showCustomMacroModal
  });

  console.log('✅ Spell Macros module loaded');

})();
