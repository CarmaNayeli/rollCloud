/**
 * Message Reaction Add Event
 * Handles adding roles when users react to messages
 */

import { Events } from 'discord.js';
import { getRoleForReaction } from '../utils/reactionRoleStorage.js';

export default {
  name: Events.MessageReactionAdd,
  once: false,

  async execute(reaction, user) {
    // Ignore bot reactions
    if (user.bot) return;

    // Handle partial reactions (reactions on uncached messages)
    if (reaction.partial) {
      try {
        await reaction.fetch();
      } catch (error) {
        console.error('Error fetching reaction:', error);
        return;
      }
    }

    // Get emoji identifier
    const emojiIdentifier = reaction.emoji.id || reaction.emoji.name;

    // Check if this message has reaction roles configured
    const roleId = getRoleForReaction(reaction.message.id, emojiIdentifier);

    if (!roleId) return;

    try {
      // Get the member
      const member = await reaction.message.guild.members.fetch(user.id);

      // Get the role
      const role = await reaction.message.guild.roles.fetch(roleId);

      if (!role) {
        console.error(`Role ${roleId} not found for reaction role`);
        return;
      }

      // Check if member already has the role
      if (member.roles.cache.has(roleId)) {
        return;
      }

      // Add the role
      await member.roles.add(role);

      console.log(`✅ Added role ${role.name} to ${user.tag} via reaction role`);

      // Try to DM the user (optional, can fail if DMs are closed)
      try {
        await user.send(`✅ You have been given the **${role.name}** role in **${reaction.message.guild.name}**!`);
      } catch (error) {
        // Silently fail if user has DMs disabled
      }
    } catch (error) {
      console.error('Error adding role via reaction:', error);

      // Try to notify user about the error
      try {
        await user.send(`❌ Failed to assign the role in **${reaction.message.guild.name}**. Please contact a moderator.`);
      } catch {
        // Silently fail
      }
    }
  },
};
