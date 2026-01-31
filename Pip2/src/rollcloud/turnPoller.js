/**
 * RollCloud Turn Poller
 * Polls Supabase for pending turns and posts them to Discord with buttons
 */

import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const POLL_INTERVAL_MS = 1500; // Poll every 1.5 seconds

let pollInterval = null;
let client = null;

/**
 * Start the turn poller
 */
export function startTurnPoller(discordClient) {
  client = discordClient;

  if (pollInterval) {
    console.log('Turn poller already running');
    return;
  }

  console.log('🎲 Starting RollCloud turn poller...');
  pollInterval = setInterval(pollForTurns, POLL_INTERVAL_MS);

  // Poll immediately
  pollForTurns();
}

/**
 * Stop the turn poller
 */
export function stopTurnPoller() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
    console.log('🎲 Stopped RollCloud turn poller');
  }
}

/**
 * Poll for pending turns
 */
async function pollForTurns() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return;
  }

  try {
    // Get pending turns with their pairing info
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/rollcloud_turns?status=eq.pending&order=created_at.asc&limit=10&select=*,rollcloud_pairings(*)`,
      {
        headers: {
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
        }
      }
    );

    if (!response.ok) {
      console.error('Failed to poll turns:', response.status);
      return;
    }

    const turns = await response.json();

    for (const turn of turns) {
      await postTurnToDiscord(turn);
    }
  } catch (error) {
    console.error('Turn poll error:', error);
  }
}

/**
 * Post a turn to Discord with buttons
 */
async function postTurnToDiscord(turn) {
  const pairing = turn.rollcloud_pairings;

  if (!pairing || !pairing.discord_channel_id) {
    console.error('No pairing found for turn:', turn.id);
    await markTurnPosted(turn.id, null, 'No pairing found');
    return;
  }

  try {
    // Get the channel
    const channel = await client.channels.fetch(pairing.discord_channel_id);

    if (!channel) {
      console.error('Channel not found:', pairing.discord_channel_id);
      await markTurnPosted(turn.id, null, 'Channel not found');
      return;
    }

    // Build the embed and buttons
    const { embed, components } = buildTurnMessage(turn);

    // Send the message
    const message = await channel.send({
      embeds: [embed],
      components: components
    });

    // Mark turn as posted
    await markTurnPosted(turn.id, message.id);

    console.log(`✅ Posted turn for ${turn.character_name} to #${channel.name}`);
  } catch (error) {
    console.error('Error posting turn:', error);
    await markTurnPosted(turn.id, null, error.message);
  }
}

/**
 * Build Discord embed and button components for a turn
 */
function buildTurnMessage(turn) {
  const {
    event_type,
    character_name,
    round_number,
    initiative,
    action_available,
    bonus_available,
    movement_available,
    reaction_available,
    available_actions
  } = turn;

  // Action economy icons
  const getIcon = (available) => available ? '✅' : '❌';

  if (event_type === 'turn_start') {
    const embed = new EmbedBuilder()
      .setTitle(`🎲 ${character_name}'s Turn!`)
      .setColor(0x4ECDC4)
      .setDescription(
        `**Action Economy:**\n` +
        `Action: ${getIcon(action_available)} | ` +
        `Bonus: ${getIcon(bonus_available)} | ` +
        `Move: ${getIcon(movement_available)} | ` +
        `Reaction: ${getIcon(reaction_available)}`
      )
      .setTimestamp();

    if (round_number) {
      embed.addFields({ name: 'Round', value: String(round_number), inline: true });
    }
    if (initiative) {
      embed.addFields({ name: 'Initiative', value: String(initiative), inline: true });
    }

    // Build action buttons (max 5 per row, max 5 rows)
    const components = buildActionButtons(available_actions, character_name);

    return { embed, components };
  }

  if (event_type === 'turn_end') {
    const embed = new EmbedBuilder()
      .setTitle(`⏸️ ${character_name}'s Turn Ended`)
      .setColor(0x95A5A6)
      .setTimestamp();

    return { embed, components: [] };
  }

  if (event_type === 'round_change') {
    const embed = new EmbedBuilder()
      .setTitle(`🔄 Round ${round_number}`)
      .setColor(0x9B59B6)
      .setDescription(character_name ? `Current turn: **${character_name}**` : 'New round begins!')
      .setTimestamp();

    return { embed, components: [] };
  }

  if (event_type === 'combat_start') {
    const embed = new EmbedBuilder()
      .setTitle('⚔️ Combat Started!')
      .setColor(0xE74C3C)
      .setDescription(character_name ? `First up: **${character_name}**` : 'Roll for initiative!')
      .setTimestamp();

    return { embed, components: [] };
  }

  // Default
  const embed = new EmbedBuilder()
    .setTitle(`🎲 ${character_name || 'Combat Update'}`)
    .setColor(0x4ECDC4)
    .setDescription(event_type)
    .setTimestamp();

  return { embed, components: [] };
}

/**
 * Build action buttons from available actions
 */
function buildActionButtons(availableActions, characterName) {
  if (!availableActions || availableActions.length === 0) {
    // Default buttons if no actions provided
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`rollcloud:end_turn:${characterName}`)
          .setLabel('End Turn')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('⏭️')
      )
    ];
  }

  const rows = [];
  let currentRow = new ActionRowBuilder();
  let buttonCount = 0;

  // Add attack/action buttons
  const attacks = availableActions.filter(a => a.type === 'action' && !a.builtin);
  for (const attack of attacks.slice(0, 3)) {
    const rollString = attack.roll || '1d20';
    currentRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`rollcloud:roll:${attack.name}:${rollString}`)
        .setLabel(attack.name)
        .setStyle(ButtonStyle.Primary)
        .setEmoji('⚔️')
    );
    buttonCount++;

    if (buttonCount === 5) {
      rows.push(currentRow);
      currentRow = new ActionRowBuilder();
      buttonCount = 0;
    }
  }

  // Add spell buttons (first 2 non-cantrips)
  const spells = availableActions.filter(a => a.type === 'spell');
  for (const spell of spells.slice(0, 2)) {
    currentRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`rollcloud:use_ability:${spell.name}:spell:${spell.level}`)
        .setLabel(spell.name)
        .setStyle(ButtonStyle.Success)
        .setEmoji('🔮')
    );
    buttonCount++;

    if (buttonCount === 5) {
      rows.push(currentRow);
      currentRow = new ActionRowBuilder();
      buttonCount = 0;
    }
  }

  // Push current row if it has buttons
  if (buttonCount > 0) {
    rows.push(currentRow);
  }

  // Add end turn button in its own row
  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`rollcloud:end_turn:${characterName}`)
        .setLabel('End Turn')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('⏭️')
    )
  );

  // Discord allows max 5 rows
  return rows.slice(0, 5);
}

/**
 * Mark a turn as posted in Supabase
 */
async function markTurnPosted(turnId, messageId, error = null) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return;

  try {
    const update = {
      status: error ? 'failed' : 'posted',
      posted_at: new Date().toISOString()
    };

    if (messageId) {
      update.discord_message_id = messageId;
    }

    await fetch(
      `${SUPABASE_URL}/rest/v1/rollcloud_turns?id=eq.${turnId}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
        },
        body: JSON.stringify(update)
      }
    );
  } catch (err) {
    console.error('Error marking turn posted:', err);
  }
}

export default { startTurnPoller, stopTurnPoller };
