import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

export default {
  data: new SlashCommandBuilder()
    .setName('sheet')
    .setDescription('View your full character sheet')
    .addStringOption(option =>
      option
        .setName('section')
        .setDescription('Which section to view')
        .setRequired(false)
        .addChoices(
          { name: 'Overview', value: 'overview' },
          { name: 'Abilities & Saves', value: 'abilities' },
          { name: 'Skills', value: 'skills' },
          { name: 'Spell Slots', value: 'spells' },
          { name: 'Resources', value: 'resources' }
        )
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: 64 }); // ephemeral

    try {
      const section = interaction.options.getString('section') || 'overview';
      const character = await getActiveCharacter(interaction.user.id);

      if (!character) {
        await interaction.editReply({
          embeds: [new EmbedBuilder()
            .setColor(0xF39C12)
            .setTitle('❌ No Active Character')
            .setDescription(
              'You don\'t have an active character.\n\n' +
              'Use `/character <name>` to set one, or `/characters` to see your list.'
            )
          ]
        });
        return;
      }

      let embed;
      switch (section) {
        case 'abilities':
          embed = buildAbilitiesEmbed(character);
          break;
        case 'skills':
          embed = buildSkillsEmbed(character);
          break;
        case 'spells':
          embed = buildSpellsEmbed(character);
          break;
        case 'resources':
          embed = buildResourcesEmbed(character);
          break;
        default:
          embed = buildOverviewEmbed(character);
      }

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      console.error('Sheet command error:', error);
      await interaction.editReply({
        content: `❌ Error: ${error.message}`
      });
    }
  }
};

const formatMod = (mod) => mod >= 0 ? `+${mod}` : `${mod}`;

function buildOverviewEmbed(char) {
  const hp = char.hit_points || { current: 0, max: 0 };
  const hpPercent = hp.max > 0 ? Math.round((hp.current / hp.max) * 100) : 0;
  const hpBar = '█'.repeat(Math.round(hpPercent / 10)) + '░'.repeat(10 - Math.round(hpPercent / 10));

  const embed = new EmbedBuilder()
    .setColor(0x4ECDC4)
    .setTitle(`📜 ${char.character_name}`)
    .setDescription(
      `**${char.race || 'Unknown'}** ${char.class || 'Unknown'} (Level ${char.level || 1})\n` +
      (char.alignment ? `*${char.alignment}*\n` : '') +
      `\n**Hit Points**\n${hpBar} ${hp.current}/${hp.max}`
    )
    .addFields(
      { name: '🛡️ AC', value: `${char.armor_class || 10}`, inline: true },
      { name: '⚡ Initiative', value: formatMod(char.initiative || 0), inline: true },
      { name: '🏃 Speed', value: `${char.speed || 30} ft`, inline: true },
      { name: '⭐ Proficiency', value: formatMod(char.proficiency_bonus || 2), inline: true }
    );

  // Quick ability overview
  if (char.attributes) {
    const attrs = char.attributes;
    const mods = char.attribute_mods || {};
    embed.addFields({
      name: '📊 Abilities',
      value: `STR ${attrs.strength || 10} (${formatMod(mods.strength || 0)}) | ` +
             `DEX ${attrs.dexterity || 10} (${formatMod(mods.dexterity || 0)}) | ` +
             `CON ${attrs.constitution || 10} (${formatMod(mods.constitution || 0)})\n` +
             `INT ${attrs.intelligence || 10} (${formatMod(mods.intelligence || 0)}) | ` +
             `WIS ${attrs.wisdom || 10} (${formatMod(mods.wisdom || 0)}) | ` +
             `CHA ${attrs.charisma || 10} (${formatMod(mods.charisma || 0)})`,
      inline: false
    });
  }

  embed.setFooter({ text: 'Use /sheet section:<name> for detailed views' });
  return embed;
}

function buildAbilitiesEmbed(char) {
  const attrs = char.attributes || {};
  const mods = char.attribute_mods || {};
  const saves = char.saves || {};

  const abilities = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'];

  const abilityFields = abilities.map(ability => {
    const score = attrs[ability] || 10;
    const mod = mods[ability] || Math.floor((score - 10) / 2);
    const save = saves[ability];
    const saveText = save !== undefined ? ` | Save: ${formatMod(save)}` : '';

    return {
      name: ability.charAt(0).toUpperCase() + ability.slice(1, 3).toUpperCase(),
      value: `**${score}** (${formatMod(mod)})${saveText}`,
      inline: true
    };
  });

  return new EmbedBuilder()
    .setColor(0x3498DB)
    .setTitle(`📊 ${char.character_name} - Abilities & Saves`)
    .addFields(abilityFields)
    .setFooter({ text: `Proficiency Bonus: ${formatMod(char.proficiency_bonus || 2)}` });
}

function buildSkillsEmbed(char) {
  const skills = char.skills || {};
  const mods = char.attribute_mods || {};

  const skillAbilities = {
    acrobatics: 'DEX', animalHandling: 'WIS', arcana: 'INT', athletics: 'STR',
    deception: 'CHA', history: 'INT', insight: 'WIS', intimidation: 'CHA',
    investigation: 'INT', medicine: 'WIS', nature: 'INT', perception: 'WIS',
    performance: 'CHA', persuasion: 'CHA', religion: 'INT', sleightOfHand: 'DEX',
    stealth: 'DEX', survival: 'WIS'
  };

  const skillLines = Object.entries(skillAbilities).map(([skill, ability]) => {
    const mod = skills[skill] !== undefined ? skills[skill] : (mods[ability.toLowerCase()] || 0);
    const displayName = skill.replace(/([A-Z])/g, ' $1').trim();
    return `${formatMod(mod).padStart(3)} ${displayName} *(${ability})*`;
  });

  // Split into two columns
  const half = Math.ceil(skillLines.length / 2);
  const col1 = skillLines.slice(0, half).join('\n');
  const col2 = skillLines.slice(half).join('\n');

  return new EmbedBuilder()
    .setColor(0x9B59B6)
    .setTitle(`📋 ${char.character_name} - Skills`)
    .addFields(
      { name: '\u200B', value: col1, inline: true },
      { name: '\u200B', value: col2, inline: true }
    );
}

function buildSpellsEmbed(char) {
  const slots = char.spell_slots || {};

  const slotEntries = Object.entries(slots)
    .filter(([_, data]) => data && (data.max > 0 || data.current > 0))
    .sort((a, b) => {
      const lvlA = parseInt(a[0].replace(/\D/g, '')) || 0;
      const lvlB = parseInt(b[0].replace(/\D/g, '')) || 0;
      return lvlA - lvlB;
    });

  if (slotEntries.length === 0) {
    return new EmbedBuilder()
      .setColor(0x8E44AD)
      .setTitle(`✨ ${char.character_name} - Spell Slots`)
      .setDescription('No spell slots available.');
  }

  const slotLines = slotEntries.map(([level, data]) => {
    const lvl = level.replace('level', '').replace('SpellSlots', '').replace('SpellSlotsMax', '');
    const current = data.current || 0;
    const max = data.max || 0;
    const filled = '⬛'.repeat(current);
    const empty = '⬜'.repeat(Math.max(0, max - current));
    return `**Level ${lvl}:** ${filled}${empty} (${current}/${max})`;
  });

  return new EmbedBuilder()
    .setColor(0x8E44AD)
    .setTitle(`✨ ${char.character_name} - Spell Slots`)
    .setDescription(slotLines.join('\n'));
}

function buildResourcesEmbed(char) {
  const resources = char.resources || [];

  if (resources.length === 0) {
    return new EmbedBuilder()
      .setColor(0xE67E22)
      .setTitle(`⚡ ${char.character_name} - Resources`)
      .setDescription('No resources tracked.');
  }

  const resourceLines = resources.map(res => {
    const current = res.current || 0;
    const max = res.max || 0;
    return `**${res.name}:** ${current}/${max}`;
  });

  return new EmbedBuilder()
    .setColor(0xE67E22)
    .setTitle(`⚡ ${char.character_name} - Resources`)
    .setDescription(resourceLines.join('\n'));
}

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
