/**
 * Reaction Role Storage Utilities
 * Manages persistent storage for reaction role configurations
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_FILE = join(__dirname, '../../data/reaction-roles.json');

/**
 * Load reaction roles from storage
 * @returns {Object} Reaction role data
 */
export function loadReactionRoles() {
  try {
    if (!existsSync(DATA_FILE)) {
      return { messages: {} };
    }
    const data = readFileSync(DATA_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error loading reaction roles:', error);
    return { messages: {} };
  }
}

/**
 * Save reaction roles to storage
 * @param {Object} data - Reaction role data to save
 */
export function saveReactionRoles(data) {
  try {
    // Ensure data directory exists
    const dataDir = dirname(DATA_FILE);
    if (!existsSync(dataDir)) {
      import('fs').then(fs => fs.mkdirSync(dataDir, { recursive: true }));
    }

    writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Error saving reaction roles:', error);
  }
}

/**
 * Add a reaction role mapping
 * @param {string} messageId - Message ID
 * @param {string} emoji - Emoji (unicode or custom ID)
 * @param {string} roleId - Role ID to assign
 */
export function addReactionRole(messageId, emoji, roleId) {
  const data = loadReactionRoles();

  if (!data.messages[messageId]) {
    data.messages[messageId] = {};
  }

  data.messages[messageId][emoji] = roleId;
  saveReactionRoles(data);
}

/**
 * Remove a reaction role mapping
 * @param {string} messageId - Message ID
 * @param {string} emoji - Emoji to remove
 */
export function removeReactionRole(messageId, emoji) {
  const data = loadReactionRoles();

  if (data.messages[messageId]) {
    delete data.messages[messageId][emoji];

    // Clean up empty message entries
    if (Object.keys(data.messages[messageId]).length === 0) {
      delete data.messages[messageId];
    }
  }

  saveReactionRoles(data);
}

/**
 * Get role ID for a reaction
 * @param {string} messageId - Message ID
 * @param {string} emoji - Emoji identifier
 * @returns {string|null} Role ID or null if not found
 */
export function getRoleForReaction(messageId, emoji) {
  const data = loadReactionRoles();
  return data.messages[messageId]?.[emoji] || null;
}

/**
 * Check if a message has reaction roles
 * @param {string} messageId - Message ID
 * @returns {boolean}
 */
export function hasReactionRoles(messageId) {
  const data = loadReactionRoles();
  return messageId in data.messages;
}

/**
 * Remove all reaction roles for a message
 * @param {string} messageId - Message ID
 */
export function removeMessage(messageId) {
  const data = loadReactionRoles();
  delete data.messages[messageId];
  saveReactionRoles(data);
}

/**
 * Get all reaction roles for a message
 * @param {string} messageId - Message ID
 * @returns {Object} Emoji to role ID mappings
 */
export function getMessageReactionRoles(messageId) {
  const data = loadReactionRoles();
  return data.messages[messageId] || {};
}
