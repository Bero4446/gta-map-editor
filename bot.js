require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
  ],
});

const {
  DISCORD_BOT_TOKEN,
  DISCORD_GUILD_ID,
  VERIFIED_ROLE_ID,
  VERIFY_CHANNEL_ID,
  SUPPORT_CHANNEL_ID,
  WELCOME_CHANNEL_ID,
  ADMIN_ROLE_ID,
  SUPPORT_CATEGORY_ID,
  TICKET_LOG_CHANNEL_ID,
} = process.env;

function verifyRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('verify_btn')
      .setLabel('Verify')
      .setStyle(ButtonStyle.Success)
  );
}

function ticketRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket_open_btn')
      .setLabel('Ticket erstellen')
      .setStyle(ButtonStyle.Primary)
  );
}

function closeTicketRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket_close_btn')
      .setLabel('Ticket schließen')
      .setStyle(ButtonStyle.Danger)
  );
}

function messageHasButton(message, buttonCustomId) {
  return message.components?.some((actionRow) =>
    actionRow.components?.some((component) => component.customId === buttonCustomId)
  );
}

function parseTicketTopic(topic) {
  if (!topic || !String(topic).startsWith('ticket:')) {
    return { ownerId: '', createdAt: null };
  }

  const parts = String(topic).split(':');
  return {
    ownerId: parts[1] || '',
    createdAt: parts[2] ? Number(parts[2]) : null,
  };
}

function formatDuration(ms) {
  if (!ms || ms < 1000) return 'unter 1 Minute';
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (!hours) return `${minutes} Minute(n)`;
  return `${hours} Std. ${minutes} Min.`;
}

async function logTicketEvent(content) {
  if (!TICKET_LOG_CHANNEL_ID) return;
  const channel = await client.channels.fetch(TICKET_LOG_CHANNEL_ID).catch(() => null);
  if (!channel || !channel.isTextBased()) return;
  await channel.send({ content }).catch(console.error);
}

async function ensureSetupMessage(channelId, buttonCustomId, content, row) {
  if (!channelId) return;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return;

  const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  const existing = messages?.find(
    (msg) => msg.author.id === client.user.id && messageHasButton(msg, buttonCustomId)
  );

  const payload = {
    content,
    components: [row],
    allowedMentions: { parse: ['everyone'] },
  };

  if (existing) {
    if (existing.content !== content) {
      await existing.edit(payload).catch(console.error);
    }
    return;
  }

  await channel.send(payload).catch(console.error);
}

client.once('ready', async () => {
  console.log(`✅ Bot online: ${client.user.tag}`);

  if (DISCORD_GUILD_ID) {
    const guild = await client.guilds.fetch(DISCORD_GUILD_ID).catch(() => null);
    if (!guild) {
      console.log('❌ Guild nicht gefunden. Prüfe DISCORD_GUILD_ID.');
    }
  }

  await ensureSetupMessage(
    VERIFY_CHANNEL_ID,
    'verify_btn',
    '@everyone\nKlicke auf den Button, um dich zu verifizieren.',
    verifyRow()
  );

  await ensureSetupMessage(
    SUPPORT_CHANNEL_ID,
    'ticket_open_btn',
    '@everyone\nBrauchst du Hilfe? Klicke auf den Button und der Bot erstellt ein Ticket.',
    ticketRow()
  );
});

client.on('guildMemberAdd', async (member) => {
  if (!WELCOME_CHANNEL_ID) return;

  const channel = await member.guild.channels.fetch(WELCOME_CHANNEL_ID).catch(() => null);
  if (!channel || !channel.isTextBased()) return;

  await channel.send(
    `👋 Willkommen ${member} auf dem Server!\nBitte gehe in <#${VERIFY_CHANNEL_ID}> und klicke auf **Verify**.`
  ).catch(console.error);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;

  if (interaction.customId === 'verify_btn') {
    const role = interaction.guild.roles.cache.get(VERIFIED_ROLE_ID);

    if (!role) {
      return interaction.reply({
        content: '❌ Verified-Rolle nicht gefunden.',
        ephemeral: true,
      });
    }

    if (interaction.member.roles.cache.has(VERIFIED_ROLE_ID)) {
      return interaction.reply({
        content: '✅ Du bist bereits verifiziert.',
        ephemeral: true,
      });
    }

    try {
      await interaction.member.roles.add(role);
      return interaction.reply({
        content: '✅ Du wurdest erfolgreich verifiziert.',
        ephemeral: true,
      });
    } catch (error) {
      console.error(error);
      return interaction.reply({
        content: '❌ Rolle konnte nicht vergeben werden. Prüfe die Rollen-Reihenfolge.',
        ephemeral: true,
      });
    }
  }

  if (interaction.customId === 'ticket_open_btn') {
    const existing = interaction.guild.channels.cache.find(
      (channel) =>
        channel.type === ChannelType.GuildText &&
        String(channel.topic || '').startsWith(`ticket:${interaction.user.id}`)
    );

    if (existing) {
      return interaction.reply({
        content: `🎫 Du hast bereits ein offenes Ticket: ${existing}`,
        ephemeral: true,
      });
    }

    const safeName =
      interaction.user.username
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '')
        .slice(0, 20) || 'user';

    const createdAt = Date.now();
    const overwrites = [
      {
        id: interaction.guild.roles.everyone.id,
        deny: [PermissionsBitField.Flags.ViewChannel],
      },
      {
        id: interaction.user.id,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
          PermissionsBitField.Flags.AttachFiles,
        ],
      },
      {
        id: client.user.id,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
          PermissionsBitField.Flags.ManageChannels,
        ],
      },
    ];

    if (ADMIN_ROLE_ID) {
      overwrites.push({
        id: ADMIN_ROLE_ID,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
          PermissionsBitField.Flags.ManageChannels,
        ],
      });
    }

    try {
      const ticketChannel = await interaction.guild.channels.create({
        name: `ticket-${safeName}`,
        type: ChannelType.GuildText,
        topic: `ticket:${interaction.user.id}:${createdAt}`,
        parent: SUPPORT_CATEGORY_ID || undefined,
        permissionOverwrites: overwrites,
      });

      await ticketChannel.send({
        content: `🎫 Hallo ${interaction.user}, ein Admin meldet sich hier.\nDrücke unten auf **Ticket schließen**, wenn alles erledigt ist.`,
        components: [closeTicketRow()],
      });

      await logTicketEvent(
        `🟢 Ticket erstellt\n**User:** ${interaction.user.tag}\n**Channel:** ${ticketChannel}\n**Zeit:** <t:${Math.floor(createdAt / 1000)}:F>`
      );

      return interaction.reply({
        content: `✅ Ticket erstellt: ${ticketChannel}`,
        ephemeral: true,
      });
    } catch (error) {
      console.error(error);
      return interaction.reply({
        content: '❌ Ticket konnte nicht erstellt werden.',
        ephemeral: true,
      });
    }
  }

  if (interaction.customId === 'ticket_close_btn') {
    const ticketInfo = parseTicketTopic(interaction.channel.topic);
    const isAdmin = ADMIN_ROLE_ID
      ? interaction.member.roles.cache.has(ADMIN_ROLE_ID)
      : false;

    if (interaction.user.id !== ticketInfo.ownerId && !isAdmin) {
      return interaction.reply({
        content: '❌ Du darfst dieses Ticket nicht schließen.',
        ephemeral: true,
      });
    }

    await interaction.reply({
      content: '🗑️ Ticket wird geschlossen...',
      ephemeral: true,
    });

    const openedAt = ticketInfo.createdAt ? new Date(ticketInfo.createdAt) : null;
    const duration = openedAt ? formatDuration(Date.now() - openedAt.getTime()) : 'unbekannt';
    const ownerMention = ticketInfo.ownerId ? `<@${ticketInfo.ownerId}>` : 'Unbekannt';

    await logTicketEvent(
      `🔴 Ticket geschlossen\n**User:** ${ownerMention}\n**Channel:** #${interaction.channel.name}\n**Geschlossen von:** ${interaction.user.tag}\n**Dauer:** ${duration}`
    );

    setTimeout(async () => {
      await interaction.channel.delete().catch(console.error);
    }, 1500);
  }
});

client.login(DISCORD_BOT_TOKEN);
