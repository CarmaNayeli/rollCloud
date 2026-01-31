/**
 * Character Trait Popups Module
 *
 * Handles all character trait popup UI (Halfling Luck, Lucky, Elven Accuracy, etc.).
 * Loaded as a plain script (no ES6 modules) to export to globalThis.
 *
 * Functions exported to globalThis:
 * - getPopupThemeColors()
 * - showHalflingLuckPopup(rollData)
 * - showLuckyPopup(rollData)
 * - showTraitChoicePopup(rollData)
 * - showWildMagicSurgePopup(d100Roll, effect)
 * - showBardicInspirationPopup(rollData)
 * - showElvenAccuracyPopup(rollData)
 * - performHalflingReroll(originalRollData)
 * - performLuckyReroll(originalRollData)
 * - performBardicInspirationRoll(rollData)
 * - performElvenAccuracyReroll(originalRollData)
 */

(function() {
  'use strict';

  // ===== HELPER FUNCTIONS =====

  /**
   * Get theme-aware colors for popups
   * @returns {Object} Color scheme based on current theme
   */
  function getPopupThemeColors() {
    const isDarkMode = document.documentElement.classList.contains('theme-dark') ||
                       document.documentElement.getAttribute('data-theme') === 'dark';

    return {
      background: isDarkMode ? '#2d2d2d' : '#ffffff',
      text: isDarkMode ? '#e0e0e0' : '#333333',
      heading: isDarkMode ? '#ffffff' : '#2D8B83',
      border: isDarkMode ? '#444444' : '#f0f8ff',
      borderAccent: isDarkMode ? '#2D8B83' : '#2D8B83',
      infoBox: isDarkMode ? '#1a1a1a' : '#f0f8ff',
      infoText: isDarkMode ? '#b0b0b0' : '#666666'
    };
  }

  // ===== HALFLING LUCK POPUP =====

  /**
   * Show Halfling Luck popup when rolling a natural 1
   * @param {Object} rollData - Roll information
   */
  function showHalflingLuckPopup(rollData) {
    debug.log('🍀 Halfling Luck popup called with:', rollData);

    // Check if document.body exists
    if (!document.body) {
      debug.error('❌ document.body not available for Halfling Luck popup');
      showNotification('🍀 Halfling Luck triggered! (Popup failed to display)', 'info');
      return;
    }

    debug.log('🍀 Creating popup overlay...');

    // Get theme-aware colors
    const colors = getPopupThemeColors();

    // Create popup overlay
    const popupOverlay = document.createElement('div');
    popupOverlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.8);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;

    // Create popup content
    const popupContent = document.createElement('div');
    popupContent.style.cssText = `
      background: ${colors.background};
      border-radius: 12px;
      padding: 24px;
      max-width: 400px;
      width: 90%;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
      text-align: center;
    `;

    debug.log('🍀 Setting popup content HTML...');

    popupContent.innerHTML = `
      <div style="font-size: 24px; margin-bottom: 16px;">🍀</div>
      <h2 style="margin: 0 0 8px 0; color: ${colors.heading};">Halfling Luck!</h2>
      <p style="margin: 0 0 16px 0; color: ${colors.text};">
        You rolled a natural 1! As a Halfling, you can reroll this d20.
      </p>
      <div style="margin: 0 0 16px 0; padding: 12px; background: ${colors.infoBox}; border-radius: 8px; border-left: 4px solid ${colors.borderAccent}; color: ${colors.text};">
        <strong>Original Roll:</strong> ${rollData.rollName}<br>
        <strong>Result:</strong> ${rollData.baseRoll} (natural 1)<br>
        <strong>Total:</strong> ${rollData.rollResult}
      </div>
      <div style="display: flex; gap: 12px; justify-content: center;">
        <button id="halflingRerollBtn" style="
          background: #2D8B83;
          color: white;
          border: none;
          padding: 12px 24px;
          border-radius: 8px;
          cursor: pointer;
          font-weight: bold;
          font-size: 14px;
        ">🎲 Reroll</button>
        <button id="halflingKeepBtn" style="
          background: #e74c3c;
          color: white;
          border: none;
          padding: 12px 24px;
          border-radius: 8px;
          cursor: pointer;
          font-weight: bold;
          font-size: 14px;
        ">Keep Roll</button>
      </div>
    `;

    debug.log('🍀 Appending popup to document.body...');

    popupOverlay.appendChild(popupContent);
    document.body.appendChild(popupOverlay);

    // Add event listeners
    document.getElementById('halflingRerollBtn').addEventListener('click', () => {
      debug.log('🍀 User chose to reroll');
      performHalflingReroll(rollData);
      document.body.removeChild(popupOverlay);
    });

    document.getElementById('halflingKeepBtn').addEventListener('click', () => {
      debug.log('🍀 User chose to keep roll');
      document.body.removeChild(popupOverlay);
    });

    // Close on overlay click
    popupOverlay.addEventListener('click', (e) => {
      if (e.target === popupOverlay) {
        debug.log('🍀 User closed popup');
        document.body.removeChild(popupOverlay);
      }
    });

    debug.log('🍀 Halfling Luck popup displayed');
  }

  /**
   * Perform Halfling Luck reroll
   * @param {Object} originalRollData - Original roll data
   */
  function performHalflingReroll(originalRollData) {
    debug.log('🍀 Performing Halfling reroll for:', originalRollData);

    // Extract the base formula (remove any modifiers)
    const formula = originalRollData.rollType;
    const baseFormula = formula.split('+')[0]; // Get just the d20 part

    // Create a new roll with just the d20
    const rerollData = {
      name: `🍀 ${originalRollData.rollName} (Halfling Luck)`,
      formula: baseFormula,
      color: '#2D8B83',
      characterName: characterData.name
    };

    debug.log('🍀 Reroll data:', rerollData);

    // Send the reroll request
    if (window.opener && !window.opener.closed) {
      // Send via popup window opener (Roll20 content script)
      window.opener.postMessage({
        action: 'rollFromPopout',
        ...rerollData
      }, '*');
    } else {
      // Fallback: send directly to Roll20 via background script
      browserAPI.runtime.sendMessage({
        action: 'relayRollToRoll20',
        roll: rerollData
      });
    }

    showNotification('🍀 Halfling Luck reroll initiated!', 'success');
  }

  // ===== LUCKY FEAT POPUP =====

  /**
   * Show Lucky Feat popup
   * @param {Object} rollData - Roll information
   */
  function showLuckyPopup(rollData) {
    debug.log('🎖️ Lucky popup called with:', rollData);

    // Check if document.body exists
    if (!document.body) {
      debug.error('❌ document.body not available for Lucky popup');
      showNotification('🎖️ Lucky triggered! (Popup failed to display)', 'info');
      return;
    }

    debug.log('🎖️ Creating Lucky popup overlay...');

    // Get theme-aware colors
    const colors = getPopupThemeColors();

    // Create popup overlay
    const popupOverlay = document.createElement('div');
    popupOverlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.8);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;

    // Create popup content
    const popupContent = document.createElement('div');
    popupContent.style.cssText = `
      background: ${colors.background};
      border-radius: 12px;
      padding: 24px;
      max-width: 400px;
      width: 90%;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
      text-align: center;
    `;

    debug.log('🎖️ Setting Lucky popup content HTML...');

    popupContent.innerHTML = `
      <div style="font-size: 24px; margin-bottom: 16px;">🎖️</div>
      <h2 style="margin: 0 0 8px 0; color: #f39c12;">Lucky Feat!</h2>
      <p style="margin: 0 0 16px 0; color: ${colors.text};">
        You rolled a ${rollData.baseRoll}! You have ${rollData.luckPointsRemaining} luck points remaining.
      </p>
      <div style="margin: 0 0 16px 0; padding: 12px; background: ${colors.infoBox}; border-radius: 8px; border-left: 4px solid #f39c12; color: ${colors.text};">
        <strong>Original Roll:</strong> ${rollData.rollName}<br>
        <strong>Result:</strong> ${rollData.baseRoll}<br>
        <strong>Luck Points:</strong> ${rollData.luckPointsRemaining}/3
      </div>
      <div style="display: flex; gap: 12px; justify-content: center;">
        <button id="luckyRerollBtn" style="
          background: #f39c12;
          color: white;
          border: none;
          padding: 12px 24px;
          border-radius: 8px;
          cursor: pointer;
          font-size: 16px;
          font-weight: bold;
          transition: background 0.2s;
        ">
          🎲 Reroll (Use Luck Point)
        </button>
        <button id="luckyKeepBtn" style="
          background: #95a5a6;
          color: white;
          border: none;
          padding: 12px 24px;
          border-radius: 8px;
          cursor: pointer;
          font-size: 16px;
          font-weight: bold;
          transition: background 0.2s;
        ">
          Keep Roll
        </button>
      </div>
    `;

    popupOverlay.appendChild(popupContent);
    document.body.appendChild(popupOverlay);

    debug.log('🎖️ Appending Lucky popup to document.body...');

    // Add event listeners
    const rerollBtn = document.getElementById('luckyRerollBtn');
    const keepBtn = document.getElementById('luckyKeepBtn');

    // Add hover effects via event listeners (CSP-compliant)
    rerollBtn.addEventListener('mouseenter', () => rerollBtn.style.background = '#e67e22');
    rerollBtn.addEventListener('mouseleave', () => rerollBtn.style.background = '#f39c12');
    keepBtn.addEventListener('mouseenter', () => keepBtn.style.background = '#7f8c8d');
    keepBtn.addEventListener('mouseleave', () => keepBtn.style.background = '#95a5a6');

    rerollBtn.addEventListener('click', () => {
      if (useLuckyPoint()) {
        performLuckyReroll(rollData);
        popupOverlay.remove();
      } else {
        alert('No luck points available!');
      }
    });

    keepBtn.addEventListener('click', () => {
      popupOverlay.remove();
    });

    // Close on overlay click
    popupOverlay.addEventListener('click', (e) => {
      if (e.target === popupOverlay) {
        popupOverlay.remove();
      }
    });

    debug.log('🎖️ Lucky popup displayed');
  }

  /**
   * Perform Lucky reroll
   * @param {Object} originalRollData - Original roll data
   */
  function performLuckyReroll(originalRollData) {
    debug.log('🎖️ Performing Lucky reroll for:', originalRollData);

    // Extract base formula (remove modifiers for the reroll)
    const baseFormula = originalRollData.rollType.replace(/[+-]\d+$/i, '');

    // Create a new roll with just the d20
    const rerollData = {
      name: `🎖️ ${originalRollData.rollName} (Lucky Reroll)`,
      formula: baseFormula,
      color: '#f39c12',
      characterName: characterData.name
    };

    // Send the reroll request
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage({
        action: 'rollFromPopout',
        ...rerollData
      }, '*');
      debug.log('🎖️ Lucky reroll sent via window.opener');
    } else {
      // Fallback: send directly to Roll20 via background script
      browserAPI.runtime.sendMessage({
        action: 'relayRollToRoll20',
        roll: rerollData
      });
    }

    showNotification('🎖️ Lucky reroll initiated!', 'success');
  }

  // ===== TRAIT CHOICE POPUP =====

  /**
   * Unified Trait Choice Popup (when multiple traits apply)
   * @param {Object} rollData - Roll information with multiple traits
   */
  function showTraitChoicePopup(rollData) {
    debug.log('🎯 Trait choice popup called with:', rollData);

    // Check if document.body exists
    if (!document.body) {
      debug.error('❌ document.body not available for trait choice popup');
      showNotification('🎯 Trait choice triggered! (Popup failed to display)', 'info');
      return;
    }

    debug.log('🎯 Creating trait choice overlay...');

    // Get theme-aware colors
    const colors = getPopupThemeColors();

    // Create popup overlay
    const popupOverlay = document.createElement('div');
    popupOverlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.8);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;

    // Create popup content
    const popupContent = document.createElement('div');
    popupContent.style.cssText = `
      background: ${colors.background};
      border-radius: 12px;
      padding: 24px;
      max-width: 450px;
      width: 90%;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
      text-align: center;
    `;

    // Build trait options HTML
    let traitOptionsHTML = '';
    const allTraits = [...rollData.racialTraits, ...rollData.featTraits];

    allTraits.forEach((trait, index) => {
      let icon = '';
      let color = '';
      let description = '';

      if (trait.name === 'Halfling Luck') {
        icon = '🍀';
        color = '#2D8B83';
        description = 'Reroll natural 1s (must use new roll)';
      } else if (trait.name === 'Lucky') {
        icon = '🎖️';
        color = '#f39c12';
        const luckyResource = getLuckyResource();
        description = `Reroll any roll (${luckyResource?.current || 0}/3 points left)`;
      }

      traitOptionsHTML += `
        <button class="trait-option-btn" data-trait-index="${index}" data-trait-color="${color}" style="
          background: ${color};
          color: white;
          border: none;
          padding: 16px;
          border-radius: 8px;
          cursor: pointer;
          font-size: 16px;
          font-weight: bold;
          margin: 8px 0;
          transition: transform 0.2s, background 0.2s;
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
        ">
          <span style="font-size: 20px;">${icon}</span>
          <div style="text-align: left;">
            <div style="font-weight: bold;">${trait.name}</div>
            <div style="font-size: 12px; opacity: 0.9;">${description}</div>
          </div>
        </button>
      `;
    });

    debug.log('🎯 Setting trait choice popup content HTML...');

    popupContent.innerHTML = `
      <div style="font-size: 24px; margin-bottom: 16px;">🎯</div>
      <h2 style="margin: 0 0 8px 0; color: ${colors.heading};">Multiple Traits Available!</h2>
      <p style="margin: 0 0 16px 0; color: ${colors.text};">
        You rolled a ${rollData.baseRoll}! Choose which trait to use:
      </p>
      <div style="margin: 0 0 16px 0; padding: 12px; background: ${colors.infoBox}; border-radius: 8px; border-left: 4px solid #3498db; color: ${colors.text};">
        <strong>Original Roll:</strong> ${rollData.rollName}<br>
        <strong>Result:</strong> ${rollData.baseRoll}<br>
        <strong>Total:</strong> ${rollData.rollResult}
      </div>
      <div style="display: flex; flex-direction: column; gap: 8px;">
        ${traitOptionsHTML}
      </div>
      <button id="cancelTraitBtn" style="
        background: #95a5a6;
        color: white;
        border: none;
        padding: 12px 24px;
        border-radius: 8px;
        cursor: pointer;
        font-size: 14px;
        font-weight: bold;
        margin-top: 8px;
        transition: background 0.2s;
      ">
        Keep Original Roll
      </button>
    `;

    popupOverlay.appendChild(popupContent);
    document.body.appendChild(popupOverlay);

    debug.log('🎯 Appending trait choice popup to document.body...');

    // Add event listeners
    const traitButtons = document.querySelectorAll('.trait-option-btn');
    const cancelBtn = document.getElementById('cancelTraitBtn');

    // Add hover effects for trait buttons (CSP-compliant)
    traitButtons.forEach((btn, index) => {
      const originalColor = btn.dataset.traitColor;

      btn.addEventListener('mouseenter', () => {
        btn.style.transform = 'translateY(-2px)';
        btn.style.background = originalColor + 'dd';
      });

      btn.addEventListener('mouseleave', () => {
        btn.style.transform = 'translateY(0)';
        btn.style.background = originalColor;
      });

      btn.addEventListener('click', () => {
        const trait = allTraits[index];
        debug.log(`🎯 User chose trait: ${trait.name}`);

        popupOverlay.remove();

        // Execute the chosen trait's action
        if (trait.name === 'Halfling Luck') {
          showHalflingLuckPopup({
            rollResult: rollData.baseRoll,
            baseRoll: rollData.baseRoll,
            rollType: rollData.rollType,
            rollName: rollData.rollName
          });
        } else if (trait.name === 'Lucky') {
          const luckyResource = getLuckyResource();
          showLuckyPopup({
            rollResult: rollData.baseRoll,
            baseRoll: rollData.baseRoll,
            rollType: rollData.rollType,
            rollName: rollData.rollName,
            luckPointsRemaining: luckyResource?.current || 0
          });
        }
      });
    });

    // Add hover effects for cancel button (CSP-compliant)
    cancelBtn.addEventListener('mouseenter', () => cancelBtn.style.background = '#7f8c8d');
    cancelBtn.addEventListener('mouseleave', () => cancelBtn.style.background = '#95a5a6');

    cancelBtn.addEventListener('click', () => {
      popupOverlay.remove();
    });

    // Close on overlay click
    popupOverlay.addEventListener('click', (e) => {
      if (e.target === popupOverlay) {
        popupOverlay.remove();
      }
    });

    debug.log('🎯 Trait choice popup displayed');
  }

  // ===== WILD MAGIC SURGE POPUP =====

  /**
   * Show Wild Magic Surge popup
   * @param {number} d100Roll - d100 roll result
   * @param {string} effect - Wild magic effect description
   */
  function showWildMagicSurgePopup(d100Roll, effect) {
    debug.log('🌀 Wild Magic Surge popup called with:', d100Roll, effect);

    if (!document.body) {
      debug.error('❌ document.body not available for Wild Magic Surge popup');
      showNotification(`🌀 Wild Magic Surge! d100: ${d100Roll}`, 'warning');
      return;
    }

    const colors = getPopupThemeColors();

    // Create popup overlay
    const popupOverlay = document.createElement('div');
    popupOverlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.8);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;

    // Create popup content
    const popupContent = document.createElement('div');
    popupContent.style.cssText = `
      background: ${colors.background};
      border-radius: 12px;
      padding: 24px;
      max-width: 500px;
      width: 90%;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
      text-align: center;
    `;

    popupContent.innerHTML = `
      <div style="font-size: 32px; margin-bottom: 16px;">🌀</div>
      <h2 style="margin: 0 0 8px 0; color: #9b59b6;">Wild Magic Surge!</h2>
      <p style="margin: 0 0 16px 0; color: ${colors.text};">
        Your spell triggers a wild magic surge!
      </p>
      <div style="margin: 0 0 16px 0; padding: 16px; background: ${colors.infoBox}; border-radius: 8px; border-left: 4px solid #9b59b6; color: ${colors.text}; text-align: left;">
        <div style="text-align: center; font-weight: bold; font-size: 18px; margin-bottom: 12px; color: #9b59b6;">
          d100 Roll: ${d100Roll}
        </div>
        <div style="font-size: 14px; line-height: 1.6;">
          ${effect}
        </div>
      </div>
      <button id="closeWildMagicBtn" style="
        background: #9b59b6;
        color: white;
        border: none;
        padding: 12px 32px;
        border-radius: 8px;
        cursor: pointer;
        font-weight: bold;
        font-size: 14px;
        transition: background 0.2s;
      ">Got it!</button>
    `;

    popupOverlay.appendChild(popupContent);
    document.body.appendChild(popupOverlay);

    // Add event listeners
    const closeBtn = document.getElementById('closeWildMagicBtn');

    closeBtn.addEventListener('mouseenter', () => closeBtn.style.background = '#8e44ad');
    closeBtn.addEventListener('mouseleave', () => closeBtn.style.background = '#9b59b6');

    closeBtn.addEventListener('click', () => {
      document.body.removeChild(popupOverlay);
    });

    // Close on overlay click
    popupOverlay.addEventListener('click', (e) => {
      if (e.target === popupOverlay) {
        document.body.removeChild(popupOverlay);
      }
    });

    // Also announce to Roll20 chat
    const colorBanner = getColoredBanner(characterData);
    const message = `&{template:default} {{name=${colorBanner}${characterData.name} - Wild Magic Surge! 🌀}} {{d100 Roll=${d100Roll}}} {{Effect=${effect}}}`;

    if (window.opener && !window.opener.closed) {
      window.opener.postMessage({
        action: 'announceSpell',
        message: message
      }, '*');
    }

    debug.log('🌀 Wild Magic Surge popup displayed');
  }

  // ===== BARDIC INSPIRATION POPUP =====

  /**
   * Show Bardic Inspiration popup
   * @param {Object} rollData - Roll information
   */
  function showBardicInspirationPopup(rollData) {
    debug.log('🎵 Bardic Inspiration popup called with:', rollData);

    // Check if document.body exists
    if (!document.body) {
      debug.error('❌ document.body not available for Bardic Inspiration popup');
      showNotification('🎵 Bardic Inspiration available! (Popup failed to display)', 'info');
      return;
    }

    debug.log('🎵 Creating Bardic Inspiration popup overlay...');

    // Get theme-aware colors
    const colors = getPopupThemeColors();

    // Create popup overlay
    const popupOverlay = document.createElement('div');
    popupOverlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.8);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;

    // Create popup content
    const popupContent = document.createElement('div');
    popupContent.style.cssText = `
      background: ${colors.background};
      border-radius: 12px;
      padding: 24px;
      max-width: 450px;
      width: 90%;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
      text-align: center;
    `;

    debug.log('🎵 Setting Bardic Inspiration popup content HTML...');

    popupContent.innerHTML = `
      <div style="font-size: 32px; margin-bottom: 16px;">🎵</div>
      <h2 style="margin: 0 0 8px 0; color: ${colors.heading};">Bardic Inspiration!</h2>
      <p style="margin: 0 0 16px 0; color: ${colors.text};">
        Add a <strong>${rollData.inspirationDie}</strong> to this roll?
      </p>
      <div style="margin: 0 0 16px 0; padding: 12px; background: ${colors.infoBox}; border-radius: 8px; border-left: 4px solid #9b59b6; color: ${colors.text};">
        <strong>Current Roll:</strong> ${rollData.rollName}<br>
        <strong>Base Result:</strong> ${rollData.baseRoll}<br>
        <strong>Inspiration Die:</strong> ${rollData.inspirationDie}<br>
        <strong>Uses Left:</strong> ${rollData.usesRemaining}
      </div>
      <div style="margin-bottom: 16px; padding: 12px; background: ${colors.infoBox}; border-radius: 8px; color: ${colors.text}; font-size: 13px; text-align: left;">
        <strong>💡 How it works:</strong><br>
        • Roll the inspiration die and add it to your total<br>
        • Can be used on ability checks, attack rolls, or saves<br>
        • Only one inspiration die can be used per roll
      </div>
      <div style="display: flex; gap: 12px; justify-content: center;">
        <button id="bardicUseBtn" style="
          background: #9b59b6;
          color: white;
          border: none;
          padding: 12px 24px;
          border-radius: 8px;
          cursor: pointer;
          font-weight: bold;
          font-size: 14px;
          transition: background 0.2s;
        ">🎲 Use Inspiration</button>
        <button id="bardicDeclineBtn" style="
          background: #7f8c8d;
          color: white;
          border: none;
          padding: 12px 24px;
          border-radius: 8px;
          cursor: pointer;
          font-weight: bold;
          font-size: 14px;
          transition: background 0.2s;
        ">Decline</button>
      </div>
    `;

    debug.log('🎵 Appending Bardic Inspiration popup to document.body...');

    popupOverlay.appendChild(popupContent);
    document.body.appendChild(popupOverlay);

    // Add hover effects
    const useBtn = document.getElementById('bardicUseBtn');
    const declineBtn = document.getElementById('bardicDeclineBtn');

    useBtn.addEventListener('mouseenter', () => {
      useBtn.style.background = '#8e44ad';
    });
    useBtn.addEventListener('mouseleave', () => {
      useBtn.style.background = '#9b59b6';
    });

    declineBtn.addEventListener('mouseenter', () => {
      declineBtn.style.background = '#95a5a6';
    });
    declineBtn.addEventListener('mouseleave', () => {
      declineBtn.style.background = '#7f8c8d';
    });

    // Add event listeners
    useBtn.addEventListener('click', () => {
      debug.log('🎵 User chose to use Bardic Inspiration');
      performBardicInspirationRoll(rollData);
      document.body.removeChild(popupOverlay);
    });

    declineBtn.addEventListener('click', () => {
      debug.log('🎵 User declined Bardic Inspiration');
      showNotification('Bardic Inspiration declined', 'info');
      document.body.removeChild(popupOverlay);
    });

    // Close on overlay click
    popupOverlay.addEventListener('click', (e) => {
      if (e.target === popupOverlay) {
        debug.log('🎵 User closed Bardic Inspiration popup');
        document.body.removeChild(popupOverlay);
      }
    });

    debug.log('🎵 Bardic Inspiration popup displayed');
  }

  /**
   * Perform Bardic Inspiration roll
   * @param {Object} rollData - Roll information
   */
  function performBardicInspirationRoll(rollData) {
    debug.log('🎵 Performing Bardic Inspiration roll with data:', rollData);

    // Use one Bardic Inspiration use
    const success = useBardicInspiration();
    if (!success) {
      debug.error('❌ Failed to use Bardic Inspiration (no uses left?)');
      showNotification('❌ Failed to use Bardic Inspiration', 'error');
      return;
    }

    // Roll the inspiration die
    const dieSize = parseInt(rollData.inspirationDie.substring(1)); // "d6" -> 6
    const inspirationRoll = Math.floor(Math.random() * dieSize) + 1;

    debug.log(`🎵 Rolled ${rollData.inspirationDie}: ${inspirationRoll}`);

    // Create the roll message
    const inspirationMessage = `/roll ${rollData.inspirationDie}`;
    const chatMessage = `🎵 Bardic Inspiration for ${rollData.rollName}: [[${inspirationRoll}]] (${rollData.inspirationDie})`;

    // Show notification
    showNotification(`🎵 Bardic Inspiration: +${inspirationRoll}!`, 'success');

    // Post to Roll20 chat
    browserAPI.runtime.sendMessage({
      action: 'rollDice',
      rollData: {
        message: chatMessage,
        characterName: characterData.name || 'Character'
      }
    });

    debug.log('🎵 Bardic Inspiration roll complete');
  }

  // ===== ELVEN ACCURACY POPUP =====

  /**
   * Show Elven Accuracy popup
   * @param {Object} rollData - Roll information
   */
  function showElvenAccuracyPopup(rollData) {
    debug.log('🧝 Elven Accuracy popup called with:', rollData);

    if (!document.body) {
      debug.error('❌ document.body not available for Elven Accuracy popup');
      showNotification('🧝 Elven Accuracy triggered!', 'info');
      return;
    }

    const colors = getPopupThemeColors();

    // Create popup overlay
    const popupOverlay = document.createElement('div');
    popupOverlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.8);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;

    // Create popup content
    const popupContent = document.createElement('div');
    popupContent.style.cssText = `
      background: ${colors.background};
      border-radius: 12px;
      padding: 24px;
      max-width: 400px;
      width: 90%;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
      text-align: center;
    `;

    popupContent.innerHTML = `
      <div style="font-size: 24px; margin-bottom: 16px;">🧝</div>
      <h2 style="margin: 0 0 8px 0; color: #c2185b;">Elven Accuracy!</h2>
      <p style="margin: 0 0 16px 0; color: ${colors.text};">
        You have advantage! Would you like to reroll the lower die?
      </p>
      <div style="margin: 0 0 16px 0; padding: 12px; background: ${colors.infoBox}; border-radius: 8px; border-left: 4px solid #c2185b; color: ${colors.text};">
        <strong>Roll:</strong> ${rollData.rollName}<br>
        <strong>Type:</strong> Advantage attack roll
      </div>
      <div style="display: flex; gap: 12px; justify-content: center;">
        <button id="elvenRerollBtn" style="
          background: #c2185b;
          color: white;
          border: none;
          padding: 12px 24px;
          border-radius: 8px;
          cursor: pointer;
          font-weight: bold;
          font-size: 14px;
        ">🎲 Reroll Lower Die</button>
        <button id="elvenKeepBtn" style="
          background: #95a5a6;
          color: white;
          border: none;
          padding: 12px 24px;
          border-radius: 8px;
          cursor: pointer;
          font-weight: bold;
          font-size: 14px;
        ">Keep Rolls</button>
      </div>
    `;

    popupOverlay.appendChild(popupContent);
    document.body.appendChild(popupOverlay);

    // Add event listeners
    const rerollBtn = document.getElementById('elvenRerollBtn');
    const keepBtn = document.getElementById('elvenKeepBtn');

    rerollBtn.addEventListener('mouseenter', () => rerollBtn.style.background = '#ad1457');
    rerollBtn.addEventListener('mouseleave', () => rerollBtn.style.background = '#c2185b');
    keepBtn.addEventListener('mouseenter', () => keepBtn.style.background = '#7f8c8d');
    keepBtn.addEventListener('mouseleave', () => keepBtn.style.background = '#95a5a6');

    rerollBtn.addEventListener('click', () => {
      debug.log('🧝 User chose to reroll with Elven Accuracy');
      performElvenAccuracyReroll(rollData);
      document.body.removeChild(popupOverlay);
    });

    keepBtn.addEventListener('click', () => {
      debug.log('🧝 User chose to keep original advantage rolls');
      document.body.removeChild(popupOverlay);
    });

    // Close on overlay click
    popupOverlay.addEventListener('click', (e) => {
      if (e.target === popupOverlay) {
        document.body.removeChild(popupOverlay);
      }
    });

    debug.log('🧝 Elven Accuracy popup displayed');
  }

  /**
   * Perform Elven Accuracy reroll
   * @param {Object} originalRollData - Original roll data
   */
  function performElvenAccuracyReroll(originalRollData) {
    debug.log('🧝 Performing Elven Accuracy reroll for:', originalRollData);

    // Roll a third d20
    const thirdRoll = Math.floor(Math.random() * 20) + 1;

    // Create reroll announcement
    const rerollData = {
      name: `🧝 ${originalRollData.rollName} (Elven Accuracy - 3rd die)`,
      formula: '1d20',
      color: '#c2185b',
      characterName: characterData.name
    };

    debug.log('🧝 Third die roll:', thirdRoll);

    // Announce the third die roll to Roll20
    const colorBanner = getColoredBanner(characterData);
    const message = `&{template:default} {{name=${colorBanner}${characterData.name} uses Elven Accuracy! 🧝}} {{Action=Reroll lower die}} {{Third d20=${thirdRoll}}} {{=Choose the highest of all three rolls!}}`;

    if (window.opener && !window.opener.closed) {
      window.opener.postMessage({
        action: 'announceSpell',
        message: message
      }, '*');
    } else {
      // Fallback: send directly to Roll20 via background script
      browserAPI.runtime.sendMessage({
        action: 'relayRollToRoll20',
        roll: { ...rerollData, result: thirdRoll }
      });
    }

    showNotification(`🧝 Elven Accuracy! Third die: ${thirdRoll}`, 'success');
  }

  // ===== EXPORTS =====

  // Export functions to globalThis
  globalThis.getPopupThemeColors = getPopupThemeColors;
  globalThis.showHalflingLuckPopup = showHalflingLuckPopup;
  globalThis.showLuckyPopup = showLuckyPopup;
  globalThis.showTraitChoicePopup = showTraitChoicePopup;
  globalThis.showWildMagicSurgePopup = showWildMagicSurgePopup;
  globalThis.showBardicInspirationPopup = showBardicInspirationPopup;
  globalThis.showElvenAccuracyPopup = showElvenAccuracyPopup;
  globalThis.performHalflingReroll = performHalflingReroll;
  globalThis.performLuckyReroll = performLuckyReroll;
  globalThis.performBardicInspirationRoll = performBardicInspirationRoll;
  globalThis.performElvenAccuracyReroll = performElvenAccuracyReroll;

  debug.log('✅ Character Trait Popups module loaded');

})();
