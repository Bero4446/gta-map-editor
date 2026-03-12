const ADMIN_PASSWORD = "gta44";
const ADMIN_NAME = "bero";

let isAdmin = false;
let markers = [];
let markerLayers = [];
let selectedMarkerId = null;
let pendingLatLng = null;

const adminLoginBtn = document.getElementById("adminLoginBtn");
const adminStatus = document.getElementById("adminStatus");

const markerIdInput = document.getElementById("markerId");
const markerNameInput = document.getElementById("markerName");
const markerCategorySelect = document.getElementById("markerCategory");
const markerLat = document.getElementById("markerLat");
const markerLng = document.getElementById("markerLng");
const markerScreenshotInput = document.getElementById("markerScreenshot");
const screenshotPreview = document.getElementById("screenshotPreview");
const noPreview = document.getElementById("noPreview");

const saveMarkerBtn = document.getElementById("saveMarkerBtn");
const updateMarkerBtn = document.getElementById("updateMarkerBtn");
const deleteMarkerBtn = document.getElementById("deleteMarkerBtn");
const resetFormBtn = document.getElementById("resetFormBtn");

const searchInput = document.getElementById("searchInput");
const filterCategory = document.getElementById("filterCategory");
const markerList = document.getElementById("markerList");

const map = L.map("map", {
  crs: L.CRS.Simple,
  minZoom: -2
});

const bounds = [[0, 0], [8192, 8192]];
L.imageOverlay("gta-map.jpg", bounds).addTo(map);
map.fitBounds(bounds);

const icons = {
  dealer: L.icon({
    iconUrl: "icons/dealer.png",
    iconSize: [40, 40],
    iconAnchor: [20, 40],
    popupAnchor: [0, -40]
  }),
  vagos: L.icon({
    iconUrl: "icons/vagos.png",
    iconSize: [40, 40],
    iconAnchor: [20, 40],
    popupAnchor: [0, -40]
  }),
  normal: L.icon({
    iconUrl: "icons/normal.png",
    iconSize: [40, 40],
    iconAnchor: [20, 40],
    popupAnchor: [0, -40]
  }),
  police: L.icon({
    iconUrl: "icons/normal.png",
    iconSize: [40, 40],
    iconAnchor: [20, 40],
    popupAnchor: [0, -40]
  }),
  ballas: L.icon({
    iconUrl: "icons/normal.png",
    iconSize: [40, 40],
    iconAnchor: [20, 40],
    popupAnchor: [0, -40]
  }),
  grove: L.icon({
    iconUrl: "icons/normal.png",
    iconSize: [40, 40],
    iconAnchor: [20, 40],
    popupAnchor: [0, -40]
  })
};

function updateAdminStatus() {
  adminStatus.textContent = isAdmin
    ? `Admin eingeloggt: ${ADMIN_NAME}`
    : "Nicht eingeloggt";
}

function normalizePos(pos) {
  if (Array.isArray(pos) && pos.length === 2) return pos;
  if (pos && typeof pos.lat === "number" && typeof pos.lng === "number") {
    return [pos.lat, pos.lng];
  }
  return [0, 0];
}

function getIcon(category) {
  return icons[category] || icons.normal;
}

function setPreview(filename = "", localUrl = "") {
  if (localUrl) {
    screenshotPreview.src = localUrl;
    screenshotPreview.style.display = "block";
    noPreview.style.display = "none";
    return;
  }

  if (filename) {
    screenshotPreview.src = `screenshots/${filename}`;
    screenshotPreview.style.display = "block";
    noPreview.style.display = "none";
  } else {
    screenshotPreview.removeAttribute("src");
    screenshotPreview.style.display = "none";
    noPreview.style.display = "block";
  }
}

function setCoords(pos) {
  const [lat, lng] = normalizePos(pos);
  markerLat.textContent = lat.toFixed(2);
  markerLng.textContent = lng.toFixed(2);
}

function clearForm() {
  markerIdInput.value = "";
  markerNameInput.value = "";
  markerCategorySelect.value = "dealer";
  markerScreenshotInput.value = "";
  selectedMarkerId = null;
  pendingLatLng = null;
  markerLat.textContent = "-";
  markerLng.textContent = "-";
  setPreview();
  renderMarkerList();
}

function fillForm(marker) {
  markerIdInput.value = marker.id;
  markerNameInput.value = marker.name;
  markerCategorySelect.value = marker.category;
  setCoords(marker.pos);
  setPreview(marker.screenshot || "");
  selectedMarkerId = marker.id;
  pendingLatLng = normalizePos(marker.pos);
  renderMarkerList();
}

function buildPopup(marker) {
  const imageHtml = marker.screenshot
    ? `<img src="screenshots/${marker.screenshot}" alt="Screenshot">`
    : `<div style="margin-top:8px;color:#aaa;">Kein Screenshot</div>`;

  return `
    <b>${marker.name}</b><br>
    Kategorie: ${marker.category}
    ${imageHtml}
  `;
}

function clearMarkerLayers() {
  markerLayers.forEach(layer => map.removeLayer(layer));
  markerLayers = [];
}

function getFilteredMarkers() {
  const search = searchInput.value.trim().toLowerCase();
  const category = filterCategory.value;

  return markers.filter((marker) => {
    const matchesSearch = marker.name.toLowerCase().includes(search);
    const matchesCategory = category === "all" || marker.category === category;
    return matchesSearch && matchesCategory;
  });
}

function renderMarkerList() {
  const filtered = getFilteredMarkers();
  markerList.innerHTML = "";

  if (filtered.length === 0) {
    markerList.innerHTML = `<div class="marker-item"><div class="marker-item-meta">Keine Marker gefunden</div></div>`;
    return;
  }

  filtered.forEach((marker) => {
    const item = document.createElement("div");
    item.className = "marker-item" + (marker.id === selectedMarkerId ? " active" : "");
    item.innerHTML = `
      <div class="marker-item-name">${marker.name}</div>
      <div class="marker-item-meta">${marker.category}</div>
    `;

    item.addEventListener("click", () => {
      fillForm(marker);
      map.setView(normalizePos(marker.pos), 2);
    });

    markerList.appendChild(item);
  });
}

function drawMarkers() {
  clearMarkerLayers();

  const filteredIds = new Set(getFilteredMarkers().map((m) => m.id));

  markers.forEach((marker) => {
    if (!filteredIds.has(marker.id)) return;

    const pos = normalizePos(marker.pos);

    const layer = L.marker(pos, {
      icon: getIcon(marker.category),
      draggable: isAdmin
    }).addTo(map);

    layer.bindPopup(buildPopup(marker));

    layer.on("click", () => {
      fillForm(marker);
    });

    if (isAdmin) {
      layer.on("dragend", async function (e) {
        const newPos = e.target.getLatLng();
        marker.pos = [newPos.lat, newPos.lng];

        if (selectedMarkerId === marker.id) {
          pendingLatLng = marker.pos;
          setCoords(marker.pos);
        }

        await saveMarkers();
        drawMarkers();
      });
    }

    markerLayers.push(layer);
  });

  renderMarkerList();
}

async function loadMarkers() {
  try {
    const res = await fetch("/markers");
    const data = await res.json();

    markers = Array.isArray(data) ? data : [];

    markers = markers.map((marker) => ({
      ...marker,
      pos: normalizePos(marker.pos)
    }));

    drawMarkers();
  } catch (error) {
    console.error("Fehler beim Laden der Marker:", error);
  }
}

async function saveMarkers() {
  try {
    await fetch("/markers", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        adminName: ADMIN_NAME,
        markers: markers
      })
    });
  } catch (error) {
    console.error("Fehler beim Speichern der Marker:", error);
  }
}

async function uploadScreenshot(file) {
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch("/upload", {
    method: "POST",
    body: formData
  });

  return await res.json();
}

adminLoginBtn.addEventListener("click", () => {
  const pw = prompt("Admin Passwort:");

  if (pw === ADMIN_PASSWORD) {
    isAdmin = true;
    updateAdminStatus();
    drawMarkers();
    alert("Admin aktiviert.");
  } else if (pw !== null) {
    alert("Falsches Passwort.");
  }
});

map.on("click", (e) => {
  if (!isAdmin) {
    alert("Nur Admins können Marker erstellen.");
    return;
  }

  selectedMarkerId = null;
  markerIdInput.value = "";
  pendingLatLng = [e.latlng.lat, e.latlng.lng];
  setCoords(pendingLatLng);
  markerNameInput.focus();
  renderMarkerList();
});

markerScreenshotInput.addEventListener("change", () => {
  const file = markerScreenshotInput.files[0];
  if (file) {
    const localUrl = URL.createObjectURL(file);
    setPreview("", localUrl);
  } else {
    const existingMarker = markers.find((m) => m.id === selectedMarkerId);
    setPreview(existingMarker?.screenshot || "");
  }
});

saveMarkerBtn.addEventListener("click", async () => {
  if (!isAdmin) {
    alert("Nur Admins können Marker speichern.");
    return;
  }

  const name = markerNameInput.value.trim();
  if (!name) {
    alert("Bitte einen Namen eingeben.");
    return;
  }

  if (!pendingLatLng) {
    alert("Bitte zuerst auf die Karte klicken, um eine Position zu wählen.");
    return;
  }

  let screenshotFile = "";
  const file = markerScreenshotInput.files[0];

  if (file) {
    const uploadResult = await uploadScreenshot(file);
    screenshotFile = uploadResult.file || "";
  }

  const newMarker = {
    id: String(Date.now()),
    name,
    category: markerCategorySelect.value,
    pos: pendingLatLng,
    screenshot: screenshotFile
  };

  markers.push(newMarker);
  await saveMarkers();
  fillForm(newMarker);
  drawMarkers();
  alert("Marker gespeichert.");
});

updateMarkerBtn.addEventListener("click", async () => {
  if (!isAdmin) {
    alert("Nur Admins können Marker bearbeiten.");
    return;
  }

  const id = markerIdInput.value;
  const marker = markers.find((m) => m.id === id);

  if (!marker) {
    alert("Kein Marker ausgewählt.");
    return;
  }

  const name = markerNameInput.value.trim();
  if (!name) {
    alert("Bitte einen Namen eingeben.");
    return;
  }

  marker.name = name;
  marker.category = markerCategorySelect.value;
  marker.pos = pendingLatLng || marker.pos;

  const file = markerScreenshotInput.files[0];
  if (file) {
    const uploadResult = await uploadScreenshot(file);
    marker.screenshot = uploadResult.file || marker.screenshot;
  }

  await saveMarkers();
  fillForm(marker);
  drawMarkers();
  alert("Marker aktualisiert.");
});

deleteMarkerBtn.addEventListener("click", async () => {
  if (!isAdmin) {
    alert("Nur Admins können Marker löschen.");
    return;
  }

  const id = markerIdInput.value;
  if (!id) {
    alert("Kein Marker ausgewählt.");
    return;
  }

  const ok = confirm("Marker wirklich löschen?");
  if (!ok) return;

  markers = markers.filter((marker) => marker.id !== id);
  await saveMarkers();
  clearForm();
  drawMarkers();
});

resetFormBtn.addEventListener("click", () => {
  clearForm();
});

searchInput.addEventListener("input", () => {
  drawMarkers();
});

filterCategory.addEventListener("change", () => {
  drawMarkers();
});

updateAdminStatus();
clearForm();
loadMarkers();
