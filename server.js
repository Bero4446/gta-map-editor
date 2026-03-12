const express = require("express");
const fs = require("fs");
const multer = require("multer");

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static("public"));

const upload = multer({ dest: "public/screenshots/" });
const MARKERS_FILE = "markers.json";

function loadMarkers() {
  if (!fs.existsSync(MARKERS_FILE)) {
    fs.writeFileSync(MARKERS_FILE, "[]", "utf8");
  }

  try {
    const raw = fs.readFileSync(MARKERS_FILE, "utf8");
    return JSON.parse(raw || "[]");
  } catch (err) {
    return [];
  }
}

function saveMarkers(markers) {
  fs.writeFileSync(MARKERS_FILE, JSON.stringify(markers, null, 2), "utf8");
}

app.get("/markers", (req, res) => {
  res.json(loadMarkers());
});

app.post("/markers", (req, res) => {
  const markers = req.body;
  saveMarkers(markers);
  res.json({ success: true });
});

app.post("/upload", upload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Keine Datei hochgeladen." });
  }

  res.json({ file: req.file.filename });
});

app.listen(PORT, () => {
  console.log(`Server läuft auf http://localhost:${PORT}`);
});