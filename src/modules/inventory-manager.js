/**
 * Inventory Manager Module
 *
 * Handles inventory display and item card creation.
 * Loaded as a plain script (no ES6 modules) to export to globalThis.
 *
 * Functions exported to globalThis:
 * - rebuildInventory()
 * - buildInventoryDisplay(container, inventory)
 * - createInventoryCard(item)
 */

(function() {
  'use strict';

  /**
   * Rebuild inventory display with current character data
   */
  function rebuildInventory() {
    if (!characterData || !characterData.inventory) return;
    const container = document.getElementById('inventory-container');
    buildInventoryDisplay(container, characterData.inventory);
  }

  /**
   * Build and display inventory with filtering
   */
  function buildInventoryDisplay(container, inventory) {
    // Clear container
    container.innerHTML = '';

    // Update currency display in header
    // updateInventoryCurrencyDisplay(inventory); // Commented out currency viewer

    if (!inventory || inventory.length === 0) {
      container.innerHTML = '<p style="color: var(--text-secondary); text-align: center; padding: 20px;">No items in inventory</p>';
      return;
    }

    debug.log(`🎒 Building inventory display with ${inventory.length} items`);

    // Apply filters
    let filteredInventory = inventory.filter(item => {
      // Filter out coins (currency) - they're tracked separately
      const lowerName = (item.name || '').toLowerCase();
      const coinPatterns = ['platinum piece', 'gold piece', 'silver piece', 'copper piece', 'electrum piece',
                            'platinum coin', 'gold coin', 'silver coin', 'copper coin', 'electrum coin',
                            'pp', 'gp', 'sp', 'cp', 'ep'];
      // Check for exact matches or plurals
      const isCoin = coinPatterns.some(pattern => {
        if (pattern.length <= 2) {
          // Short patterns (pp, gp, etc.) - match exactly or with quantity prefix
          return lowerName === pattern || lowerName === pattern + 's' || lowerName.match(new RegExp(`^\\d+\\s*${pattern}s?$`));
        }
        // Longer patterns - match if name contains it
        return lowerName.includes(pattern);
      });
      if (isCoin) {
        return false;
      }

      // Filter by type
      if (inventoryFilters.filter === 'equipped' && !item.equipped) {
        return false;
      }
      if (inventoryFilters.filter === 'attuned' && !item.attuned) {
        return false;
      }
      if (inventoryFilters.filter === 'container' && item.type !== 'container') {
        return false;
      }

      // Filter by search term
      if (inventoryFilters.search) {
        const searchLower = inventoryFilters.search;
        const name = (item.name || '').toLowerCase();
        const desc = (item.description || '').toLowerCase();
        const tagsString = (item.tags || []).join(' ').toLowerCase();
        if (!name.includes(searchLower) && !desc.includes(searchLower) && !tagsString.includes(searchLower)) {
          return false;
        }
      }

      return true;
    });

    if (filteredInventory.length === 0) {
      container.innerHTML = '<p style="color: var(--text-secondary); text-align: center; padding: 20px;">No items match filters</p>';
      return;
    }

    // Sort inventory: equipped first, then by name
    filteredInventory.sort((a, b) => {
      if (a.equipped && !b.equipped) return -1;
      if (!a.equipped && b.equipped) return 1;
      return (a.name || '').localeCompare(b.name || '');
    });

    // Group items by category/container
    filteredInventory.forEach(item => {
      const itemCard = createInventoryCard(item);
      container.appendChild(itemCard);
    });

    debug.log(`✅ Inventory display built with ${filteredInventory.length} items`);
  }

  /**
   * Create an inventory item card element
   */
  function createInventoryCard(item) {
    const card = document.createElement('div');
    card.className = 'action-card'; // Reuse action card styling
    card.style.cssText = `
      background: var(--bg-card);
      border-left: 4px solid ${item.equipped ? '#c2185b' : item.attuned ? '#9b59b6' : '#95a5a6'};
      padding: 15px;
      margin-bottom: 10px;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.2s;
      ${item.equipped ? 'box-shadow: 0 0 10px rgba(39, 174, 96, 0.3);' : ''}
    `;

    card.onmouseover = () => {
      card.style.background = 'var(--bg-card-hover)';
      card.style.transform = 'translateX(2px)';
    };
    card.onmouseout = () => {
      card.style.background = 'var(--bg-card)';
      card.style.transform = 'translateX(0)';
    };

    // Header with name and quantity
    const header = document.createElement('div');
    header.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;';

    const nameSection = document.createElement('div');
    nameSection.style.cssText = 'display: flex; align-items: center; gap: 8px;';

    const itemName = document.createElement('strong');
    itemName.textContent = item.name || 'Unnamed Item';
    itemName.style.cssText = 'color: var(--text-primary); font-size: 1.1em;';
    nameSection.appendChild(itemName);

    // Add badges for equipped/attuned
    if (item.equipped) {
      const equippedBadge = document.createElement('span');
      equippedBadge.textContent = '⚔️ Equipped';
      equippedBadge.style.cssText = 'background: #c2185b; color: white; padding: 2px 8px; border-radius: 12px; font-size: 0.75em; font-weight: bold;';
      nameSection.appendChild(equippedBadge);
    }

    if (item.attuned) {
      const attunedBadge = document.createElement('span');
      attunedBadge.textContent = '✨ Attuned';
      attunedBadge.style.cssText = 'background: #9b59b6; color: white; padding: 2px 8px; border-radius: 12px; font-size: 0.75em; font-weight: bold;';
      nameSection.appendChild(attunedBadge);
    }

    if (item.requiresAttunement && !item.attuned) {
      const requiresBadge = document.createElement('span');
      requiresBadge.textContent = '(Requires Attunement)';
      requiresBadge.style.cssText = 'color: var(--text-muted); font-size: 0.85em; font-style: italic;';
      nameSection.appendChild(requiresBadge);
    }

    header.appendChild(nameSection);

    // Quantity display
    const metaSection = document.createElement('div');
    metaSection.style.cssText = 'display: flex; flex-direction: column; align-items: flex-end; gap: 4px;';

    if (item.quantity > 1 || item.showIncrement) {
      const quantitySpan = document.createElement('span');
      quantitySpan.textContent = `×${item.quantity}`;
      quantitySpan.style.cssText = 'color: var(--text-secondary); font-weight: bold; font-size: 1.1em;';
      metaSection.appendChild(quantitySpan);
    }

    header.appendChild(metaSection);
    card.appendChild(header);

    // Weight
    if (item.weight && item.weight > 0) {
      const weightDiv = document.createElement('div');
      const totalWeight = item.weight * item.quantity;
      weightDiv.textContent = `⚖️ ${totalWeight} lb${totalWeight !== 1 ? 's' : ''}`;
      weightDiv.style.cssText = 'color: var(--text-secondary); font-size: 0.85em; margin-bottom: 4px;';
      card.appendChild(weightDiv);
    }

    // Tags
    if (item.tags && item.tags.length > 0) {
      const tagsDiv = document.createElement('div');
      tagsDiv.style.cssText = 'display: flex; gap: 6px; flex-wrap: wrap; margin: 6px 0;';
      item.tags.forEach(tag => {
        const tagSpan = document.createElement('span');
        tagSpan.textContent = tag;
        tagSpan.style.cssText = 'background: var(--bg-tertiary); color: var(--text-secondary); padding: 2px 6px; border-radius: 8px; font-size: 0.75em;';
        tagsDiv.appendChild(tagSpan);
      });
      card.appendChild(tagsDiv);
    }

    // Description (collapsed by default, click to expand)
    if (item.description && item.description.trim()) {
      const descDiv = document.createElement('div');
      descDiv.style.cssText = 'color: var(--text-secondary); font-size: 0.9em; margin-top: 8px; border-top: 1px solid var(--border-color); padding-top: 8px; line-height: 1.4; max-height: 0; overflow: hidden; transition: max-height 0.3s;';
      descDiv.innerHTML = item.description.replace(/\n/g, '<br>');

      card.addEventListener('click', () => {
        if (descDiv.style.maxHeight === '0px' || !descDiv.style.maxHeight) {
          descDiv.style.maxHeight = '500px';
          descDiv.style.paddingTop = '8px';
        } else {
          descDiv.style.maxHeight = '0px';
          descDiv.style.paddingTop = '0px';
        }
      });

      card.appendChild(descDiv);
    }

    return card;
  }

  // Export to globalThis for use across all scripts
  globalThis.rebuildInventory = rebuildInventory;
  globalThis.buildInventoryDisplay = buildInventoryDisplay;
  globalThis.createInventoryCard = createInventoryCard;

})();
