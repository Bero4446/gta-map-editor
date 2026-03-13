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

const ALLOWED_CATEGORIES = [
  "Dealer",
  "UG",
  "Feld",
  "Workstation",
  "Schwarzmarkt"
];

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
  idleTimeoutMillis: 30000
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
    updatedAt: marker.updatedAt || new Date().toISOString()
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
    updatedAt: row.updated_at
      ? new Date(row.updated_at).toISOString()
      : new Date().toISOString()
  };
}

function filterMarkersForUser(markers, user) {
  const canSeeBlackMarket = !!user && (user.isVip || user.isAdmin);
  return markers.filter((marker) => canSeeBlackMarket || marker.category !== "Schwarzmarkt");
}

function hasMarkerChanged(oldMarker, newMarker) {
  return (
    oldMarker.name !== newMarker.name ||
    oldMarker.description !== newMarker.description ||
    oldMarker.category !== newMarker.category ||
    oldMarker.lat !== newMarker.lat ||
    oldMarker.lng !== newMarker.lng ||
    (oldMarker.image || "") !== (newMarker.image || "")
  );
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

async function createMarkersTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS markers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL,
      lat DOUBLE PRECISION NOT NULL,
      lng DOUBLE PRECISION NOT NULL,
      image TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_markers_category ON markers(category)
  `);
}

async function getMarkerCount() {
  const result = await pool.query(`
    SELECT COUNT(*)::int AS count
    FROM markers
  `);

  return Number(result.rows[0]?.count || 0);
}

async function loadMarkers(client = pool) {
  const result = await client.query(`
    SELECT id, name, description, category, lat, lng, image, updated_at
    FROM markers
    ORDER BY updated_at DESC, id ASC
  `);

  return result.rows.map(rowToMarker);
}

async function insertMarker(client, marker) {
  await client.query(
    `
      INSERT INTO markers (
        id, name, description, category, lat, lng, image, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
    `,
    [
      marker.id,
      marker.name,
      marker.description,
      marker.category,
      marker.lat,
      marker.lng,
      marker.image
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
      await insertMarker(client, marker);
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

async function sendDiscordLog(content) {
  if (!DISCORD_WEBHOOK_URL) return;

  try {
    await axios.post(DISCORD_WEBHOOK_URL, { content });
  } catch (error) {
    console.error("Discord Webhook Fehler:", error.response?.data || error.message);
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
      isAdmin: false
    });
  }

  res.json({
    loggedIn: true,
    username: req.user.username,
    isVip: !!req.user.isVip,
    isAdmin: !!req.user.isAdmin
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
    res.status(500).json({
      success: false,
      error: "Marker konnten nicht geladen werden."
    });
  }
});

app.post("/markers", requireAdmin, async (req, res) => {
  const incoming = Array.isArray(req.body.markers) ? req.body.markers : [];
  const cleanMarkers = incoming.map(normalizeMarker).filter(Boolean);
  const adminName = req.user?.username || "Unbekannt";

  let oldMarkers = [];
  const client = await pool.connect();

  try {
    oldMarkers = await loadMarkers(client);

    await client.query("BEGIN");
    await client.query("DELETE FROM markers");

    for (const marker of cleanMarkers) {
      await insertMarker(client, marker);
    }

    await client.query("COMMIT");

    const oldMap = new Map(oldMarkers.map((marker) => [marker.id, marker]));
    const newMap = new Map(cleanMarkers.map((marker) => [marker.id, marker]));

    const added = cleanMarkers.filter((marker) => !oldMap.has(marker.id));
    const removed = oldMarkers.filter((marker) => !newMap.has(marker.id));
    const changed = cleanMarkers.filter((marker) => {
      const oldMarker = oldMap.get(marker.id);
      return oldMarker && hasMarkerChanged(oldMarker, marker);
    });

    for (const marker of added) {
      await sendDiscordLog(
        `🟢 **${adminName}** hat Marker erstellt: **${marker.name}** | Kategorie: **${marker.category}** | Koords: **${marker.lat.toFixed(2)}, ${marker.lng.toFixed(2)}**`
      );
    }

    for (const marker of removed) {
      await sendDiscordLog(
        `🔴 **${adminName}** hat Marker gelöscht: **${marker.name}** | Kategorie: **${marker.category}**`
      );
    }

    for (const marker of changed) {
      await sendDiscordLog(
        `🟡 **${adminName}** hat Marker geändert: **${marker.name}** | Kategorie: **${marker.category}** | Koords: **${marker.lat.toFixed(2)}, ${marker.lng.toFixed(2)}**`
      );
    }

    res.json({
      success: true,
      markers: cleanMarkers
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
    await createMarkersTable();
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
