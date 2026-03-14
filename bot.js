require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder,
} = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
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
  SUPPORT_PING_ROLE_ID,
  DISCORD_SUPPORT_ROLE_ID,
} = process.env;

const EFFECTIVE_SUPPORT_ROLE_ID = SUPPORT_PING_ROLE_ID || DISCORD_SUPPORT_ROLE_ID || "";

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
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts = [];
  if (days) parts.push(`${days} Tag(e)`);
  if (hours) parts.push(`${hours} Std.`);
  if (minutes || !parts.length) parts.push(`${minutes} Min.`);
  return parts.join(' ');
}

async function getTicketLogChannel() {
  if (!TICKET_LOG_CHANNEL_ID) return null;
  const channel = await client.channels.fetch(TICKET_LOG_CHANNEL_ID).catch(() => null);
  return channel && channel.isTextBased() ? channel : null;
}

async function logTicketEvent(content, extra = {}) {
  const channel = await getTicketLogChannel();
  if (!channel) return;
  await channel.send({
    content,
    files: extra.files || [],
    allowedMentions: { parse: [] },
  }).catch(console.error);
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

async function buildTranscript(channel) {
  const pages = [];
  let lastId;

  for (let i = 0; i < 5; i += 1) {
    const batch = await channel.messages.fetch({ limit: 100, before: lastId }).catch(() => null);
    if (!batch || !batch.size) break;
    pages.push(...Array.from(batch.values()));
    lastId = batch.last()?.id;
    if (batch.size < 100) break;
  }

  const messages = pages
    .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
    .map((msg) => {
      const createdAt = new Date(msg.createdTimestamp).toLocaleString('de-DE');
      const attachments = msg.attachments.size
        ? ` | Anhänge: ${Array.from(msg.attachments.values()).map((a) => a.url).join(', ')}`
        : '';
      const content = (msg.content || '')
        .replace(/\r/g, '')
        .trim();
      const cleanContent = content || '[keine Textnachricht]';
      return `[${createdAt}] ${msg.author?.tag || 'Unbekannt'}: ${cleanContent}${attachments}`;
    });

  const header = [
    `Ticket-Transcript: #${channel.name}`,
    `Erstellt: ${new Date().toLocaleString('de-DE')}`,
    '',
  ];

  return Buffer.from([...header, ...messages].join('\n'), 'utf8');
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

    if (EFFECTIVE_SUPPORT_ROLE_ID) {
      overwrites.push({
        id: EFFECTIVE_SUPPORT_ROLE_ID,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
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

      const supportPing = EFFECTIVE_SUPPORT_ROLE_ID ? `<@&${EFFECTIVE_SUPPORT_ROLE_ID}> ` : '';
      await ticketChannel.send({
        content: `${supportPing}🎫 Hallo ${interaction.user}, ein Teammitglied meldet sich hier.\nDrücke unten auf **Ticket schließen**, wenn alles erledigt ist.`,
        components: [closeTicketRow()],
        allowedMentions: { roles: EFFECTIVE_SUPPORT_ROLE_ID ? [EFFECTIVE_SUPPORT_ROLE_ID] : [] },
      });

      await logTicketEvent(
        `🟢 Ticket erstellt\n**User:** ${interaction.user.tag}\n**Channel:** ${ticketChannel}\n**Zeit:** <t:${Math.floor(createdAt / 1000)}:F>\n**Support-Ping:** ${EFFECTIVE_SUPPORT_ROLE_ID ? `<@&${EFFECTIVE_SUPPORT_ROLE_ID}>` : 'nicht gesetzt'}`
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
    const isOwner = interaction.user.id === ticketInfo.ownerId;

    if (!isOwner && !isAdmin) {
      return interaction.reply({
        content: '❌ Du darfst dieses Ticket nicht schließen.',
        ephemeral: true,
      });
    }

    await interaction.reply({
      content: '🗑️ Ticket wird geschlossen und archiviert...',
      ephemeral: true,
    });

    const openedAt = ticketInfo.createdAt ? new Date(ticketInfo.createdAt) : null;
    const duration = openedAt ? formatDuration(Date.now() - openedAt.getTime()) : 'unbekannt';
    const ownerMention = ticketInfo.ownerId ? `<@${ticketInfo.ownerId}>` : 'Unbekannt';
    const transcriptBuffer = await buildTranscript(interaction.channel).catch(() => null);

    const files = transcriptBuffer
      ? [
          new AttachmentBuilder(transcriptBuffer, {
            name: `${interaction.channel.name}-transcript.txt`,
          }),
        ]
      : [];

    await logTicketEvent(
      `🔴 Ticket geschlossen\n**User:** ${ownerMention}\n**Channel:** #${interaction.channel.name}\n**Geschlossen von:** ${interaction.user.tag}\n**Dauer:** ${duration}`,
      { files }
    );

    setTimeout(async () => {
      await interaction.channel.delete().catch(console.error);
    }, 1500);
  }
});

client.login(DISCORD_BOT_TOKEN);
