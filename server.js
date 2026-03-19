require("dotenv").config();

const { sendDevlogPost, sendMapUpdatesPost, sendProjectUpdate } = require("./bot");
const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const session = require("express-session");
const passport = require("passport");
const DiscordStrategy = require("passport-discord").Strategy;
const axios = require("axios");
const multer = require("multer");
const { Pool } = require("pg");

const app = express();
app.set("trust proxy", 1);

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");
const MARKERS_FILE = path.join(__dirname, "markers.json");
const BACKUP_DIR = path.join(__dirname, "backups");
const AI_UPLOADS_DIR = path.join(__dirname, "ai-uploads");
const AI_DATA_DIR = path.join(__dirname, "ai-data");
const AI_UPLOADS_JSON = path.join(AI_DATA_DIR, "uploads.json");
const AI_REFERENCES_JSON = path.join(AI_DATA_DIR, "references.json");
const HISTORY_FILE = path.join(AI_DATA_DIR, "marker-history.json");
const DEVLOG_API_KEY = process.env.DEVLOG_API_KEY || "";
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || "";
const DATABASE_URL = String(process.env.DATABASE_URL || "").trim();
const AUTO_BACKUP_INTERVAL_MINUTES = Math.max(
  15,
  Number(process.env.AUTO_BACKUP_INTERVAL_MINUTES || 360)
);

const ALLOWED_CATEGORIES = [
  "Dealer",
  "UG",
  "Feld",
  "Workstation",
  "Schwarzmarkt",
  "Fraktions Krankenhaus",
  "Systempunkteshop",
  "Fraktion",
  "Fraktionsgebiet"
];

for (const dir of [PUBLIC_DIR, BACKUP_DIR, AI_UPLOADS_DIR, AI_DATA_DIR]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

for (const file of [AI_UPLOADS_JSON, AI_REFERENCES_JSON, HISTORY_FILE]) {
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, "[]", "utf8");
  }
}

const liveClients = new Set();

const pool = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30000,
      ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false
    })
  : null;

if (pool) {
  pool.on("error", (error) => {
    console.error("Postgres Pool Fehler:", error.message);
  });
} else {
  console.log("DATABASE_URL nicht gesetzt -> JSON/Fallback-Speicherung wird benutzt.");
}

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(express.static(PUBLIC_DIR));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "change-me-please",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production"
    }
  })
);

app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

const discordClientId = process.env.DISCORD_CLIENT_ID || "";
const discordClientSecret = process.env.DISCORD_CLIENT_SECRET || "";
const discordRedirectUri = process.env.DISCORD_REDIRECT_URI || "";

if (discordClientId && discordClientSecret && discordRedirectUri) {
  passport.use(
    new DiscordStrategy(
      {
        clientID: discordClientId,
        clientSecret: discordClientSecret,
        callbackURL: discordRedirectUri,
        scope: ["identify"]
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          const guildId = process.env.DISCORD_GUILD_ID || "";
          const vipRoleId = process.env.DISCORD_VIP_ROLE_ID || "";
          const adminRoleId = process.env.DISCORD_ADMIN_ROLE_ID || "";
          const supportRoleId =
            process.env.DISCORD_SUPPORT_ROLE_ID || process.env.SUPPORT_PING_ROLE_ID || "";
          const mapperRoleId = process.env.DISCORD_MAPPER_ROLE_ID || "";
          const dashboardRoleId = process.env.DISCORD_DASHBOARD_ROLE_ID || "";

          let isVip = false;
          let isAdmin = false;
          let isSupport = false;
          let isMapper = false;
          let canViewDashboard = false;
          let canEdit = false;
          let roleNames = [];

          if (guildId && process.env.DISCORD_BOT_TOKEN) {
            try {
              const response = await axios.get(
                `https://discord.com/api/guilds/${guildId}/members/${profile.id}`,
                {
                  headers: {
                    Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`
                  },
                  timeout: 15000
                }
              );

              const roles = Array.isArray(response.data?.roles) ? response.data.roles : [];

              isVip = !!vipRoleId && roles.includes(vipRoleId);
              isAdmin = !!adminRoleId && roles.includes(adminRoleId);
              isSupport = !!supportRoleId && roles.includes(supportRoleId);
              isMapper = !!mapperRoleId && roles.includes(mapperRoleId);

              canEdit = isAdmin || isMapper;
              canViewDashboard = isAdmin || isSupport || isMapper || (!!dashboardRoleId && roles.includes(dashboardRoleId));

              roleNames = [
                isAdmin ? "Admin" : null,
                isMapper ? "Mapper" : null,
                isSupport ? "Support" : null,
                isVip ? "VIP" : null
              ].filter(Boolean);
            } catch (apiError) {
              console.error(
                "Discord Rollenabfrage Fehler:",
                apiError.response?.data || apiError.message
              );
            }
          }

          const user = {
            id: String(profile.id || ""),
            username: profile.username || profile.global_name || "Discord User",
            avatar: profile.avatar || "",
            isVip,
            isAdmin,
            isSupport,
            isMapper,
            canEdit,
            canViewDashboard,
            roleNames
          };

          return done(null, user);
        } catch (error) {
          return done(error);
        }
      }
    )
  );
} else {
  console.warn("Discord OAuth ist nicht vollständig konfiguriert.");
}

function readJsonFile(file, fallback = []) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, "utf8");
    if (!raw.trim()) return fallback;
    const parsed = JSON.parse(raw);
    return parsed;
  } catch (error) {
    console.error(`Fehler beim Lesen von ${path.basename(file)}:`, error.message);
    return fallback;
  }
}

function writeJsonFile(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

function normalizeLines(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || "").trim()).filter(Boolean);
  }

  return String(value || "")
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function safeFileNamePart(value, fallback = "upload") {
  return (
    String(value || fallback)
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || fallback
  );
}

function detectExtensionFromMime(mime = "") {
  if (mime.includes("png")) return ".png";
  if (mime.includes("webp")) return ".webp";
  if (mime.includes("gif")) return ".gif";
  if (mime.includes("jpeg")) return ".jpg";
  return ".jpg";
}

function getSafeBackupFilename(filename) {
  return path.basename(String(filename || "")).replace(/[^a-zA-Z0-9._-]/g, "");
}

function markerSummary(marker) {
  return `${marker.name} (${marker.category}) @ ${Number(marker.lat).toFixed(2)}, ${Number(
    marker.lng
  ).toFixed(2)}`;
}

function formatValue(value) {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "boolean") return value ? "Ja" : "Nein";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "-";
  return String(value);
}

function normalizeMarker(input) {
  if (!input || typeof input !== "object") return null;

  const lat = Number(input.lat);
  const lng = Number(input.lng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const category = String(input.category || "").trim();
  if (!ALLOWED_CATEGORIES.includes(category)) return null;

  const name = String(input.name || "").trim();
  if (!name) return null;

  const radiusValue = Number(input.radius);
  const radius =
    category === "Fraktionsgebiet"
      ? Number.isFinite(radiusValue) && radiusValue > 0
        ? radiusValue
        : 200
      : 0;

  return {
    id: String(input.id || crypto.randomUUID()),
    name,
    description: String(input.description || "").trim(),
    category,
    lat,
    lng,
    radius,
    image: String(input.image || "").trim(),
    owner: String(input.owner || "").trim(),
    favorite: !!input.favorite,
    createdBy: String(input.createdBy || "").trim(),
    updatedBy: String(input.updatedBy || "").trim(),
    createdAt: input.createdAt ? new Date(input.createdAt).toISOString() : new Date().toISOString(),
    updatedAt: input.updatedAt ? new Date(input.updatedAt).toISOString() : new Date().toISOString()
  };
}

function filterMarkersForUser(markers, user) {
  const isVip = !!user?.isVip || !!user?.isAdmin;

  return markers.filter((marker) => {
    if (marker.category === "Schwarzmarkt" && !isVip) {
      return false;
    }
    return true;
  });
}

function buildMarkerChanges(oldMarker, newMarker) {
  if (!oldMarker) return [];

  const fields = [
    ["name", "Name"],
    ["description", "Beschreibung"],
    ["category", "Kategorie"],
    ["lat", "Breitengrad"],
    ["lng", "Längengrad"],
    ["radius", "Radius"],
    ["image", "Bild"],
    ["owner", "Besitzer"],
    ["favorite", "Favorit"]
  ];

  const changes = [];

  for (const [key, label] of fields) {
    const before = oldMarker[key];
    const after = newMarker[key];

    if (String(before ?? "") !== String(after ?? "")) {
      changes.push({
        key,
        label,
        before,
        after
      });
    }
  }

  return changes;
}

function buildHistorySummary(action, marker, changes) {
  if (action === "created") return `Marker erstellt: ${markerSummary(marker)}`;
  if (action === "deleted") return `Marker gelöscht: ${markerSummary(marker)}`;
  if (action === "imported") return `Marker per Import übernommen: ${markerSummary(marker)}`;
  if (action === "restored") return `Marker wiederhergestellt: ${markerSummary(marker)}`;

  if (!changes.length) {
    return `Marker aktualisiert: ${markerSummary(marker)}`;
  }

  return `Marker geändert: ${changes
    .map((change) => `${change.label}: ${formatValue(change.before)} → ${formatValue(change.after)}`)
    .join(" | ")}`;
}

function buildDiscordLog(action, marker, adminName, changes = []) {
  const base = [
    `**Marker:** ${marker.name}`,
    `**Kategorie:** ${marker.category}`,
    `**Besitzer:** ${marker.owner || "-"}`,
    `**Koordinaten:** ${Number(marker.lat).toFixed(2)}, ${Number(marker.lng).toFixed(2)}`
  ];

  if (marker.category === "Fraktionsgebiet") {
    base.push(`**Radius:** ${Number(marker.radius || 200)}m`);
  }

  if (action === "created") {
    return `🟢 **${adminName}** hat Marker erstellt\n${base.join("\n")}`;
  }

  if (action === "deleted") {
    return `🔴 **${adminName}** hat Marker gelöscht\n${base.join("\n")}`;
  }

  if (action === "imported") {
    return `📥 **${adminName}** hat Marker importiert\n${base.join("\n")}`;
  }

  if (action === "restored") {
    return `♻️ **${adminName}** hat eine Marker-Version wiederhergestellt\n${base.join("\n")}`;
  }

  const summary = changes.length
    ? changes.map((change) => `${change.label}: ${formatValue(change.before)} → ${formatValue(change.after)}`).join(" | ")
    : "Keine Detailänderungen erkannt";

  return `🟡 **${adminName}** hat Marker geändert\n${base.join("\n")}\n**Änderungen:** ${summary}`;
}

async function sendDiscordLog(content) {
  if (!DISCORD_WEBHOOK_URL) return;

  try {
    await axios.post(DISCORD_WEBHOOK_URL, { content }, { timeout: 15000 });
  } catch (error) {
    console.error("Discord Webhook Fehler:", error.response?.data || error.message);
  }
}

function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];

  return fs
    .readdirSync(BACKUP_DIR)
    .filter((file) => file.endsWith(".json"))
    .map((file) => {
      const fullPath = path.join(BACKUP_DIR, file);
      const stat = fs.statSync(fullPath);
      return {
        file,
        size: stat.size,
        createdAt: stat.mtime.toISOString()
      };
    })
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function broadcastLiveEvent(type, payload = {}) {
  const message = `event: ${type}\ndata: ${JSON.stringify({
    type,
    timestamp: new Date().toISOString(),
    ...payload
  })}\n\n`;

  for (const client of liveClients) {
    client.write(message);
  }
}

async function createBackupFile(reason = "manual", actor = "System", markersInput = null) {
  const markers = Array.isArray(markersInput) ? markersInput : await loadMarkers();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `backup-${timestamp}-${String(reason).replace(/[^a-zA-Z0-9_-]/g, "")}.json`;

  const payload = {
    meta: {
      reason,
      actor,
      createdAt: new Date().toISOString(),
      markerCount: markers.length
    },
    markers
  };

  fs.writeFileSync(path.join(BACKUP_DIR, filename), JSON.stringify(payload, null, 2), "utf8");
  broadcastLiveEvent("backup-created", { reason, actor, filename, markerCount: markers.length });

  return {
    filename,
    markerCount: markers.length
  };
}

function scheduleAutomaticBackups() {
  const ms = AUTO_BACKUP_INTERVAL_MINUTES * 60 * 1000;

  setInterval(async () => {
    try {
      const markers = await loadMarkers();
      await createBackupFile("auto", "System", markers);
      console.log(`Automatisches Backup erstellt (${markers.length} Marker).`);
    } catch (error) {
      console.error("Automatisches Backup fehlgeschlagen:", error.message);
    }
  }, ms);
}

async function createTables() {
  if (!pool) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS markers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL,
      lat DOUBLE PRECISION NOT NULL,
      lng DOUBLE PRECISION NOT NULL,
      radius DOUBLE PRECISION NOT NULL DEFAULT 0,
      image TEXT NOT NULL DEFAULT '',
      owner TEXT NOT NULL DEFAULT '',
      favorite BOOLEAN NOT NULL DEFAULT FALSE,
      created_by TEXT NOT NULL DEFAULT '',
      updated_by TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS marker_history (
      history_id BIGSERIAL PRIMARY KEY,
      marker_id TEXT NOT NULL,
      action TEXT NOT NULL,
      admin_name TEXT NOT NULL DEFAULT '',
      admin_id TEXT NOT NULL DEFAULT '',
      marker_name TEXT NOT NULL DEFAULT '',
      change_summary TEXT NOT NULL DEFAULT '',
      changes_json TEXT NOT NULL DEFAULT '[]',
      snapshot_json TEXT NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function loadMarkersFromDb() {
  const result = await pool.query(`
    SELECT id, name, description, category, lat, lng, radius, image, owner, favorite, created_by, updated_by, created_at, updated_at
    FROM markers
    ORDER BY category ASC, name ASC
  `);

  return result.rows.map((row) => ({
    id: String(row.id || ""),
    name: String(row.name || ""),
    description: String(row.description || ""),
    category: String(row.category || ""),
    lat: Number(row.lat),
    lng: Number(row.lng),
    radius: Number(row.radius || 0),
    image: String(row.image || ""),
    owner: String(row.owner || ""),
    favorite: !!row.favorite,
    createdBy: String(row.created_by || ""),
    updatedBy: String(row.updated_by || ""),
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null
  }));
}

function loadMarkersFromJson() {
  const parsed = readJsonFile(MARKERS_FILE, []);
  if (!Array.isArray(parsed)) return [];
  return parsed.map(normalizeMarker).filter(Boolean);
}

async function seedFromJsonIfDatabaseIsEmpty() {
  if (!pool) return;

  const countResult = await pool.query(`SELECT COUNT(*)::int AS count FROM markers`);
  const count = Number(countResult.rows[0]?.count || 0);

  if (count > 0) return;

  const markersFromJson = loadMarkersFromJson();
  if (!markersFromJson.length) return;

  for (const marker of markersFromJson) {
    await pool.query(
      `
        INSERT INTO markers (
          id, name, description, category, lat, lng, radius, image, owner, favorite, created_by, updated_by, created_at, updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      `,
      [
        marker.id,
        marker.name,
        marker.description,
        marker.category,
        marker.lat,
        marker.lng,
        marker.radius || 0,
        marker.image || "",
        marker.owner || "",
        !!marker.favorite,
        marker.createdBy || "",
        marker.updatedBy || "",
        marker.createdAt || new Date().toISOString(),
        marker.updatedAt || new Date().toISOString()
      ]
    );
  }

  console.log(`${markersFromJson.length} Marker aus markers.json importiert.`);
}

async function loadMarkers() {
  if (pool) {
    return loadMarkersFromDb();
  }
  return loadMarkersFromJson();
}

async function saveMarkers(finalMarkers, adminName, adminId) {
  if (pool) {
    await pool.query("BEGIN");
    try {
      await pool.query(`DELETE FROM markers`);

      for (const marker of finalMarkers) {
        await pool.query(
          `
            INSERT INTO markers (
              id, name, description, category, lat, lng, radius, image, owner, favorite, created_by, updated_by, created_at, updated_at
            )
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
          `,
          [
            marker.id,
            marker.name,
            marker.description,
            marker.category,
            marker.lat,
            marker.lng,
            marker.radius || 0,
            marker.image || "",
            marker.owner || "",
            !!marker.favorite,
            marker.createdBy || adminName,
            marker.updatedBy || adminName,
            marker.createdAt || new Date().toISOString(),
            marker.updatedAt || new Date().toISOString()
          ]
        );
      }

      await pool.query("COMMIT");
    } catch (error) {
      await pool.query("ROLLBACK");
      throw error;
    }
    return;
  }

  writeJsonFile(MARKERS_FILE, finalMarkers);
}

function readHistory() {
  const parsed = readJsonFile(HISTORY_FILE, []);
  return Array.isArray(parsed) ? parsed : [];
}

function writeHistory(entries) {
  writeJsonFile(HISTORY_FILE, entries);
}

async function addHistoryEntry(entry) {
  if (pool) {
    await pool.query(
      `
        INSERT INTO marker_history (
          marker_id, action, admin_name, admin_id, marker_name, change_summary, changes_json, snapshot_json, created_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
      `,
      [
        entry.markerId,
        entry.action,
        entry.adminName || "",
        entry.adminId || "",
        entry.markerName || "",
        entry.changeSummary || "",
        JSON.stringify(entry.changes || []),
        JSON.stringify(entry.snapshot || {})
      ]
    );
    return;
  }

  const history = readHistory();
  history.unshift({
    historyId: Date.now() + Math.floor(Math.random() * 1000),
    markerId: entry.markerId,
    action: entry.action,
    adminName: entry.adminName || "",
    adminId: entry.adminId || "",
    markerName: entry.markerName || "",
    changeSummary: entry.changeSummary || "",
    changes: entry.changes || [],
    snapshot: entry.snapshot || {},
    createdAt: new Date().toISOString()
  });
  writeHistory(history);
}

async function getMarkerHistory(markerId) {
  if (pool) {
    const result = await pool.query(
      `
        SELECT history_id, marker_id, action, admin_name, admin_id, marker_name, change_summary, changes_json, snapshot_json, created_at
        FROM marker_history
        WHERE marker_id = $1
        ORDER BY created_at DESC, history_id DESC
        LIMIT 50
      `,
      [markerId]
    );

    return result.rows.map((row) => ({
      historyId: Number(row.history_id),
      markerId: String(row.marker_id || ""),
      action: String(row.action || ""),
      adminName: String(row.admin_name || ""),
      adminId: String(row.admin_id || ""),
      markerName: String(row.marker_name || ""),
      changeSummary: String(row.change_summary || ""),
      changes: JSON.parse(row.changes_json || "[]"),
      snapshot: JSON.parse(row.snapshot_json || "{}"),
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : null
    }));
  }

  return readHistory().filter((entry) => String(entry.markerId) === String(markerId));
}

async function getHistoryEntryById(historyId) {
  if (pool) {
    const result = await pool.query(
      `
        SELECT history_id, marker_id, action, admin_name, admin_id, marker_name, change_summary, changes_json, snapshot_json, created_at
        FROM marker_history
        WHERE history_id = $1
        LIMIT 1
      `,
      [historyId]
    );

    if (!result.rowCount) return null;

    const row = result.rows[0];
    return {
      historyId: Number(row.history_id),
      markerId: String(row.marker_id || ""),
      action: String(row.action || ""),
      adminName: String(row.admin_name || ""),
      adminId: String(row.admin_id || ""),
      markerName: String(row.marker_name || ""),
      changeSummary: String(row.change_summary || ""),
      changes: JSON.parse(row.changes_json || "[]"),
      snapshot: JSON.parse(row.snapshot_json || "{}"),
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : null
    };
  }

  return readHistory().find((entry) => Number(entry.historyId) === Number(historyId)) || null;
}

async function getDashboardData() {
  const allMarkers = await loadMarkers();
  const history = pool
    ? (
        await pool.query(`
          SELECT history_id, marker_id, action, admin_name, marker_name, change_summary, created_at
          FROM marker_history
          ORDER BY created_at DESC, history_id DESC
          LIMIT 8
        `)
      ).rows.map((row) => ({
        historyId: Number(row.history_id),
        markerId: String(row.marker_id || ""),
        action: String(row.action || ""),
        adminName: String(row.admin_name || ""),
        markerName: String(row.marker_name || ""),
        changeSummary: String(row.change_summary || ""),
        createdAt: row.created_at ? new Date(row.created_at).toISOString() : null
      }))
    : readHistory().slice(0, 8).map((entry) => ({
        historyId: Number(entry.historyId),
        markerId: String(entry.markerId || ""),
        action: String(entry.action || ""),
        adminName: String(entry.adminName || ""),
        markerName: String(entry.markerName || ""),
        changeSummary: String(entry.changeSummary || ""),
        createdAt: entry.createdAt || null
      }));

  const categoryCounts = {};
  const ownerCounts = {};

  for (const marker of allMarkers) {
    categoryCounts[marker.category] = (categoryCounts[marker.category] || 0) + 1;

    const owner = String(marker.owner || "Unzugewiesen").trim() || "Unzugewiesen";
    ownerCounts[owner] = (ownerCounts[owner] || 0) + 1;
  }

  const topOwners = Object.entries(ownerCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([owner, count]) => ({ owner, count }));

  return {
    metrics: {
      totalMarkers: allMarkers.length,
      favorites: allMarkers.filter((marker) => marker.favorite).length,
      territories: allMarkers.filter((marker) => marker.category === "Fraktionsgebiet").length,
      blackmarket: allMarkers.filter((marker) => marker.category === "Schwarzmarkt").length,
      categories: categoryCounts
    },
    topOwners,
    recentChanges: history,
    backups: listBackups().slice(0, 10)
  };
}

function requireEditor(req, res, next) {
  if (!req.user || !req.user.canEdit) {
    return res.status(403).json({
      success: false,
      error: "Nur Admins oder Mapper dürfen diese Aktion ausführen."
    });
  }
  next();
}

function requireDashboard(req, res, next) {
  if (!req.user || !req.user.canViewDashboard) {
    return res.status(403).json({
      success: false,
      error: "Kein Zugriff auf das Dashboard."
    });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || !req.user.isAdmin) {
    return res.status(403).json({
      success: false,
      error: "Nur Admins dürfen diese Aktion ausführen."
    });
  }
  next();
}

function requireDevlogKey(req, res, next) {
  if (!DEVLOG_API_KEY) return next();

  const incomingKey = String(req.headers["x-devlog-key"] || req.body?.key || "").trim();
  if (!incomingKey || incomingKey !== DEVLOG_API_KEY) {
    return res.status(401).json({
      success: false,
      error: "Ungültiger Devlog-Key."
    });
  }

  next();
}

app.get("/", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    uptime: process.uptime(),
    database: !!pool,
    timestamp: new Date().toISOString()
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    ok: true,
    uptime: process.uptime(),
    database: !!pool,
    timestamp: new Date().toISOString()
  });
});

app.get("/api/auth-debug", (req, res) => {
  res.json({
    clientIdSet: !!process.env.DISCORD_CLIENT_ID,
    clientSecretSet: !!process.env.DISCORD_CLIENT_SECRET,
    redirectUri: process.env.DISCORD_REDIRECT_URI || "",
    guildIdSet: !!process.env.DISCORD_GUILD_ID,
    botTokenSet: !!process.env.DISCORD_BOT_TOKEN,
    loggedIn: !!req.user,
    user: req.user || null
  });
});

app.get("/auth/discord", (req, res, next) => {
  if (!discordClientId || !discordClientSecret || !discordRedirectUri) {
    return res.status(500).send("Discord OAuth ist nicht vollständig konfiguriert.");
  }

  console.log("Discord Login gestartet");
  console.log("CLIENT_ID gesetzt:", !!process.env.DISCORD_CLIENT_ID);
  console.log("CLIENT_SECRET gesetzt:", !!process.env.DISCORD_CLIENT_SECRET);
  console.log("REDIRECT_URI:", process.env.DISCORD_REDIRECT_URI || "FEHLT");
  console.log("GUILD_ID gesetzt:", !!process.env.DISCORD_GUILD_ID);
  console.log("BOT_TOKEN gesetzt:", !!process.env.DISCORD_BOT_TOKEN);

  return passport.authenticate("discord")(req, res, next);
});

app.get("/auth/discord/callback", (req, res, next) => {
  passport.authenticate("discord", (err, user, info) => {
    console.log("DISCORD CALLBACK QUERY:", req.query);
    console.log("DISCORD CALLBACK ERR:", err ? err.message || err : null);
    console.log("DISCORD CALLBACK INFO:", info || null);

    if (err) {
      console.error("OAuth Fehler:", err.response?.data || err.message || err);
      return res.status(500).send(`Discord OAuth Fehler: ${err.message || err}`);
    }

    if (!user) {
      console.error("Kein User von Discord zurückbekommen:", info);
      return res.status(401).send("Discord Login fehlgeschlagen.");
    }

    req.logIn(user, (loginErr) => {
      if (loginErr) {
        console.error("Session Login Fehler:", loginErr);
        return res.status(500).send(`Session Fehler: ${loginErr.message || loginErr}`);
      }

      console.log("Discord Login erfolgreich:", user.username || user.id);
      return res.redirect("/");
    });
  })(req, res, next);
});

app.get("/logout", (req, res) => {
  req.logout(() => {
    req.session.destroy(() => {
      res.redirect("/");
    });
  });
});

app.get("/api/user", (req, res) => {
  if (!req.user) {
    return res.json({
      loggedIn: false,
      username: "",
      isVip: false,
      isAdmin: false,
      isSupport: false,
      isMapper: false,
      canEdit: false,
      canViewDashboard: false,
      roleNames: [],
      id: ""
    });
  }

  return res.json({
    loggedIn: true,
    username: req.user.username,
    isVip: !!req.user.isVip,
    isAdmin: !!req.user.isAdmin,
    isSupport: !!req.user.isSupport,
    isMapper: !!req.user.isMapper,
    canEdit: !!req.user.canEdit,
    canViewDashboard: !!req.user.canViewDashboard,
    roleNames: Array.isArray(req.user.roleNames) ? req.user.roleNames : [],
    id: req.user.id || ""
  });
});

app.get("/api/live", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  res.write(`event: connected\ndata: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`);
  liveClients.add(res);

  const heartbeat = setInterval(() => {
    res.write(`event: ping\ndata: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`);
  }, 25000);

  req.on("close", () => {
    clearInterval(heartbeat);
    liveClients.delete(res);
  });
});

app.get("/markers", async (req, res) => {
  try {
    const markers = await loadMarkers();
    res.json(filterMarkersForUser(markers, req.user));
  } catch (error) {
    console.error("Fehler beim Laden der Marker:", error.message);
    res.status(500).json({
      success: false,
      error: "Marker konnten nicht geladen werden."
    });
  }
});

app.post("/markers", requireEditor, async (req, res) => {
  const incoming = Array.isArray(req.body?.markers) ? req.body.markers : null;

  if (!incoming) {
    return res.status(400).json({
      success: false,
      error: "Ungültige Daten. Erwartet wird { markers: [...] }."
    });
  }

  const adminName = req.user?.username || "Unbekannt";
  const adminId = req.user?.id || "";
  const oldMarkers = await loadMarkers();
  const oldMap = new Map(oldMarkers.map((marker) => [marker.id, marker]));
  const nowIso = new Date().toISOString();

  const finalMarkers = incoming
    .map(normalizeMarker)
    .filter(Boolean)
    .map((marker) => {
      const oldMarker = oldMap.get(marker.id);
      if (oldMarker) {
        return {
          ...marker,
          owner: marker.owner || oldMarker.owner || adminName,
          radius: marker.radius || 0,
          favorite: !!marker.favorite,
          createdBy: oldMarker.createdBy || adminName,
          updatedBy: adminName,
          createdAt: oldMarker.createdAt || nowIso,
          updatedAt: nowIso
        };
      }

      return {
        ...marker,
        owner: marker.owner || adminName,
        radius: marker.radius || 0,
        favorite: !!marker.favorite,
        createdBy: adminName,
        updatedBy: adminName,
        createdAt: nowIso,
        updatedAt: nowIso
      };
    });

  try {
    const newMap = new Map(finalMarkers.map((marker) => [marker.id, marker]));
    const added = finalMarkers.filter((marker) => !oldMap.has(marker.id));
    const removed = oldMarkers.filter((marker) => !newMap.has(marker.id));
    const changed = finalMarkers
      .map((marker) => {
        const oldMarker = oldMap.get(marker.id);
        if (!oldMarker) return null;
        const changes = buildMarkerChanges(oldMarker, marker);
        if (!changes.length) return null;
        return { marker, changes };
      })
      .filter(Boolean);

    if (oldMarkers.length > 0) {
      await createBackupFile("before-save", adminName, oldMarkers);
    }

    await saveMarkers(finalMarkers, adminName, adminId);

    for (const marker of added) {
      await addHistoryEntry({
        markerId: marker.id,
        action: "created",
        adminName,
        adminId,
        markerName: marker.name,
        changeSummary: buildHistorySummary("created", marker, []),
        changes: [],
        snapshot: marker
      });
      await sendDiscordLog(buildDiscordLog("created", marker, adminName, []));
    }

    for (const entry of changed) {
      await addHistoryEntry({
        markerId: entry.marker.id,
        action: "updated",
        adminName,
        adminId,
        markerName: entry.marker.name,
        changeSummary: buildHistorySummary("updated", entry.marker, entry.changes),
        changes: entry.changes,
        snapshot: entry.marker
      });
      await sendDiscordLog(buildDiscordLog("updated", entry.marker, adminName, entry.changes));
    }

    for (const marker of removed) {
      await addHistoryEntry({
        markerId: marker.id,
        action: "deleted",
        adminName,
        adminId,
        markerName: marker.name,
        changeSummary: buildHistorySummary("deleted", marker, []),
        changes: [],
        snapshot: marker
      });
      await sendDiscordLog(buildDiscordLog("deleted", marker, adminName, []));
    }

    broadcastLiveEvent("markers-updated", {
      actor: adminName,
      markerCount: finalMarkers.length,
      added: added.length,
      changed: changed.length,
      removed: removed.length
    });

    res.json({
      success: true,
      markers: finalMarkers
    });
  } catch (error) {
    console.error("Fehler beim Speichern der Marker:", error.message);
    res.status(500).json({
      success: false,
      error: "Marker konnten nicht gespeichert werden."
    });
  }
});

app.get("/api/export-markers", requireAdmin, async (req, res) => {
  try {
    const markers = await loadMarkers();
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `markers-export-${timestamp}.json`;

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(JSON.stringify(markers, null, 2));
  } catch (error) {
    console.error("Fehler beim Exportieren der Marker:", error.message);
    res.status(500).json({
      success: false,
      error: "Marker konnten nicht exportiert werden."
    });
  }
});

app.post("/api/import-markers", requireAdmin, async (req, res) => {
  const incoming = Array.isArray(req.body)
    ? req.body
    : Array.isArray(req.body?.markers)
    ? req.body.markers
    : null;

  if (!incoming) {
    return res.status(400).json({
      success: false,
      error: "Ungültige Daten. Erwartet wird ein Array oder { markers: [...] }."
    });
  }

  const adminName = req.user?.username || "Unbekannt";
  const adminId = req.user?.id || "";
  const nowIso = new Date().toISOString();

  const cleanMarkers = incoming
    .map(normalizeMarker)
    .filter(Boolean)
    .map((marker) => ({
      ...marker,
      owner: marker.owner || adminName,
      radius: marker.radius || 0,
      favorite: !!marker.favorite,
      createdBy: marker.createdBy || adminName,
      updatedBy: adminName,
      createdAt: marker.createdAt || nowIso,
      updatedAt: nowIso
    }));

  if (cleanMarkers.length === 0 && incoming.length > 0) {
    return res.status(400).json({
      success: false,
      error: "Es konnten keine gültigen Marker importiert werden."
    });
  }

  try {
    const oldMarkers = await loadMarkers();
    if (oldMarkers.length > 0) {
      await createBackupFile("before-import", adminName, oldMarkers);
    }

    await saveMarkers(cleanMarkers, adminName, adminId);

    for (const marker of cleanMarkers) {
      await addHistoryEntry({
        markerId: marker.id,
        action: "imported",
        adminName,
        adminId,
        markerName: marker.name,
        changeSummary: buildHistorySummary("imported", marker, []),
        changes: [],
        snapshot: marker
      });
    }

    await sendDiscordLog(`📥 **${adminName}** hat einen Marker-Import ausgeführt.\n**Marker gesamt:** ${cleanMarkers.length}`);

    broadcastLiveEvent("markers-updated", {
      actor: adminName,
      markerCount: cleanMarkers.length,
      imported: cleanMarkers.length
    });

    res.json({
      success: true,
      imported: cleanMarkers.length,
      markers: cleanMarkers
    });
  } catch (error) {
    console.error("Import Fehler:", error.message);
    res.status(500).json({
      success: false,
      error: "Marker konnten nicht importiert werden."
    });
  }
});

app.get("/api/marker-history/:markerId", requireAdmin, async (req, res) => {
  try {
    const markerId = String(req.params.markerId || "").trim();
    if (!markerId) {
      return res.status(400).json({ success: false, error: "Marker-ID fehlt." });
    }

    const history = await getMarkerHistory(markerId);
    res.json({
      success: true,
      history
    });
  } catch (error) {
    console.error("Marker History Fehler:", error.message);
    res.status(500).json({
      success: false,
      error: "Historie konnte nicht geladen werden."
    });
  }
});

app.post("/api/marker-history-entry/:historyId/restore", requireAdmin, async (req, res) => {
  try {
    const historyId = Number(req.params.historyId);
    if (!Number.isFinite(historyId)) {
      return res.status(400).json({
        success: false,
        error: "Ungültige History-ID."
      });
    }

    const entry = await getHistoryEntryById(historyId);
    if (!entry) {
      return res.status(404).json({
        success: false,
        error: "Historieneintrag nicht gefunden."
      });
    }

    const snapshot = normalizeMarker(entry.snapshot || {});
    if (!snapshot) {
      return res.status(400).json({
        success: false,
        error: "Snapshot konnte nicht gelesen werden."
      });
    }

    const adminName = req.user?.username || "Unbekannt";
    const adminId = req.user?.id || "";
    const currentMarkersBeforeRestore = await loadMarkers();

    if (currentMarkersBeforeRestore.length > 0) {
      await createBackupFile("before-restore", adminName, currentMarkersBeforeRestore);
    }

    const oldMarker = currentMarkersBeforeRestore.find((marker) => marker.id === snapshot.id) || null;
    const nowIso = new Date().toISOString();

    const restoredMarker = {
      ...snapshot,
      owner: snapshot.owner || oldMarker?.owner || adminName,
      radius: snapshot.radius || 0,
      favorite: !!snapshot.favorite,
      createdBy: snapshot.createdBy || oldMarker?.createdBy || adminName,
      updatedBy: adminName,
      createdAt: snapshot.createdAt || oldMarker?.createdAt || nowIso,
      updatedAt: nowIso
    };

    const changes = buildMarkerChanges(oldMarker, restoredMarker);
    const finalMarkers = currentMarkersBeforeRestore.filter((marker) => marker.id !== restoredMarker.id);
    finalMarkers.push(restoredMarker);

    await saveMarkers(finalMarkers, adminName, adminId);
    await addHistoryEntry({
      markerId: restoredMarker.id,
      action: "restored",
      adminName,
      adminId,
      markerName: restoredMarker.name,
      changeSummary: buildHistorySummary("restored", restoredMarker, changes),
      changes,
      snapshot: restoredMarker
    });

    await sendDiscordLog(buildDiscordLog("restored", restoredMarker, adminName, changes));

    broadcastLiveEvent("markers-updated", {
      actor: adminName,
      markerCount: finalMarkers.length,
      restoredMarkerId: restoredMarker.id
    });

    res.json({
      success: true,
      marker: restoredMarker,
      message: `${entry.markerName || restoredMarker.name} wurde wiederhergestellt.`
    });
  } catch (error) {
    console.error("Fehler beim Wiederherstellen:", error.message);
    res.status(500).json({
      success: false,
      error: "Version konnte nicht wiederhergestellt werden."
    });
  }
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024
  }
});

app.post("/upload", requireEditor, (req, res) => {
  upload.single("file")(req, res, (error) => {
    if (error) {
      return res.status(400).json({
        success: false,
        error: error.message || "Upload fehlgeschlagen"
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: "Keine Datei hochgeladen"
      });
    }

    const dataUrl = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;

    res.json({
      success: true,
      file: req.file.originalname,
      path: dataUrl
    });
  });
});

app.get("/api/admin-dashboard", requireDashboard, async (req, res) => {
  try {
    res.json({
      success: true,
      ...(await getDashboardData())
    });
  } catch (error) {
    console.error("Dashboard Fehler:", error.message);
    res.status(500).json({
      success: false,
      error: "Dashboard konnte nicht geladen werden."
    });
  }
});

app.get("/api/backups", requireDashboard, async (req, res) => {
  try {
    res.json({
      success: true,
      backups: listBackups()
    });
  } catch (error) {
    console.error("Backup-Liste Fehler:", error.message);
    res.status(500).json({
      success: false,
      error: "Backups konnten nicht geladen werden."
    });
  }
});

app.get("/api/backups/:filename", requireAdmin, async (req, res) => {
  try {
    const file = getSafeBackupFilename(req.params.filename);
    if (!file) {
      return res.status(400).json({
        success: false,
        error: "Dateiname fehlt."
      });
    }

    const fullPath = path.join(BACKUP_DIR, file);
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({
        success: false,
        error: "Backup nicht gefunden."
      });
    }

    res.download(fullPath);
  } catch (error) {
    console.error("Backup-Download Fehler:", error.message);
    res.status(500).json({
      success: false,
      error: "Backup konnte nicht geladen werden."
    });
  }
});

app.post("/api/backups/create", requireAdmin, async (req, res) => {
  try {
    const markers = await loadMarkers();
    const backup = await createBackupFile("manual", req.user?.username || "Admin", markers);
    res.json({
      success: true,
      backup
    });
  } catch (error) {
    console.error("Manuelles Backup fehlgeschlagen:", error.message);
    res.status(500).json({
      success: false,
      error: "Backup konnte nicht erstellt werden."
    });
  }
});

function readAiUploads() {
  const parsed = readJsonFile(AI_UPLOADS_JSON, []);
  return Array.isArray(parsed) ? parsed : [];
}

function writeAiUploads(entries) {
  writeJsonFile(AI_UPLOADS_JSON, entries);
}

function readAiReferences() {
  const parsed = readJsonFile(AI_REFERENCES_JSON, []);
  return Array.isArray(parsed) ? parsed : [];
}

function writeAiReferences(entries) {
  writeJsonFile(AI_REFERENCES_JSON, entries);
}

function getUploadMatches(upload) {
  const markers = readJsonFile(MARKERS_FILE, []).map(normalizeMarker).filter(Boolean);

  return markers
    .map((marker, index) => {
      let score = 42;
      const reasons = [];

      if (String(upload.imageType || "") === "ingame" && marker.category === "Schwarzmarkt") {
        score += 10;
        reasons.push("Ingame passt zu Schwarzmarkt");
      }

      if (String(upload.imageType || "") === "map" && marker.category === "Fraktionsgebiet") {
        score += 10;
        reasons.push("Karte passt zu Gebiet");
      }

      if (marker.favorite) {
        score += 6;
        reasons.push("Marker ist Favorit");
      }

      score = Math.max(1, Math.min(99, score - index));

      return {
        matchId: Number(`${upload.uploadId}${index + 1}`),
        uploadId: Number(upload.uploadId),
        markerId: marker.id,
        markerName: marker.name,
        score,
        reason: reasons.join(" • ") || "Basis-Vorschlag",
        rankIndex: index + 1,
        lat: Number(marker.lat),
        lng: Number(marker.lng),
        category: marker.category,
        referenceCount: 0,
        createdAt: new Date().toISOString()
      };
    })
    .sort((a, b) => b.score - a.score || a.markerName.localeCompare(b.markerName, "de"))
    .slice(0, 3);
}

app.use("/ai-uploads", express.static(AI_UPLOADS_DIR));

app.get("/api/image-intelligence/overview", requireAdmin, async (req, res) => {
  try {
    const uploads = readAiUploads();
    const references = readAiReferences();

    const statusBreakdown = {};
    for (const upload of uploads) {
      const status = String(upload.status || "neu");
      statusBreakdown[status] = (statusBreakdown[status] || 0) + 1;
    }

    res.json({
      success: true,
      totalUploads: uploads.length,
      totalReferences: references.length,
      statusBreakdown: Object.entries(statusBreakdown).map(([status, count]) => ({
        status,
        count
      }))
    });
  } catch (error) {
    console.error("Image-Overview Fehler:", error.message);
    res.status(500).json({
      success: false,
      error: "Übersicht konnte nicht geladen werden."
    });
  }
});

app.get("/api/image-intelligence/uploads", requireAdmin, async (req, res) => {
  try {
    const uploads = readAiUploads().map((upload) => ({
      ...upload,
      matches: getUploadMatches(upload)
    }));

    res.json({
      success: true,
      uploads
    });
  } catch (error) {
    console.error("Image-Uploads Fehler:", error.message);
    res.status(500).json({
      success: false,
      error: "Uploads konnten nicht geladen werden."
    });
  }
});

app.get("/api/image-intelligence/references", requireAdmin, async (req, res) => {
  try {
    const imageType = String(req.query.type || "").trim();
    let references = readAiReferences();

    if (imageType) {
      references = references.filter((entry) => String(entry.imageType || "") === imageType);
    }

    res.json({
      success: true,
      references
    });
  } catch (error) {
    console.error("Referenzen Fehler:", error.message);
    res.status(500).json({
      success: false,
      error: "Referenzen konnten nicht geladen werden."
    });
  }
});

app.post("/api/image-intelligence/upload", requireAdmin, (req, res) => {
  upload.single("file")(req, res, async (error) => {
    if (error) {
      return res.status(400).json({
        success: false,
        error: error.message || "Upload fehlgeschlagen."
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: "Keine Datei hochgeladen."
      });
    }

    try {
      const imageType = String(req.body?.imageType || "map").trim() || "map";
      const extension = detectExtensionFromMime(req.file.mimetype || "");
      const baseName = `${Date.now()}-${safeFileNamePart(req.file.originalname, "upload")}${extension}`;
      const relativePath = baseName;
      const fullPath = path.join(AI_UPLOADS_DIR, relativePath);

      fs.writeFileSync(fullPath, req.file.buffer);

      const uploads = readAiUploads();
      const uploadId = Date.now();

      const entry = {
        uploadId,
        imageType,
        status: "neu",
        fileName: req.file.originalname || baseName,
        mimeType: req.file.mimetype || "image/jpeg",
        imagePath: relativePath,
        imageUrl: `/ai-uploads/${relativePath}`,
        uploadedBy: req.user?.username || "Admin",
        uploadedById: req.user?.id || "",
        originalMarkerId: "",
        suggestedMarkerId: "",
        suggestedLat: null,
        suggestedLng: null,
        suggestedScore: 0,
        notes: "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const matches = getUploadMatches(entry);
      const best = matches[0] || null;

      if (best) {
        entry.status = "automatisch erkannt";
        entry.suggestedMarkerId = best.markerId;
        entry.suggestedLat = best.lat;
        entry.suggestedLng = best.lng;
        entry.suggestedScore = best.score;
      }

      uploads.unshift(entry);
      writeAiUploads(uploads);

      res.json({
        success: true,
        upload: entry,
        matches
      });
    } catch (innerError) {
      console.error("Image-Upload Fehler:", innerError.message);
      res.status(500).json({
        success: false,
        error: "Bild konnte nicht verarbeitet werden."
      });
    }
  });
});

app.post("/api/image-intelligence/confirm", requireAdmin, async (req, res) => {
  try {
    const uploadId = Number(req.body?.uploadId);
    const markerId = String(req.body?.markerId || "").trim();
    const lat = Number(req.body?.lat);
    const lng = Number(req.body?.lng);
    const status = String(req.body?.status || "bestätigt").trim() || "bestätigt";
    const notes = String(req.body?.notes || "").trim();

    if (!Number.isFinite(uploadId)) {
      return res.status(400).json({ success: false, error: "Upload-ID fehlt." });
    }

    if (!markerId) {
      return res.status(400).json({ success: false, error: "Marker-ID fehlt." });
    }

    const uploads = readAiUploads();
    const uploadEntry = uploads.find((entry) => Number(entry.uploadId) === uploadId);

    if (!uploadEntry) {
      return res.status(404).json({ success: false, error: "Upload nicht gefunden." });
    }

    const markers = await loadMarkers();
    const marker = markers.find((entry) => entry.id === markerId);

    if (!marker) {
      return res.status(404).json({ success: false, error: "Marker nicht gefunden." });
    }

    const finalLat = Number.isFinite(lat) ? lat : Number(marker.lat);
    const finalLng = Number.isFinite(lng) ? lng : Number(marker.lng);

    uploadEntry.status = status;
    uploadEntry.originalMarkerId = marker.id;
    uploadEntry.suggestedMarkerId = marker.id;
    uploadEntry.suggestedLat = finalLat;
    uploadEntry.suggestedLng = finalLng;
    uploadEntry.suggestedScore = uploadEntry.suggestedScore || 90;
    uploadEntry.notes = notes;
    uploadEntry.updatedAt = new Date().toISOString();
    writeAiUploads(uploads);

    const references = readAiReferences();
    references.unshift({
      referenceId: Date.now(),
      markerId: marker.id,
      markerName: marker.name,
      imageType: uploadEntry.imageType,
      status: "bestätigt",
      fileName: uploadEntry.fileName,
      mimeType: uploadEntry.mimeType,
      imagePath: uploadEntry.imagePath,
      imageUrl: uploadEntry.imageUrl,
      createdFromUploadId: uploadId,
      linkedHistoryId: null,
      createdBy: req.user?.username || "Admin",
      createdById: req.user?.id || "",
      lat: finalLat,
      lng: finalLng,
      notes,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    writeAiReferences(references);

    res.json({ success: true });
  } catch (error) {
    console.error("Image-Confirm Fehler:", error.message);
    res.status(500).json({
      success: false,
      error: "Treffer konnte nicht bestätigt werden."
    });
  }
});

app.post("/api/image-intelligence/reject/:uploadId", requireAdmin, async (req, res) => {
  try {
    const uploadId = Number(req.params.uploadId);
    if (!Number.isFinite(uploadId)) {
      return res.status(400).json({ success: false, error: "Ungültige Upload-ID." });
    }

    const uploads = readAiUploads();
    const uploadEntry = uploads.find((entry) => Number(entry.uploadId) === uploadId);
    if (!uploadEntry) {
      return res.status(404).json({ success: false, error: "Upload nicht gefunden." });
    }

    uploadEntry.status = "abgelehnt";
    uploadEntry.updatedAt = new Date().toISOString();
    writeAiUploads(uploads);

    res.json({ success: true });
  } catch (error) {
    console.error("Image-Reject Fehler:", error.message);
    res.status(500).json({
      success: false,
      error: "Upload konnte nicht abgelehnt werden."
    });
  }
});

app.delete("/api/image-intelligence/references/:referenceId", requireAdmin, async (req, res) => {
  try {
    const referenceId = Number(req.params.referenceId);
    if (!Number.isFinite(referenceId)) {
      return res.status(400).json({ success: false, error: "Ungültige Referenz-ID." });
    }

    const references = readAiReferences().filter(
      (entry) => Number(entry.referenceId) !== referenceId
    );
    writeAiReferences(references);

    res.json({ success: true });
  } catch (error) {
    console.error("Reference-Delete Fehler:", error.message);
    res.status(500).json({
      success: false,
      error: "Referenz konnte nicht gelöscht werden."
    });
  }
});

app.post("/api/devlog/manual", requireAdmin, async (req, res) => {
  try {
    const data = {
      title: req.body?.title || "LSV-Map System-Update live",
      description: req.body?.description || "Es wurde ein neues Update veröffentlicht.",
      area: req.body?.area || "Website",
      branch: req.body?.branch || "main",
      author: req.user?.username || "Admin",
      commit: req.body?.commit || "Manueller Devlog-Post",
      commitId: req.body?.commitId || "-",
      features: Array.isArray(req.body?.features) ? req.body.features : normalizeLines(req.body?.features || ""),
      deployStatus: req.body?.deployStatus || "Erfolgreich",
      imageUrl: req.body?.imageUrl || ""
    };

    await sendProjectUpdate(data);
    res.json({ success: true });
  } catch (error) {
    console.error("Devlog Fehler:", error.message);
    res.status(500).json({
      success: false,
      error: "Devlog konnte nicht gesendet werden."
    });
  }
});

app.post("/api/devlog/github", requireDevlogKey, async (req, res) => {
  try {
    const body = req.body || {};
    const refName = String(body.ref || "").split("/").pop() || "main";

    if (refName !== "main") {
      return res.json({
        success: true,
        skipped: true,
        reason: "Nur main wird gepostet."
      });
    }

    const commits = Array.isArray(body.commits) ? body.commits : [];
    const features = commits
      .map((commit) => String(commit.message || "").trim())
      .filter(Boolean)
      .slice(0, 6);
    const head = commits[commits.length - 1] || {};

    await sendDevlogPost({
      title: "LSV-Map GitHub-Update",
      description: body.head_commit?.message || head.message || "Neue Änderungen wurden auf main gepusht.",
      area: "GitHub",
      branch: refName,
      author: body.pusher?.name || head.author?.name || "Unbekannt",
      commit: body.head_commit?.message || head.message || "Push auf main",
      commitId: String(body.after || "").slice(0, 7) || "-",
      features,
      deployStatus: "Ausstehend",
      url: body.compare || body.repository?.html_url || ""
    });

    res.json({ success: true });
  } catch (error) {
    console.error("GitHub Devlog Fehler:", error.message);
    res.status(500).json({
      success: false,
      error: "GitHub Devlog fehlgeschlagen."
    });
  }
});

app.post("/api/devlog/deploy", requireDevlogKey, async (req, res) => {
  try {
    const body = req.body || {};

    await sendProjectUpdate({
      title: body.title || "LSV-Map Deploy Status",
      description: body.description || "Ein neuer Deploy-Status wurde gemeldet.",
      shortDescription: body.shortDescription || body.description || "Neues Update live.",
      area: body.area || "Deploy",
      branch: body.branch || "main",
      author: body.author || "System",
      commit: body.commit || "Deploy-Update",
      commitId: body.commitId || "-",
      features: Array.isArray(body.features) ? body.features : normalizeLines(body.features || ""),
      deployStatus: body.deployStatus || "Erfolgreich",
      imageUrl: body.imageUrl || ""
    });

    res.json({ success: true });
  } catch (error) {
    console.error("Deploy Devlog Fehler:", error.message);
    res.status(500).json({
      success: false,
      error: "Deploy-Devlog fehlgeschlagen."
    });
  }
});

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: "Route nicht gefunden."
  });
});

async function startServer() {
  try {
    await createTables();
    await seedFromJsonIfDatabaseIsEmpty();
    scheduleAutomaticBackups();

    const host = "0.0.0.0";
    const server = app.listen(PORT, host, () => {
      console.log(`Server läuft auf http://${host}:${PORT}`);
      console.log(`Öffentliche Dateien aus: ${PUBLIC_DIR}`);
      console.log(`Auto-Backups alle ${AUTO_BACKUP_INTERVAL_MINUTES} Minuten aktiv.`);
    });

    server.on("error", (error) => {
      console.error("HTTP Server Fehler:", error);
      process.exit(1);
    });

    server.keepAliveTimeout = 65000;
    server.headersTimeout = 66000;
  } catch (error) {
    console.error("Serverstart fehlgeschlagen:", error.message);
    process.exit(1);
  }
}

startServer();
