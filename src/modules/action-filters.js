/**
 * Action Filters Module
 *
 * Handles action filtering, categorization, and filter state management.
 * Loaded as a plain script (no ES6 modules) to export to globalThis.
 *
 * Functions exported to globalThis:
 * - categorizeAction(action)
 * - filterActions(deduplicatedActions)
 * - rebuildActions()
 * - initializeActionFilters()
 *
 * State exported to globalThis:
 * - actionFilters (via Object.defineProperty with getter/setter)
 */

(function() {
  'use strict';

  // ===== FILTER STATE =====

  let actionFilters = {
    actionType: 'all',
    category: 'all',
    search: ''
  };

  // Export actionFilters state with getter/setter
  Object.defineProperty(globalThis, 'actionFilters', {
    get: () => actionFilters,
    set: (value) => { actionFilters = value; },
    configurable: true
  });

  // ===== CATEGORIZATION =====

  /**
   * Categorize an action as healing, damage, or utility
   */
  function categorizeAction(action) {
    const name = (action.name || '').toLowerCase();
    const damageType = (action.damageType || '').toLowerCase();

    // Check for healing based on damage type or name
    if (damageType.includes('heal') || name.includes('heal') || name.includes('cure')) {
      return 'healing';
    }

    // Check for damage based on actual damage formula
    if (action.damage && action.damage.includes('d')) {
      return 'damage';
    }

    // Everything else is utility
    return 'utility';
  }

  // ===== FILTERING =====

  /**
   * Apply current action filters to deduplicated actions
   */
  function filterActions(deduplicatedActions) {
    let filteredActions = deduplicatedActions.filter(action => {
      const actionName = (action.name || '').toLowerCase();

      // Filter out duplicate Divine Smite entries - keep only the main one
      if (actionName.includes('divine smite')) {
        // Skip variants like "Divine Smite Level 1", "Divine Smite (Against Fiends, Critical) Level 1", etc.
        // Keep only the base "Divine Smite" entry
        if (actionName !== 'divine smite' && !actionName.match(/^divine smite$/)) {
          if (typeof debug !== 'undefined') {
            debug.log(`⏭️ Filtering out duplicate Divine Smite entry: ${action.name}`);
          }
          return false;
        } else {
          if (typeof debug !== 'undefined') {
            debug.log(`✅ Keeping main Divine Smite entry: ${action.name}`);
          }
        }
      }

      // Debug: Log all Lay on Hands related actions
      if (actionName.includes('lay on hands')) {
        const normalizedActionName = action.name.toLowerCase()
          .replace(/[^a-z0-9\s:]/g, '') // Remove special chars except colon and space
          .replace(/\s+/g, ' ') // Normalize spaces
          .trim();
        const normalizedSearch = 'lay on hands: heal';

        if (typeof debug !== 'undefined') {
          debug.log(`🔍 Found Lay on Hands action: "${action.name}"`);
          debug.log(`🔍 Normalized action name: "${normalizedActionName}"`);
          debug.log(`🔍 Normalized search term: "${normalizedSearch}"`);
          debug.log(`🔍 Do they match? ${normalizedActionName === normalizedSearch}`);
          debug.log(`🔍 Action object:`, action);
        }
      }

      // Filter by action type
      if (actionFilters.actionType !== 'all') {
        const actionType = (action.actionType || '').toLowerCase();
        if (actionType !== actionFilters.actionType) {
          return false;
        }
      }

      // Filter by category
      if (actionFilters.category !== 'all') {
        const category = categorizeAction(action);
        if (category !== actionFilters.category) {
          return false;
        }
      }

      // Filter by search term
      if (actionFilters.search) {
        const searchLower = actionFilters.search;
        const name = (action.name || '').toLowerCase();
        const desc = (action.description || '').toLowerCase();
        if (!name.includes(searchLower) && !desc.includes(searchLower)) {
          return false;
        }
      }

      return true;
    });

    if (typeof debug !== 'undefined') {
      debug.log(`🔍 Filtered ${deduplicatedActions.length} actions to ${filteredActions.length} actions`);
    }
    return filteredActions;
  }

  // ===== REBUILD =====

  /**
   * Rebuild actions display with current filters
   */
  function rebuildActions() {
    if (typeof characterData === 'undefined' || !characterData || !characterData.actions) return;
    const container = document.getElementById('actions-container');
    if (typeof buildActionsDisplay !== 'undefined') {
      buildActionsDisplay(container, characterData.actions);
    }
  }

  // ===== INITIALIZATION =====

  /**
   * Initialize action filter event listeners
   */
  function initializeActionFilters() {
    // Actions search filter
    const actionsSearch = document.getElementById('actions-search');
    if (actionsSearch) {
      actionsSearch.addEventListener('input', (e) => {
        actionFilters.search = e.target.value.toLowerCase();
        rebuildActions();
      });
    }

    // Action type filters
    document.querySelectorAll('[data-type="action-type"]').forEach(btn => {
      btn.addEventListener('click', () => {
        actionFilters.actionType = btn.dataset.filter;
        document.querySelectorAll('[data-type="action-type"]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        rebuildActions();
      });
    });

    // Action category filters
    document.querySelectorAll('[data-type="action-category"]').forEach(btn => {
      btn.addEventListener('click', () => {
        actionFilters.category = btn.dataset.filter;
        document.querySelectorAll('[data-type="action-category"]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        rebuildActions();
      });
    });
  }

  // ===== EXPORTS =====

  globalThis.categorizeAction = categorizeAction;
  globalThis.filterActions = filterActions;
  globalThis.rebuildActions = rebuildActions;
  globalThis.initializeActionFilters = initializeActionFilters;

})();
