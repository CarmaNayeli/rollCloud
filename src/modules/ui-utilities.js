/**
 * UI Utilities Module
 *
 * Generic UI helper functions:
 * - Collapsible sections (expand/collapse sheet sections)
 * - Color palette selector (notification color picker)
 * - Close button handler
 * - Supabase color sync
 *
 * These are reusable UI components that don't contain domain-specific logic.
 *
 * Loaded as a plain script (no ES6 modules) to export to globalThis.
 *
 * Functions exported to globalThis:
 * - initCollapsibleSections()
 * - collapseSectionByContainerId(containerId)
 * - expandSectionByContainerId(containerId)
 * - createColorPalette(selectedColor)
 * - initColorPalette()
 * - syncColorToSupabase(color)
 * - initCloseButton()
 */

(function() {
  'use strict';

  // ===== COLLAPSIBLE SECTIONS =====

  /**
   * Initialize collapsible sections
   * Makes all section headers clickable to toggle visibility
   */
  function initCollapsibleSections() {
    const sections = document.querySelectorAll('.section h3');

    sections.forEach(header => {
      header.addEventListener('click', function() {
        const section = this.parentElement;
        const content = section.querySelector('.section-content');

        // Toggle collapsed class
        this.classList.toggle('collapsed');
        content.classList.toggle('collapsed');
      });
    });
  }

  /**
   * Helper function to collapse a section by its container ID
   * @param {string} containerId - The ID of the container element
   */
  function collapseSectionByContainerId(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const section = container.closest('.section');
    if (!section) return;

    const header = section.querySelector('h3');
    const content = section.querySelector('.section-content');

    if (header && content) {
      header.classList.add('collapsed');
      content.classList.add('collapsed');
    }
  }

  /**
   * Helper function to expand a section by its container ID
   * @param {string} containerId - The ID of the container element
   */
  function expandSectionByContainerId(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const section = container.closest('.section');
    if (!section) return;

    const header = section.querySelector('h3');
    const content = section.querySelector('.section-content');

    if (header && content) {
      header.classList.remove('collapsed');
      content.classList.remove('collapsed');
    }
  }

  // ===== COLOR PALETTE =====

  /**
   * Create color palette HTML
   * @param {string} selectedColor - Currently selected color hex value
   * @returns {string} HTML string for color palette
   */
  function createColorPalette(selectedColor) {
    const colors = [
      { name: 'Blue', value: '#3498db', emoji: '🔵' },
      { name: 'Red', value: '#e74c3c', emoji: '🔴' },
      { name: 'Green', value: '#c2185b', emoji: '🟢' },
      { name: 'Purple', value: '#9b59b6', emoji: '🟣' },
      { name: 'Orange', value: '#e67e22', emoji: '🟠' },
      { name: 'Yellow', value: '#f1c40f', emoji: '🟡' },
      { name: 'Grey', value: '#95a5a6', emoji: '⚪' },
      { name: 'Black', value: '#34495e', emoji: '⚫' },
      { name: 'Brown', value: '#8b4513', emoji: '🟤' }
    ];

    return colors.map(color => {
      const isSelected = color.value === selectedColor;
      return `
      <div class="color-swatch"
           data-color="${color.value}"
           style="font-size: 1.5em; cursor: pointer; transition: all 0.2s; opacity: ${isSelected ? '1' : '0.85'}; transform: ${isSelected ? 'scale(1.15)' : 'scale(1)'}; filter: ${isSelected ? 'drop-shadow(0 0 4px white)' : 'none'}; text-align: center;"
           title="${color.name}">${color.emoji}</div>
    `;
    }).join('');
  }

  // Global flag to track if document-level click listener has been added
  let colorPaletteDocumentListenerAdded = false;

  /**
   * Initialize color palette selector
   * Sets up the color picker dropdown for notification colors
   */
  function initColorPalette() {
    // Set default color if not set
    if (!characterData.notificationColor) {
      characterData.notificationColor = '#3498db';
    }

    const toggleBtnOld = document.getElementById('color-toggle');
    const palette = document.getElementById('color-palette');

    if (!toggleBtnOld || !palette) return;

    // Clone and replace toggle button to remove old listeners
    const toggleBtn = toggleBtnOld.cloneNode(true);
    toggleBtnOld.parentNode.replaceChild(toggleBtn, toggleBtnOld);

    // Toggle palette visibility
    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isVisible = palette.style.display === 'grid';
      palette.style.display = isVisible ? 'none' : 'grid';
    });

    // Add document-level click listener only once
    if (!colorPaletteDocumentListenerAdded) {
      // Close palette when clicking outside
      document.addEventListener('click', (e) => {
        const currentToggleBtn = document.getElementById('color-toggle');
        const currentPalette = document.getElementById('color-palette');
        if (currentPalette && currentToggleBtn) {
          if (!currentPalette.contains(e.target) && e.target !== currentToggleBtn && !currentToggleBtn.contains(e.target)) {
            currentPalette.style.display = 'none';
          }
        }
      });
      colorPaletteDocumentListenerAdded = true;
      debug.log('🎨 Added document-level color palette click listener');
    }

    // Add click handlers to color swatches
    document.querySelectorAll('.color-swatch').forEach(swatch => {
      swatch.addEventListener('click', (e) => {
        const newColor = e.target.dataset.color;
        const oldColor = characterData.notificationColor;
        characterData.notificationColor = newColor;

        // Update all swatches appearance
        document.querySelectorAll('.color-swatch').forEach(s => {
          const isSelected = s.dataset.color === newColor;
          s.style.opacity = isSelected ? '1' : '0.6';
          s.style.transform = isSelected ? 'scale(1.2)' : 'scale(1)';
          s.style.filter = isSelected ? 'drop-shadow(0 0 4px white)' : 'none';
        });

        // Update the toggle button emoji (using current element in DOM)
        const newEmoji = getColorEmoji(newColor);
        const colorEmojiEl = document.getElementById('color-emoji');
        if (colorEmojiEl) {
          colorEmojiEl.textContent = newEmoji;
        }

        // Close the palette
        palette.style.display = 'none';

        // Save to storage
        saveCharacterData();

        // Sync to Supabase if available
        syncColorToSupabase(newColor);

        showNotification(`🎨 Notification color changed to ${e.target.title}!`);
      });
    });
  }

  /**
   * Sync color selection to Supabase
   * @param {string} color - Hex color value to sync
   */
  async function syncColorToSupabase(color) {
    try {
      // Send message to background script to sync to Supabase
      const response = await browserAPI.runtime.sendMessage({
        action: 'syncCharacterColor',
        characterId: characterData.id,
        color: color
      });

      if (response && response.success) {
        debug.log('🎨 Color synced to Supabase successfully');
      } else {
        debug.warn('⚠️ Failed to sync color to Supabase:', response?.error);
      }
    } catch (error) {
      debug.warn('⚠️ Error syncing color to Supabase:', error);
    }
  }

  // ===== CLOSE BUTTON =====

  /**
   * Initialize close button
   * Adds click handler to close the popup window
   */
  function initCloseButton() {
    const closeBtn = document.getElementById('close-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        window.close();
      });
    }
  }

  // ===== EXPORTS =====

  // Export functions to globalThis
  globalThis.initCollapsibleSections = initCollapsibleSections;
  globalThis.collapseSectionByContainerId = collapseSectionByContainerId;
  globalThis.expandSectionByContainerId = expandSectionByContainerId;
  globalThis.createColorPalette = createColorPalette;
  globalThis.initColorPalette = initColorPalette;
  globalThis.syncColorToSupabase = syncColorToSupabase;
  globalThis.initCloseButton = initCloseButton;

  debug.log('✅ UI Utilities module loaded');

  // ===== AUTO-INITIALIZATION =====

  // Initialize collapsible sections when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCollapsibleSections);
  } else {
    initCollapsibleSections();
  }

  // Initialize close button when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCloseButton);
  } else {
    initCloseButton();
  }

})();
