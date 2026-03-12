const express = require("express");
const fs = require("fs");
const multer = require("multer");

const app = express();
const PORT = process.env.PORT || 3000;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || "";

app.use(express.json());
app.use(express.static("public"));

const upload = multer({ dest: "public/screenshots/" });
const MARKERS_FILE = "markers.json";

function loadMarkers() {
  if (!fs.existsSync(MARKERS_FILE)) {
    fs.writeFileSync(MARKERS_FILE, "[]");
  }

  const data = fs.readFileSync(MARKERS_FILE);
  return JSON.parse(data);
}

function saveMarkers(markers) {
  fs.writeFileSync(MARKERS_FILE, JSON.stringify(markers, null, 2));
}

async function sendDiscordLog(content) {
  if (!DISCORD_WEBHOOK_URL) return;

  try {
    await fetch(DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ content })
    });
  } catch (error) {
    console.error("Discord Webhook Fehler:", error);
  }
}

app.get("/markers", (req, res) => {
  res.json(loadMarkers());
});

app.post("/markers", async (req, res) => {
  const oldMarkers = loadMarkers();
  const newMarkers = req.body;

  saveMarkers(newMarkers);

  const oldIds = new Set(oldMarkers.map(m => m.id));
  const newIds = new Set(newMarkers.map(m => m.id));

  const added = newMarkers.filter(m => !oldIds.has(m.id));
  const removed = oldMarkers.filter(m => !newIds.has(m.id));

  for (const marker of added) {
    await sendDiscordLog(
      `🟢 Marker erstellt: **${marker.name}** | Kategorie: **${marker.category}**`
    );
  }

  for (const marker of removed) {
    await sendDiscordLog(
      `🔴 Marker gelöscht: **${marker.name}** | Kategorie: **${marker.category}**`
    );
  }

  res.json({ success: true });
});

app.post("/upload", upload.single("file"), (req, res) => {
  res.json({ file: req.file.filename });
});

app.listen(PORT, () => {
  console.log("Server läuft auf Port " + PORT);
});
