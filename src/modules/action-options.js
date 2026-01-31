/**
 * Action Options Module
 *
 * Handles generation of action options (attack, damage, healing buttons).
 * Loaded as a plain script (no ES6 modules) to export to globalThis.
 *
 * Functions exported to globalThis:
 * - getActionOptions(action)
 */

(function() {
  'use strict';

  /**
   * Get available action options (attack/damage rolls) with edge case modifications
   * @param {Object} action - Action object
   * @returns {Object} Object with { options: [], skipNormalButtons: boolean }
   */
  function getActionOptions(action) {
    const options = [];

    // Check for attack
    if (action.attackRoll) {
      // Convert to full formula if it's just a number (legacy data)
      let formula = action.attackRoll;
      if (typeof formula === 'number' || !formula.includes('d20')) {
        const bonus = parseInt(formula);
        formula = bonus >= 0 ? `1d20+${bonus}` : `1d20${bonus}`;
      }

      options.push({
        type: 'attack',
        label: '🎯 Attack',
        formula: formula,
        icon: '🎯',
        color: '#e74c3c'
      });
    }

    // Check for damage/healing rolls
    const isValidDiceFormula = action.damage && (/\d*d\d+/.test(action.damage) || /\d*d\d+/.test(action.damage.replace(/\s*\+\s*/g, '+')));
    debug.log(`🎲 Action "${action.name}" damage check:`, {
      damage: action.damage,
      isValid: isValidDiceFormula,
      attackRoll: action.attackRoll
    });
    if (isValidDiceFormula) {
      const isHealing = action.damageType && action.damageType.toLowerCase().includes('heal');
      const isTempHP = action.damageType && (
        action.damageType.toLowerCase() === 'temphp' ||
        action.damageType.toLowerCase() === 'temporary' ||
        action.damageType.toLowerCase().includes('temp')
      );

      // Use different text for healing vs damage vs features
      let btnText;
      if (isHealing) {
        btnText = '💚 Heal';
      } else if (action.actionType === 'feature' || !action.attackRoll) {
        btnText = '🎲 Roll';
      } else {
        btnText = '💥 Damage';
      }

      options.push({
        type: isHealing ? 'healing' : (isTempHP ? 'temphp' : 'damage'),
        label: btnText,
        formula: action.damage,
        icon: isTempHP ? '🛡️' : (isHealing ? '💚' : '💥'),
        color: isTempHP ? '#3498db' : (isHealing ? '#c2185b' : '#e67e22')
      });
    }

    // Apply edge case modifications
    let edgeCaseResult;

    // Check class feature edge cases first
    if (isClassFeatureEdgeCase(action.name)) {
      edgeCaseResult = applyClassFeatureEdgeCaseModifications(action, options);
      debug.log(`🔍 Edge case applied for "${action.name}": skipNormalButtons = ${edgeCaseResult.skipNormalButtons}`);
    }
    // Check racial feature edge cases
    else if (isRacialFeatureEdgeCase(action.name)) {
      edgeCaseResult = applyRacialFeatureEdgeCaseModifications(action, options);
      debug.log(`🔍 Edge case applied for "${action.name}": skipNormalButtons = ${edgeCaseResult.skipNormalButtons}`);
    }
    // Check combat maneuver edge cases
    else if (isCombatManeuverEdgeCase(action.name)) {
      edgeCaseResult = applyCombatManeuverEdgeCaseModifications(action, options);
      debug.log(`🔍 Edge case applied for "${action.name}": skipNormalButtons = ${edgeCaseResult.skipNormalButtons}`);
    }
    // Default - no edge cases
    else {
      edgeCaseResult = { options, skipNormalButtons: false };
      debug.log(`🔍 No edge case for "${action.name}": skipNormalButtons = false`);
    }

    return edgeCaseResult;
  }

  // ===== EXPORTS =====

  globalThis.getActionOptions = getActionOptions;

  console.log('✅ Action Options module loaded');

})();
