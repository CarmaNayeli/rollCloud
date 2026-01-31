import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

export default {
  data: new SlashCommandBuilder()
    .setName('characters')
    .setDescription('List all your synced characters'),

  async execute(interaction) {
    await interaction.deferReply({ flags: 64 });

    try {
      const characters = await getCharactersByUser(interaction.user.id);

      if (!characters || characters.length === 0) {
        await interaction.editReply({
          embeds: [new EmbedBuilder()
            .setColor(0xF39C12)
            .setTitle('📋 No Characters')
            .setDescription(
              'You don\'t have any characters synced yet.\n\n' +
              '**To sync a character:**\n' +
              '1. Make sure you\'ve run `/rollcloud` with your pairing code\n' +
              '2. Open a DiceCloud character sheet\n' +
              '3. Click "Sync Character" in the RollCloud extension'
            )
          ]
        });
        return;
      }

      const characterList = characters.map((char, index) => {
        const active = char.is_active ? '✅ ' : '';
        const hp = char.hit_points || { current: 0, max: 0 };
        return `${active}**${index + 1}. ${char.character_name}**\n` +
               `   ${char.race || 'Unknown'} ${char.class || 'Unknown'} (Lv ${char.level})\n` +
               `   HP: ${hp.current}/${hp.max} | AC: ${char.armor_class || 10}`;
      }).join('\n\n');

      const activeChar = characters.find(c => c.is_active);

      const embed = new EmbedBuilder()
        .setColor(0x4ECDC4)
        .setTitle(`🎭 ${interaction.user.username}'s Characters`)
        .setDescription(characterList)
        .setFooter({
          text: activeChar
            ? `Active: ${activeChar.character_name}`
            : 'Use /character <name> to set active character'
        });

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      console.error('Characters command error:', error);
      await interaction.editReply({
        content: `❌ Error: ${error.message}`
      });
    }
  }
};

async function getCharactersByUser(discordUserId) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error('Supabase not configured');
  }

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/rollcloud_characters?discord_user_id=eq.${discordUserId}&select=*&order=is_active.desc,updated_at.desc`,
    {
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
      }
    }
  );

  if (!response.ok) {
    throw new Error(`Database error: ${response.status}`);
  }

  return await response.json();
}
