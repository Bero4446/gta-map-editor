require("dotenv").config();

const express = require("express");
const path = require("path");
const fs = require("fs");
const session = require("express-session");
const passport = require("passport");
const axios = require("axios");

const app = express();
app.set("trust proxy", 1);

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");
const MARKERS_FILE = path.join(__dirname, "markers.json");

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
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

function readJsonFile(file, fallback = []) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, "utf8");
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch (error) {
    console.error(`Fehler beim Lesen von ${path.basename(file)}:`, error.message);
    return fallback;
  }
}

let lastDiscordLoginAttempt = 0;

app.get("/", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    ok: true,
    uptime: process.uptime(),
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

app.get("/auth/discord", (req, res) => {
  const now = Date.now();

  if (now - lastDiscordLoginAttempt < 15000) {
    return res.status(429).send("Bitte 15 Sekunden warten und dann erneut versuchen.");
  }

  lastDiscordLoginAttempt = now;

  const clientId = process.env.DISCORD_CLIENT_ID;
  const redirectUri = process.env.DISCORD_REDIRECT_URI;

  console.log("Discord Login gestartet");
  console.log("CLIENT_ID gesetzt:", !!process.env.DISCORD_CLIENT_ID);
  console.log("CLIENT_SECRET gesetzt:", !!process.env.DISCORD_CLIENT_SECRET);
  console.log("REDIRECT_URI:", process.env.DISCORD_REDIRECT_URI || "FEHLT");

  if (!clientId || !redirectUri) {
    return res.status(500).send("Discord OAuth ist nicht vollständig konfiguriert.");
  }

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: "identify"
  });

  return res.redirect(`https://discord.com/oauth2/authorize?${params.toString()}`);
});

app.get("/auth/discord/callback", async (req, res) => {
  try {
    console.log("DISCORD CALLBACK QUERY:", req.query);

    const code = String(req.query.code || "");
    if (!code) {
      return res.status(400).send("Discord OAuth Fehler: Kein Code erhalten.");
    }

    const tokenBody = new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID || "",
      client_secret: process.env.DISCORD_CLIENT_SECRET || "",
      grant_type: "authorization_code",
      code,
      redirect_uri: process.env.DISCORD_REDIRECT_URI || ""
    });

    const tokenResponse = await axios.post(
      "https://discord.com/api/oauth2/token",
      tokenBody.toString(),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        timeout: 15000
      }
    );

    const accessToken = tokenResponse.data?.access_token;
    if (!accessToken) {
      console.error("DISCORD CALLBACK ERR: Kein Access Token erhalten");
      return res.status(500).send("Discord OAuth Fehler: Kein Access Token erhalten.");
    }

    const profileResponse = await axios.get("https://discord.com/api/users/@me", {
      headers: {
        Authorization: `Bearer ${accessToken}`
      },
      timeout: 15000
    });

    const profile = profileResponse.data || {};

    const user = {
      id: String(profile.id || ""),
      username: profile.username || profile.global_name || "Discord User",
      avatar: profile.avatar || "",
      isVip: false,
      isAdmin: false,
      isSupport: false,
      isMapper: false,
      canEdit: false,
      canViewDashboard: false,
      roleNames: ["Eingeloggt"]
    };

    req.login(user, (loginErr) => {
      if (loginErr) {
        console.error("Session Login Fehler:", loginErr);
        return res.status(500).send(`Session Fehler: ${loginErr.message || loginErr}`);
      }

      console.log("Discord Login erfolgreich:", user.username || user.id);
      return res.redirect("/");
    });
  } catch (error) {
    console.error("DISCORD CALLBACK ERR:", error.message || error);
    console.error("DISCORD CALLBACK DATA:", error.response?.data || null);
    console.error("DISCORD CALLBACK HEADERS:", error.response?.headers || null);
    console.error("OAuth Fehler:", error.response?.data || error.message || error);

    return res.status(500).send(
      `Discord OAuth Fehler: ${
        error.response?.data?.error_description ||
        error.response?.data?.error ||
        error.message ||
        "Unbekannt"
      }`
    );
  }
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
    isVip: false,
    isAdmin: false,
    isSupport: false,
    isMapper: false,
    canEdit: false,
    canViewDashboard: false,
    roleNames: Array.isArray(req.user.roleNames) ? req.user.roleNames : ["Eingeloggt"],
    id: req.user.id || ""
  });
});

app.get("/markers", (req, res) => {
  try {
    const markers = readJsonFile(MARKERS_FILE, []);
    res.json(Array.isArray(markers) ? markers : []);
  } catch (error) {
    console.error("Fehler beim Laden der Marker:", error.message);
    res.status(500).json({
      success: false,
      error: "Marker konnten nicht geladen werden."
    });
  }
});

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: "Route nicht gefunden."
  });
});

const host = "0.0.0.0";
const server = app.listen(PORT, host, () => {
  console.log(`Server läuft auf http://${host}:${PORT}`);
  console.log(`Öffentliche Dateien aus: ${PUBLIC_DIR}`);
});

server.on("error", (error) => {
  console.error("HTTP Server Fehler:", error);
  process.exit(1);
});

server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;
