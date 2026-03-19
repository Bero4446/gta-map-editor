require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  SlashCommandBuilder,
} = require("discord.js");

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const {
  DISCORD_BOT_TOKEN,
  DISCORD_GUILD_ID,
  VERIFIED_ROLE_ID,
  VERIFY_CHANNEL_ID,
  SUPPORT_CHANNEL_ID,
  ADMIN_ROLE_ID,
  SUPPORT_CATEGORY_ID,
  TICKET_LOG_CHANNEL_ID,
  SUPPORT_PING_ROLE_ID,
  DISCORD_SUPPORT_ROLE_ID,
  DEVLOG_CHANNEL_ID,
  MAP_UPDATES_CHANNEL_ID,
  GITHUB_REPO_NAME,
} = process.env;

const DEFAULT_REPO_NAME = GITHUB_REPO_NAME || "LSV-Map";
const DEFAULT_DEVLOG_CHANNEL_ID = DEVLOG_CHANNEL_ID || "1484175224395010220";
const DEFAULT_MAP_UPDATES_CHANNEL_ID = MAP_UPDATES_CHANNEL_ID || "";

let startupFinished = false;

function verifyRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("verify_btn")
      .setLabel("Verify")
      .setStyle(ButtonStyle.Success)
  );
}

function ticketRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("ticket_open_btn")
      .setLabel("Ticket erstellen")
      .setStyle(ButtonStyle.Primary)
  );
}

function closeTicketRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("ticket_close_btn")
      .setLabel("Ticket schließen")
      .setStyle(ButtonStyle.Danger)
  );
}

function getSupportPingRoleId() {
  return SUPPORT_PING_ROLE_ID || DISCORD_SUPPORT_ROLE_ID || "";
}

function messageHasButton(message, buttonCustomId) {
  return message.components?.some((actionRow) =>
    actionRow.components?.some((component) => component.customId === buttonCustomId)
  );
}

function truncate(text, max = 1024) {
  const value = String(text || "").trim();
  if (!value) return "";
  if (value.length <= max) return value;
  return `${value.slice(0, max - 3)}...`;
}

function normalizeLines(value) {
  if (!value) return [];
  return String(value)
    .split(/\r?\n|;/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function toBulletText(items, fallback = "Keine Angaben") {
  const lines = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!lines.length) return fallback;
  return lines.map((item) => `• ${item}`).join("\n");
}

function getDeployStatusLabel(status) {
  const value = String(status || "").trim().toLowerCase();
  if (!value) return "Unbekannt";
  if (["success", "ok", "done", "live", "erfolgreich"].includes(value)) return "Erfolgreich";
  if (["failed", "error", "fehler"].includes(value)) return "Fehlgeschlagen";
  if (["pending", "running", "building"].includes(value)) return "Läuft";
  return status;
}

async function fetchTextChannel(channelId) {
  if (!channelId) return null;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return null;
  return channel;
}

async function ensureSetupMessage(channelId, buttonCustomId, content, row) {
  const channel = await fetchTextChannel(channelId);
  if (!channel) return;

  const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  const existing = messages?.find(
    (msg) => msg.author.id === client.user.id && messageHasButton(msg, buttonCustomId)
  );

  const payload = {
    content,
    components: [row],
    allowedMentions: { parse: ["everyone"] },
  };

  if (existing) {
    await existing.edit(payload).catch(() => null);
    return;
  }

  await channel.send(payload).catch(console.error);
}

async function sendTicketLog(content) {
  const channel = await fetchTextChannel(TICKET_LOG_CHANNEL_ID);
  if (!channel) return;
  await channel.send({ content }).catch(console.error);
}

function buildDevlogEmbed(data = {}) {
  const title = truncate(
    data.title || "LSV-Map System-Update live",
    256
  );

  const description = truncate(
    data.description ||
      "Es wurde ein neues Update für das Projekt veröffentlicht.",
    4096
  );

  const area = truncate(data.area || "Website", 1024);
  const branch = truncate(data.branch || "main", 1024);
  const author = truncate(data.author || "Unbekannt", 1024);
  const commit = truncate(data.commit || "Kein Commit angegeben", 1024);
  const commitId = truncate(data.commitId || "-", 1024);
  const repoName = truncate(data.repoName || DEFAULT_REPO_NAME, 1024);
  const deployStatus = truncate(getDeployStatusLabel(data.deployStatus || "Erfolgreich"), 1024);

  const features = normalizeLines(data.features);
  const extra = normalizeLines(data.extra);

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(title)
    .setDescription(description)
    .addFields(
      { name: "Bereich", value: area, inline: true },
      { name: "Branch", value: branch, inline: true },
      { name: "Autor", value: author, inline: true },
      { name: "Repository", value: repoName, inline: true },
      { name: "Commit", value: commit, inline: true },
      { name: "ID", value: commitId, inline: true },
      { name: "Neue Features", value: truncate(toBulletText(features), 1024), inline: false },
      { name: "Deploy-Status", value: deployStatus, inline: true }
    )
    .setFooter({
      text: data.footer || "LSV-Map Devlog",
    })
    .setTimestamp(new Date());

  if (extra.length) {
    embed.addFields({
      name: "Zusätzliche Infos",
      value: truncate(toBulletText(extra), 1024),
      inline: false,
    });
  }

  if (data.imageUrl) {
    embed.setImage(data.imageUrl);
  }

  if (data.thumbnailUrl) {
    embed.setThumbnail(data.thumbnailUrl);
  }

  if (data.url) {
    embed.setURL(data.url);
  }

  return embed;
}

function buildMapUpdatesEmbed(data = {}) {
  const title = truncate(data.title || "LSV-Map Update live", 256);
  const features = normalizeLines(data.features).slice(0, 4);

  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle(title)
    .setDescription(
      truncate(
        data.shortDescription ||
          "Ein neues Update wurde veröffentlicht.",
        4096
      )
    )
    .addFields({
      name: "Neu",
      value: truncate(toBulletText(features, "Keine Details"), 1024),
      inline: false,
    })
    .setFooter({ text: "LSV-Map Updates" })
    .setTimestamp(new Date());

  if (data.imageUrl) {
    embed.setThumbnail(data.imageUrl);
  }

  return embed;
}

async function sendDevlogPost(data = {}) {
  const channel = await fetchTextChannel(DEFAULT_DEVLOG_CHANNEL_ID);
  if (!channel) {
    console.warn("⚠️ Devlog-Channel nicht gefunden.");
    return false;
  }

  const embed = buildDevlogEmbed(data);
  await channel.send({ embeds: [embed] }).catch(console.error);

  return true;
}

async function sendMapUpdatesPost(data = {}) {
  if (!DEFAULT_MAP_UPDATES_CHANNEL_ID) return false;

  const channel = await fetchTextChannel(DEFAULT_MAP_UPDATES_CHANNEL_ID);
  if (!channel) {
    console.warn("⚠️ map-updates Channel nicht gefunden.");
    return false;
  }

  const embed = buildMapUpdatesEmbed(data);
  await channel.send({ embeds: [embed] }).catch(console.error);

  return true;
}

async function sendProjectUpdate(data = {}) {
  await sendDevlogPost(data);

  await sendMapUpdatesPost({
    title: data.title || "LSV-Map Update live",
    shortDescription:
      data.shortDescription ||
      data.description ||
      "Ein neues Update wurde veröffentlicht.",
    features: data.features || [],
    imageUrl: data.imageUrl || "",
  });
}

function devlogCommandSchema() {
  return new SlashCommandBuilder()
    .setName("devlog")
    .setDescription("Postet einen Devlog-Eintrag in den Devlog-Channel.")
    .addStringOption((option) =>
      option
        .setName("titel")
        .setDescription("Titel des Devlog-Posts")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("beschreibung")
        .setDescription("Kurze Beschreibung des Updates")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("bereich")
        .setDescription("Zum Beispiel Website, Bot, Dashboard")
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName("branch")
        .setDescription("Standard: main")
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName("commit")
        .setDescription("Kurze Commit-/Update-Zeile")
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName("commit_id")
        .setDescription("Kurze Commit-ID")
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName("features")
        .setDescription("Mehrere Punkte mit ; trennen")
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName("deploy")
        .setDescription("Zum Beispiel erfolgreich, fehlgeschlagen, läuft")
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName("bild")
        .setDescription("Optionales Bild / URL")
        .setRequired(false)
    )
    .addBooleanOption((option) =>
      option
        .setName("map_updates")
        .setDescription("Zusätzlich eine kurze Version in map-updates posten")
        .setRequired(false)
    );
}

async function registerCommands() {
  if (!DISCORD_GUILD_ID || !client.application) return;

  const commands = [devlogCommandSchema().toJSON()];

  await client.application.commands.set(commands, DISCORD_GUILD_ID).catch((error) => {
    console.error("❌ Slash-Commands konnten nicht registriert werden:", error.message);
  });
}

function memberIsAdmin(interaction) {
  if (!ADMIN_ROLE_ID) return true;
  return interaction.member?.roles?.cache?.has(ADMIN_ROLE_ID) || false;
}

client.once("ready", async () => {
  console.log(`✅ Bot online: ${client.user.tag}`);

  if (DISCORD_GUILD_ID) {
    const guild = await client.guilds.fetch(DISCORD_GUILD_ID).catch(() => null);
    if (!guild) {
      console.log("❌ Guild nicht gefunden. Prüfe DISCORD_GUILD_ID.");
    }
  }

  await registerCommands();

  await ensureSetupMessage(
    VERIFY_CHANNEL_ID,
    "verify_btn",
    "@everyone\nKlicke auf den Button, um dich zu verifizieren.",
    verifyRow()
  );

  await ensureSetupMessage(
    SUPPORT_CHANNEL_ID,
    "ticket_open_btn",
    "@everyone\nBrauchst du Hilfe? Klicke auf den Button und der Bot erstellt ein Ticket.",
    ticketRow()
  );

  startupFinished = true;
});

client.on("interactionCreate", async (interaction) => {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === "devlog") {
      if (!memberIsAdmin(interaction)) {
        return interaction.reply({
          content: "❌ Nur Admins dürfen Devlog-Posts ausführen.",
          ephemeral: true,
        });
      }

      const title = interaction.options.getString("titel", true);
      const description = interaction.options.getString("beschreibung", true);
      const area = interaction.options.getString("bereich") || "Website";
      const branch = interaction.options.getString("branch") || "main";
      const commit = interaction.options.getString("commit") || "Manueller Devlog-Post";
      const commitId = interaction.options.getString("commit_id") || "-";
      const features = normalizeLines(interaction.options.getString("features") || "");
      const deployStatus = interaction.options.getString("deploy") || "Erfolgreich";
      const imageUrl = interaction.options.getString("bild") || "";
      const alsoPostMapUpdates = interaction.options.getBoolean("map_updates") || false;

      await interaction.deferReply({ ephemeral: true });

      const data = {
        title,
        description,
        area,
        branch,
        author: interaction.user.username,
        commit,
        commitId,
        features,
        deployStatus,
        imageUrl,
      };

      const success = await sendDevlogPost(data);

      if (alsoPostMapUpdates) {
        await sendMapUpdatesPost({
          title,
          shortDescription: description,
          features,
          imageUrl,
        });
      }

      if (!success) {
        return interaction.editReply("❌ Devlog-Channel konnte nicht erreicht werden.");
      }

      return interaction.editReply("✅ Devlog wurde erfolgreich gepostet.");
    }

    return;
  }

  if (!interaction.isButton()) return;

  if (interaction.customId === "verify_btn") {
    const role = interaction.guild.roles.cache.get(VERIFIED_ROLE_ID);

    if (!role) {
      return interaction.reply({
        content: "❌ Verified-Rolle nicht gefunden.",
        ephemeral: true,
      });
    }

    if (interaction.member.roles.cache.has(VERIFIED_ROLE_ID)) {
      return interaction.reply({
        content: "✅ Du bist bereits verifiziert.",
        ephemeral: true,
      });
    }

    try {
      await interaction.member.roles.add(role);

      return interaction.reply({
        content: "✅ Du wurdest erfolgreich verifiziert.",
        ephemeral: true,
      });
    } catch (error) {
      console.error(error);
      return interaction.reply({
        content: "❌ Rolle konnte nicht vergeben werden. Prüfe die Rollen-Reihenfolge.",
        ephemeral: true,
      });
    }
  }

  if (interaction.customId === "ticket_open_btn") {
    const existing = interaction.guild.channels.cache.find(
      (channel) =>
        channel.type === ChannelType.GuildText &&
        channel.topic === `ticket:${interaction.user.id}`
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
        .replace(/[^a-z0-9-]/g, "")
        .slice(0, 20) || "user";

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

    const supportRoleId = getSupportPingRoleId();
    if (supportRoleId) {
      overwrites.push({
        id: supportRoleId,
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
        topic: `ticket:${interaction.user.id}`,
        parent: SUPPORT_CATEGORY_ID || undefined,
        permissionOverwrites: overwrites,
      });

      const pingText = supportRoleId ? `<@&${supportRoleId}> ` : "";

      await ticketChannel.send({
        content: `${pingText}🎫 Hallo ${interaction.user}, ein Admin meldet sich hier.\nDrücke unten auf **Ticket schließen**, wenn alles erledigt ist.`,
        components: [closeTicketRow()],
        allowedMentions: { parse: ["roles", "users"] },
      });

      await sendTicketLog(`🟢 Ticket erstellt von ${interaction.user.tag}: #${ticketChannel.name}`);

      return interaction.reply({
        content: `✅ Ticket erstellt: ${ticketChannel}`,
        ephemeral: true,
      });
    } catch (error) {
      console.error(error);
      return interaction.reply({
        content: "❌ Ticket konnte nicht erstellt werden.",
        ephemeral: true,
      });
    }
  }

  if (interaction.customId === "ticket_close_btn") {
    const ticketOwnerId = interaction.channel.topic?.replace("ticket:", "");
    const isAdmin = ADMIN_ROLE_ID
      ? interaction.member.roles.cache.has(ADMIN_ROLE_ID)
      : false;

    if (interaction.user.id !== ticketOwnerId && !isAdmin) {
      return interaction.reply({
        content: "❌ Du darfst dieses Ticket nicht schließen.",
        ephemeral: true,
      });
    }

    await sendTicketLog(`🔴 Ticket geschlossen von ${interaction.user.tag}: #${interaction.channel.name}`);

    await interaction.reply({
      content: "🗑️ Ticket wird geschlossen...",
      ephemeral: true,
    });

    setTimeout(async () => {
      await interaction.channel.delete().catch(console.error);
    }, 1500);
  }
});

client.on("error", (error) => {
  console.error("Discord Bot Fehler:", error);
});

if (!DISCORD_BOT_TOKEN) {
  console.error("❌ DISCORD_BOT_TOKEN fehlt.");
} else {
  client.login(DISCORD_BOT_TOKEN).catch((error) => {
    console.error("❌ Discord Login fehlgeschlagen:", error.message);
  });
}

module.exports = {
  client,
  get isReady() {
    return startupFinished && !!client.user;
  },
  sendDevlogPost,
  sendMapUpdatesPost,
  sendProjectUpdate,
  buildDevlogEmbed,
  buildMapUpdatesEmbed,
};
