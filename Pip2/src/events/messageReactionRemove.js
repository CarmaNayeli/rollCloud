/**
 * Message Reaction Remove Event
 * Handles removing roles when users unreact to messages
 */

import { Events } from 'discord.js';
import { getRoleForReaction } from '../utils/reactionRoleStorage.js';

export default {
  name: Events.MessageReactionRemove,
  once: false,

  async execute(reaction, user) {
    // Ignore bot reactions
    if (user.bot) return;

    // Handle partial reactions
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

      // Check if member has the role
      if (!member.roles.cache.has(roleId)) {
        return;
      }

      // Remove the role
      await member.roles.remove(role);

      console.log(`✅ Removed role ${role.name} from ${user.tag} via reaction role`);

      // Try to DM the user (optional)
      try {
        await user.send(`📤 The **${role.name}** role has been removed from you in **${reaction.message.guild.name}**.`);
      } catch (error) {
        // Silently fail if user has DMs disabled
      }
    } catch (error) {
      console.error('Error removing role via reaction:', error);
    }
  },
};
