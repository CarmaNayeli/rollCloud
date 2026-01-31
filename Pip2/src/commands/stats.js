import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

export default {
  data: new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Quick stat lookup for your active character')
    .addStringOption(option =>
      option
        .setName('stat')
        .setDescription('The stat to look up')
        .setRequired(true)
        .addChoices(
          { name: 'HP', value: 'hp' },
          { name: 'AC', value: 'ac' },
          { name: 'Initiative', value: 'initiative' },
          { name: 'Strength', value: 'strength' },
          { name: 'Dexterity', value: 'dexterity' },
          { name: 'Constitution', value: 'constitution' },
          { name: 'Intelligence', value: 'intelligence' },
          { name: 'Wisdom', value: 'wisdom' },
          { name: 'Charisma', value: 'charisma' },
          { name: 'Perception', value: 'perception' },
          { name: 'Stealth', value: 'stealth' },
          { name: 'Athletics', value: 'athletics' },
          { name: 'Spell Slots', value: 'spellslots' }
        )
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: 64 }); // ephemeral

    try {
      const stat = interaction.options.getString('stat');
      const character = await getActiveCharacter(interaction.user.id);

      if (!character) {
        await interaction.editReply({
          content: '❌ No active character. Use `/character <name>` to set one.'
        });
        return;
      }

      const formatMod = (mod) => mod >= 0 ? `+${mod}` : `${mod}`;
      const name = character.character_name;
      let embed;

      switch (stat) {
        case 'hp': {
          const hp = character.hit_points || { current: 0, max: 0 };
          const percent = hp.max > 0 ? Math.round((hp.current / hp.max) * 100) : 0;
          const bar = '█'.repeat(Math.round(percent / 10)) + '░'.repeat(10 - Math.round(percent / 10));
          embed = new EmbedBuilder()
            .setColor(percent > 50 ? 0x2ECC71 : percent > 25 ? 0xF39C12 : 0xE74C3C)
            .setTitle(`❤️ ${name}'s HP`)
            .setDescription(`${bar}\n**${hp.current} / ${hp.max}** (${percent}%)`);
          break;
        }

        case 'ac':
          embed = new EmbedBuilder()
            .setColor(0x3498DB)
            .setTitle(`🛡️ ${name}'s AC`)
            .setDescription(`**${character.armor_class || 10}**`);
          break;

        case 'initiative':
          embed = new EmbedBuilder()
            .setColor(0xF39C12)
            .setTitle(`⚡ ${name}'s Initiative`)
            .setDescription(`**${formatMod(character.initiative || 0)}**`);
          break;

        case 'spellslots': {
          const slots = character.spell_slots || {};
          const slotLines = Object.entries(slots)
            .filter(([_, data]) => data && data.max > 0)
            .map(([level, data]) => {
              const lvl = level.replace(/\D/g, '');
              const filled = '⬛'.repeat(data.current || 0);
              const empty = '⬜'.repeat(Math.max(0, (data.max || 0) - (data.current || 0)));
              return `**Lv ${lvl}:** ${filled}${empty} (${data.current}/${data.max})`;
            })
            .join('\n');

          embed = new EmbedBuilder()
            .setColor(0x8E44AD)
            .setTitle(`✨ ${name}'s Spell Slots`)
            .setDescription(slotLines || 'No spell slots');
          break;
        }

        default: {
          // Ability score or skill
          const abilities = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'];
          const skills = ['perception', 'stealth', 'athletics'];

          if (abilities.includes(stat)) {
            const score = character.attributes?.[stat] || 10;
            const mod = character.attribute_mods?.[stat] || Math.floor((score - 10) / 2);
            const save = character.saves?.[stat];

            embed = new EmbedBuilder()
              .setColor(0x4ECDC4)
              .setTitle(`📊 ${name}'s ${stat.charAt(0).toUpperCase() + stat.slice(1)}`)
              .addFields(
                { name: 'Score', value: `**${score}**`, inline: true },
                { name: 'Modifier', value: `**${formatMod(mod)}**`, inline: true }
              );

            if (save !== undefined) {
              embed.addFields({ name: 'Save', value: `**${formatMod(save)}**`, inline: true });
            }
          } else if (skills.includes(stat)) {
            const skillMod = character.skills?.[stat] || 0;
            embed = new EmbedBuilder()
              .setColor(0x9B59B6)
              .setTitle(`📋 ${name}'s ${stat.charAt(0).toUpperCase() + stat.slice(1)}`)
              .setDescription(`**${formatMod(skillMod)}**`);
          }
          break;
        }
      }

      if (embed) {
        embed.setFooter({ text: `${character.class || 'Unknown'} Lv ${character.level}` });
        await interaction.editReply({ embeds: [embed] });
      } else {
        await interaction.editReply({ content: `❌ Unknown stat: ${stat}` });
      }

    } catch (error) {
      console.error('Stats command error:', error);
      await interaction.editReply({ content: `❌ Error: ${error.message}` });
    }
  }
};

async function getActiveCharacter(discordUserId) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error('Supabase not configured');
  }

  let response = await fetch(
    `${SUPABASE_URL}/rest/v1/rollcloud_characters?discord_user_id=eq.${discordUserId}&is_active=eq.true&select=*&limit=1`,
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

  let data = await response.json();

  if (data.length === 0) {
    response = await fetch(
      `${SUPABASE_URL}/rest/v1/rollcloud_characters?discord_user_id=eq.${discordUserId}&select=*&order=updated_at.desc&limit=1`,
      {
        headers: {
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
        }
      }
    );

    if (response.ok) {
      data = await response.json();
    }
  }

  return data.length > 0 ? data[0] : null;
}
