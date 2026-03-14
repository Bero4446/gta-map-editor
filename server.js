require('./bot');
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
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || "";
const DATABASE_URL = process.env.DATABASE_URL;
const ALLOWED_CATEGORIES = ["Dealer", "UG", "Feld", "Workstation", "Schwarzmarkt", "Fraktions Krankenhaus", "Systempunkteshop", "Fraktion"];

if (!fs.existsSync(PUBLIC_DIR)) {
  fs.mkdirSync(PUBLIC_DIR, { recursive: true });
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

        let isVip = false;
        let isAdmin = false;

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
        }

        profile.isVip = isVip;
        profile.isAdmin = isAdmin;

        return done(null, profile);
      } catch (error) {
        console.error("Discord Rollenfehler:", error.response?.data || error.message);
        profile.isVip = false;
        profile.isAdmin = false;
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

  return {
    id: String(marker.id || crypto.randomUUID()),
    name: String(marker.name || "Unbenannter Marker").trim(),
    description: String(marker.description || "").trim(),
    category: safeCategory,
    lat,
    lng,
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
  return `${marker.name} [${marker.category}] @ ${Number(marker.lat).toFixed(2)}, ${Number(marker.lng).toFixed(2)}`;
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
    { key: "owner", label: "Besitzer" },
    { key: "favorite", label: "Favorit" },
    { key: "image", label: "Screenshot" }
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

  if (!changes.length) {
    return `Marker aktualisiert: ${markerSummary(marker)}`;
  }

  return `Marker geändert: ${changes.map((change) => `${change.label}: ${formatValue(change.before)} → ${formatValue(change.after)}`).join(" | ")}`;
}

function buildDiscordLog(action, marker, adminName, changes) {
  if (action === "created") {
    return `🟢 **${adminName}** hat Marker erstellt: **${marker.name}** | Kategorie: **${marker.category}** | Besitzer: **${marker.owner || "-"}** | Favorit: **${marker.favorite ? "Ja" : "Nein"}** | Koords: **${Number(marker.lat).toFixed(2)}, ${Number(marker.lng).toFixed(2)}**`;
  }

  if (action === "deleted") {
    return `🔴 **${adminName}** hat Marker gelöscht: **${marker.name}** | Kategorie: **${marker.category}** | Besitzer: **${marker.owner || "-"}** | Koords: **${Number(marker.lat).toFixed(2)}, ${Number(marker.lng).toFixed(2)}**`;
  }

  if (action === "imported") {
    return `📥 **${adminName}** hat Marker importiert: **${marker.name}** | Kategorie: **${marker.category}** | Besitzer: **${marker.owner || "-"}**`;
  }

  const summary = changes.length
    ? changes.map((change) => `${change.label}: ${formatValue(change.before)} → ${formatValue(change.after)}`).join(" | ")
    : "Keine Detailänderungen erkannt";

  return `🟡 **${adminName}** hat Marker geändert: **${marker.name}** | ${summary}`;
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
      image TEXT NOT NULL DEFAULT '',
      owner TEXT NOT NULL DEFAULT '',
      favorite BOOLEAN NOT NULL DEFAULT FALSE,
      created_by TEXT NOT NULL DEFAULT '',
      updated_by TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`ALTER TABLE markers ADD COLUMN IF NOT EXISTS owner TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE markers ADD COLUMN IF NOT EXISTS favorite BOOLEAN NOT NULL DEFAULT FALSE`);
  await pool.query(`ALTER TABLE markers ADD COLUMN IF NOT EXISTS created_by TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE markers ADD COLUMN IF NOT EXISTS updated_by TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE markers ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
  await pool.query(`ALTER TABLE markers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_markers_category ON markers(category)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_markers_favorite ON markers(favorite)`);

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
    SELECT id, name, description, category, lat, lng, image, owner, favorite, created_by, updated_by, created_at, updated_at
    FROM markers
    ORDER BY favorite DESC, updated_at DESC, id ASC
  `);

  return result.rows.map(rowToMarker);
}

async function insertMarker(client, marker) {
  await client.query(
    `
      INSERT INTO markers (
        id, name, description, category, lat, lng, image, owner, favorite,
        created_by, updated_by, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, COALESCE($12::timestamptz, NOW()), COALESCE($13::timestamptz, NOW()))
    `,
    [
      marker.id,
      marker.name,
      marker.description,
      marker.category,
      marker.lat,
      marker.lng,
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
      JSON.stringify(snapshot || {})
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

app.get(
  "/auth/discord/callback",
  passport.authenticate("discord", { failureRedirect: "/" }),
  (req, res) => {
    res.redirect("/");
  }
);

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
      id: ""
    });
  }

  res.json({
    loggedIn: true,
    username: req.user.username,
    isVip: !!req.user.isVip,
    isAdmin: !!req.user.isAdmin,
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

app.get("/markers", async (req, res) => {
  try {
    const markers = await loadMarkers();
    res.json(filterMarkersForUser(markers, req.user));
  } catch (error) {
    console.error("Fehler beim Laden der Marker:", error.message);
    res.status(500).json({ success: false, error: "Marker konnten nicht geladen werden." });
  }
});

app.post("/markers", requireAdmin, async (req, res) => {
  const incoming = Array.isArray(req.body.markers) ? req.body.markers : [];
  const normalizedIncoming = incoming.map(normalizeMarker).filter(Boolean);
  const adminName = req.user?.username || "Unbekannt";
  const adminId = req.user?.id || "";
  const client = await pool.connect();

  try {
    const oldMarkers = await loadMarkers(client);
    const oldMap = new Map(oldMarkers.map((marker) => [marker.id, marker]));

    const finalMarkers = normalizedIncoming.map((marker) => {
      const oldMarker = oldMap.get(marker.id);
      const nowIso = new Date().toISOString();

      if (oldMarker) {
        return {
          ...oldMarker,
          ...marker,
          owner: marker.owner || oldMarker.owner || "",
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
        changes: [],
        snapshot: marker
      });
    }

    for (const entry of changed) {
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

app.post("/upload", requireAdmin, (req, res) => {
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

async function startServer() {
  try {
    await createTables();
    await seedFromJsonIfDatabaseIsEmpty();

    app.listen(PORT, () => {
      console.log(`Server läuft auf Port ${PORT}`);
    });
  } catch (error) {
    console.error("Serverstart fehlgeschlagen:", error.message);
    process.exit(1);
  }
}

startServer();
