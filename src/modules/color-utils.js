/**
 * Color Utilities
 * Functions for handling character notification colors and color names
 */

/**
 * Get emoji representation of a color
 * @param {string} color - Hex color code
 * @returns {string} Emoji representing the color
 */
function getColorEmoji(color) {
  const colorEmojiMap = {
    '#3498db': '🔵', // Blue
    '#e74c3c': '🔴', // Red
    '#c2185b': '🟢', // Green
    '#9b59b6': '🟣', // Purple
    '#e67e22': '🟠', // Orange
    '#f1c40f': '🟡', // Yellow
    '#95a5a6': '⚪', // Grey
    '#34495e': '⚫', // Black
    '#8b4513': '🟤'  // Brown
  };
  return colorEmojiMap[color] || '🔵';
}

/**
 * Get human-readable name for a color
 * @param {string} hexColor - Hex color code
 * @returns {string} Color name
 */
function getColorName(hexColor) {
  const colorMap = {
    '#3498db': 'Blue',
    '#e74c3c': 'Red',
    '#c2185b': 'Green',
    '#9b59b6': 'Purple',
    '#e67e22': 'Orange',
    '#f1c40f': 'Yellow',
    '#95a5a6': 'Grey',
    '#34495e': 'Black',
    '#8b4513': 'Brown'
  };
  return colorMap[hexColor] || 'Blue';
}

/**
 * Get colored banner with emoji for character
 * @param {object} characterData - Character data object with notificationColor
 * @returns {string} Emoji banner
 */
function getColoredBanner(characterData) {
  const color = characterData.notificationColor || '#3498db';
  const emoji = getColorEmoji(color);
  return `${emoji} `;
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getColorEmoji, getColorName, getColoredBanner };
}

// Make available globally for popup-sheet.js (both as ColorUtils namespace and individual functions)
if (typeof window !== 'undefined') {
  window.ColorUtils = { getColorEmoji, getColorName, getColoredBanner };
  // Also export individual functions to globalThis for direct access
  window.getColorEmoji = getColorEmoji;
  window.getColorName = getColorName;
  window.getColoredBanner = getColoredBanner;
}
