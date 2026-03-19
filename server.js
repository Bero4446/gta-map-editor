const { sendDevlogPost, sendMapUpdatesPost, sendProjectUpdate } = require('./bot');
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

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const MARKERS_FILE = path.join(__dirname, "markers.json");
const BACKUP_DIR = path.join(__dirname, "backups");
const AI_UPLOADS_DIR = path.join(__dirname, "ai-uploads");
const AI_DATA_DIR = path.join(__dirname, "ai-data");
const DEVLOG_API_KEY = process.env.DEVLOG_API_KEY || "";
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || "";
const DATABASE_URL = process.env.DATABASE_URL;
const AUTO_BACKUP_INTERVAL_MINUTES = Math.max(15, Number(process.env.AUTO_BACKUP_INTERVAL_MINUTES || 360));
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

if (!fs.existsSync(PUBLIC_DIR)) {
  fs.mkdirSync(PUBLIC_DIR, { recursive: true });
}

if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

if (!fs.existsSync(AI_UPLOADS_DIR)) {
  fs.mkdirSync(AI_UPLOADS_DIR, { recursive: true });
}

if (!fs.existsSync(AI_DATA_DIR)) {
  fs.mkdirSync(AI_DATA_DIR, { recursive: true });
}

if (!DATABASE_URL) {
  console.error("DATABASE_URL fehlt. Bitte in Render die Postgres-Verbindung als Umgebungsvariable setzen.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false
});

pool.on("error", (error) => {
  console.error("Postgres Pool Fehler:", error.message);
});

const liveClients = new Set();

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

passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((obj, done) => {
  done(null, obj);
});

passport.use(
  new DiscordStrategy(
    {
      clientID: process.env.DISCORD_CLIENT_ID,
      clientSecret: process.env.DISCORD_CLIENT_SECRET,
      callbackURL: process.env.DISCORD_REDIRECT_URI,
      scope: ["identify"]
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const guildId = process.env.DISCORD_GUILD_ID;
        const vipRoleId = process.env.DISCORD_VIP_ROLE_ID;
        const adminRoleId = process.env.DISCORD_ADMIN_ROLE_ID;
        const supportRoleId = process.env.DISCORD_SUPPORT_ROLE_ID || process.env.SUPPORT_PING_ROLE_ID || "";
        const mapperRoleId = process.env.DISCORD_MAPPER_ROLE_ID || "";
        const dashboardRoleId = process.env.DISCORD_DASHBOARD_ROLE_ID || "";

        let isVip = false;
        let isAdmin = false;
        let isSupport = false;
        let isMapper = false;
        let canViewDashboard = false;
        let canEdit = false;

        if (guildId && process.env.DISCORD_BOT_TOKEN) {
          const response = await axios.get(
            `https://discord.com/api/guilds/${guildId}/members/${profile.id}`,
            {
              headers: {
                Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`
              }
            }
          );

          const roles = Array.isArray(response.data.roles) ? response.data.roles : [];

          if (vipRoleId) isVip = roles.includes(vipRoleId);
          if (adminRoleId) isAdmin = roles.includes(adminRoleId);
          if (supportRoleId) isSupport = roles.includes(supportRoleId);
          if (mapperRoleId) isMapper = roles.includes(mapperRoleId);
          if (dashboardRoleId) canViewDashboard = roles.includes(dashboardRoleId);
        }

        canEdit = isAdmin || isMapper;
        canViewDashboard = isAdmin || isSupport || canViewDashboard;

        profile.isVip = isVip;
        profile.isAdmin = isAdmin;
        profile.isSupport = isSupport;
        profile.isMapper = isMapper;
        profile.canEdit = canEdit;
        profile.canViewDashboard = canViewDashboard;
        profile.roleNames = [
          isAdmin ? "Admin" : "",
          isSupport ? "Support" : "",
          isMapper ? "Mapper" : "",
          isVip ? "VIP" : "",
          canViewDashboard && !isAdmin && !isSupport ? "Dashboard" : ""
        ].filter(Boolean);

        return done(null, profile);
      } catch (error) {
        console.error("Discord Rollenfehler:", error.response?.data || error.message);
        profile.isVip = false;
        profile.isAdmin = false;
        profile.isSupport = false;
        profile.isMapper = false;
        profile.canEdit = false;
        profile.canViewDashboard = false;
        profile.roleNames = [];
        return done(null, profile);
      }
    }
  )
);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith("image/")) {
      return cb(null, true);
    }

    cb(new Error("Nur Bilddateien sind erlaubt."));
  }
});

function normalizeMarker(marker) {
  if (!marker || typeof marker !== "object") return null;

  let lat = marker.lat;
  let lng = marker.lng;

  if ((lat === undefined || lng === undefined) && marker.pos) {
    if (Array.isArray(marker.pos) && marker.pos.length >= 2) {
      lat = Number(marker.pos[0]);
      lng = Number(marker.pos[1]);
    } else if (
      typeof marker.pos === "object" &&
      marker.pos !== null &&
      typeof marker.pos.lat !== "undefined" &&
      typeof marker.pos.lng !== "undefined"
    ) {
      lat = Number(marker.pos.lat);
      lng = Number(marker.pos.lng);
    }
  }

  lat = Number(lat);
  lng = Number(lng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const category = String(marker.category || "Dealer");
  const safeCategory = ALLOWED_CATEGORIES.includes(category) ? category : "Dealer";
  const rawRadius = Number(marker.radius || marker.zoneRadius || 0);
  const radius = safeCategory === "Fraktionsgebiet"
    ? (Number.isFinite(rawRadius) && rawRadius > 0 ? Math.max(50, Math.round(rawRadius)) : 200)
    : 0;

  return {
    id: String(marker.id || crypto.randomUUID()),
    name: String(marker.name || "Unbenannter Marker").trim(),
    description: String(marker.description || "").trim(),
    category: safeCategory,
    lat,
    lng,
    radius,
    image: typeof marker.image === "string" ? marker.image : "",
    owner: String(marker.owner || marker.assignee || "").trim(),
    favorite: !!marker.favorite,
    createdBy: String(marker.createdBy || marker.created_by || "").trim(),
    updatedBy: String(marker.updatedBy || marker.updated_by || "").trim(),
    createdAt: marker.createdAt || marker.created_at || null,
    updatedAt: marker.updatedAt || marker.updated_at || null
  };
}

function rowToMarker(row) {
  return {
    id: String(row.id),
    name: String(row.name || "Unbenannter Marker"),
    description: String(row.description || ""),
    category: String(row.category || "Dealer"),
    lat: Number(row.lat),
    lng: Number(row.lng),
    radius: Number(row.radius || 0),
    image: typeof row.image === "string" ? row.image : "",
    owner: String(row.owner || ""),
    favorite: !!row.favorite,
    createdBy: String(row.created_by || ""),
    updatedBy: String(row.updated_by || ""),
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null
  };
}

function filterMarkersForUser(markers, user) {
  const canSeeBlackMarket = !!user && (user.isVip || user.isAdmin);
  return markers.filter((marker) => canSeeBlackMarket || marker.category !== "Schwarzmarkt");
}

function markerSummary(marker) {
  const territory = marker.category === "Fraktionsgebiet" ? ` | Radius ${Number(marker.radius || 200)}m` : "";
  return `${marker.name} [${marker.category}] @ ${Number(marker.lat).toFixed(2)}, ${Number(marker.lng).toFixed(2)}${territory}`;
}

function formatValue(value) {
  if (value === null || typeof value === "undefined" || value === "") return "—";
  if (typeof value === "boolean") return value ? "Ja" : "Nein";
  if (typeof value === "number") return Number(value).toFixed(2);
  return String(value);
}

function buildMarkerChanges(oldMarker, newMarker) {
  const changes = [];

  const fields = [
    { key: "name", label: "Name" },
    { key: "description", label: "Beschreibung" },
    { key: "category", label: "Kategorie" },
    { key: "owner", label: "Besitzer/Zuständigkeit" },
    { key: "favorite", label: "Favorit" },
    { key: "image", label: "Screenshot" },
    { key: "radius", label: "Gebietsradius" }
  ];

  for (const field of fields) {
    const before = oldMarker?.[field.key];
    const after = newMarker?.[field.key];

    if ((before || "") !== (after || "")) {
      if (field.key === "favorite") {
        if (!!before !== !!after) {
          changes.push({
            field: field.key,
            label: field.label,
            before: !!before,
            after: !!after
          });
        }
      } else {
        changes.push({
          field: field.key,
          label: field.label,
          before: before ?? "",
          after: after ?? ""
        });
      }
    }
  }

  if (!oldMarker || Number(oldMarker.lat) !== Number(newMarker.lat) || Number(oldMarker.lng) !== Number(newMarker.lng)) {
    changes.push({
      field: "coords",
      label: "Koordinaten",
      before: oldMarker ? `${Number(oldMarker.lat).toFixed(2)}, ${Number(oldMarker.lng).toFixed(2)}` : "—",
      after: `${Number(newMarker.lat).toFixed(2)}, ${Number(newMarker.lng).toFixed(2)}`
    });
  }

  return changes;
}

function buildHistorySummary(action, marker, changes) {
  if (action === "created") {
    return `Marker erstellt: ${markerSummary(marker)}`;
  }

  if (action === "deleted") {
    return `Marker gelöscht: ${markerSummary(marker)}`;
  }

  if (action === "imported") {
    return `Marker per Import übernommen: ${markerSummary(marker)}`;
  }

  if (action === "restored") {
    return `Marker wiederhergestellt: ${markerSummary(marker)}`;
  }

  if (!changes.length) {
    return `Marker aktualisiert: ${markerSummary(marker)}`;
  }

  return `Marker geändert: ${changes.map((change) => `${change.label}: ${formatValue(change.before)} → ${formatValue(change.after)}`).join(" | ")}`;
}

function buildDiscordLog(action, marker, adminName, changes) {
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
    await axios.post(DISCORD_WEBHOOK_URL, { content });
  } catch (error) {
    console.error("Discord Webhook Fehler:", error.response?.data || error.message);
  }
}

function loadMarkersFromJson() {
  try {
    if (!fs.existsSync(MARKERS_FILE)) {
      return [];
    }

    const raw = fs.readFileSync(MARKERS_FILE, "utf8");
    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.map(normalizeMarker).filter(Boolean);
  } catch (error) {
    console.error("Fehler beim Laden von markers.json:", error.message);
    return [];
  }
}

async function createTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS markers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL,
      lat DOUBLE PRECISION NOT NULL,
      lng DOUBLE PRECISION NOT NULL,
      radius INTEGER NOT NULL DEFAULT 0,
      image TEXT NOT NULL DEFAULT '',
      owner TEXT NOT NULL DEFAULT '',
      favorite BOOLEAN NOT NULL DEFAULT FALSE,
      created_by TEXT NOT NULL DEFAULT '',
      updated_by TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`ALTER TABLE markers ADD COLUMN IF NOT EXISTS radius INTEGER NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE markers ADD COLUMN IF NOT EXISTS owner TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE markers ADD COLUMN IF NOT EXISTS favorite BOOLEAN NOT NULL DEFAULT FALSE`);
  await pool.query(`ALTER TABLE markers ADD COLUMN IF NOT EXISTS created_by TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE markers ADD COLUMN IF NOT EXISTS updated_by TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE markers ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
  await pool.query(`ALTER TABLE markers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_markers_category ON markers(category)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_markers_favorite ON markers(favorite)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_markers_owner ON markers(owner)`);

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

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_marker_history_marker_id ON marker_history(marker_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_marker_history_created_at ON marker_history(created_at DESC)`);
}

async function getMarkerCount() {
  const result = await pool.query(`SELECT COUNT(*)::int AS count FROM markers`);
  return Number(result.rows[0]?.count || 0);
}

async function loadMarkers(client = pool) {
  const result = await client.query(`
    SELECT id, name, description, category, lat, lng, radius, image, owner, favorite, created_by, updated_by, created_at, updated_at
    FROM markers
    ORDER BY favorite DESC, updated_at DESC, id ASC
  `);

  return result.rows.map(rowToMarker);
}

async function insertMarker(client, marker) {
  await client.query(
    `
      INSERT INTO markers (
        id, name, description, category, lat, lng, radius, image, owner, favorite,
        created_by, updated_by, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, COALESCE($13::timestamptz, NOW()), COALESCE($14::timestamptz, NOW()))
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
      marker.createdAt || null,
      marker.updatedAt || null
    ]
  );
}async function upsertMarker(client, marker) {
  await client.query(
    `
      INSERT INTO markers (
        id, name, description, category, lat, lng, radius, image, owner, favorite,
        created_by, updated_by, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, COALESCE($13::timestamptz, NOW()), COALESCE($14::timestamptz, NOW()))
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        lat = EXCLUDED.lat,
        lng = EXCLUDED.lng,
        radius = EXCLUDED.radius,
        image = EXCLUDED.image,
        owner = EXCLUDED.owner,
        favorite = EXCLUDED.favorite,
        created_by = EXCLUDED.created_by,
        updated_by = EXCLUDED.updated_by,
        created_at = EXCLUDED.created_at,
        updated_at = EXCLUDED.updated_at
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
      marker.createdAt || null,
      marker.updatedAt || null
    ]
  );
}

async function insertHistory(client, { markerId, action, adminName, adminId, markerName, changeSummary, changes, snapshot }) {
  await client.query(
    `
      INSERT INTO marker_history (
        marker_id, action, admin_name, admin_id, marker_name,
        change_summary, changes_json, snapshot_json, created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
    `,
    [
      markerId,
      action,
      adminName || "",
      adminId || "",
      markerName || "",
      changeSummary || "",
      JSON.stringify(changes || []),
      JSON.stringify(snapshot || {}),
    ]
  );
}

async function seedFromJsonIfDatabaseIsEmpty() {
  const count = await getMarkerCount();

  if (count > 0) {
    return;
  }

  const markersFromJson = loadMarkersFromJson();

  if (markersFromJson.length === 0) {
    console.log("Keine Startdaten aus markers.json gefunden.");
    return;
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    for (const marker of markersFromJson) {
      const preparedMarker = {
        ...marker,
        owner: marker.owner || "",
        radius: marker.radius || 0,
        favorite: !!marker.favorite,
        createdBy: marker.createdBy || "Import",
        updatedBy: marker.updatedBy || "Import",
        createdAt: marker.createdAt || new Date().toISOString(),
        updatedAt: marker.updatedAt || new Date().toISOString()
      };

      await insertMarker(client, preparedMarker);
      await insertHistory(client, {
        markerId: preparedMarker.id,
        action: "imported",
        adminName: "System",
        adminId: "",
        markerName: preparedMarker.name,
        changeSummary: buildHistorySummary("imported", preparedMarker, []),
        changes: [],
        snapshot: preparedMarker
      });
    }

    await client.query("COMMIT");
    console.log(`${markersFromJson.length} Marker aus markers.json in Postgres importiert.`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}


function getSafeBackupFilename(filename) {
  return path.basename(String(filename || "")).replace(/[^a-zA-Z0-9._-]/g, "");
}

function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR)
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
  const message = `event: ${type}\ndata: ${JSON.stringify({ type, timestamp: new Date().toISOString(), ...payload })}\n\n`;
  for (const client of liveClients) {
    client.write(message);
  }
}

async function createBackupFile(reason = "manual", actor = "System", markersInput = null) {
  const markers = Array.isArray(markersInput) ? markersInput : await loadMarkers();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `backup-${timestamp}-${String(reason).replace(/[^a-zA-Z0-9_-]/g, "")}.json`;
  const backupPayload = {
    meta: {
      reason,
      actor,
      createdAt: new Date().toISOString(),
      markerCount: markers.length
    },
    markers
  };

  fs.writeFileSync(path.join(BACKUP_DIR, filename), JSON.stringify(backupPayload, null, 2), "utf8");
  broadcastLiveEvent("backup-created", { reason, actor, filename, markerCount: markers.length });
  return { filename, markerCount: markers.length };
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

async function getDashboardData() {
  const allMarkers = await loadMarkers();
  const historyResult = await pool.query(
    `
      SELECT history_id, marker_id, action, admin_name, marker_name, change_summary, created_at
      FROM marker_history
      ORDER BY created_at DESC, history_id DESC
      LIMIT 8
    `
  );

  const categoryCounts = {};
  for (const marker of allMarkers) {
    categoryCounts[marker.category] = (categoryCounts[marker.category] || 0) + 1;
  }

  const ownerCounts = {};
  for (const marker of allMarkers) {
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
    recentChanges: historyResult.rows.map((row) => ({
      historyId: Number(row.history_id),
      markerId: String(row.marker_id),
      action: String(row.action),
      adminName: String(row.admin_name || ""),
      markerName: String(row.marker_name || ""),
      changeSummary: String(row.change_summary || ""),
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : null
    })),
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

app.get("/auth/discord", passport.authenticate("discord"));

app.get("/auth/discord/callback", (req, res, next) => {
  passport.authenticate("discord", (err, user, info) => {
    console.log("DISCORD CALLBACK QUERY:", req.query);
    console.log("DISCORD CALLBACK ERR:", err);
    console.log("DISCORD CALLBACK INFO:", info);

    if (err) {
      console.error("OAuth Fehler:", err);
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

  res.json({
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

app.get("/api/health", async (req, res) => {
  try {
    const markerCount = await getMarkerCount();

    res.json({
      ok: true,
      markerCount
    });
  } catch (error) {
    console.error("Health Fehler:", error.message);
    res.status(500).json({ ok: false, error: "Datenbankfehler" });
  }
});

app.get("/api/stream", (req, res) => {
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

app.get("/api/admin-dashboard", requireDashboard, async (req, res) => {
  try {
    res.json({ success: true, ...(await getDashboardData()) });
  } catch (error) {
    console.error("Dashboard Fehler:", error.message);
    res.status(500).json({ success: false, error: "Dashboard konnte nicht geladen werden." });
  }
});

app.get("/api/backups", requireDashboard, async (req, res) => {
  try {
    res.json({ success: true, backups: listBackups() });
  } catch (error) {
    console.error("Backup-Liste Fehler:", error.message);
    res.status(500).json({ success: false, error: "Backups konnten nicht geladen werden." });
  }
});

app.get("/api/backups/:filename", requireAdmin, async (req, res) => {
  try {
    const file = getSafeBackupFilename(req.params.filename);
    if (!file) {
      return res.status(400).json({ success: false, error: "Dateiname fehlt." });
    }
    const fullPath = path.join(BACKUP_DIR, file);
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ success: false, error: "Backup nicht gefunden." });
    }
    res.download(fullPath);
  } catch (error) {
    console.error("Backup-Download Fehler:", error.message);
    res.status(500).json({ success: false, error: "Backup konnte nicht geladen werden." });
  }
});

app.post("/api/backups/create", requireAdmin, async (req, res) => {
  try {
    const markers = await loadMarkers();
    const backup = await createBackupFile("manual", req.user?.username || "Admin", markers);
    res.json({ success: true, backup });
  } catch (error) {
    console.error("Manuelles Backup fehlgeschlagen:", error.message);
    res.status(500).json({ success: false, error: "Backup konnte nicht erstellt werden." });
  }
});

app.get("/markers", async (req, res) => {
  try {
    const markers = await loadMarkers();
    res.json(filterMarkersForUser(markers, req.user));
  } catch (error) {
    console.error("Fehler beim Laden der Marker:", error.message);
    res.status(500).json({ success: false, error: "Marker konnten nicht geladen werden." });
  }
});

app.post("/markers", requireEditor, async (req, res) => {
  const incoming = Array.isArray(req.body.markers) ? req.body.markers : [];
  const normalizedIncoming = incoming.map(normalizeMarker).filter(Boolean);
  const adminName = req.user?.username || "Unbekannt";
  const adminId = req.user?.id || "";
  const client = await pool.connect();

  try {
    const oldMarkers = await loadMarkers(client);
    const oldMap = new Map(oldMarkers.map((marker) => [marker.id, marker]));
    const shouldBackup = oldMarkers.length > 0;

    const finalMarkers = normalizedIncoming.map((marker) => {
      const oldMarker = oldMap.get(marker.id);
      const nowIso = new Date().toISOString();

      if (oldMarker) {
        return {
          ...oldMarker,
          ...marker,
          owner: marker.owner || oldMarker.owner || "",
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

    const newMap = new Map(finalMarkers.map((marker) => [marker.id, marker]));
    const added = finalMarkers.filter((marker) => !oldMap.has(marker.id));
    const removed = oldMarkers.filter((marker) => !newMap.has(marker.id));
    const changed = finalMarkers
      .map((marker) => {
        const oldMarker = oldMap.get(marker.id);
        if (!oldMarker) return null;
        const changes = buildMarkerChanges(oldMarker, marker);
        if (!changes.length) return null;
        return { marker, oldMarker, changes };
      })
      .filter(Boolean);

    if (shouldBackup) {
      await createBackupFile("before-save", adminName, oldMarkers);
    }

    await client.query("BEGIN");
    await client.query("DELETE FROM markers");

    for (const marker of finalMarkers) {
      await insertMarker(client, marker);
    }

    for (const marker of added) {
      const summary = buildHistorySummary("created", marker, []);
      await insertHistory(client, {
        markerId: marker.id,
        action: "created",
        adminName,
        adminId,
        markerName: marker.name,
        changeSummary: summary,
      });
    }    for (const entry of changed) {
      const summary = buildHistorySummary("updated", entry.marker, entry.changes);
      await insertHistory(client, {
        markerId: entry.marker.id,
        action: "updated",
        adminName,
        adminId,
        markerName: entry.marker.name,
        changeSummary: summary,
        changes: entry.changes,
        snapshot: entry.marker
      });
    }

    for (const marker of removed) {
      const summary = buildHistorySummary("deleted", marker, []);
      await insertHistory(client, {
        markerId: marker.id,
        action: "deleted",
        adminName,
        adminId,
        markerName: marker.name,
        changeSummary: summary,
        changes: [],
        snapshot: marker
      });
    }

    await client.query("COMMIT");

    for (const marker of added) {
      await sendDiscordLog(buildDiscordLog("created", marker, adminName, []));
    }

    for (const entry of changed) {
      await sendDiscordLog(buildDiscordLog("updated", entry.marker, adminName, entry.changes));
    }

    for (const marker of removed) {
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
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("Rollback Fehler:", rollbackError.message);
    }

    console.error("Fehler beim Speichern der Marker:", error.message);
    res.status(500).json({
      success: false,
      error: "Marker konnten nicht gespeichert werden."
    });
  } finally {
    client.release();
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
    : Array.isArray(req.body.markers)
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
      createdAt: marker.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }));

  if (cleanMarkers.length === 0 && incoming.length > 0) {
    return res.status(400).json({
      success: false,
      error: "Es konnten keine gültigen Marker importiert werden."
    });
  }

  const client = await pool.connect();

  try {
    const oldMarkers = await loadMarkers(client);
    if (oldMarkers.length > 0) {
      await createBackupFile("before-import", adminName, oldMarkers);
    }

    await client.query("BEGIN");
    await client.query("DELETE FROM markers");

    for (const marker of cleanMarkers) {
      await insertMarker(client, marker);
      await insertHistory(client, {
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

    await client.query("COMMIT");

    await sendDiscordLog(`📥 **${adminName}** hat einen Marker-Import ausgeführt. Importierte Marker: **${cleanMarkers.length}**`);

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
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("Rollback Fehler:", rollbackError.message);
    }

    console.error("Fehler beim Importieren der Marker:", error.message);
    res.status(500).json({
      success: false,
      error: "Marker konnten nicht importiert werden."
    });
  } finally {
    client.release();
  }
});

app.get("/api/marker-history/:markerId", requireAdmin, async (req, res) => {
  try {
    const markerId = String(req.params.markerId || "").trim();

    if (!markerId) {
      return res.status(400).json({ success: false, error: "Marker-ID fehlt." });
    }

    const result = await pool.query(
      `
        SELECT history_id, marker_id, action, admin_name, admin_id, marker_name,
               change_summary, changes_json, snapshot_json, created_at
        FROM marker_history
        WHERE marker_id = $1
        ORDER BY created_at DESC, history_id DESC
        LIMIT 50
      `,
      [markerId]
    );

    const history = result.rows.map((row) => ({
      historyId: Number(row.history_id),
      markerId: String(row.marker_id),
      action: String(row.action),
      adminName: String(row.admin_name || ""),
      adminId: String(row.admin_id || ""),
      markerName: String(row.marker_name || ""),
      changeSummary: String(row.change_summary || ""),
      changes: JSON.parse(row.changes_json || "[]"),
      snapshot: JSON.parse(row.snapshot_json || "{}"),
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : null
    }));

    res.json({ success: true, history });
  } catch (error) {
    console.error("Fehler beim Laden der Marker-Historie:", error.message);
    res.status(500).json({ success: false, error: "Historie konnte nicht geladen werden." });
  }
});

app.post("/api/marker-history-entry/:historyId/restore", requireAdmin, async (req, res) => {
  const historyId = Number(req.params.historyId);
  if (!Number.isFinite(historyId)) {
    return res.status(400).json({ success: false, error: "Ungültige Historien-ID." });
  }

  const adminName = req.user?.username || "Unbekannt";
  const adminId = req.user?.id || "";
  const client = await pool.connect();

  try {
    const entryResult = await client.query(
      `
        SELECT history_id, marker_id, marker_name, snapshot_json
        FROM marker_history
        WHERE history_id = $1
        LIMIT 1
      `,
      [historyId]
    );

    if (!entryResult.rowCount) {
      return res.status(404).json({ success: false, error: "Historieneintrag nicht gefunden." });
    }

    const entry = entryResult.rows[0];
    const snapshot = normalizeMarker(JSON.parse(entry.snapshot_json || "{}"));

    if (!snapshot) {
      return res.status(400).json({ success: false, error: "Snapshot konnte nicht gelesen werden." });
    }

    const currentMarkersBeforeRestore = await loadMarkers(client);
    if (currentMarkersBeforeRestore.length > 0) {
      await createBackupFile("before-restore", adminName, currentMarkersBeforeRestore);
    }

    const currentResult = await client.query(
      `
        SELECT id, name, description, category, lat, lng, radius, image, owner, favorite, created_by, updated_by, created_at, updated_at
        FROM markers
        WHERE id = $1
        LIMIT 1
      `,
      [snapshot.id]
    );

    const oldMarker = currentResult.rowCount ? rowToMarker(currentResult.rows[0]) : null;
    const nowIso = new Date().toISOString();
    const restoredMarker = {
      ...snapshot,
      owner: snapshot.owner || oldMarker?.owner || adminName,
      radius: snapshot.radius || 0,
      createdBy: snapshot.createdBy || oldMarker?.createdBy || adminName,
      updatedBy: adminName,
      createdAt: snapshot.createdAt || oldMarker?.createdAt || nowIso,
      updatedAt: nowIso
    };

    const changes = buildMarkerChanges(oldMarker, restoredMarker);

    await client.query("BEGIN");
    await upsertMarker(client, restoredMarker);
    await insertHistory(client, {
      markerId: restoredMarker.id,
      action: "restored",
      adminName,
      adminId,
      markerName: restoredMarker.name,
      changeSummary: buildHistorySummary("restored", restoredMarker, changes),
      changes,
      snapshot: restoredMarker
    });
    await client.query("COMMIT");

    await sendDiscordLog(buildDiscordLog("restored", restoredMarker, adminName, changes));

    broadcastLiveEvent("markers-updated", {
      actor: adminName,
      markerCount: (await loadMarkers()).length,
      restoredMarkerId: restoredMarker.id
    });

    res.json({
      success: true,
      marker: restoredMarker,
      message: `${entry.marker_name || restoredMarker.name} wurde wiederhergestellt.`
    });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("Rollback Fehler:", rollbackError.message);
    }
    console.error("Fehler beim Wiederherstellen:", error.message);
    res.status(500).json({ success: false, error: "Version konnte nicht wiederhergestellt werden." });
  } finally {
    client.release();
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

function requireDevlogKey(req, res, next) {
  if (!DEVLOG_API_KEY) return next();

  const incomingKey = String(req.headers["x-devlog-key"] || req.body?.key || "").trim();
  if (!incomingKey || incomingKey !== DEVLOG_API_KEY) {
    return res.status(401).json({ success: false, error: "Ungültiger Devlog-Key." });
  }

  next();
}

function safeFileNamePart(value, fallback = "upload") {
  return String(value || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || fallback;
}

function detectExtensionFromMime(mime = "") {
  if (mime.includes("png")) return ".png";
  if (mime.includes("webp")) return ".webp";
  if (mime.includes("gif")) return ".gif";
  return ".jpg";
}

async function ensureAiTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS image_detection_uploads (
      upload_id BIGSERIAL PRIMARY KEY,
      image_type TEXT NOT NULL DEFAULT 'map',
      status TEXT NOT NULL DEFAULT 'neu',
      file_name TEXT NOT NULL DEFAULT '',
      mime_type TEXT NOT NULL DEFAULT '',
      image_path TEXT NOT NULL DEFAULT '',
      image_url TEXT NOT NULL DEFAULT '',
      uploaded_by TEXT NOT NULL DEFAULT '',
      uploaded_by_id TEXT NOT NULL DEFAULT '',
      original_marker_id TEXT NOT NULL DEFAULT '',
      suggested_marker_id TEXT NOT NULL DEFAULT '',
      suggested_lat DOUBLE PRECISION,
      suggested_lng DOUBLE PRECISION,
      suggested_score DOUBLE PRECISION NOT NULL DEFAULT 0,
      notes TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS image_detection_matches (
      match_id BIGSERIAL PRIMARY KEY,
      upload_id BIGINT NOT NULL REFERENCES image_detection_uploads(upload_id) ON DELETE CASCADE,
      marker_id TEXT NOT NULL DEFAULT '',
      marker_name TEXT NOT NULL DEFAULT '',
      score DOUBLE PRECISION NOT NULL DEFAULT 0,
      reason TEXT NOT NULL DEFAULT '',
      rank_index INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS image_detection_references (
      reference_id BIGSERIAL PRIMARY KEY,
      marker_id TEXT NOT NULL DEFAULT '',
      marker_name TEXT NOT NULL DEFAULT '',
      image_type TEXT NOT NULL DEFAULT 'map',
      status TEXT NOT NULL DEFAULT 'bestätigt',
      file_name TEXT NOT NULL DEFAULT '',
      mime_type TEXT NOT NULL DEFAULT '',
      image_path TEXT NOT NULL DEFAULT '',
      image_url TEXT NOT NULL DEFAULT '',
      created_from_upload_id BIGINT,
      linked_history_id BIGINT,
      created_by TEXT NOT NULL DEFAULT '',
      created_by_id TEXT NOT NULL DEFAULT '',
      lat DOUBLE PRECISION,
      lng DOUBLE PRECISION,
      notes TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_image_detection_uploads_created_at ON image_detection_uploads(created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_image_detection_uploads_status ON image_detection_uploads(status)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_image_detection_references_marker_id ON image_detection_references(marker_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_image_detection_references_image_type ON image_detection_references(image_type)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_image_detection_matches_upload_id ON image_detection_matches(upload_id)`);
}

function buildAiImageUrl(relativePath) {
  return relativePath ? `/ai-uploads/${relativePath}` : "";
}

function scoreReferenceCandidate({ uploadType, marker, reference, index }) {
  let score = 42;
  const reasons = [];

  if (String(reference.image_type || "") === String(uploadType || "")) {
    score += 18;
    reasons.push("Bildtyp passt");
  }

  if (reference.marker_id && marker.id === reference.marker_id) {
    score += 20;
    reasons.push("gleicher Marker wie vorhandene Referenz");
  }

  if (marker.favorite) {
    score += 6;
    reasons.push("Marker ist Favorit");
  }

  if (marker.category === "Schwarzmarkt" && uploadType === "ingame") {
    score += 8;
    reasons.push("Ingame-Bild passt gut zu Schwarzmarkt-Suche");
  }

  if (marker.category === "Fraktionsgebiet" && uploadType === "map") {
    score += 10;
    reasons.push("Kartenbild passt gut zu Gebietserkennung");
  }

  score = Math.max(1, Math.min(99, score - index * 4));
  return { score, reason: reasons.join(" • ") || "Basis-Vorschlag" };
}

async function buildDetectionMatches(uploadId, uploadType) {
  const markers = await loadMarkers();
  const referenceResult = await pool.query(
    `
      SELECT reference_id, marker_id, marker_name, image_type, status, file_name, image_path, image_url, lat, lng, created_at
      FROM image_detection_references
      WHERE status <> 'abgelehnt'
      ORDER BY updated_at DESC, reference_id DESC
      LIMIT 500
    `
  );

  const references = referenceResult.rows;
  const ranked = [];  for (const [index, marker] of markers.entries()) {
    const markerRefs = references.filter((ref) => ref.marker_id === marker.id);
    const reference = markerRefs[0] || { image_type: uploadType, marker_id: marker.id };
    const { score, reason } = scoreReferenceCandidate({ uploadType, marker, reference, index });
    ranked.push({
      markerId: marker.id,
      markerName: marker.name,
      lat: Number(marker.lat),
      lng: Number(marker.lng),
      score,
      reason,
      category: marker.category,
      referenceCount: markerRefs.length
    });
  }

  ranked.sort((a, b) => b.score - a.score || a.markerName.localeCompare(b.markerName, 'de'));
  const top = ranked.slice(0, 3);

  await pool.query(`DELETE FROM image_detection_matches WHERE upload_id = $1`, [uploadId]);

  for (const [rankIndex, match] of top.entries()) {
    await pool.query(
      `
        INSERT INTO image_detection_matches (upload_id, marker_id, marker_name, score, reason, rank_index)
        VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [uploadId, match.markerId, match.markerName, match.score, match.reason, rankIndex + 1]
    );
  }

  return top;
}

async function getUploadMatches(uploadId) {
  const result = await pool.query(
    `
      SELECT match_id, upload_id, marker_id, marker_name, score, reason, rank_index, created_at
      FROM image_detection_matches
      WHERE upload_id = $1
      ORDER BY rank_index ASC, score DESC
    `,
    [uploadId]
  );

  return result.rows.map((row) => ({
    matchId: Number(row.match_id),
    uploadId: Number(row.upload_id),
    markerId: String(row.marker_id || ""),
    markerName: String(row.marker_name || ""),
    score: Number(row.score || 0),
    reason: String(row.reason || ""),
    rankIndex: Number(row.rank_index || 0),
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null
  }));
}

async function getDetectionUploadById(uploadId) {
  const result = await pool.query(
    `
      SELECT upload_id, image_type, status, file_name, mime_type, image_path, image_url, uploaded_by, uploaded_by_id,
             original_marker_id, suggested_marker_id, suggested_lat, suggested_lng, suggested_score, notes, created_at, updated_at
      FROM image_detection_uploads
      WHERE upload_id = $1
      LIMIT 1
    `,
    [uploadId]
  );

  if (!result.rowCount) return null;
  const row = result.rows[0];
  return {
    uploadId: Number(row.upload_id),
    imageType: String(row.image_type || "map"),
    status: String(row.status || "neu"),
    fileName: String(row.file_name || ""),
    mimeType: String(row.mime_type || ""),
    imagePath: String(row.image_path || ""),
    imageUrl: String(row.image_url || ""),
    uploadedBy: String(row.uploaded_by || ""),
    uploadedById: String(row.uploaded_by_id || ""),
    originalMarkerId: String(row.original_marker_id || ""),
    suggestedMarkerId: String(row.suggested_marker_id || ""),
    suggestedLat: row.suggested_lat === null ? null : Number(row.suggested_lat),
    suggestedLng: row.suggested_lng === null ? null : Number(row.suggested_lng),
    suggestedScore: Number(row.suggested_score || 0),
    notes: String(row.notes || ""),
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null
  };
}

app.use('/ai-uploads', express.static(AI_UPLOADS_DIR));

app.post('/api/devlog/manual', requireAdmin, async (req, res) => {
  try {
    const data = {
      title: req.body?.title || 'LSV-Map System-Update live',
      description: req.body?.description || 'Es wurde ein neues Update veröffentlicht.',
      area: req.body?.area || 'Website',
      branch: req.body?.branch || 'main',
      author: req.user?.username || 'Admin',
      commit: req.body?.commit || 'Manueller Devlog-Post',
      commitId: req.body?.commitId || '-',
      features: Array.isArray(req.body?.features) ? req.body.features : normalizeLines(req.body?.features || ''),
      deployStatus: req.body?.deployStatus || 'Erfolgreich',
      imageUrl: req.body?.imageUrl || ''
    };

    await sendProjectUpdate(data);
    res.json({ success: true });
  } catch (error) {
    console.error('Devlog Fehler:', error.message);
    res.status(500).json({ success: false, error: 'Devlog konnte nicht gesendet werden.' });
  }
});

app.post('/api/devlog/github', requireDevlogKey, async (req, res) => {
  try {
    const body = req.body || {};
    const refName = String(body.ref || '').split('/').pop() || 'main';

    if (refName !== 'main') {
      return res.json({ success: true, skipped: true, reason: 'Nur main wird gepostet.' });
    }

    const commits = Array.isArray(body.commits) ? body.commits : [];
    const features = commits.map((commit) => String(commit.message || '').trim()).filter(Boolean).slice(0, 6);
    const head = commits[commits.length - 1] || {};

    await sendDevlogPost({
      title: 'LSV-Map GitHub-Update',
      description: body.head_commit?.message || head.message || 'Neue Änderungen wurden auf main gepusht.',
      area: 'GitHub',
      branch: refName,
      author: body.pusher?.name || head.author?.name || 'Unbekannt',
      commit: body.head_commit?.message || head.message || 'Push auf main',
      commitId: String(body.after || '').slice(0, 7) || '-',
      features,
      deployStatus: 'Ausstehend',
      url: body.compare || body.repository?.html_url || ''
    });

    res.json({ success: true });
  } catch (error) {
    console.error('GitHub Devlog Fehler:', error.message);
    res.status(500).json({ success: false, error: 'GitHub Devlog fehlgeschlagen.' });
  }
});

app.post('/api/devlog/deploy', requireDevlogKey, async (req, res) => {
  try {
    const body = req.body || {};

    await sendProjectUpdate({
      title: body.title || 'LSV-Map Deploy Status',
      description: body.description || 'Ein neuer Deploy-Status wurde gemeldet.',
      shortDescription: body.shortDescription || body.description || 'Neues Update live.',
      area: body.area || 'Deploy',
      branch: body.branch || 'main',
      author: body.author || 'System',
      commit: body.commit || 'Deploy-Update',
      commitId: body.commitId || '-',
      features: Array.isArray(body.features) ? body.features : normalizeLines(body.features || ''),
      deployStatus: body.deployStatus || 'Erfolgreich',
      imageUrl: body.imageUrl || ''
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Deploy Devlog Fehler:', error.message);
    res.status(500).json({ success: false, error: 'Deploy-Devlog fehlgeschlagen.' });
  }
});

app.get('/api/image-intelligence/overview', requireAdmin, async (req, res) => {
  try {
    const [uploadsResult, referencesResult] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS count FROM image_detection_uploads`),
      pool.query(`SELECT COUNT(*)::int AS count FROM image_detection_references`)
    ]);

    const statusResult = await pool.query(`
      SELECT status, COUNT(*)::int AS count
      FROM image_detection_uploads
      GROUP BY status
      ORDER BY status ASC
    `);

    res.json({
      success: true,
      totalUploads: Number(uploadsResult.rows[0]?.count || 0),
      totalReferences: Number(referencesResult.rows[0]?.count || 0),
      statusBreakdown: statusResult.rows.map((row) => ({ status: row.status, count: Number(row.count || 0) }))
    });
  } catch (error) {
    console.error('Image-Overview Fehler:', error.message);
    res.status(500).json({ success: false, error: 'Übersicht konnte nicht geladen werden.' });
  }
});

app.get('/api/image-intelligence/uploads', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT upload_id, image_type, status, file_name, mime_type, image_path, image_url, uploaded_by, uploaded_by_id,
             original_marker_id, suggested_marker_id, suggested_lat, suggested_lng, suggested_score, notes, created_at, updated_at
      FROM image_detection_uploads
      ORDER BY created_at DESC, upload_id DESC
      LIMIT 100
    `);

    const uploads = [];
    for (const row of result.rows) {
      const matches = await getUploadMatches(row.upload_id);
      uploads.push({
        uploadId: Number(row.upload_id),
        imageType: String(row.image_type || 'map'),
        status: String(row.status || 'neu'),
        fileName: String(row.file_name || ''),
        mimeType: String(row.mime_type || ''),
        imagePath: String(row.image_path || ''),
        imageUrl: String(row.image_url || ''),
        uploadedBy: String(row.uploaded_by || ''),
        uploadedById: String(row.uploaded_by_id || ''),
        originalMarkerId: String(row.original_marker_id || ''),
        suggestedMarkerId: String(row.suggested_marker_id || ''),
        suggestedLat: row.suggested_lat === null ? null : Number(row.suggested_lat),
        suggestedLng: row.suggested_lng === null ? null : Number(row.suggested_lng),
        suggestedScore: Number(row.suggested_score || 0),
        notes: String(row.notes || ''),
        createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
        updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
        matches
      });
    }

    res.json({ success: true, uploads });
  } catch (error) {
    console.error('Image-Uploads Fehler:', error.message);
    res.status(500).json({ success: false, error: 'Uploads konnten nicht geladen werden.' });
  }
});

app.get('/api/image-intelligence/references', requireAdmin, async (req, res) => {
  try {
    const imageType = String(req.query.type || '').trim();
    const values = [];
    let whereSql = '';

    if (imageType) {
      values.push(imageType);
      whereSql = `WHERE image_type = $${values.length}`;
    }

    const result = await pool.query(`
      SELECT reference_id, marker_id, marker_name, image_type, status, file_name, mime_type, image_path, image_url,
             created_from_upload_id, linked_history_id, created_by, created_by_id, lat, lng, notes, created_at, updated_at
      FROM image_detection_references
      ${whereSql}
      ORDER BY created_at DESC, reference_id DESC
      LIMIT 200
    `, values);

    const references = result.rows.map((row) => ({
      referenceId: Number(row.reference_id),
      markerId: String(row.marker_id || ''),
      markerName: String(row.marker_name || ''),
      imageType: String(row.image_type || 'map'),
      status: String(row.status || 'bestätigt'),
      fileName: String(row.file_name || ''),
      mimeType: String(row.mime_type || ''),
      imagePath: String(row.image_path || ''),
      imageUrl: String(row.image_url || ''),
      createdFromUploadId: row.created_from_upload_id === null ? null : Number(row.created_from_upload_id),
      linkedHistoryId: row.linked_history_id === null ? null : Number(row.linked_history_id),
      createdBy: String(row.created_by || ''),
      createdById: String(row.created_by_id || ''),
      lat: row.lat === null ? null : Number(row.lat),
      lng: row.lng === null ? null : Number(row.lng),
      notes: String(row.notes || ''),
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null
    }));

    res.json({ success: true, references });
  } catch (error) {
    console.error('Image-References Fehler:', error.message);
    res.status(500).json({ success: false, error: 'Referenzen konnten nicht geladen werden.' });
  }
});

app.post('/api/image-intelligence/upload', requireAdmin, (req, res) => {
  upload.single('file')(req, res, async (error) => {
    if (error) {
      return res.status(400).json({ success: false, error: error.message || 'Upload fehlgeschlagen.' });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Keine Datei hochgeladen.' });
    }

    try {
      const imageType = String(req.body?.imageType || 'map').trim().toLowerCase() === 'ingame' ? 'ingame' : 'map';
      const ext = detectExtensionFromMime(req.file.mimetype);
      const fileName = `${Date.now()}-${safeFileNamePart(req.file.originalname || imageType)}${ext}`;
      const relativePath = fileName;
      const fullPath = path.join(AI_UPLOADS_DIR, relativePath);
      fs.writeFileSync(fullPath, req.file.buffer);

      const imageUrl = buildAiImageUrl(relativePath);

      const insertResult = await pool.query(
        `
          INSERT INTO image_detection_uploads (
            image_type, status, file_name, mime_type, image_path, image_url, uploaded_by, uploaded_by_id, notes, updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
          RETURNING upload_id
        `,
        [
          imageType,
          'neu',
          req.file.originalname || fileName,
          req.file.mimetype || 'image/jpeg',
          relativePath,
          imageUrl,
          req.user?.username || 'Admin',
          req.user?.id || '',
          ''
        ]
      );

      const uploadId = Number(insertResult.rows[0].upload_id);
      const matches = await buildDetectionMatches(uploadId, imageType);
      const best = matches[0] || null;

      await pool.query(
        `
          UPDATE image_detection_uploads
          SET status = $2, suggested_marker_id = $3, suggested_lat = $4, suggested_lng = $5, suggested_score = $6, updated_at = NOW()
          WHERE upload_id = $1
        `,
        [
          uploadId,
          best ? 'automatisch erkannt' : 'neu',
          best?.markerId || '',
          best?.lat ?? null,
          best?.lng ?? null,
          best?.score || 0
        ]
      );

      const finalUpload = await getDetectionUploadById(uploadId);
      const finalMatches = await getUploadMatches(uploadId);

      res.json({
        success: true,
        upload: finalUpload,
        matches: finalMatches
      });
    } catch (innerError) {
      console.error('Image-Upload Fehler:', innerError.message);
      res.status(500).json({ success: false, error: 'Bild konnte nicht verarbeitet werden.' });
    }
  });
});

app.post('/api/image-intelligence/confirm', requireAdmin, async (req, res) => {
  try {
    const uploadId = Number(req.body?.uploadId);
    const markerId = String(req.body?.markerId || '').trim();
    const lat = Number(req.body?.lat);
    const lng = Number(req.body?.lng);
    const status = String(req.body?.status || 'bestätigt').trim() || 'bestätigt';
    const notes = String(req.body?.notes || '').trim();

    if (!Number.isFinite(uploadId)) {
      return res.status(400).json({ success: false, error: 'Upload-ID fehlt.' });
    }

    if (!markerId) {
      return res.status(400).json({ success: false, error: 'Marker-ID fehlt.' });
    }

    const uploadRow = await getDetectionUploadById(uploadId);
    if (!uploadRow) {
      return res.status(404).json({ success: false, error: 'Upload nicht gefunden.' });
    }

    const markers = await loadMarkers();
    const marker = markers.find((entry) => entry.id === markerId);
    if (!marker) {
      return res.status(404).json({ success: false, error: 'Marker nicht gefunden.' });
    }

    const finalLat = Number.isFinite(lat) ? lat : Number(marker.lat);
    const finalLng = Number.isFinite(lng) ? lng : Number(marker.lng);

    await pool.query(
      `
        UPDATE image_detection_uploads
        SET status = $2, original_marker_id = $3, suggested_marker_id = $3, suggested_lat = $4, suggested_lng = $5, notes = $6, updated_at = NOW()
        WHERE upload_id = $1
      `,
      [uploadId, status, marker.id, finalLat, finalLng, notes]
    );

    await pool.query(
      `
        INSERT INTO image_detection_references (
          marker_id, marker_name, image_type, status, file_name, mime_type, image_path, image_url, created_from_upload_id,
          created_by, created_by_id, lat, lng, notes, updated_at
        )
        VALUES ($1, $2, $3, 'bestätigt', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
      `,
      [
        marker.id,
        marker.name,
        uploadRow.imageType,
        uploadRow.fileName,
        uploadRow.mimeType,
        uploadRow.imagePath,
        uploadRow.imageUrl,
        uploadId,
        req.user?.username || 'Admin',
        req.user?.id || '',
        finalLat,
        finalLng,
        notes
      ]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Image-Confirm Fehler:', error.message);
    res.status(500).json({ success: false, error: 'Treffer konnte nicht bestätigt werden.' });
  }
});

app.post('/api/image-intelligence/reject/:uploadId', requireAdmin, async (req, res) => {
  try {
    const uploadId = Number(req.params.uploadId);
    if (!Number.isFinite(uploadId)) {
      return res.status(400).json({ success: false, error: 'Ungültige Upload-ID.' });
    }

    await pool.query(
      `UPDATE image_detection_uploads SET status = 'abgelehnt', updated_at = NOW() WHERE upload_id = $1`,
      [uploadId]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Image-Reject Fehler:', error.message);
    res.status(500).json({ success: false, error: 'Upload konnte nicht abgelehnt werden.' });
  }
});

app.delete('/api/image-intelligence/references/:referenceId', requireAdmin, async (req, res) => {
  try {
    const referenceId = Number(req.params.referenceId);
    if (!Number.isFinite(referenceId)) {
      return res.status(400).json({ success: false, error: 'Ungültige Referenz-ID.' });
    }

    await pool.query(`DELETE FROM image_detection_references WHERE reference_id = $1`, [referenceId]);
    res.json({ success: true });
  } catch (error) {
    console.error('Reference-Delete Fehler:', error.message);
    res.status(500).json({ success: false, error: 'Referenz konnte nicht gelöscht werden.' });
  }
});

async function startServer() {
  try {
    await createTables();
    await ensureAiTables();
    await seedFromJsonIfDatabaseIsEmpty();
    scheduleAutomaticBackups();

    app.listen(PORT, () => {
      console.log(`Server läuft auf Port ${PORT}`);
      console.log(`Auto-Backups alle ${AUTO_BACKUP_INTERVAL_MINUTES} Minuten aktiv.`);
    });
  } catch (error) {
    console.error("Serverstart fehlgeschlagen:", error.message);
    process.exit(1);
  }
}

startServer();
