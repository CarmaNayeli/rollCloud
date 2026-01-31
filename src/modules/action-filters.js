/**
 * Action Filters Module
 *
 * Handles action filtering, categorization, and rebuilding.
 * Loaded as a plain script (no ES6 modules) to export to globalThis.
 *
 * Functions exported to globalThis:
 * - categorizeAction(action)
 * - initializeActionFilters()
 * - rebuildActions()
 *
 * State variables exported to globalThis:
 * - actionFilters
 */

(function() {
  'use strict';

  // ===== STATE =====

  // Filter state for actions
  const actionFilters = {
    actionType: 'all',
    category: 'all',
    search: ''
  };

  // ===== FUNCTIONS =====

  /**
   * Helper function to categorize an action
   * @param {Object} action - Action object
   * @returns {string} Category: 'healing', 'damage', or 'utility'
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

    // Action type filters (action, bonus action, reaction, etc.)
    document.querySelectorAll('[data-type="action-type"]').forEach(btn => {
      btn.addEventListener('click', () => {
        actionFilters.actionType = btn.dataset.filter;
        document.querySelectorAll('[data-type="action-type"]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        rebuildActions();
      });
    });

    // Action category filters (damage, healing, utility)
    document.querySelectorAll('[data-type="action-category"]').forEach(btn => {
      btn.addEventListener('click', () => {
        actionFilters.category = btn.dataset.filter;
        document.querySelectorAll('[data-type="action-category"]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        rebuildActions();
      });
    });
  }

  /**
   * Rebuild actions with current filters
   */
  function rebuildActions() {
    if (!characterData || !characterData.actions) return;

    // Filter actions based on current filter state
    let filteredActions = characterData.actions.filter(action => {
      // Filter by action type (action, bonus, reaction, free)
      if (actionFilters.actionType !== 'all') {
        const actionType = (action.actionType || 'action').toLowerCase(); // Default to 'action' if not set
        if (actionType !== actionFilters.actionType.toLowerCase()) { // Case-insensitive comparison
          return false;
        }
      }

      // Filter by category (damage, healing, utility)
      if (actionFilters.category !== 'all') {
        const category = categorizeAction(action);
        if (category !== actionFilters.category) {
          return false;
        }
      }

      // Filter by search term
      if (actionFilters.search) {
        const searchLower = actionFilters.search.toLowerCase();
        const nameMatch = (action.name || '').toLowerCase().includes(searchLower);
        const descMatch = (action.description || '').toLowerCase().includes(searchLower);
        const summaryMatch = (action.summary || '').toLowerCase().includes(searchLower);
        if (!nameMatch && !descMatch && !summaryMatch) {
          return false;
        }
      }

      return true;
    });

    debug.log(`🔍 Filtered actions: ${filteredActions.length}/${characterData.actions.length} (type=${actionFilters.actionType}, category=${actionFilters.category}, search="${actionFilters.search}")`);

    const container = document.getElementById('actions-container');
    buildActionsDisplay(container, filteredActions);
  }

  // ===== EXPORTS =====

  globalThis.categorizeAction = categorizeAction;
  globalThis.initializeActionFilters = initializeActionFilters;
  globalThis.rebuildActions = rebuildActions;

  // Export state variable with getter and setter
  Object.defineProperty(globalThis, 'actionFilters', {
    get: () => actionFilters,
    set: (value) => {
      if (value && typeof value === 'object') {
        Object.assign(actionFilters, value);
      }
    }
  });

  console.log('✅ Action Filters module loaded');

})();
