const MAP_IMAGE = "GTAV-HD-MAP-satellite.jpg";
const MAP_SIZE = 8192;
const BOUNDS = [[0, 0], [MAP_SIZE, MAP_SIZE]];

const map = L.map("map", {
  crs: L.CRS.Simple,
  minZoom: -4,
  maxZoom: 1,
  zoomSnap: 0.25,
  wheelPxPerZoomLevel: 120,
  maxBounds: BOUNDS,
  maxBoundsViscosity: 1.0
});

L.imageOverlay(MAP_IMAGE, BOUNDS).addTo(map);

/* groß und zentriert starten */
map.fitBounds(BOUNDS);
map.setZoom(-2);

let markers = [];
let markerLayers = [];
let selectedMarkerId = null;
let currentUser = {
  loggedIn: false,
  username: "",
  isVip: false,
  isAdmin: false
};

const icons = {
  Dealer: createEmojiIcon("💊"),
  UG: createEmojiIcon("🔫"),
  Feld: createEmojiIcon("🌿"),
  Schwarzmarkt: createEmojiIcon("🕶")
};

function createEmojiIcon(emoji) {
  return L.divIcon({
    className: "marker-icon",
    html: `<div class="emoji-marker">${emoji}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -10]
  });
}

function getActiveFilters() {
  return Array.from(document.querySelectorAll("[data-filter]:checked")).map((el) => el.dataset.filter);
}

function shouldShowMarker(marker) {
  const activeFilters = getActiveFilters();
  const searchValue = document.getElementById("markerSearch").value.trim().toLowerCase();

  if (!activeFilters.includes(marker.category)) return false;
  if (marker.category === "Schwarzmarkt" && !(currentUser.isVip || currentUser.isAdmin)) return false;

  if (!searchValue) return true;

  const text = `${marker.name} ${marker.description} ${marker.category}`.toLowerCase();
  return text.includes(searchValue);
}

function clearForm() {
  selectedMarkerId = null;
  document.getElementById("markerName").value = "";
  document.getElementById("markerDescription").value = "";
  document.getElementById("markerCategory").value = "Dealer";
  document.getElementById("markerLat").value = "";
  document.getElementById("markerLng").value = "";
  document.getElementById("markerImage").value = "";
}

function fillForm(marker) {
  selectedMarkerId = marker.id;
  document.getElementById("markerName").value = marker.name || "";
  document.getElementById("markerDescription").value = marker.description || "";
  document.getElementById("markerCategory").value = marker.category || "Dealer";
  document.getElementById("markerLat").value = marker.lat;
  document.getElementById("markerLng").value = marker.lng;
}

async function fetchUser() {
  try {
    const res = await fetch("/api/user");
    currentUser = await res.json();
  } catch (error) {
    currentUser = {
      loggedIn: false,
      username: "",
      isVip: false,
      isAdmin: false
    };
  }

  updateUserUi();
}

function updateUserUi() {
  const loginStatus = document.getElementById("loginStatus");
  const roleInfo = document.getElementById("roleInfo");
  const logoutBtn = document.getElementById("logoutBtn");
  const vipElements = document.querySelectorAll(".vip-only");
  const saveButton = document.getElementById("saveMarker");

  if (!currentUser.loggedIn) {
    loginStatus.textContent = "Nicht eingeloggt";
    roleInfo.textContent = "Discord Login nötig. Marker erstellen/bearbeiten nur mit Admin-Rolle.";
    logoutBtn.classList.add("hidden");
    vipElements.forEach((el) => el.classList.add("hidden"));
    saveButton.disabled = true;
    saveButton.textContent = "Nur Admin";
    return;
  }

  const roles = [];
  if (currentUser.isAdmin) roles.push("Admin");
  if (currentUser.isVip) roles.push("VIP");

  loginStatus.textContent = `👤 ${currentUser.username}`;
  roleInfo.textContent = roles.length
    ? `Eingeloggt als ${currentUser.username} (${roles.join(" / ")})`
    : `Eingeloggt als ${currentUser.username}`;

  logoutBtn.classList.remove("hidden");

  if (currentUser.isVip || currentUser.isAdmin) {
    vipElements.forEach((el) => el.classList.remove("hidden"));
  } else {
    vipElements.forEach((el) => el.classList.add("hidden"));
  }

  if (currentUser.isAdmin) {
    saveButton.disabled = false;
    saveButton.textContent = selectedMarkerId ? "Änderungen speichern" : "Speichern";
  } else {
    saveButton.disabled = true;
    saveButton.textContent = "Nur Admin";
  }
}

async function loadMarkers() {
  const res = await fetch("/markers");
  markers = await res.json();
  renderMarkers();
  updateStats();
}

async function saveMarkers() {
  const response = await fetch("/markers", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      markers,
      adminName: currentUser.username || "Admin"
    })
  });

  const data = await response.json();
  if (data.markers) {
    markers = data.markers;
  }
}

function renderMarkers() {
  markerLayers.forEach((layer) => map.removeLayer(layer));
  markerLayers = [];

  markers.forEach((marker) => {
    if (!shouldShowMarker(marker)) return;

    const layer = L.marker([marker.lat, marker.lng], {
      icon: icons[marker.category] || icons.Dealer,
      draggable: !!currentUser.isAdmin,
      title: marker.name
    }).addTo(map);

    layer.bindTooltip(marker.name || "Marker", {
      direction: "top",
      opacity: 0.95
    });

    const descriptionHtml = marker.description
      ? `<div style="margin-top:6px;">${escapeHtml(marker.description).replace(/\n/g, "<br>")}</div>`
      : "";

    const imageHtml = marker.image
      ? `<img class="popup-image" src="${escapeHtml(marker.image)}" alt="Marker Screenshot">`
      : "";

    const adminActions = currentUser.isAdmin
      ? `
        <div class="popup-actions">
          <button onclick="window.editMarker('${marker.id}')">Bearbeiten</button>
          <button class="secondary" onclick="window.deleteMarker('${marker.id}')">Löschen</button>
        </div>
      `
      : "";

    layer.bindPopup(`
      <div>
        <strong>${escapeHtml(marker.name)}</strong><br>
        Kategorie: ${escapeHtml(marker.category)}
        ${descriptionHtml}
        ${imageHtml}
        ${adminActions}
      </div>
    `);

    layer.on("dragend", async (e) => {
      if (!currentUser.isAdmin) return;

      const pos = e.target.getLatLng();
      marker.lat = roundCoord(pos.lat);
      marker.lng = roundCoord(pos.lng);

      await saveMarkers();
      updateStats();
      renderMarkers();
    });

    markerLayers.push(layer);
  });
}

function updateStats() {
  const visible = markers.filter((m) => shouldShowMarker(m));
  const vipVisible = markers.filter(
    (m) => m.category === "Schwarzmarkt" && (currentUser.isVip || currentUser.isAdmin)
  );

  document.getElementById("statTotal").textContent = `Marker: ${visible.length}`;
  document.getElementById("statDealer").textContent = `Dealer: ${markers.filter((m) => m.category === "Dealer").length}`;
  document.getElementById("statUG").textContent = `UG: ${markers.filter((m) => m.category === "UG").length}`;
  document.getElementById("statField").textContent = `Felder: ${markers.filter((m) => m.category === "Feld").length}`;

  const statVip = document.getElementById("statVip");
  if (statVip) {
    statVip.textContent = `Schwarzmarkt: ${vipVisible.length}`;
  }
}

async function uploadImageIfNeeded() {
  const fileInput = document.getElementById("markerImage");
  const file = fileInput.files[0];
  if (!file) return null;

  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch("/upload", {
    method: "POST",
    body: formData
  });

  const data = await res.json();
  return data.path || "";
}

function roundCoord(value) {
  return Number(Number(value).toFixed(2));
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function handleSaveMarker() {
  if (!currentUser.isAdmin) {
    alert("Nur Admins dürfen Marker erstellen oder bearbeiten.");
    return;
  }

  const name = document.getElementById("markerName").value.trim();
  const description = document.getElementById("markerDescription").value.trim();
  const category = document.getElementById("markerCategory").value;
  const lat = Number(document.getElementById("markerLat").value);
  const lng = Number(document.getElementById("markerLng").value);

  if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    alert("Bitte Name und gültige Koordinaten eingeben.");
    return;
  }

  let imagePath = null;
  try {
    imagePath = await uploadImageIfNeeded();
  } catch (error) {
    console.error("Upload Fehler:", error);
    alert("Bild konnte nicht hochgeladen werden.");
    return;
  }

  if (selectedMarkerId) {
    const marker = markers.find((m) => m.id === selectedMarkerId);
    if (!marker) return;

    marker.name = name;
    marker.description = description;
    marker.category = category;
    marker.lat = roundCoord(lat);
    marker.lng = roundCoord(lng);
    if (imagePath) marker.image = imagePath;
  } else {
    markers.push({
      id: String(Date.now()),
      name,
      description,
      category,
      lat: roundCoord(lat),
      lng: roundCoord(lng),
      image: imagePath || ""
    });
  }

  await saveMarkers();
  clearForm();
  updateUserUi();
  renderMarkers();
  updateStats();
}

window.editMarker = function (id) {
  if (!currentUser.isAdmin) return;
  const marker = markers.find((m) => m.id === id);
  if (!marker) return;

  fillForm(marker);

  document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
  document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));
  document.querySelector('[data-tab="editor"]').classList.add("active");
  document.getElementById("editor").classList.add("active");

  updateUserUi();
};

window.deleteMarker = async function (id) {
  if (!currentUser.isAdmin) return;
  if (!confirm("Marker wirklich löschen?")) return;

  markers = markers.filter((m) => m.id !== id);
  await saveMarkers();
  clearForm();
  renderMarkers();
  updateStats();
  updateUserUi();
};

map.on("click", (e) => {
  document.getElementById("markerLat").value = roundCoord(e.latlng.lat);
  document.getElementById("markerLng").value = roundCoord(e.latlng.lng);

  document.getElementById("coordInfo").textContent =
    `Koordinaten übernommen: Lat ${roundCoord(e.latlng.lat)} | Lng ${roundCoord(e.latlng.lng)}`;
});

document.getElementById("saveMarker").addEventListener("click", handleSaveMarker);
document.getElementById("clearForm").addEventListener("click", clearForm);

document.getElementById("markerSearch").addEventListener("input", () => {
  renderMarkers();
  updateStats();
});

document.querySelectorAll("[data-filter]").forEach((checkbox) => {
  checkbox.addEventListener("change", () => {
    renderMarkers();
    updateStats();
  });
});

document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(btn.dataset.tab).classList.add("active");
  });
});

document.getElementById("panelToggle").addEventListener("click", () => {
  document.getElementById("panel").classList.toggle("collapsed");
  setTimeout(() => map.invalidateSize(), 260);
});

document.getElementById("discordLogin").addEventListener("click", () => {
  window.location.href = "/auth/discord";
});

document.getElementById("logoutBtn").addEventListener("click", () => {
  window.location.href = "/logout";
});

async function init() {
  await fetchUser();
  await loadMarkers();
  setTimeout(() => map.invalidateSize(), 150);
}

init();
