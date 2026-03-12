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

  const data = fs.readFileSync(MARKERS_FILE, "utf8");
  return JSON.parse(data);
}

function saveMarkers(markers) {
  fs.writeFileSync(MARKERS_FILE, JSON.stringify(markers, null, 2));
}

function posToText(pos) {
  if (Array.isArray(pos) && pos.length === 2) {
    return `${pos[0].toFixed(2)}, ${pos[1].toFixed(2)}`;
  }
  if (pos && typeof pos.lat === "number" && typeof pos.lng === "number") {
    return `${pos.lat.toFixed(2)}, ${pos.lng.toFixed(2)}`;
  }
  return "unbekannt";
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
  const newMarkers = req.body.markers || [];
  const adminName = req.body.adminName || "Unbekannt";

  saveMarkers(newMarkers);

  const oldMap = new Map(oldMarkers.map(m => [m.id, m]));
  const newMap = new Map(newMarkers.map(m => [m.id, m]));

  const added = newMarkers.filter(m => !oldMap.has(m.id));
  const removed = oldMarkers.filter(m => !newMap.has(m.id));

  const edited = [];
  const moved = [];

  for (const newMarker of newMarkers) {
    const oldMarker = oldMap.get(newMarker.id);
    if (!oldMarker) continue;

    const oldPos = JSON.stringify(oldMarker.pos);
    const newPos = JSON.stringify(newMarker.pos);

    const changedName = oldMarker.name !== newMarker.name;
    const changedCategory = oldMarker.category !== newMarker.category;
    const changedScreenshot = (oldMarker.screenshot || "") !== (newMarker.screenshot || "");
    const changedPosition = oldPos !== newPos;

    if (changedName || changedCategory || changedScreenshot) {
      edited.push({ oldMarker, newMarker });
    }

    if (changedPosition) {
      moved.push({ oldMarker, newMarker });
    }
  }

  for (const marker of added) {
    await sendDiscordLog(
      `🟢 **${adminName}** hat Marker erstellt: **${marker.name}** | Kategorie: **${marker.category}** | Position: **${posToText(marker.pos)}**`
    );
  }

  for (const marker of removed) {
    await sendDiscordLog(
      `🔴 **${adminName}** hat Marker gelöscht: **${marker.name}** | Kategorie: **${marker.category}**`
    );
  }

  for (const item of edited) {
    await sendDiscordLog(
      `🟡 **${adminName}** hat Marker bearbeitet: **${item.oldMarker.name}** → **${item.newMarker.name}** | Kategorie: **${item.oldMarker.category}** → **${item.newMarker.category}**`
    );
  }

  for (const item of moved) {
    await sendDiscordLog(
      `🔵 **${adminName}** hat Marker verschoben: **${item.newMarker.name}** | Von: **${posToText(item.oldMarker.pos)}** | Nach: **${posToText(item.newMarker.pos)}**`
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
