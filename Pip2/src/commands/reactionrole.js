/**
 * Reaction Role Command
 * Set up reaction roles for self-assignable roles
 */

import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import {
  addReactionRole,
  removeReactionRole,
  getMessageReactionRoles,
  removeMessage,
} from '../utils/reactionRoleStorage.js';

export default {
  data: new SlashCommandBuilder()
    .setName('reactionrole')
    .setDescription('Manage reaction roles for self-assignable roles')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addSubcommand(subcommand =>
      subcommand
        .setName('create')
        .setDescription('Create a new reaction role message')
        .addStringOption(option =>
          option
            .setName('title')
            .setDescription('Title for the reaction role embed')
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName('description')
            .setDescription('Description explaining the roles')
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName('color')
            .setDescription('Embed color (hex code, e.g., #5865F2)')
            .setRequired(false)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('add')
        .setDescription('Add a reaction role to an existing message')
        .addStringOption(option =>
          option
            .setName('message_id')
            .setDescription('ID of the message to add reaction to')
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName('emoji')
            .setDescription('Emoji to react with (unicode or custom)')
            .setRequired(true)
        )
        .addRoleOption(option =>
          option
            .setName('role')
            .setDescription('Role to assign when reacted')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('remove')
        .setDescription('Remove a reaction role from a message')
        .addStringOption(option =>
          option
            .setName('message_id')
            .setDescription('ID of the message')
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName('emoji')
            .setDescription('Emoji to remove')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('list')
        .setDescription('List all reaction roles for a message')
        .addStringOption(option =>
          option
            .setName('message_id')
            .setDescription('ID of the message')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('delete')
        .setDescription('Delete all reaction roles from a message')
        .addStringOption(option =>
          option
            .setName('message_id')
            .setDescription('ID of the message')
            .setRequired(true)
        )
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case 'create':
        await handleCreate(interaction);
        break;
      case 'add':
        await handleAdd(interaction);
        break;
      case 'remove':
        await handleRemove(interaction);
        break;
      case 'list':
        await handleList(interaction);
        break;
      case 'delete':
        await handleDelete(interaction);
        break;
    }
  },
};

/**
 * Create a new reaction role message
 */
async function handleCreate(interaction) {
  const title = interaction.options.getString('title');
  const description = interaction.options.getString('description');
  const colorHex = interaction.options.getString('color') || '#5865F2';

  // Validate color
  const color = colorHex.replace('#', '');
  if (!/^[0-9A-Fa-f]{6}$/.test(color)) {
    return interaction.reply({
      content: '❌ Invalid color! Use hex format like #5865F2',
      flags: 64 // ephemeral,
    });
  }

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(parseInt(color, 16))
    .setFooter({ text: 'React with an emoji to get a role!' });

  try {
    const message = await interaction.channel.send({ embeds: [embed] });

    await interaction.reply({
      content: `✅ Reaction role message created!\n\nMessage ID: \`${message.id}\`\n\nUse \`/reactionrole add message_id:${message.id}\` to add roles.`,
      flags: 64 // ephemeral,
    });
  } catch (error) {
    console.error('Error creating reaction role message:', error);
    await interaction.reply({
      content: '❌ Failed to create message. Make sure I have permission to send messages!',
      flags: 64 // ephemeral,
    });
  }
}

/**
 * Add a reaction role to an existing message
 */
async function handleAdd(interaction) {
  const messageId = interaction.options.getString('message_id');
  const emojiInput = interaction.options.getString('emoji');
  const role = interaction.options.getRole('role');

  // Check if bot can manage this role
  const botMember = await interaction.guild.members.fetchMe();
  if (role.position >= botMember.roles.highest.position) {
    return interaction.reply({
      content: `❌ I cannot manage the role ${role.name} because it's higher than or equal to my highest role!`,
      flags: 64 // ephemeral,
    });
  }

  // Check if role is @everyone
  if (role.id === interaction.guild.id) {
    return interaction.reply({
      content: '❌ Cannot assign the @everyone role!',
      flags: 64 // ephemeral,
    });
  }

  try {
    // Fetch the message
    const message = await interaction.channel.messages.fetch(messageId);

    // Parse emoji (handle both unicode and custom emojis)
    let emojiIdentifier = emojiInput.trim();
    const customEmojiMatch = emojiInput.match(/<a?:(\w+):(\d+)>/);
    if (customEmojiMatch) {
      emojiIdentifier = customEmojiMatch[2]; // Use emoji ID for custom emojis
    }

    // Add reaction to the message
    await message.react(emojiInput);

    // Save to storage
    addReactionRole(messageId, emojiIdentifier, role.id);

    await interaction.reply({
      content: `✅ Added reaction role: ${emojiInput} → ${role.name}`,
      flags: 64 // ephemeral,
    });
  } catch (error) {
    console.error('Error adding reaction role:', error);
    if (error.code === 10008) {
      await interaction.reply({
        content: '❌ Message not found! Make sure the message ID is correct and in this channel.',
        flags: 64 // ephemeral,
      });
    } else if (error.code === 10014) {
      await interaction.reply({
        content: '❌ Unknown emoji! Make sure the emoji is from this server or use a standard Unicode emoji.',
        flags: 64 // ephemeral,
      });
    } else {
      await interaction.reply({
        content: '❌ Failed to add reaction role. Check my permissions and try again.',
        flags: 64 // ephemeral,
      });
    }
  }
}

/**
 * Remove a reaction role from a message
 */
async function handleRemove(interaction) {
  const messageId = interaction.options.getString('message_id');
  const emojiInput = interaction.options.getString('emoji');

  // Parse emoji
  let emojiIdentifier = emojiInput.trim();
  const customEmojiMatch = emojiInput.match(/<a?:(\w+):(\d+)>/);
  if (customEmojiMatch) {
    emojiIdentifier = customEmojiMatch[2];
  }

  try {
    // Remove from storage
    removeReactionRole(messageId, emojiIdentifier);

    // Try to remove the reaction from the message
    const message = await interaction.channel.messages.fetch(messageId);
    const reaction = message.reactions.cache.find(r => {
      if (r.emoji.id) {
        return r.emoji.id === emojiIdentifier;
      }
      return r.emoji.name === emojiIdentifier;
    });

    if (reaction) {
      await reaction.remove();
    }

    await interaction.reply({
      content: `✅ Removed reaction role: ${emojiInput}`,
      flags: 64 // ephemeral,
    });
  } catch (error) {
    console.error('Error removing reaction role:', error);
    await interaction.reply({
      content: '❌ Failed to remove reaction role. It has been removed from storage, but the reaction may still be on the message.',
      flags: 64 // ephemeral,
    });
  }
}

/**
 * List all reaction roles for a message
 */
async function handleList(interaction) {
  const messageId = interaction.options.getString('message_id');

  try {
    const reactionRoles = getMessageReactionRoles(messageId);

    if (Object.keys(reactionRoles).length === 0) {
      return interaction.reply({
        content: '❌ No reaction roles found for this message.',
        flags: 64 // ephemeral,
      });
    }

    const message = await interaction.channel.messages.fetch(messageId);
    const embed = new EmbedBuilder()
      .setTitle('📋 Reaction Roles')
      .setDescription(`Message: [Jump to message](${message.url})`)
      .setColor(0x5865F2);

    let description = '';
    for (const [emoji, roleId] of Object.entries(reactionRoles)) {
      const role = await interaction.guild.roles.fetch(roleId);
      const emojiDisplay = emoji.match(/^\d+$/)
        ? `<:custom:${emoji}>`
        : emoji;
      description += `${emojiDisplay} → ${role ? role.name : `Unknown Role (${roleId})`}\n`;
    }

    embed.addFields({ name: 'Configured Roles', value: description });

    await interaction.reply({
      embeds: [embed],
      flags: 64 // ephemeral,
    });
  } catch (error) {
    console.error('Error listing reaction roles:', error);
    await interaction.reply({
      content: '❌ Failed to list reaction roles.',
      flags: 64 // ephemeral,
    });
  }
}

/**
 * Delete all reaction roles from a message
 */
async function handleDelete(interaction) {
  const messageId = interaction.options.getString('message_id');

  try {
    const reactionRoles = getMessageReactionRoles(messageId);

    if (Object.keys(reactionRoles).length === 0) {
      return interaction.reply({
        content: '❌ No reaction roles found for this message.',
        flags: 64 // ephemeral,
      });
    }

    removeMessage(messageId);

    await interaction.reply({
      content: `✅ Deleted all reaction roles for message \`${messageId}\``,
      flags: 64 // ephemeral,
    });
  } catch (error) {
    console.error('Error deleting reaction roles:', error);
    await interaction.reply({
      content: '❌ Failed to delete reaction roles.',
      flags: 64 // ephemeral,
    });
  }
}
