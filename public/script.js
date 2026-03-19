const MAP_SIZE = 8192;
const BOUNDS = [[0, 0], [MAP_SIZE, MAP_SIZE]];
const MAP_IMAGE_CANDIDATES = [
  "GTAV-HD-MAP-satellite.jpg",
  "GTAV-HD-MAP-satellite.jpeg",
  "/GTAV-HD-MAP-satellite.jpg",
  "/GTAV-HD-MAP-satellite.jpeg"
];

const CATEGORY_META = {
  Dealer: { icon: "💊", statId: "statDealer", label: "Dealer" },
  UG: { icon: "🔫", statId: "statUG", label: "UG" },
  Feld: { icon: "🌿", statId: "statField", label: "Felder" },
  Workstation: { icon: "🖥️", statId: "statWorkstation", label: "Workstations" },
  Schwarzmarkt: { icon: "🕶", statId: "statVip", label: "Schwarzmarkt", vipOnly: true },
  "Fraktions Krankenhaus": { icon: "🏥", statId: "statHospital", label: "Fraktions Krankenhaus" },
  Systempunkteshop: { icon: "🛒", statId: "statPointShop", label: "Systempunkteshop" },
  Fraktion: { icon: "🛡️", statId: "statFaction", label: "Fraktion" },
  Fraktionsgebiet: { icon: "🗺️", statId: "statTerritory", label: "Fraktionsgebiete", territory: true }
};

const RECOGNITION_STATUS_LABELS = {
  "neu": "Neu",
  "automatisch erkannt": "Automatisch erkannt",
  "manuell korrigiert": "Manuell korrigiert",
  "bestätigt": "Bestätigt",
  "abgelehnt": "Abgelehnt"
};

const map = L.map("map", {
  crs: L.CRS.Simple,
  minZoom: -4,
  maxZoom: 1,
  zoomSnap: 0.25,
  wheelPxPerZoomLevel: 120,
  maxBounds: BOUNDS,
  maxBoundsViscosity: 1.0
});

let activeMapOverlay = null;

function tryLoadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(src);
    img.onerror = () => reject(new Error(`Bild nicht gefunden: ${src}`));
    img.src = src;
  });
}

async function loadMapImage() {
  for (const candidate of MAP_IMAGE_CANDIDATES) {
    try {
      const foundSrc = await tryLoadImage(candidate);
      activeMapOverlay = L.imageOverlay(foundSrc, BOUNDS).addTo(map);
      map.fitBounds(BOUNDS);
      map.setZoom(-2);
      console.log("Map geladen:", foundSrc);
      return;
    } catch (error) {
      console.warn(error.message);
    }
  }

  console.error("Kein Kartenbild gefunden.");
  const mapElement = document.getElementById("map");
  if (mapElement) {
    mapElement.innerHTML = `
      <div style="padding:20px;color:white;background:#1f2937;height:100%;display:flex;align-items:center;justify-content:center;text-align:center;">
        Kartenbild nicht gefunden.<br>
        Lege die Datei als <b>GTAV-HD-MAP-satellite.jpg</b> oder <b>GTAV-HD-MAP-satellite.jpeg</b> in den Ordner <b>public</b>.
      </div>
    `;
  }
}

loadMapImage();

let markers = [];
let markerLayers = [];
let markerLayerById = new Map();
let selectedMarkerId = null;
let selectedHistoryMarkerId = null;
let dashboardState = null;
let liveSyncSource = null;
let lastSyncMessageAt = null;

let currentUser = {
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
};

let recognitionState = {
  currentUpload: null,
  currentMatches: [],
  selectedMatch: null,
  overview: null,
  uploads: [],
  references: [],
  referenceType: "map",
  manualPlacementMode: false,
  markerLayer: null
};

const icons = Object.fromEntries(
  Object.entries(CATEGORY_META).map(([key, meta]) => [key, createEmojiIcon(meta.icon)])
);

function createEmojiIcon(emoji) {
  return L.divIcon({
    className: "emoji-div-icon",
    html: `<div class="emoji-marker">${emoji}</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    popupAnchor: [0, -14],
    tooltipAnchor: [0, -18]
  });
}

function showMessage(text, type = "success") {
  const box = document.getElementById("appMessage");
  if (!box) return;

  box.textContent = text;
  box.classList.remove("hidden", "message-success", "message-error");
  box.classList.add(type === "error" ? "message-error" : "message-success");

  clearTimeout(showMessage.timeout);
  showMessage.timeout = setTimeout(() => {
    box.classList.add("hidden");
  }, 4000);
}

function isAdmin() {
  return !!currentUser.loggedIn && !!currentUser.isAdmin;
}

function isVipOrAdmin() {
  return !!currentUser.loggedIn && (!!currentUser.isVip || !!currentUser.isAdmin);
}

function canEditMarkers() {
  return !!currentUser.loggedIn && !!currentUser.canEdit;
}

function canViewDashboard() {
  return !!currentUser.loggedIn && !!currentUser.canViewDashboard;
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

function escapeJsString(str) {
  return String(str)
    .replaceAll("\\", "\\\\")
    .replaceAll("'", "\\'");
}

function formatDateTime(value) {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleString("de-DE");
  } catch {
    return value;
  }
}

function formatValue(value) {
  if (value === null || typeof value === "undefined" || value === "") return "-";
  if (typeof value === "boolean") return value ? "Ja" : "Nein";
  if (typeof value === "number") return Number(value).toFixed(2);
  return String(value);
}

function getActiveFilters() {
  return Array.from(document.querySelectorAll("[data-filter]:checked")).map((el) => el.dataset.filter);
}

function getSearchValue() {
  return document.getElementById("globalSearch")?.value.trim().toLowerCase() || "";
}

function getOwnerFilterValue() {
  if (!canEditMarkers()) return "";
  return document.getElementById("ownerFilter")?.value.trim().toLowerCase() || "";
}

function getRadiusValueFromForm() {
  const raw = Number(document.getElementById("markerRadius")?.value || 0);
  if (!Number.isFinite(raw) || raw <= 0) return 200;
  return Math.max(50, Math.round(raw));
}

function getSearchText(marker) {
  const base = `${marker.name} ${marker.description} ${marker.category}`.toLowerCase();
  if (!canEditMarkers()) return base;
  return `${base} ${marker.owner || ""}`.toLowerCase();
}

function shouldShowMarker(marker) {
  const activeFilters = getActiveFilters();
  const searchValue = getSearchValue();
  const favoritesOnly = !!document.getElementById("favoritesOnly")?.checked;
  const ownerFilter = getOwnerFilterValue();
  const myMarkersOnly = canEditMarkers() && !!document.getElementById("myMarkersOnly")?.checked;

  if (!activeFilters.includes(marker.category)) return false;
  if (marker.category === "Schwarzmarkt" && !isVipOrAdmin()) return false;
  if (favoritesOnly && !marker.favorite) return false;

  if (myMarkersOnly && String(marker.owner || "").trim().toLowerCase() !== String(currentUser.username || "").trim().toLowerCase()) {
    return false;
  }

  if (ownerFilter) {
    const ownerText = String(marker.owner || "").toLowerCase();
    if (!ownerText.includes(ownerFilter)) return false;
  }

  if (!searchValue) return true;
  return getSearchText(marker).includes(searchValue);
}

function getVisibleMarkers() {
  return markers.filter((marker) => shouldShowMarker(marker));
}

function getSortedMarkers(list = markers) {
  return [...list].sort((a, b) => {
    if (!!a.favorite !== !!b.favorite) return Number(b.favorite) - Number(a.favorite);
    return String(a.name || "").localeCompare(String(b.name || ""), "de");
  });
}

function switchToTab(tabName) {
  const targetTab = document.querySelector(`.tab[data-tab="${tabName}"]`);
  const targetContent = document.getElementById(tabName);

  if (!targetTab || !targetContent) return;
  if (targetTab.classList.contains("hidden") || targetContent.classList.contains("hidden")) return;

  document.querySelectorAll(".tab").forEach((tab) => tab.classList.remove("active"));
  document.querySelectorAll(".tab-content").forEach((content) => content.classList.remove("active"));

  targetTab.classList.add("active");
  targetContent.classList.add("active");
}

function ensureAllowedActiveTab() {
  const activeTab = document.querySelector(".tab.active");
  const activeContent = document.querySelector(".tab-content.active");

  if (!activeTab || !activeContent) {
    switchToTab("filter");
    return;
  }

  if (activeTab.classList.contains("hidden") || activeContent.classList.contains("hidden")) {
    switchToTab("filter");
  }
}

function updateRadiusFieldVisibility() {
  const wrap = document.getElementById("markerRadiusWrap");
  const category = document.getElementById("markerCategory")?.value;
  if (!wrap) return;

  if (category === "Fraktionsgebiet") {
    wrap.classList.remove("hidden");
  } else {
    wrap.classList.add("hidden");
  }
}

function clearForm() {
  selectedMarkerId = null;
  document.getElementById("markerName").value = "";
  document.getElementById("markerDescription").value = "";
  document.getElementById("markerCategory").value = "Dealer";
  document.getElementById("markerOwner").value = "";
  document.getElementById("markerFavorite").checked = false;
  document.getElementById("markerRadius").value = "200";
  document.getElementById("markerLat").value = "";
  document.getElementById("markerLng").value = "";
  const img = document.getElementById("markerImage");
  if (img) img.value = "";

  const editModeInfo = document.getElementById("editModeInfo");
  if (editModeInfo) editModeInfo.classList.add("hidden");

  updateRadiusFieldVisibility();
  updateUserUi();
}

function fillForm(marker) {
  selectedMarkerId = marker.id;
  document.getElementById("markerName").value = marker.name || "";
  document.getElementById("markerDescription").value = marker.description || "";
  document.getElementById("markerCategory").value = marker.category || "Dealer";
  document.getElementById("markerOwner").value = marker.owner || "";
  document.getElementById("markerFavorite").checked = !!marker.favorite;
  document.getElementById("markerRadius").value = marker.radius || 200;
  document.getElementById("markerLat").value = marker.lat;
  document.getElementById("markerLng").value = marker.lng;

  const img = document.getElementById("markerImage");
  if (img) img.value = marker.image || "";

  const editModeInfo = document.getElementById("editModeInfo");
  if (editModeInfo) editModeInfo.classList.remove("hidden");

  updateRadiusFieldVisibility();
  updateUserUi();
}

function markerToPayload(marker) {
  return {
    id: marker.id,
    name: String(marker.name || "").trim(),
    description: String(marker.description || "").trim(),
    category: marker.category,
    lat: Number(marker.lat),
    lng: Number(marker.lng),
    image: marker.image || "",
    owner: String(marker.owner || "").trim(),
    favorite: !!marker.favorite,
    radius: marker.category === "Fraktionsgebiet" ? Number(marker.radius || 200) : 0
  };
}

function buildMarkerFromForm() {
  const name = document.getElementById("markerName").value.trim();
  const description = document.getElementById("markerDescription").value.trim();
  const category = document.getElementById("markerCategory").value;
  const owner = document.getElementById("markerOwner").value.trim();
  const favorite = !!document.getElementById("markerFavorite").checked;
  const lat = Number(document.getElementById("markerLat").value);
  const lng = Number(document.getElementById("markerLng").value);
  const image = document.getElementById("markerImage")?.value.trim() || "";
  const radius = category === "Fraktionsgebiet" ? getRadiusValueFromForm() : 0;

  if (!name) throw new Error("Bitte einen Marker-Namen eingeben.");
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error("Bitte gültige Koordinaten setzen.");

  return {
    id: selectedMarkerId || crypto.randomUUID(),
    name,
    description,
    category,
    lat: roundCoord(lat),
    lng: roundCoord(lng),
    image,
    owner,
    favorite,
    radius
  };
}

function updateSyncStatus(state = "offline", text = "Offline") {
  const status = document.getElementById("syncStatus");
  if (!status) return;

  status.classList.remove("offline", "online", "connecting");
  status.classList.add(state);
  status.textContent = text;
}

function copyToClipboard(text, successMessage = "Kopiert.") {
  navigator.clipboard.writeText(String(text || "")).then(() => {
    showMessage(successMessage);
  }).catch(() => {
    showMessage("Konnte nicht kopiert werden.", "error");
  });
}

function downloadJsonFile(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function getSelectedMarker() {
  return markers.find((marker) => marker.id === selectedMarkerId) || null;
}

function removeAllMarkerLayers() {
  markerLayers.forEach((layer) => {
    try {
      map.removeLayer(layer);
    } catch {}
  });

  markerLayers = [];
  markerLayerById.clear();
}

function getMarkerPopupHtml(marker) {
  const imageHtml = marker.image
    ? `<img src="${escapeHtml(marker.image)}" alt="${escapeHtml(marker.name)}" class="popup-image" ondblclick="openImageModal('${escapeJsString(marker.image)}')">`
    : "";

  const ownerHtml = canEditMarkers()
    ? `<div class="popup-owner">Besitzer/Zuständigkeit: <strong>${escapeHtml(marker.owner || "-")}</strong></div>`
    : "";

  const favoriteHtml = marker.favorite ? `<span class="favorite-badge">⭐ Favorit</span>` : "";
  const radiusHtml = marker.category === "Fraktionsgebiet"
    ? `<div class="popup-radius">Radius: ${formatValue(marker.radius || 200)} m</div>`
    : "";

  return `
    <div class="popup-wrap">
      <div class="popup-title-row">
        <strong>${escapeHtml(marker.name)}</strong>
        ${favoriteHtml}
      </div>
      <div class="popup-category">${escapeHtml(marker.category)}</div>
      <div class="popup-description">${escapeHtml(marker.description || "Keine Beschreibung")}</div>
      ${ownerHtml}
      ${radiusHtml}
      ${imageHtml}
      <div class="popup-actions">
        <button onclick="editMarkerFromPopup('${escapeJsString(marker.id)}')">Bearbeiten</button>
        <button onclick="toggleFavoriteFromPopup('${escapeJsString(marker.id)}')">Favorit</button>
        <button onclick="copyCoordsFromPopup(${Number(marker.lat)}, ${Number(marker.lng)})">Koordinaten</button>
        ${isAdmin() ? `<button onclick="showMarkerHistory('${escapeJsString(marker.id)}')">Verlauf</button>` : ""}
        ${isAdmin() ? `<button class="danger" onclick="deleteMarkerFromPopup('${escapeJsString(marker.id)}')">Löschen</button>` : ""}
      </div>
    </div>
  `;
}

function renderMarkers() {
  removeAllMarkerLayers();

  const visibleMarkers = getSortedMarkers(getVisibleMarkers());

  visibleMarkers.forEach((marker) => {
    const markerLayer = L.marker([marker.lat, marker.lng], {
      icon: icons[marker.category] || icons.Dealer,
      title: marker.name
    });

    markerLayer.bindPopup(getMarkerPopupHtml(marker), {
      maxWidth: 320,
      closeButton: true,
      autoPan: true
    });

    markerLayer.on("click", () => {
      selectedMarkerId = marker.id;
      updateUserUi();
    });

    markerLayer.addTo(map);
    markerLayers.push(markerLayer);
    markerLayerById.set(marker.id, markerLayer);

    if (marker.category === "Fraktionsgebiet") {
      const circle = L.circle([marker.lat, marker.lng], {
        radius: Number(marker.radius || 200),
        color: "#7c3aed",
        fillColor: "#7c3aed",
        fillOpacity: 0.12,
        weight: 2
      }).addTo(map);

      markerLayers.push(circle);
    }
  });

  updateStats();
  renderSearchResults();
}

function focusMarkerById(id, openPopup = true) {
  const marker = markers.find((entry) => entry.id === id);
  if (!marker) return;

  selectedMarkerId = id;
  updateUserUi();

  map.setView([marker.lat, marker.lng], Math.max(map.getZoom(), -1.5), {
    animate: true,
    duration: 0.4
  });

  if (openPopup) {
    setTimeout(() => {
      const layer = markerLayerById.get(id);
      if (layer) layer.openPopup();
    }, 150);
  }
}

window.editMarkerFromPopup = function (id) {
  const marker = markers.find((entry) => entry.id === id);
  if (!marker) return;
  fillForm(marker);
  focusMarkerById(id, false);
  switchToTab("editor");
};

window.toggleFavoriteFromPopup = async function (id) {
  const marker = markers.find((entry) => entry.id === id);
  if (!marker) return;
  marker.favorite = !marker.favorite;

  try {
    await saveMarkers();
    renderMarkers();
    focusMarkerById(id, true);
    showMessage(marker.favorite ? "Favorit gesetzt." : "Favorit entfernt.");
  } catch (error) {
    console.error(error);
    showMessage(error.message || "Favorit konnte nicht gespeichert werden.", "error");
  }
};

window.copyCoordsFromPopup = function (lat, lng) {
  copyToClipboard(`${lat}, ${lng}`, "Koordinaten kopiert.");
};

window.deleteMarkerFromPopup = async function (id) {
  if (!isAdmin()) return;
  const marker = markers.find((entry) => entry.id === id);
  if (!marker) return;

  const confirmed = confirm(`Marker "${marker.name}" wirklich löschen?`);
  if (!confirmed) return;

  markers = markers.filter((entry) => entry.id !== id);
  if (selectedMarkerId === id) selectedMarkerId = null;

  try {
    await saveMarkers();
    renderMarkers();
    clearForm();
    showMessage("Marker gelöscht.");
  } catch (error) {
    console.error(error);
    showMessage(error.message || "Marker konnte nicht gelöscht werden.", "error");
  }
};

function updateStats() {
  const visibleMarkers = getVisibleMarkers();

  Object.entries(CATEGORY_META).forEach(([category, meta]) => {
    const el = document.getElementById(meta.statId);
    if (!el) return;
    el.textContent = visibleMarkers.filter((marker) => marker.category === category).length;
  });

  const totalEl = document.getElementById("statTotal");
  if (totalEl) totalEl.textContent = visibleMarkers.length;
}

function renderSearchResults() {
  const container = document.getElementById("searchResults");
  if (!container) return;

  const searchValue = getSearchValue();
  const visibleMarkers = getSortedMarkers(getVisibleMarkers());

  if (!searchValue) {
    container.innerHTML = `<div class="search-empty">Gib oben einen Suchbegriff ein oder nutze die Filter.</div>`;
    return;
  }

  if (!visibleMarkers.length) {
    container.innerHTML = `<div class="search-empty">Keine Treffer gefunden.</div>`;
    return;
  }

  container.innerHTML = visibleMarkers.slice(0, 40).map((marker) => `
    <button class="search-result-item" onclick="focusMarkerFromSearch('${escapeJsString(marker.id)}')">
      <span class="search-result-title">${escapeHtml(marker.name)}</span>
      <span class="search-result-meta">${escapeHtml(marker.category)}${canEditMarkers() ? ` • ${escapeHtml(marker.owner || "-")}` : ""}</span>
    </button>
  `).join("");
}

window.focusMarkerFromSearch = function (id) {
  focusMarkerById(id, true);
};

async function fetchUser() {
  try {
    const res = await fetch("/api/user");
    currentUser = await res.json();
    updateUserUi();
  } catch (error) {
    console.error(error);
    showMessage("Benutzerstatus konnte nicht geladen werden.", "error");
  }
}

function updateUserUi() {
  const loginStatus = document.getElementById("loginStatus");
  const discordLogin = document.getElementById("discordLogin");
  const logoutBtn = document.getElementById("logoutBtn");
  const roleBadges = document.getElementById("roleBadges");
  const ownerFilterWrap = document.getElementById("ownerFilterWrap");
  const myMarkersWrap = document.getElementById("myMarkersWrap");
  const favoritesOnlyWrap = document.getElementById("favoritesOnlyWrap");

  if (loginStatus) {
    loginStatus.textContent = currentUser.loggedIn ? currentUser.username : "Nicht eingeloggt";
  }

  if (discordLogin) discordLogin.classList.toggle("hidden", currentUser.loggedIn);
  if (logoutBtn) logoutBtn.classList.toggle("hidden", !currentUser.loggedIn);

  if (roleBadges) {
    roleBadges.innerHTML = (currentUser.roleNames || []).map((role) => `<span class="role-badge">${escapeHtml(role)}</span>`).join("");
  }

  if (ownerFilterWrap) ownerFilterWrap.classList.toggle("hidden", !canEditMarkers());
  if (myMarkersWrap) myMarkersWrap.classList.toggle("hidden", !canEditMarkers());
  if (favoritesOnlyWrap) favoritesOnlyWrap.classList.remove("hidden");

  document.querySelectorAll(".editor-only").forEach((el) => {
    el.classList.toggle("hidden", !canEditMarkers());
  });

  document.querySelectorAll(".admin-only").forEach((el) => {
    el.classList.toggle("hidden", !isAdmin());
  });

  document.querySelectorAll(".dashboard-only").forEach((el) => {
    el.classList.toggle("hidden", !canViewDashboard());
  });

  document.querySelectorAll(".recognition-admin-only").forEach((el) => {
    el.classList.toggle("hidden", !isAdmin());
  });

  const markerOwnerInput = document.getElementById("markerOwner");
  if (markerOwnerInput && !markerOwnerInput.value && currentUser.loggedIn) {
    markerOwnerInput.value = currentUser.username || "";
  }

  const saveButton = document.getElementById("saveMarker");
  if (saveButton) {
    saveButton.disabled = !canEditMarkers();
    saveButton.textContent = selectedMarkerId ? "Änderungen speichern" : "Marker speichern";
  }

  ensureAllowedActiveTab();
}

async function loadMarkers() {
  try {
    const response = await fetch("/markers");
    if (!response.ok) throw new Error("Marker konnten nicht geladen werden.");
    markers = await response.json();
    renderMarkers();
  } catch (error) {
    console.error(error);
    showMessage(error.message || "Marker konnten nicht geladen werden.", "error");
  }
}

async function saveMarkers() {
  const payload = markers.map(markerToPayload);

  const response = await fetch("/markers", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ markers: payload })
  });

  const data = await response.json();

  if (!response.ok || data.success === false) {
    throw new Error(data.error || "Marker konnten nicht gespeichert werden.");
  }

  markers = Array.isArray(data.markers) ? data.markers : payload;
}

async function handleSaveMarker() {
  if (!canEditMarkers()) {
    showMessage("Du darfst keine Marker bearbeiten.", "error");
    return;
  }

  try {
    const marker = buildMarkerFromForm();
    const existingIndex = markers.findIndex((entry) => entry.id === marker.id);

    if (existingIndex >= 0) {
      markers.splice(existingIndex, 1, marker);
    } else {
      markers.push(marker);
    }

    await saveMarkers();
    renderMarkers();
    fillForm(marker);
    focusMarkerById(marker.id, true);
    showMessage(existingIndex >= 0 ? "Marker aktualisiert." : "Marker erstellt.");
  } catch (error) {
    console.error(error);
    showMessage(error.message || "Marker konnte nicht gespeichert werden.", "error");
  }
}

function prepareDuplicateMarker(marker) {
  fillForm({
    ...marker,
    id: crypto.randomUUID(),
    name: `${marker.name} Kopie`,
    lat: roundCoord(Number(marker.lat) + 15),
    lng: roundCoord(Number(marker.lng) + 15)
  });
  selectedMarkerId = null;
  updateUserUi();
  switchToTab("editor");
}

window.duplicateSelectedMarker = function () {
  const marker = getSelectedMarker();
  if (!marker) {
    showMessage("Kein Marker ausgewählt.", "error");
    return;
  }
  prepareDuplicateMarker(marker);
  showMessage("Kopie vorbereitet.");
};

window.copySelectedOwner = function () {
  const marker = getSelectedMarker();
  if (!marker) {
    showMessage("Kein Marker ausgewählt.", "error");
    return;
  }
  copyToClipboard(marker.owner || "", "Besitzer kopiert.");
};

async function fetchDashboard() {
  if (!canViewDashboard()) {
    dashboardState = null;
    renderDashboard();
    return;
  }

  try {
    const response = await fetch("/api/admin-dashboard");
    const data = await response.json();

    if (!response.ok || data.success === false) {
      throw new Error(data.error || "Dashboard konnte nicht geladen werden.");
    }

    dashboardState = data;
    renderDashboard();
  } catch (error) {
    console.error(error);
    showMessage(error.message || "Dashboard konnte nicht geladen werden.", "error");
  }
}

function renderDashboard() {
  const totals = dashboardState?.metrics || {};

  const totalEl = document.getElementById("dashboardTotalMarkers");
  const favoritesEl = document.getElementById("dashboardFavorites");
  const territoriesEl = document.getElementById("dashboardTerritories");
  const blackmarketEl = document.getElementById("dashboardBlackmarket");
  const ownersEl = document.getElementById("dashboardTopOwners");
  const recentEl = document.getElementById("dashboardRecentChanges");
  const backupsEl = document.getElementById("dashboardBackups");
  const statusEl = document.getElementById("dashboardStatus");

  if (totalEl) totalEl.textContent = totals.totalMarkers || 0;
  if (favoritesEl) favoritesEl.textContent = totals.favorites || 0;
  if (territoriesEl) territoriesEl.textContent = totals.territories || 0;
  if (blackmarketEl) blackmarketEl.textContent = totals.blackmarket || 0;

  if (statusEl) {
    statusEl.textContent = lastSyncMessageAt
      ? `Live-Sync aktiv • letzte Aktualisierung ${formatDateTime(lastSyncMessageAt)}`
      : "Live-Sync aktiv";
  }

  if (ownersEl) {
    const topOwners = dashboardState?.topOwners || [];
    ownersEl.innerHTML = topOwners.length
      ? topOwners.map((entry) => `
          <div class="dashboard-list-item">
            <span>${escapeHtml(entry.owner || "-")}</span>
            <strong>${entry.count}</strong>
          </div>
        `).join("")
      : `<div class="dashboard-empty">Keine Daten vorhanden.</div>`;
  }

  if (recentEl) {
    const recent = dashboardState?.recentChanges || [];
    recentEl.innerHTML = recent.length
      ? recent.map((entry) => `
          <div class="dashboard-list-item dashboard-list-item-stack">
            <strong>${escapeHtml(entry.markerName || entry.markerId || "Marker")}</strong>
            <span>${escapeHtml(entry.action || "-")} • ${escapeHtml(entry.adminName || "-")}</span>
            <small>${escapeHtml(formatDateTime(entry.createdAt))}</small>
          </div>
        `).join("")
      : `<div class="dashboard-empty">Noch keine Änderungen.</div>`;
  }

  if (backupsEl) {
    const backups = dashboardState?.backups || [];
    backupsEl.innerHTML = backups.length
      ? backups.map((entry) => `
          <div class="dashboard-list-item">
            <div>
              <strong>${escapeHtml(entry.file)}</strong>
              <div class="dashboard-meta">${escapeHtml(formatDateTime(entry.createdAt))}</div>
            </div>
            ${isAdmin() ? `<button onclick="downloadBackup('${escapeJsString(entry.file)}')">Laden</button>` : ""}
          </div>
        `).join("")
      : `<div class="dashboard-empty">Noch keine Backups.</div>`;
  }
}

window.downloadBackup = function (file) {
  if (!isAdmin()) return;
  window.location.href = `/api/backups/${encodeURIComponent(file)}`;
};

window.createManualBackup = async function () {
  if (!isAdmin()) return;

  try {
    const response = await fetch("/api/backups/create", { method: "POST" });
    const data = await response.json();

    if (!response.ok || data.success === false) {
      throw new Error(data.error || "Backup konnte nicht erstellt werden.");
    }

    await fetchDashboard();
    showMessage(`Backup erstellt: ${data.backup?.filename || "ok"}`);
  } catch (error) {
    console.error(error);
    showMessage(error.message || "Backup konnte nicht erstellt werden.", "error");
  }
};

async function importMarkersFromFile() {
  if (!isAdmin()) {
    showMessage("Nur Admins dürfen importieren.", "error");
    return;
  }

  const input = document.getElementById("importFile");
  const file = input?.files?.[0];

  if (!file) {
    showMessage("Bitte zuerst eine Datei auswählen.", "error");
    return;
  }

  const confirmed = confirm("Import überschreibt alle aktuellen Marker. Wirklich fortfahren?");
  if (!confirmed) return;

  try {
    const text = await file.text();
    const parsed = JSON.parse(text);

    const response = await fetch("/api/import-markers", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(Array.isArray(parsed) ? parsed : parsed.markers || [])
    });

    const data = await response.json();
    if (!response.ok || data.success === false) {
      throw new Error(data.error || "Import fehlgeschlagen.");
    }

    await loadMarkers();
    await fetchDashboard();
    showMessage(`Import erfolgreich. Marker importiert: ${data.imported || 0}`);
  } catch (error) {
    console.error(error);
    showMessage(error.message || "Import fehlgeschlagen.", "error");
  }
}

async function loadMarkerHistory(markerId) {
  const response = await fetch(`/api/marker-history/${encodeURIComponent(markerId)}`);
  const data = await response.json();

  if (!response.ok || data.success === false) {
    throw new Error(data.error || "Historie konnte nicht geladen werden.");
  }

  return data.history || [];
}

function renderMarkerHistory(entries) {
  const container = document.getElementById("historyList");
  if (!container) return;

  if (!entries.length) {
    container.innerHTML = `<div class="history-empty">Keine Historie vorhanden.</div>`;
    return;
  }

  container.innerHTML = entries.map((entry) => `
    <div class="history-item">
      <div class="history-head">
        <strong>${escapeHtml(entry.action || "-")}</strong>
        <span>${escapeHtml(formatDateTime(entry.createdAt))}</span>
      </div>
      <div class="history-meta">Admin: ${escapeHtml(entry.adminName || "-")}</div>
      <div class="history-summary">${escapeHtml(entry.changeSummary || "-")}</div>
      ${(entry.changes || []).length ? `<ul class="history-changes">${entry.changes.map((change) => `<li><strong>${escapeHtml(change.label || change.key || "Änderung")}</strong>: ${escapeHtml(formatValue(change.before))} → ${escapeHtml(formatValue(change.after))}</li>`).join("")}</ul>` : ""}
      ${isAdmin() ? `<button onclick="restoreHistoryEntry(${Number(entry.historyId)})">Wiederherstellen</button>` : ""}
    </div>
  `).join("");
}

window.showMarkerHistory = async function (markerId) {
  if (!isAdmin()) return;
  selectedHistoryMarkerId = markerId;
  switchToTab("history");

  try {
    const history = await loadMarkerHistory(markerId);
    renderMarkerHistory(history);
  } catch (error) {
    console.error(error);
    showMessage(error.message || "Historie konnte nicht geladen werden.", "error");
  }
};

window.restoreHistoryEntry = async function (historyId) {
  if (!isAdmin()) return;
  if (!confirm("Diese Version wirklich wiederherstellen?")) return;

  try {
    const response = await fetch(`/api/marker-history-entry/${encodeURIComponent(historyId)}/restore`, {
      method: "POST"
    });
    const data = await response.json();

    if (!response.ok || data.success === false) {
      throw new Error(data.error || "Version konnte nicht wiederhergestellt werden.");
    }

    await loadMarkers();
    await fetchDashboard();
    if (selectedHistoryMarkerId) {
      await window.showMarkerHistory(selectedHistoryMarkerId);
    }
    showMessage("Version wiederhergestellt.");
  } catch (error) {
    console.error(error);
    showMessage(error.message || "Version konnte nicht wiederhergestellt werden.", "error");
  }
};

function clearRecognitionMarker() {
  if (recognitionState.markerLayer) {
    try {
      map.removeLayer(recognitionState.markerLayer);
    } catch {}
    recognitionState.markerLayer = null;
  }
}

function setRecognitionMapMarker(lat, lng, label = "Treffer") {
  clearRecognitionMarker();
  recognitionState.markerLayer = L.marker([lat, lng]).addTo(map);
  recognitionState.markerLayer.bindPopup(label).openPopup();
  map.setView([lat, lng], Math.max(map.getZoom(), -1.5), {
    animate: true,
    duration: 0.35
  });
}

function getRecognitionStatusLabel(status) {
  return RECOGNITION_STATUS_LABELS[status] || status || "-";
}

function getScoreClass(score) {
  if (score >= 80) return "high";
  if (score >= 55) return "medium";
  return "low";
}

function renderRecognitionSection() {
  renderRecognitionOverview();
  renderRecognitionUploads();
  renderRecognitionPreview();
  renderRecognitionMatches();
  renderRecognitionReferences();
}

function renderRecognitionOverview() {
  const totalUploads = document.getElementById("recognitionTotalUploads");
  const totalReferences = document.getElementById("recognitionTotalReferences");
  const breakdown = document.getElementById("recognitionStatusBreakdown");

  if (totalUploads) totalUploads.textContent = recognitionState.overview?.totalUploads || 0;
  if (totalReferences) totalReferences.textContent = recognitionState.overview?.totalReferences || 0;

  if (breakdown) {
    const items = recognitionState.overview?.statusBreakdown || [];
    breakdown.innerHTML = items.length
      ? items.map((entry) => `
          <div class="dashboard-list-item">
            <span>${escapeHtml(getRecognitionStatusLabel(entry.status))}</span>
            <strong>${entry.count}</strong>
          </div>
        `).join("")
      : `<div class="dashboard-empty">Keine Daten vorhanden.</div>`;
  }
}

function renderRecognitionUploads() {
  const list = document.getElementById("recognitionUploads");
  if (!list) return;

  const uploads = recognitionState.uploads || [];
  if (!uploads.length) {
    list.innerHTML = `<div class="dashboard-empty">Noch keine Uploads vorhanden.</div>`;
    return;
  }

  list.innerHTML = uploads.map((entry) => `
    <button class="recognition-upload-item ${recognitionState.currentUpload?.uploadId === entry.uploadId ? "selected" : ""}" onclick="selectRecognitionUpload(${Number(entry.uploadId)})">
      <span>${escapeHtml(entry.fileName || `Upload ${entry.uploadId}`)}</span>
      <small>${escapeHtml(getRecognitionStatusLabel(entry.status))}</small>
    </button>
  `).join("");
}

function renderRecognitionPreview() {
  const image = document.getElementById("recognitionPreviewImage");
  const empty = document.getElementById("recognitionPreviewEmpty");
  const imageType = document.getElementById("recognitionImageType");
  const status = document.getElementById("recognitionStatus");
  const uploadedBy = document.getElementById("recognitionUploadedBy");

  const upload = recognitionState.currentUpload;

  if (!upload) {
    if (image) image.classList.add("hidden");
    if (empty) empty.classList.remove("hidden");
    if (imageType) imageType.textContent = "-";
    if (status) status.textContent = "-";
    if (uploadedBy) uploadedBy.textContent = "-";
    return;
  }

  if (image) {
    image.classList.remove("hidden");
    image.src = upload.imageUrl || "";
  }
  if (empty) empty.classList.add("hidden");
  if (imageType) imageType.textContent = upload.imageType === "ingame" ? "Ingame-Bild" : "Kartenbild";
  if (status) status.textContent = getRecognitionStatusLabel(upload.status);
  if (uploadedBy) uploadedBy.textContent = upload.uploadedBy || "-";
}

function renderRecognitionMatches() {
  const container = document.getElementById("recognitionMatches");
  if (!container) return;

  const matches = recognitionState.currentMatches || [];
  if (!matches.length) {
    container.innerHTML = `<div class="dashboard-empty">Noch keine Erkennung durchgeführt.</div>`;
    return;
  }

  container.innerHTML = matches.map((match, index) => `
    <div class="recognition-match-card ${recognitionState.selectedMatch?.markerId === match.markerId ? "selected" : ""}">
      <div class="recognition-match-top">
        <strong>#${index + 1} ${escapeHtml(match.markerName || match.markerId)}</strong>
        <span class="score-pill ${getScoreClass(Number(match.score || 0))}">${Number(match.score || 0)}%</span>
      </div>
      <div class="recognition-match-meta">
        Marker-ID: ${escapeHtml(match.markerId || "-")}<br>
        Koordinaten: ${escapeHtml(formatValue(match.lat))}, ${escapeHtml(formatValue(match.lng))}<br>
        Grund: ${escapeHtml(match.reason || "-")}
      </div>
      <div class="recognition-match-actions">
        <button onclick="selectRecognitionMatchById('${escapeJsString(match.markerId)}')">Auswählen</button>
        <button onclick="focusRecognitionMatchById('${escapeJsString(match.markerId)}')">Auf Karte</button>
      </div>
    </div>
  `).join("");
}

function renderRecognitionReferences() {
  const grid = document.getElementById("referenceGrid");
  if (!grid) return;

  const refs = recognitionState.references || [];
  if (!refs.length) {
    grid.innerHTML = `<div class="dashboard-empty">Noch keine Referenzen vorhanden.</div>`;
    return;
  }

  grid.innerHTML = refs.map((ref) => `
    <div class="reference-card">
      ${ref.imageUrl ? `<img src="${escapeHtml(ref.imageUrl)}" alt="Referenzbild" class="reference-image" ondblclick="openImageModal('${escapeJsString(ref.imageUrl)}')">` : ""}
      <div class="reference-content">
        <strong>${escapeHtml(ref.markerName || ref.markerId || "Unbekannt")}</strong>
        <div class="reference-meta">
          Typ: ${ref.imageType === "ingame" ? "Ingame" : "Karte"}<br>
          Marker-ID: ${escapeHtml(ref.markerId || "-")}<br>
          Koordinaten: ${escapeHtml(formatValue(ref.lat))}, ${escapeHtml(formatValue(ref.lng))}<br>
          Erstellt: ${escapeHtml(formatDateTime(ref.createdAt))}
        </div>
        <div class="reference-actions">
          <button onclick="focusReference('${escapeJsString(ref.markerId || "")}', ${Number(ref.lat || 0)}, ${Number(ref.lng || 0)})">Auf Karte</button>
          ${isAdmin() ? `<button onclick="deleteReference(${Number(ref.referenceId)})">Löschen</button>` : ""}
        </div>
      </div>
    </div>
  `).join("");
}

async function refreshRecognitionOverview() {
  if (!isAdmin()) return;
  try {
    const response = await fetch("/api/image-intelligence/overview");
    const data = await response.json();
    if (!response.ok || data.success === false) {
      throw new Error(data.error || "Übersicht konnte nicht geladen werden.");
    }
    recognitionState.overview = data;
    renderRecognitionOverview();
  } catch (error) {
    console.error(error);
  }
}

async function refreshRecognitionUploads() {
  if (!isAdmin()) return;
  try {
    const response = await fetch("/api/image-intelligence/uploads");
    const data = await response.json();
    if (!response.ok || data.success === false) {
      throw new Error(data.error || "Uploads konnten nicht geladen werden.");
    }

    recognitionState.uploads = data.uploads || [];

    if (recognitionState.currentUpload) {
      const fresh = recognitionState.uploads.find((entry) => entry.uploadId === recognitionState.currentUpload.uploadId);
      if (fresh) {
        recognitionState.currentUpload = fresh;
        recognitionState.currentMatches = fresh.matches || [];
      }
    }

    renderRecognitionUploads();
    renderRecognitionPreview();
    renderRecognitionMatches();
  } catch (error) {
    console.error(error);
  }
}

async function refreshRecognitionReferences(type = recognitionState.referenceType || "map") {
  if (!isAdmin()) return;
  try {
    recognitionState.referenceType = type;
    const response = await fetch(`/api/image-intelligence/references?type=${encodeURIComponent(type)}`);
    const data = await response.json();
    if (!response.ok || data.success === false) {
      throw new Error(data.error || "Referenzen konnten nicht geladen werden.");
    }
    recognitionState.references = data.references || [];
    renderRecognitionReferences();
  } catch (error) {
    console.error(error);
  }
}

async function uploadRecognitionImage(imageType, file) {
  if (!isAdmin() || !file) return;

  const body = new FormData();
  body.append("file", file);
  body.append("imageType", imageType);

  try {
    showMessage("Bild wird verarbeitet...");

    const response = await fetch("/api/image-intelligence/upload", {
      method: "POST",
      body
    });
    const data = await response.json();

    if (!response.ok || data.success === false) {
      throw new Error(data.error || "Bild konnte nicht erkannt werden.");
    }

    recognitionState.currentUpload = data.upload || null;
    recognitionState.currentMatches = data.matches || [];
    recognitionState.selectedMatch = recognitionState.currentMatches[0] || null;
    recognitionState.manualPlacementMode = false;

    if (recognitionState.selectedMatch) {
      setRecognitionMapMarker(
        recognitionState.selectedMatch.lat,
        recognitionState.selectedMatch.lng,
        `${recognitionState.selectedMatch.markerName} • ${recognitionState.selectedMatch.score}%`
      );
    }

    await refreshRecognitionOverview();
    await refreshRecognitionUploads();
    await refreshRecognitionReferences(recognitionState.referenceType || "map");
    renderRecognitionSection();
    switchToTab("recognition");
    showMessage("Bild erkannt. Treffer wurden vorbereitet.");
  } catch (error) {
    console.error(error);
    showMessage(error.message || "Bild konnte nicht verarbeitet werden.", "error");
  }
}

window.selectRecognitionUpload = function (uploadId) {
  const upload = recognitionState.uploads.find((entry) => Number(entry.uploadId) === Number(uploadId));
  if (!upload) return;

  recognitionState.currentUpload = upload;
  recognitionState.currentMatches = upload.matches || [];
  recognitionState.selectedMatch = recognitionState.currentMatches[0] || null;
  recognitionState.manualPlacementMode = false;

  if (recognitionState.selectedMatch) {
    setRecognitionMapMarker(
      recognitionState.selectedMatch.lat,
      recognitionState.selectedMatch.lng,
      `${recognitionState.selectedMatch.markerName} • ${recognitionState.selectedMatch.score}%`
    );
  }

  renderRecognitionSection();
};

window.selectRecognitionMatchById = function (markerId) {
  const match = recognitionState.currentMatches.find((entry) => entry.markerId === markerId);
  if (!match) return;
  recognitionState.selectedMatch = match;
  setRecognitionMapMarker(match.lat, match.lng, `${match.markerName} • ${match.score}%`);
  renderRecognitionMatches();
};

window.focusRecognitionMatchById = function (markerId) {
  const match = recognitionState.currentMatches.find((entry) => entry.markerId === markerId);
  if (!match) return;
  recognitionState.selectedMatch = match;
  setRecognitionMapMarker(match.lat, match.lng, `${match.markerName} • ${match.score}%`);
  renderRecognitionMatches();
};

window.focusReference = function (markerId, lat, lng) {
  if (markerId) {
    focusMarkerById(markerId, true);
    return;
  }
  setRecognitionMapMarker(lat, lng, "Referenz");
};

window.deleteReference = async function (referenceId) {
  if (!isAdmin()) return;
  if (!confirm("Referenz wirklich löschen?")) return;

  try {
    const response = await fetch(`/api/image-intelligence/references/${encodeURIComponent(referenceId)}`, {
      method: "DELETE"
    });
    const data = await response.json();
    if (!response.ok || data.success === false) {
      throw new Error(data.error || "Referenz konnte nicht gelöscht werden.");
    }

    await refreshRecognitionReferences(recognitionState.referenceType || "map");
    await refreshRecognitionOverview();
    showMessage("Referenz gelöscht.");
  } catch (error) {
    console.error(error);
    showMessage(error.message || "Referenz konnte nicht gelöscht werden.", "error");
  }
};

function prepareNewMarkerFromRecognition(match, imageUrl = "") {
  clearForm();
  document.getElementById("markerName").value = match.markerName || "Neuer Marker";
  document.getElementById("markerLat").value = roundCoord(match.lat || 0);
  document.getElementById("markerLng").value = roundCoord(match.lng || 0);
  document.getElementById("markerImage").value = imageUrl || "";
  document.getElementById("markerOwner").value = currentUser.username || "";
  switchToTab("editor");
  updateRadiusFieldVisibility();
}

async function confirmRecognitionSelection() {
  if (!isAdmin()) return;

  const selected = recognitionState.selectedMatch;
  const upload = recognitionState.currentUpload;
  if (!selected || !upload) {
    showMessage("Kein Treffer ausgewählt.", "error");
    return;
  }

  try {
    const response = await fetch("/api/image-intelligence/confirm", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        uploadId: upload.uploadId,
        markerId: selected.markerId,
        lat: selected.lat,
        lng: selected.lng,
        status: recognitionState.manualPlacementMode ? "manuell korrigiert" : "bestätigt",
        notes: recognitionState.manualPlacementMode ? "Manuell auf Karte gesetzt" : "Treffer bestätigt"
      })
    });

    const data = await response.json();
    if (!response.ok || data.success === false) {
      throw new Error(data.error || "Treffer konnte nicht bestätigt werden.");
    }

    recognitionState.currentUpload = null;
    recognitionState.currentMatches = [];
    recognitionState.selectedMatch = null;
    recognitionState.manualPlacementMode = false;
    clearRecognitionMarker();

    await refreshRecognitionUploads();
    await refreshRecognitionReferences();
    await refreshRecognitionOverview();
    renderRecognitionSection();
  } catch (error) {
    console.error(error);
    showMessage(error.message || "Treffer konnte nicht bestätigt werden.", "error");
  }
}

async function rejectCurrentRecognitionUpload() {
  if (!isAdmin() || !recognitionState.currentUpload) return;
  if (!confirm("Diesen Upload wirklich ablehnen?")) return;

  try {
    const res = await fetch(`/api/image-intelligence/reject/${encodeURIComponent(recognitionState.currentUpload.uploadId)}`, {
      method: "POST"
    });
    const data = await res.json();
    if (!res.ok || data.success === false) {
      throw new Error(data.error || "Upload konnte nicht abgelehnt werden.");
    }

    recognitionState.currentUpload = null;
    recognitionState.currentMatches = [];
    recognitionState.selectedMatch = null;
    recognitionState.manualPlacementMode = false;
    clearRecognitionMarker();

    await refreshRecognitionUploads();
    await refreshRecognitionOverview();
    renderRecognitionSection();
    showMessage("Upload wurde abgelehnt.");
  } catch (error) {
    console.error(error);
    showMessage(error.message || "Upload konnte nicht abgelehnt werden.", "error");
  }
}

function enableManualRecognitionPlacement() {
  if (!isAdmin() || !recognitionState.currentUpload) return;
  recognitionState.manualPlacementMode = true;
  switchToTab("recognition");
  showMessage("Klicke jetzt auf die Karte, um die Position manuell zu setzen.");
}

function applyRecognitionToEditor() {
  if (!isAdmin()) return;

  const selected = recognitionState.selectedMatch;
  const currentUpload = recognitionState.currentUpload;

  if (!selected || !currentUpload) {
    showMessage("Kein Treffer ausgewählt.", "error");
    return;
  }

  prepareNewMarkerFromRecognition(
    {
      markerId: selected.markerId,
      markerName: selected.markerName,
      lat: selected.lat,
      lng: selected.lng,
      score: selected.score
    },
    currentUpload.imageUrl || ""
  );
}

map.on("click", (e) => {
  const latInput = document.getElementById("markerLat");
  const lngInput = document.getElementById("markerLng");

  if (!latInput || !lngInput) return;

  latInput.value = roundCoord(e.latlng.lat);
  lngInput.value = roundCoord(e.latlng.lng);

  const coordInfo = document.getElementById("coordInfo");
  if (coordInfo) {
    coordInfo.textContent = `Koordinaten übernommen: Lat ${roundCoord(e.latlng.lat)} | Lng ${roundCoord(e.latlng.lng)}`;
  }

  if (isAdmin() && recognitionState.manualPlacementMode && recognitionState.currentUpload) {
    const current = recognitionState.selectedMatch || recognitionState.currentMatches[0];
    recognitionState.selectedMatch = {
      ...(current || {
        markerId: "",
        markerName: "Manuell gesetzter Punkt",
        score: 100,
        reason: "Manuell auf Karte gesetzt"
      }),
      lat: roundCoord(e.latlng.lat),
      lng: roundCoord(e.latlng.lng),
      score: current?.score || 100,
      reason: "Manuell auf Karte gesetzt"
    };

    setRecognitionMapMarker(e.latlng.lat, e.latlng.lng, "Manuell korrigiert");
    renderRecognitionMatches();
    showMessage("Manuelle Position gesetzt. Du kannst den Treffer jetzt in den Editor übernehmen.");
  }
});

document.getElementById("saveMarker")?.addEventListener("click", handleSaveMarker);

document.getElementById("clearForm")?.addEventListener("click", () => {
  clearForm();
  showMessage("Formular geleert.");
});

document.getElementById("copyCoordsBtn")?.addEventListener("click", () => {
  const lat = document.getElementById("markerLat").value.trim();
  const lng = document.getElementById("markerLng").value.trim();

  if (!lat || !lng) {
    showMessage("Keine Koordinaten zum Kopieren vorhanden.", "error");
    return;
  }

  copyToClipboard(`${lat}, ${lng}`, "Koordinaten kopiert.");
});

document.getElementById("exportAllBtn")?.addEventListener("click", () => {
  if (!isAdmin()) {
    showMessage("Nur Admins dürfen exportieren.", "error");
    return;
  }

  window.location.href = "/api/export-markers";
});

document.getElementById("exportVisibleBtn")?.addEventListener("click", () => {
  if (!isAdmin()) {
    showMessage("Nur Admins dürfen exportieren.", "error");
    return;
  }

  downloadJsonFile("markers-visible.json", getVisibleMarkers().map(markerToPayload));
  showMessage("Sichtbare Marker exportiert.");
});

document.getElementById("importMarkersBtn")?.addEventListener("click", importMarkersFromFile);
document.getElementById("refreshDashboardBtn")?.addEventListener("click", fetchDashboard);
document.getElementById("createBackupBtn")?.addEventListener("click", window.createManualBackup);
document.getElementById("exportBackupBtn")?.addEventListener("click", async () => {
  if (!isAdmin()) {
    showMessage("Nur Admins dürfen Backups laden.", "error");
    return;
  }

  try {
    const res = await fetch("/api/backups");
    const data = await res.json();
    if (!res.ok || data.success === false) {
      throw new Error(data.error || "Backups konnten nicht geladen werden.");
    }
    const latest = Array.isArray(data.backups) ? data.backups[0] : null;
    if (!latest) {
      throw new Error("Kein Backup vorhanden.");
    }
    window.downloadBackup(latest.file);
  } catch (error) {
    console.error(error);
    showMessage(error.message || "Backups konnten nicht geladen werden.", "error");
  }
});

document.getElementById("markerCategory")?.addEventListener("change", updateRadiusFieldVisibility);

document.getElementById("globalSearch")?.addEventListener("input", () => {
  renderMarkers();
  updateStats();
  renderSearchResults();

  const search = getSearchValue();
  if (!search) return;

  const found = getSortedMarkers(getVisibleMarkers())[0];
  if (found) {
    focusMarkerById(found.id, false);
  }
});

document.getElementById("markerSearch")?.addEventListener("input", () => {
  const search = document.getElementById("markerSearch").value.trim().toLowerCase();
  if (!search) return;

  const found = getSortedMarkers(markers).find((marker) => getSearchText(marker).includes(search));
  if (found) {
    fillForm(found);
    focusMarkerById(found.id, false);
  }
});

document.getElementById("ownerFilter")?.addEventListener("input", () => {
  renderMarkers();
  updateStats();
  renderSearchResults();
});

document.getElementById("myMarkersOnly")?.addEventListener("change", () => {
  renderMarkers();
  updateStats();
  renderSearchResults();
});

document.querySelectorAll("[data-filter]").forEach((checkbox) => {
  checkbox.addEventListener("change", () => {
    renderMarkers();
    updateStats();
    renderSearchResults();
  });
});

document.getElementById("favoritesOnly")?.addEventListener("change", () => {
  renderMarkers();
  updateStats();
  renderSearchResults();
});

document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (btn.classList.contains("hidden")) return;
    switchToTab(btn.dataset.tab);
  });
});

document.getElementById("panelToggle")?.addEventListener("click", () => {
  document.getElementById("panel")?.classList.toggle("collapsed");
});

document.getElementById("discordLogin")?.addEventListener("click", () => {
  window.location.href = "/auth/discord";
});

document.getElementById("logoutBtn")?.addEventListener("click", () => {
  window.location.href = "/logout";
});

document.getElementById("closeImageModal")?.addEventListener("click", window.closeImageModal);
document.querySelector(".image-modal-backdrop")?.addEventListener("click", window.closeImageModal);

document.getElementById("uploadMapImageBtn")?.addEventListener("click", () => {
  if (!isAdmin()) return;
  document.getElementById("mapImageUpload")?.click();
});

document.getElementById("uploadIngameImageBtn")?.addEventListener("click", () => {
  if (!isAdmin()) return;
  document.getElementById("ingameImageUpload")?.click();
});

document.getElementById("mapImageUpload")?.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  await uploadRecognitionImage("map", file);
  event.target.value = "";
});

document.getElementById("ingameImageUpload")?.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  await uploadRecognitionImage("ingame", file);
  event.target.value = "";
});

document.getElementById("recognitionUseManualBtn")?.addEventListener("click", enableManualRecognitionPlacement);
document.getElementById("recognitionRejectBtn")?.addEventListener("click", rejectCurrentRecognitionUpload);
document.getElementById("recognitionApplyBtn")?.addEventListener("click", applyRecognitionToEditor);
document.getElementById("recognitionRefreshBtn")?.addEventListener("click", async () => {
  await refreshRecognitionUploads();
  await refreshRecognitionReferences();
  await refreshRecognitionOverview();
  showMessage("Bild-Erkennung aktualisiert.");
});

document.getElementById("referencesShowMapBtn")?.addEventListener("click", async () => {
  recognitionState.referenceType = "map";
  await refreshRecognitionReferences("map");
});

document.getElementById("referencesShowIngameBtn")?.addEventListener("click", async () => {
  recognitionState.referenceType = "ingame";
  await refreshRecognitionReferences("ingame");
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    window.closeImageModal();
    recognitionState.manualPlacementMode = false;
  }
});

function startLiveSync() {
  if (liveSyncSource) {
    liveSyncSource.close();
  }

  updateSyncStatus("connecting", "Verbinde...");
  liveSyncSource = new EventSource("/api/live");

  liveSyncSource.addEventListener("connected", () => {
    updateSyncStatus("online", "Live-Sync");
  });

  liveSyncSource.addEventListener("markers-updated", async (event) => {
    lastSyncMessageAt = new Date().toISOString();
    updateSyncStatus("online", "Live-Sync");

    try {
      const payload = JSON.parse(event.data || "{}");
      await loadMarkers();
      if (canViewDashboard()) await fetchDashboard();
      if (isAdmin()) {
        await refreshRecognitionUploads();
        await refreshRecognitionReferences(recognitionState.referenceType || "map");
        await refreshRecognitionOverview();
      }
      if (payload.actor) {
        showMessage(`Live-Update von ${payload.actor}`);
      }
    } catch (error) {
      console.error(error);
    }
  });

  liveSyncSource.addEventListener("backup-created", async () => {
    lastSyncMessageAt = new Date().toISOString();
    updateSyncStatus("online", "Live-Sync");
    if (canViewDashboard()) await fetchDashboard();
  });

  liveSyncSource.onerror = () => {
    updateSyncStatus("offline", "Neu verbinden...");
  };
}

window.openImageModal = function (src) {
  if (!src) return;
  const modal = document.getElementById("imageModal");
  const img = document.getElementById("imageModalImage");
  if (!modal || !img) return;

  img.src = src;
  modal.classList.remove("hidden");
};

window.closeImageModal = function () {
  const modal = document.getElementById("imageModal");
  const img = document.getElementById("imageModalImage");
  if (!modal || !img) return;

  modal.classList.add("hidden");
  img.src = "";
};

(async function init() {
  await fetchUser();
  await loadMarkers();
  await fetchDashboard();

  if (isAdmin()) {
    await refreshRecognitionOverview();
    await refreshRecognitionUploads();
    await refreshRecognitionReferences("map");
  }

  clearForm();
  renderRecognitionSection();
  startLiveSync();
})();
