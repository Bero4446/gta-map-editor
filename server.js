const express = require("express");
const fs = require("fs");
const path = require("path");
const session = require("express-session");
const passport = require("passport");
const DiscordStrategy = require("passport-discord").Strategy;
const axios = require("axios");
const multer = require("multer");

const app = express();

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const SCREENSHOT_DIR = path.join(PUBLIC_DIR, "screenshots");
const BACKUP_DIR = path.join(__dirname, "backups");
const MARKERS_FILE = path.join(__dirname, "markers.json");
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || "";

if (!fs.existsSync(PUBLIC_DIR)) {
  fs.mkdirSync(PUBLIC_DIR, { recursive: true });
}

if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

if (!fs.existsSync(MARKERS_FILE)) {
  fs.writeFileSync(MARKERS_FILE, "[]", "utf8");
}

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(PUBLIC_DIR));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "change-me-please",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax"
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

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, SCREENSHOT_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase() || ".jpg";
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  }
});

const upload = multer({ storage });

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
  const allowedCategories = ["Dealer", "UG", "Feld", "Workstation", "Schwarzmarkt"];
  const safeCategory = allowedCategories.includes(category) ? category : "Dealer";

  return {
    id: String(marker.id || Date.now()),
    name: String(marker.name || "Unbenannter Marker").trim(),
    description: String(marker.description || "").trim(),
    category: safeCategory,
    lat,
    lng,
    image: typeof marker.image === "string" ? marker.image : "",
    updatedAt: marker.updatedAt || new Date().toISOString()
  };
}

function loadMarkers() {
  try {
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

function createBackup() {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupFile = path.join(BACKUP_DIR, `markers-backup-${timestamp}.json`);
    fs.copyFileSync(MARKERS_FILE, backupFile);

    const files = fs
      .readdirSync(BACKUP_DIR)
      .filter((file) => file.endsWith(".json"))
      .sort();

    if (files.length > 10) {
      const filesToDelete = files.slice(0, files.length - 10);
      for (const file of filesToDelete) {
        fs.unlinkSync(path.join(BACKUP_DIR, file));
      }
    }
  } catch (error) {
    console.error("Backup Fehler:", error.message);
  }
}

function saveMarkers(markers) {
  const cleanMarkers = markers.map(normalizeMarker).filter(Boolean);
  createBackup();
  fs.writeFileSync(MARKERS_FILE, JSON.stringify(cleanMarkers, null, 2), "utf8");
  return cleanMarkers;
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

async function sendDiscordLog(content) {
  if (!DISCORD_WEBHOOK_URL) return;

  try {
    await axios.post(DISCORD_WEBHOOK_URL, { content });
  } catch (error) {
    console.error("Discord Webhook Fehler:", error.response?.data || error.message);
  }
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

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    markerCount: loadMarkers().length
  });
});

app.get("/markers", (req, res) => {
  res.json(loadMarkers());
});

app.post("/markers", async (req, res) => {
  try {
    const incoming = Array.isArray(req.body.markers) ? req.body.markers : [];
    const adminName = req.body.adminName || "Unbekannt";

    const oldMarkers = loadMarkers();
    const newMarkers = saveMarkers(incoming);

    const oldMap = new Map(oldMarkers.map((m) => [m.id, m]));
    const newMap = new Map(newMarkers.map((m) => [m.id, m]));

    const added = newMarkers.filter((m) => !oldMap.has(m.id));
    const removed = oldMarkers.filter((m) => !newMap.has(m.id));
    const changed = newMarkers.filter((m) => {
      const oldMarker = oldMap.get(m.id);
      return oldMarker && hasMarkerChanged(oldMarker, m);
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
      markers: newMarkers
    });
  } catch (error) {
    console.error("Fehler beim Speichern der Marker:", error.message);
    res.status(500).json({
      success: false,
      error: "Marker konnten nicht gespeichert werden."
    });
  }
});

app.post("/upload", upload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      error: "Keine Datei hochgeladen"
    });
  }

  res.json({
    success: true,
    file: req.file.filename,
    path: `screenshots/${req.file.filename}`
  });
});

app.listen(PORT, () => {
  console.log(`Server läuft auf Port ${PORT}`);
});
