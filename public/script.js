const MAP_IMAGE = "GTAV-HD-MAP-satellite.jpeg";
const MAP_SIZE = 8192;
const BOUNDS = [[0, 0], [MAP_SIZE, MAP_SIZE]];

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

L.imageOverlay(MAP_IMAGE, BOUNDS).addTo(map);
map.fitBounds(BOUNDS);
map.setZoom(-2);

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

  const editModeInfo = document.getElementById("editModeInfo");
  if (editModeInfo) editModeInfo.classList.remove("hidden");

  updateRadiusFieldVisibility();
  updateUserUi();
}

function prepareNewMarkerFromRecognition(match, imageUrl = "") {
  selectedMarkerId = null;
  document.getElementById("markerName").value = "";
  document.getElementById("markerDescription").value = "";
  document.getElementById("markerCategory").value = "Dealer";
  document.getElementById("markerOwner").value = currentUser.username || "";
  document.getElementById("markerFavorite").checked = false;
  document.getElementById("markerRadius").value = "200";
  document.getElementById("markerLat").value = roundCoord(match.lat);
  document.getElementById("markerLng").value = roundCoord(match.lng);

  const editModeInfo = document.getElementById("editModeInfo");
  if (editModeInfo) editModeInfo.classList.add("hidden");

  recognitionState.preparedImageUrl = imageUrl || "";
  updateRadiusFieldVisibility();
  switchToTab("editor");
  showMessage("Treffer wurde in den Editor übernommen.");
}

async function fetchUser() {
  try {
    const res = await fetch("/api/user");
    currentUser = await res.json();
  } catch {
    currentUser = {
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
  }

  updateUserUi();
}

function updateUserUi() {
  const loginStatus = document.getElementById("loginStatus");
  const roleInfo = document.getElementById("roleInfo");
  const logoutBtn = document.getElementById("logoutBtn");
  const vipElements = document.querySelectorAll(".vip-only");
  const adminElements = document.querySelectorAll(".admin-only");
  const editorElements = document.querySelectorAll(".editor-only");
  const dashboardElements = document.querySelectorAll(".dashboard-only");
  const saveButton = document.getElementById("saveMarker");
  const historyHint = document.getElementById("historyHint");
  const roleBadges = document.getElementById("roleBadges");

  if (roleBadges) {
    roleBadges.innerHTML = "";
  }

  if (!currentUser.loggedIn) {
    if (loginStatus) loginStatus.textContent = "Nicht eingeloggt";
    if (roleInfo) roleInfo.textContent = "Discord Login nötig. Marker erstellen/bearbeiten nur mit Admin- oder Mapper-Rolle.";
    if (logoutBtn) logoutBtn.classList.add("hidden");
    if (historyHint) historyHint.textContent = "Historie erst nach Admin-Login sichtbar.";

    vipElements.forEach((el) => el.classList.add("hidden"));
    adminElements.forEach((el) => el.classList.add("hidden"));
    editorElements.forEach((el) => el.classList.add("hidden"));
    dashboardElements.forEach((el) => el.classList.add("hidden"));

    if (saveButton) {
      saveButton.disabled = true;
      saveButton.textContent = "Nur Admin / Mapper";
    }

    ensureAllowedActiveTab();
    renderSearchResults();
    renderDashboard();
    renderRecognitionSection();
    return;
  }

  const roles = Array.isArray(currentUser.roleNames) && currentUser.roleNames.length
    ? currentUser.roleNames
    : [
        currentUser.isAdmin ? "Admin" : "",
        currentUser.isSupport ? "Support" : "",
        currentUser.isMapper ? "Mapper" : "",
        currentUser.isVip ? "VIP" : ""
      ].filter(Boolean);

  if (loginStatus) loginStatus.textContent = `👤 ${currentUser.username}`;
  if (roleInfo) {
    roleInfo.textContent = roles.length
      ? `Eingeloggt als ${currentUser.username} (${roles.join(" / ")})`
      : `Eingeloggt als ${currentUser.username}`;
  }

  if (historyHint) {
    historyHint.textContent = isAdmin()
      ? "Wähle einen Marker aus, um seinen Verlauf zu sehen und alte Versionen wiederherzustellen."
      : "Historie nur für Admins sichtbar.";
  }

  if (roleBadges) {
    roleBadges.innerHTML = roles.map((role) => `<span class="role-badge">${escapeHtml(role)}</span>`).join("");
  }

  if (logoutBtn) logoutBtn.classList.remove("hidden");

  if (isVipOrAdmin()) {
    vipElements.forEach((el) => el.classList.remove("hidden"));
  } else {
    vipElements.forEach((el) => el.classList.add("hidden"));
  }

  if (isAdmin()) {
    adminElements.forEach((el) => el.classList.remove("hidden"));
  } else {
    adminElements.forEach((el) => el.classList.add("hidden"));
  }

  if (canEditMarkers()) {
    editorElements.forEach((el) => el.classList.remove("hidden"));
  } else {
    editorElements.forEach((el) => el.classList.add("hidden"));
  }

  if (canViewDashboard()) {
    dashboardElements.forEach((el) => el.classList.remove("hidden"));
  } else {
    dashboardElements.forEach((el) => el.classList.add("hidden"));
  }

  if (saveButton) {
    if (canEditMarkers()) {
      saveButton.disabled = false;
      saveButton.textContent = selectedMarkerId ? "Änderungen speichern" : "Speichern";
    } else {
      saveButton.disabled = true;
      saveButton.textContent = "Nur Admin / Mapper";
    }
  }

  ensureAllowedActiveTab();
  renderSearchResults();
  renderDashboard();
  renderRecognitionSection();
}

async function loadMarkers() {
  try {
    const res = await fetch("/markers");
    if (!res.ok) throw new Error("Marker konnten nicht geladen werden.");

    markers = await res.json();
    renderMarkers();
    updateStats();
    renderSearchResults();
  } catch (error) {
    console.error(error);
    showMessage("Marker konnten nicht geladen werden.", "error");
  }
}

async function saveMarkers() {
  const response = await fetch("/markers", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ markers })
  });

  const data = await response.json();

  if (!response.ok || data.success === false) {
    throw new Error(data.error || "Marker konnten nicht gespeichert werden.");
  }

  if (Array.isArray(data.markers)) {
    markers = data.markers;
  }

  if (canViewDashboard()) {
    fetchDashboard().catch(() => {});
  }
}

function buildPopupHtml(marker) {
  const descriptionHtml = marker.description
    ? `<div class="popup-desc">${escapeHtml(marker.description).replace(/\n/g, "<br>")}</div>`
    : `<div class="popup-desc">Keine Beschreibung vorhanden.</div>`;

  const imageHtml = marker.image
    ? `
      <img
        class="popup-image"
        src="${escapeHtml(marker.image)}"
        alt="Marker Screenshot"
        ondblclick="window.openImageModal('${escapeJsString(marker.image)}')"
      >
      <div class="popup-hint">Doppelklick auf das Bild zum Vergrößern</div>
    `
    : "";

  const ownerHtml = canEditMarkers()
    ? `<div class="popup-meta">Besitzer/Zuständigkeit: ${escapeHtml(marker.owner || "-")}</div>`
    : "";

  const favoriteHtml = marker.favorite
    ? `<div class="popup-meta">⭐ Favorit</div>`
    : "";

  const territoryHtml = marker.category === "Fraktionsgebiet"
    ? `<div class="popup-meta">Gebietsradius: ${escapeHtml(formatValue(marker.radius || 200))} m</div>`
    : "";

  const adminButtons = canEditMarkers()
    ? `
      <button onclick="window.editMarker('${marker.id}')">Bearbeiten</button>
      <button onclick="window.toggleMarkerFavorite('${marker.id}')">${marker.favorite ? "Favorit entfernen" : "Als Favorit"}</button>
      <button class="secondary" onclick="window.duplicateMarker('${marker.id}')">Duplizieren</button>
      ${isAdmin() ? `<button onclick="window.showMarkerHistory('${marker.id}')">Verlauf</button>` : ""}
      <button class="secondary" onclick="window.copyMarkerOwner('${marker.id}')">Besitzer kopieren</button>
      ${isAdmin() ? `<button class="secondary" onclick="window.deleteMarker('${marker.id}')">Löschen</button>` : ""}
    `
    : "";

  const adminMeta = canEditMarkers()
    ? `
      <div class="popup-meta">Erstellt von: ${escapeHtml(marker.createdBy || "-")}</div>
      <div class="popup-meta">Zuletzt geändert von: ${escapeHtml(marker.updatedBy || "-")}</div>
      <div class="popup-meta">Letzte Änderung: ${escapeHtml(formatDateTime(marker.updatedAt))}</div>
    `
    : "";

  return `
    <div>
      <div class="popup-title">${marker.favorite ? "⭐ " : ""}${escapeHtml(marker.name)}</div>
      <div class="popup-category">Kategorie: ${escapeHtml(marker.category)}</div>
      ${favoriteHtml}
      ${ownerHtml}
      ${territoryHtml}
      <div class="popup-meta">Lat: ${Number(marker.lat).toFixed(2)} | Lng: ${Number(marker.lng).toFixed(2)}</div>
      ${adminMeta}
      ${descriptionHtml}
      ${imageHtml}
      <div class="popup-actions">
        <button onclick="window.copyMarkerCoords('${marker.id}')">Koords kopieren</button>
        ${adminButtons}
      </div>
    </div>
  `;
}

function getTerritoryStyle(marker) {
  const owner = String(marker.owner || "neutral");
  let hash = 0;
  for (let i = 0; i < owner.length; i += 1) {
    hash = ((hash << 5) - hash) + owner.charCodeAt(i);
    hash |= 0;
  }

  const palette = ["#5865f2", "#57f287", "#faa61a", "#eb459e", "#3ba55d", "#ed4245"];
  const index = Math.abs(hash) % palette.length;
  return {
    color: palette[index],
    weight: 2,
    fillOpacity: 0.12
  };
}

function focusMarkerById(id, openPopup = true) {
  const marker = markers.find((m) => m.id === id);
  const layer = markerLayerById.get(id);
  if (!marker || !layer) return;

  map.flyTo([Number(marker.lat), Number(marker.lng)], Math.max(map.getZoom(), -1.25), {
    duration: 0.6
  });

  if (openPopup && layer.marker) {
    setTimeout(() => layer.marker.openPopup(), 250);
  }
}

function clearRecognitionMarker() {
  if (recognitionState.markerLayer) {
    map.removeLayer(recognitionState.markerLayer);
    recognitionState.markerLayer = null;
  }
}

function setRecognitionMapMarker(lat, lng, label = "Erkannter Treffer") {
  clearRecognitionMarker();

  recognitionState.markerLayer = L.circleMarker([Number(lat), Number(lng)], {
    radius: 12,
    color: "#5a78ff",
    weight: 3,
    fillColor: "#5a78ff",
    fillOpacity: 0.25
  }).addTo(map);

  recognitionState.markerLayer.bindPopup(`
    <div>
      <div class="popup-title">${escapeHtml(label)}</div>
      <div class="popup-meta">Lat: ${Number(lat).toFixed(2)} | Lng: ${Number(lng).toFixed(2)}</div>
    </div>
  `);

  map.flyTo([Number(lat), Number(lng)], Math.max(map.getZoom(), -1.4), {
    duration: 0.55
  });
}

function renderMarkers() {
  markerLayers.forEach((layer) => {
    if (layer.group) {
      map.removeLayer(layer.group);
    }
  });

  markerLayers = [];
  markerLayerById = new Map();

  getSortedMarkers().forEach((marker) => {
    if (!shouldShowMarker(marker)) return;

    const group = L.layerGroup();
    let territoryLayer = null;

    if (marker.category === "Fraktionsgebiet") {
      territoryLayer = L.circle([Number(marker.lat), Number(marker.lng)], {
        radius: Number(marker.radius) || 200,
        ...getTerritoryStyle(marker)
      });
      territoryLayer.bindPopup(buildPopupHtml(marker));
      territoryLayer.bindTooltip(`${marker.name} (${Number(marker.radius) || 200}m)`, {
        className: "territory-label",
        sticky: true,
        direction: "top"
      });
      territoryLayer.addTo(group);
    }

    const markerLayer = L.marker([Number(marker.lat), Number(marker.lng)], {
      icon: icons[marker.category] || icons.Dealer,
      draggable: canEditMarkers(),
      title: marker.favorite ? `⭐ ${marker.name}` : marker.name
    });

    markerLayer.bindTooltip(marker.favorite ? `⭐ ${marker.name}` : (marker.name || "Marker"), {
      direction: "top",
      opacity: 0.95
    });

    markerLayer.bindPopup(buildPopupHtml(marker));

    markerLayer.on("click", () => {
      map.flyTo([Number(marker.lat), Number(marker.lng)], Math.max(map.getZoom(), -1.5), {
        duration: 0.45
      });
    });

    markerLayer.on("dragend", async (e) => {
      if (!canEditMarkers()) return;

      try {
        const pos = e.target.getLatLng();
        marker.lat = roundCoord(pos.lat);
        marker.lng = roundCoord(pos.lng);

        await saveMarkers();
        updateStats();
        renderMarkers();
        renderSearchResults();
        showMessage("Marker verschoben und gespeichert.");
      } catch (error) {
        console.error(error);
        showMessage("Marker konnte nicht verschoben werden.", "error");
      }
    });

    markerLayer.addTo(group);
    group.addTo(map);

    const entry = { id: marker.id, group, marker: markerLayer, territory: territoryLayer };
    markerLayers.push(entry);
    markerLayerById.set(marker.id, entry);
  });
}

function updateStats() {
  const visible = getVisibleMarkers();
  const allVisibleForUser = markers.filter((m) => m.category !== "Schwarzmarkt" || isVipOrAdmin());
  const favoriteCount = allVisibleForUser.filter((m) => m.favorite).length;

  const statTotal = document.getElementById("statTotal");
  const statFavorites = document.getElementById("statFavorites");
  if (statTotal) statTotal.textContent = `Marker sichtbar: ${visible.length}`;
  if (statFavorites) statFavorites.textContent = `Favoriten: ${favoriteCount}`;

  Object.entries(CATEGORY_META).forEach(([category, meta]) => {
    const el = document.getElementById(meta.statId);
    if (!el) return;
    const count = markers.filter((m) => m.category === category && (category !== "Schwarzmarkt" || isVipOrAdmin())).length;
    el.textContent = `${meta.label}: ${count}`;
  });
}

function renderSearchResults() {
  const list = document.getElementById("searchResults");
  if (!list) return;

  const searchValue = getSearchValue();
  const visible = getSortedMarkers(getVisibleMarkers());

  if (!visible.length) {
    list.innerHTML = `<div class="status-box">Keine Marker passen zu den aktuellen Filtern.</div>`;
    return;
  }

  const categoryOrder = Object.keys(CATEGORY_META);
  const grouped = new Map();

  visible.forEach((marker) => {
    const category = marker.category || "Sonstige";
    if (!grouped.has(category)) grouped.set(category, []);
    grouped.get(category).push(marker);
  });

  const sortedCategories = categoryOrder
    .filter((category) => grouped.has(category))
    .concat(
      [...grouped.keys()]
        .filter((category) => !categoryOrder.includes(category))
        .sort((a, b) => a.localeCompare(b, "de"))
    );

  list.innerHTML = sortedCategories.map((category, index) => {
    const items = grouped.get(category) || [];
    const meta = CATEGORY_META[category] || { icon: "📍", label: category };
    const isOpen = searchValue ? "open" : index === 0 ? "open" : "";

    const cards = items.map((marker) => {
      const owner = canEditMarkers()
        ? `<div class="search-result-meta">Besitzer: ${escapeHtml(marker.owner || "-")}</div>`
        : "";

      const territory = marker.category === "Fraktionsgebiet"
        ? `<div class="search-result-meta">Radius: ${escapeHtml(formatValue(marker.radius || 200))} m</div>`
        : "";

      return `
        <div class="search-result">
          <div class="search-result-title">${marker.favorite ? "⭐ " : ""}${escapeHtml(marker.name)}</div>
          <div class="search-result-meta">${escapeHtml(category)} • ${Number(marker.lat).toFixed(2)}, ${Number(marker.lng).toFixed(2)}</div>
          ${owner}
          ${territory}
          <div class="search-result-actions">
            <button onclick="window.focusMarker('${marker.id}')">Auf Karte</button>
            <button class="secondary" onclick="window.copyMarkerCoords('${marker.id}')">Koords</button>
            ${canEditMarkers() ? `<button class="secondary" onclick="window.editMarker('${marker.id}')">Bearbeiten</button>` : ""}
            ${canEditMarkers() ? `<button class="secondary" onclick="window.duplicateMarker('${marker.id}')">Duplizieren</button>` : ""}
            ${isAdmin() ? `<button class="secondary" onclick="window.showMarkerHistory('${marker.id}')">Verlauf</button>` : ""}
          </div>
        </div>
      `;
    }).join("");

    return `
      <details class="search-group" ${isOpen}>
        <summary class="search-group-summary">
          <span class="search-group-left">${escapeHtml(meta.icon || "📍")} ${escapeHtml(meta.label || category)}</span>
          <span class="search-group-right">${items.length}</span>
        </summary>
        <div class="search-group-items">
          ${cards}
        </div>
      </details>
    `;
  }).join("");
}

async function uploadImageIfNeeded() {
  const fileInput = document.getElementById("markerImage");
  const file = fileInput?.files?.[0];
  if (!file) return recognitionState.preparedImageUrl || null;

  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch("/upload", {
    method: "POST",
    body: formData
  });

  const data = await res.json();

  if (!res.ok || data.success === false) {
    throw new Error(data.error || "Bild konnte nicht hochgeladen werden.");
  }

  return data.path || recognitionState.preparedImageUrl || "";
}

async function copyToClipboard(text, successText = "Kopiert.") {
  try {
    await navigator.clipboard.writeText(text);
    showMessage(successText);
  } catch {
    showMessage("Kopieren nicht möglich.", "error");
  }
}

window.copyMarkerCoords = function (id) {
  const marker = markers.find((m) => m.id === id);
  if (!marker) {
    showMessage("Marker nicht gefunden.", "error");
    return;
  }

  copyToClipboard(`${marker.lat}, ${marker.lng}`, "Marker-Koordinaten kopiert.");
};

window.copyMarkerOwner = function (id) {
  if (!canEditMarkers()) return;
  const marker = markers.find((m) => m.id === id);
  if (!marker) {
    showMessage("Marker nicht gefunden.", "error");
    return;
  }

  copyToClipboard(marker.owner || "", "Besitzer/Zuständigkeit kopiert.");
};

window.focusMarker = function (id) {
  focusMarkerById(id, true);
};

window.openImageModal = function (src) {
  const modal = document.getElementById("imageModal");
  const modalImage = document.getElementById("modalImage");
  if (!modal || !modalImage) return;

  modalImage.src = src;
  modal.classList.remove("hidden");
};

window.closeImageModal = function () {
  const modal = document.getElementById("imageModal");
  const modalImage = document.getElementById("modalImage");
  if (!modal || !modalImage) return;

  modal.classList.add("hidden");
  modalImage.src = "";
};

function downloadJson(filename, data) {
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

function cryptoRandomId() {
  if (window.crypto && window.crypto.randomUUID) {
    return window.crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function handleSaveMarker() {
  if (!canEditMarkers()) {
    showMessage("Nur Admins oder Mapper dürfen Marker erstellen oder bearbeiten.", "error");
    return;
  }

  const name = document.getElementById("markerName").value.trim();
  const description = document.getElementById("markerDescription").value.trim();
  const category = document.getElementById("markerCategory").value;
  const ownerInput = document.getElementById("markerOwner").value.trim();
  const favorite = !!document.getElementById("markerFavorite").checked;
  const lat = Number(document.getElementById("markerLat").value);
  const lng = Number(document.getElementById("markerLng").value);
  const radius = category === "Fraktionsgebiet" ? getRadiusValueFromForm() : 0;

  if (!name) {
    showMessage("Bitte einen Namen für den Marker eingeben.", "error");
    return;
  }

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    showMessage("Bitte gültige Koordinaten eingeben.", "error");
    return;
  }

  try {
    const imagePath = await uploadImageIfNeeded();
    const wasEditing = !!selectedMarkerId;

    if (selectedMarkerId) {
      const marker = markers.find((m) => m.id === selectedMarkerId);
      if (!marker) throw new Error("Marker wurde nicht gefunden.");

      marker.name = name;
      marker.description = description;
      marker.category = category;
      marker.owner = ownerInput || currentUser.username;
      marker.favorite = favorite;
      marker.radius = radius;
      marker.lat = roundCoord(lat);
      marker.lng = roundCoord(lng);
      if (imagePath) marker.image = imagePath;
      marker.updatedAt = new Date().toISOString();
      marker.updatedBy = currentUser.username;
    } else {
      markers.push({
        id: cryptoRandomId(),
        name,
        description,
        category,
        owner: ownerInput || currentUser.username,
        favorite,
        radius,
        lat: roundCoord(lat),
        lng: roundCoord(lng),
        image: imagePath || recognitionState.preparedImageUrl || "",
        createdBy: currentUser.username,
        updatedBy: currentUser.username,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }

    await saveMarkers();

    if (isAdmin() && recognitionState.currentUpload && recognitionState.selectedMatch) {
      await confirmRecognitionSelection().catch((error) => {
        console.error(error);
      });
    }

    clearForm();
    recognitionState.preparedImageUrl = "";
    renderMarkers();
    updateStats();
    renderSearchResults();
    showMessage(wasEditing ? "Marker gespeichert." : "Marker erstellt.");
  } catch (error) {
    console.error(error);
    showMessage(error.message || "Marker konnte nicht gespeichert werden.", "error");
  }
}

window.editMarker = function (id) {
  if (!canEditMarkers()) return;

  const marker = markers.find((m) => m.id === id);
  if (!marker) {
    showMessage("Marker konnte nicht geladen werden.", "error");
    return;
  }

  fillForm(marker);
  switchToTab("editor");
  showMessage("Marker zum Bearbeiten geladen.");
};

window.toggleMarkerFavorite = async function (id) {
  if (!canEditMarkers()) return;

  const marker = markers.find((m) => m.id === id);
  if (!marker) {
    showMessage("Marker nicht gefunden.", "error");
    return;
  }

  try {
    marker.favorite = !marker.favorite;
    marker.updatedAt = new Date().toISOString();
    marker.updatedBy = currentUser.username;
    await saveMarkers();
    renderMarkers();
    updateStats();
    renderSearchResults();
    showMessage(marker.favorite ? "Marker als Favorit gespeichert." : "Favorit entfernt.");
  } catch (error) {
    console.error(error);
    showMessage("Favorit konnte nicht gespeichert werden.", "error");
  }
};

window.duplicateMarker = async function (id) {
  if (!canEditMarkers()) return;

  const marker = markers.find((m) => m.id === id);
  if (!marker) {
    showMessage("Marker nicht gefunden.", "error");
    return;
  }

  const now = new Date().toISOString();
  const duplicate = {
    ...marker,
    id: `${marker.id}-copy-${Date.now()}`,
    name: `${marker.name} Kopie`,
    lat: roundCoord(Number(marker.lat) + 35),
    lng: roundCoord(Number(marker.lng) + 35),
    createdAt: now,
    updatedAt: now,
    createdBy: currentUser.username,
    updatedBy: currentUser.username
  };

  markers.unshift(duplicate);
  await saveMarkers();
  renderMarkers();
  updateStats();
  renderSearchResults();
  fillForm(duplicate);
  showMessage("Marker dupliziert.");
};

window.deleteMarker = async function (id) {
  if (!isAdmin()) return;
  if (!confirm("Marker wirklich löschen?")) return;

  try {
    selectedHistoryMarkerId = id;
    markers = markers.filter((m) => m.id !== id);
    await saveMarkers();
    clearForm();
    renderMarkers();
    updateStats();
    renderSearchResults();
    await window.showMarkerHistory(id);
    showMessage("Marker gelöscht. Über Verlauf kannst du ihn wiederherstellen.");
  } catch (error) {
    console.error(error);
    showMessage("Marker konnte nicht gelöscht werden.", "error");
  }
};

function renderHistory(history) {
  const title = document.getElementById("historyTitle");
  const list = document.getElementById("historyList");

  if (!title || !list) return;

  if (!selectedHistoryMarkerId) {
    title.textContent = "Verlauf";
    list.innerHTML = `<div class="status-box">Noch kein Marker ausgewählt.</div>`;
    return;
  }

  const marker = markers.find((m) => m.id === selectedHistoryMarkerId);
  title.textContent = marker ? `Verlauf: ${marker.name}` : `Verlauf: ${selectedHistoryMarkerId}`;

  if (!history.length) {
    list.innerHTML = `<div class="status-box">Keine Historie gefunden.</div>`;
    return;
  }

  list.innerHTML = history
    .map((entry) => {
      const changesHtml = Array.isArray(entry.changes) && entry.changes.length
        ? `<ul>${entry.changes.map((change) => `<li><strong>${escapeHtml(change.label || change.field || "Änderung")}</strong>: ${escapeHtml(formatValue(change.before))} → ${escapeHtml(formatValue(change.after))}</li>`).join("")}</ul>`
        : "";

      const restoreButton = isAdmin()
        ? `<div class="history-actions"><button onclick="window.restoreHistoryEntry('${entry.historyId}')">Diese Version wiederherstellen</button></div>`
        : "";

      return `
        <div class="history-entry">
          <strong>${escapeHtml(entry.action)}</strong><br>
          ${escapeHtml(formatDateTime(entry.createdAt))}<br>
          Admin: ${escapeHtml(entry.adminName || "-")}<br>
          ${escapeHtml(entry.changeSummary || "-")}
          ${changesHtml}
          ${restoreButton}
        </div>
      `;
    })
    .join("");
}

window.showMarkerHistory = async function (id) {
  if (!isAdmin()) return;

  selectedHistoryMarkerId = id;
  switchToTab("history");
  renderHistory([]);

  try {
    const res = await fetch(`/api/marker-history/${encodeURIComponent(id)}`);
    const data = await res.json();

    if (!res.ok || data.success === false) {
      throw new Error(data.error || "Historie konnte nicht geladen werden.");
    }

    renderHistory(Array.isArray(data.history) ? data.history : []);
  } catch (error) {
    console.error(error);
    showMessage(error.message || "Historie konnte nicht geladen werden.", "error");
    renderHistory([]);
  }
};

window.restoreHistoryEntry = async function (historyId) {
  if (!isAdmin()) return;
  if (!confirm("Diese Version wirklich wiederherstellen?")) return;

  try {
    const res = await fetch(`/api/marker-history-entry/${encodeURIComponent(historyId)}/restore`, {
      method: "POST"
    });

    const data = await res.json();

    if (!res.ok || data.success === false) {
      throw new Error(data.error || "Version konnte nicht wiederhergestellt werden.");
    }

    await loadMarkers();
    if (data.marker?.id) {
      selectedHistoryMarkerId = data.marker.id;
      await window.showMarkerHistory(data.marker.id);
      focusMarkerById(data.marker.id, true);
    }
    showMessage("Version erfolgreich wiederhergestellt.");
  } catch (error) {
    console.error(error);
    showMessage(error.message || "Version konnte nicht wiederhergestellt werden.", "error");
  }
};

async function importMarkersFromFile() {
  if (!isAdmin()) {
    showMessage("Nur Admins dürfen importieren.", "error");
    return;
  }

  const fileInput = document.getElementById("importFile");
  const file = fileInput?.files?.[0];

  if (!file) {
    showMessage("Bitte zuerst eine JSON-Datei auswählen.", "error");
    return;
  }

  if (!confirm("Import überschreibt alle aktuellen Marker. Wirklich fortfahren?")) {
    return;
  }

  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const payload = Array.isArray(parsed) ? parsed : Array.isArray(parsed.markers) ? parsed.markers : null;

    if (!payload) {
      throw new Error("Ungültige JSON-Datei. Erwartet wird ein Array oder { markers: [...] }.");
    }

    const res = await fetch("/api/import-markers", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ markers: payload })
    });

    const data = await res.json();

    if (!res.ok || data.success === false) {
      throw new Error(data.error || "Import fehlgeschlagen.");
    }

    markers = Array.isArray(data.markers) ? data.markers : [];
    selectedHistoryMarkerId = null;
    clearForm();
    renderMarkers();
    updateStats();
    renderHistory([]);
    renderSearchResults();
    fileInput.value = "";
    showMessage(`Import erfolgreich. Marker importiert: ${data.imported || markers.length}`);
  } catch (error) {
    console.error(error);
    showMessage(error.message || "Import fehlgeschlagen.", "error");
  }
}

function setSyncStatus(state = "offline", label = "Offline") {
  const el = document.getElementById("syncStatus");
  if (!el) return;
  el.className = `sync-pill ${state}`;
  el.textContent = `● ${label}`;
}

async function fetchDashboard() {
  if (!canViewDashboard()) {
    dashboardState = null;
    renderDashboard();
    return;
  }

  try {
    const res = await fetch("/api/admin-dashboard");
    const data = await res.json();

    if (!res.ok || data.success === false) {
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
  const totalEl = document.getElementById("dashboardTotalMarkers");
  const favoritesEl = document.getElementById("dashboardFavorites");
  const territoriesEl = document.getElementById("dashboardTerritories");
  const blackmarketEl = document.getElementById("dashboardBlackmarket");
  const ownersEl = document.getElementById("dashboardTopOwners");
  const changesEl = document.getElementById("dashboardRecentChanges");
  const backupsEl = document.getElementById("dashboardBackups");
  const statusEl = document.getElementById("dashboardStatus");

  if (!totalEl || !favoritesEl || !territoriesEl || !blackmarketEl || !ownersEl || !changesEl || !backupsEl || !statusEl) return;

  if (!canViewDashboard()) {
    totalEl.textContent = "0";
    favoritesEl.textContent = "0";
    territoriesEl.textContent = "0";
    blackmarketEl.textContent = "0";
    ownersEl.innerHTML = `<div class="status-box">Dashboard nur für berechtigte Rollen sichtbar.</div>`;
    changesEl.innerHTML = `<div class="status-box">Keine Daten.</div>`;
    backupsEl.innerHTML = `<div class="status-box">Keine Daten.</div>`;
    statusEl.textContent = "Live-Übersicht für Admin / Support.";
    return;
  }

  if (!dashboardState) {
    ownersEl.innerHTML = `<div class="status-box">Dashboard wird geladen...</div>`;
    changesEl.innerHTML = `<div class="status-box">Dashboard wird geladen...</div>`;
    backupsEl.innerHTML = `<div class="status-box">Dashboard wird geladen...</div>`;
    return;
  }

  const metrics = dashboardState.metrics || {};
  totalEl.textContent = String(metrics.totalMarkers || 0);
  favoritesEl.textContent = String(metrics.favorites || 0);
  territoriesEl.textContent = String(metrics.territories || 0);
  blackmarketEl.textContent = String(metrics.blackmarket || 0);
  statusEl.textContent = lastSyncMessageAt
    ? `Live-Sync aktiv • letzte Aktualisierung ${formatDateTime(lastSyncMessageAt)}`
    : "Live-Sync aktiv";

  const topOwners = Array.isArray(dashboardState.topOwners) ? dashboardState.topOwners : [];
  ownersEl.innerHTML = topOwners.length
    ? topOwners.map((entry) => `
        <div class="dashboard-item">
          <strong>${escapeHtml(entry.owner)}</strong>
          <span>${escapeHtml(String(entry.count))} Marker</span>
        </div>
      `).join("")
    : `<div class="status-box">Noch keine Zuständigkeiten.</div>`;

  const recentChanges = Array.isArray(dashboardState.recentChanges) ? dashboardState.recentChanges : [];
  changesEl.innerHTML = recentChanges.length
    ? recentChanges.map((entry) => `
        <div class="dashboard-item dashboard-item-stack">
          <strong>${escapeHtml(entry.markerName || entry.markerId)}</strong>
          <span>${escapeHtml(entry.action)} • ${escapeHtml(entry.adminName || "-")}</span>
          <small>${escapeHtml(formatDateTime(entry.createdAt))}</small>
        </div>
      `).join("")
    : `<div class="status-box">Noch keine Änderungen.</div>`;

  const backups = Array.isArray(dashboardState.backups) ? dashboardState.backups : [];
  backupsEl.innerHTML = backups.length
    ? backups.map((entry, index) => `
        <div class="dashboard-item">
          <div>
            <strong>${escapeHtml(entry.file)}</strong>
            <div class="dashboard-meta">${escapeHtml(formatDateTime(entry.createdAt))}</div>
          </div>
          ${isAdmin() ? `<button class="secondary" onclick="window.downloadBackup('${escapeJsString(entry.file)}')">${index === 0 ? "Neueste laden" : "Laden"}</button>` : ""}
        </div>
      `).join("")
    : `<div class="status-box">Noch keine Backups.</div>`;
}

window.downloadBackup = function (file) {
  if (!isAdmin()) return;
  window.location.href = `/api/backups/${encodeURIComponent(file)}`;
};

window.createManualBackup = async function () {
  if (!isAdmin()) return;

  try {
    const res = await fetch("/api/backups/create", { method: "POST" });
    const data = await res.json();
    if (!res.ok || data.success === false) {
      throw new Error(data.error || "Backup konnte nicht erstellt werden.");
    }
    await fetchDashboard();
    showMessage(`Backup erstellt: ${data.backup?.filename || "ok"}`);
  } catch (error) {
    console.error(error);
    showMessage(error.message || "Backup konnte nicht erstellt werden.", "error");
  }
};

function startLiveSync() {
  if (liveSyncSource) {
    liveSyncSource.close();
  }

  setSyncStatus("connecting", "Verbinde…");
  liveSyncSource = new EventSource("/api/stream");

  liveSyncSource.addEventListener("connected", () => {
    setSyncStatus("online", "Live-Sync");
  });

  liveSyncSource.addEventListener("markers-updated", async (event) => {
    lastSyncMessageAt = new Date().toISOString();
    setSyncStatus("online", "Live-Sync");
    try {
      const payload = JSON.parse(event.data || "{}");
      await loadMarkers();
      if (canViewDashboard()) {
        await fetchDashboard();
      }
      if (isAdmin()) {
        await refreshRecognitionUploads();
        await refreshRecognitionReferences();
        await refreshRecognitionOverview();
      }
      if (payload.actor && payload.actor !== currentUser.username) {
        showMessage(`Live-Update von ${payload.actor} übernommen.`);
      }
    } catch (error) {
      console.error(error);
    }
  });

  liveSyncSource.addEventListener("backup-created", async () => {
    lastSyncMessageAt = new Date().toISOString();
    setSyncStatus("online", "Backup live");
    if (canViewDashboard()) {
      await fetchDashboard();
    }
  });

  liveSyncSource.addEventListener("ping", () => {
    setSyncStatus("online", "Live-Sync");
  });

  liveSyncSource.onerror = () => {
    setSyncStatus("offline", "Neu verbinden…");
  };
}

function getScoreClass(score) {
  if (Number(score) >= 80) return "high";
  if (Number(score) >= 55) return "medium";
  return "low";
}

function getStatusLabel(status) {
  return RECOGNITION_STATUS_LABELS[status] || status || "-";
}

function renderRecognitionSection() {
  renderRecognitionPreview();
  renderRecognitionMatches();
  renderRecognitionUploads();
  renderRecognitionReferences();
  renderRecognitionOverview();
}

function renderRecognitionPreview() {
  const wrap = document.getElementById("recognitionPreviewWrap");
  const empty = document.getElementById("recognitionPreviewEmpty");
  const image = document.getElementById("recognitionPreviewImage");
  const typeEl = document.getElementById("recognitionImageType");
  const statusEl = document.getElementById("recognitionStatus");
  const uploadedByEl = document.getElementById("recognitionUploadedBy");

  if (!wrap || !empty || !image || !typeEl || !statusEl || !uploadedByEl) return;

  const upload = recognitionState.currentUpload;

  if (!upload) {
    wrap.classList.add("empty");
    empty.classList.remove("hidden");
    image.classList.add("hidden");
    image.src = "";
    typeEl.textContent = "-";
    statusEl.textContent = "-";
    uploadedByEl.textContent = "-";
    return;
  }

  wrap.classList.remove("empty");
  empty.classList.add("hidden");
  image.classList.remove("hidden");
  image.src = upload.imageUrl || "";
  typeEl.textContent = upload.imageType === "ingame" ? "Ingame-Bild" : "Kartenbild";
  statusEl.textContent = getStatusLabel(upload.status);
  uploadedByEl.textContent = upload.uploadedBy || "-";
}

function selectRecognitionMatch(match) {
  recognitionState.selectedMatch = match || null;

  if (match) {
    setRecognitionMapMarker(match.lat, match.lng, `${match.markerName} • ${match.score}%`);
  } else {
    clearRecognitionMarker();
  }

  renderRecognitionMatches();
}

function renderRecognitionMatches() {
  const list = document.getElementById("recognitionMatches");
  if (!list) return;

  const matches = Array.isArray(recognitionState.currentMatches) ? recognitionState.currentMatches : [];

  if (!matches.length) {
    list.innerHTML = `<div class="status-box">Noch keine Erkennung durchgeführt.</div>`;
    return;
  }

  list.innerHTML = matches.map((match, index) => {
    const selected = recognitionState.selectedMatch?.markerId === match.markerId ? "selected" : "";
    return `
      <div class="recognition-match-card ${selected}">
        <div class="recognition-match-top">
          <div class="recognition-match-title">#${index + 1} ${escapeHtml(match.markerName || match.markerId)}</div>
          <div class="score-pill ${getScoreClass(match.score)}">${escapeHtml(String(match.score))}%</div>
        </div>

        <div class="recognition-match-meta">
          Marker-ID: ${escapeHtml(match.markerId || "-")}<br>
          Koordinaten: ${escapeHtml(formatValue(match.lat))}, ${escapeHtml(formatValue(match.lng))}<br>
          Grund: ${escapeHtml(match.reason || "-")}
        </div>

        <div class="recognition-card-actions">
          <button onclick="window.chooseRecognitionMatch('${escapeJsString(match.markerId)}')">
            ${selected ? "Ausgewählt" : "Diesen Treffer wählen"}
          </button>
          <button class="secondary" onclick="window.focusRecognitionMatch('${escapeJsString(match.markerId)}')">Auf Karte</button>
        </div>
      </div>
    `;
  }).join("");
}

function renderRecognitionUploads() {
  const list = document.getElementById("recognitionRecentUploads");
  if (!list) return;

  const uploads = Array.isArray(recognitionState.uploads) ? recognitionState.uploads.slice(0, 8) : [];

  if (!uploads.length) {
    list.innerHTML = `<div class="status-box">Noch keine Uploads.</div>`;
    return;
  }

  list.innerHTML = uploads.map((upload) => `
    <div class="recognition-upload-card">
      <div class="recognition-upload-top">
        <div class="recognition-upload-title">${escapeHtml(upload.fileName || `Upload #${upload.uploadId}`)}</div>
        <div class="type-pill">${upload.imageType === "ingame" ? "Ingame" : "Karte"}</div>
      </div>

      <div class="recognition-upload-meta">
        Status: <span class="status-pill ${escapeHtml(String(upload.status || '').toLowerCase().replace(/\s+/g, '-'))}">${escapeHtml(getStatusLabel(upload.status))}</span><br>
        Upload von: ${escapeHtml(upload.uploadedBy || "-")}<br>
        Erstellt: ${escapeHtml(formatDateTime(upload.createdAt))}
      </div>

      <div class="recognition-card-actions">
        <button onclick="window.loadRecognitionUpload(${Number(upload.uploadId)})">Öffnen</button>
        <button class="secondary" onclick="window.openImageModal('${escapeJsString(upload.imageUrl || "")}')">Bild</button>
      </div>
    </div>
  `).join("");
}

function renderRecognitionOverview() {
  const totalUploads = document.getElementById("recognitionTotalUploads");
  const totalRefs = document.getElementById("recognitionTotalReferences");
  const confirmed = document.getElementById("recognitionConfirmedCount");
  const rejected = document.getElementById("recognitionRejectedCount");

  if (!totalUploads || !totalRefs || !confirmed || !rejected) return;

  const overview = recognitionState.overview || {};
  totalUploads.textContent = String(overview.totalUploads || 0);
  totalRefs.textContent = String(overview.totalReferences || 0);

  const breakdown = Array.isArray(overview.statusBreakdown) ? overview.statusBreakdown : [];
  const confirmedItem = breakdown.find((entry) => entry.status === "bestätigt");
  const rejectedItem = breakdown.find((entry) => entry.status === "abgelehnt");

  confirmed.textContent = String(confirmedItem?.count || 0);
  rejected.textContent = String(rejectedItem?.count || 0);
}

function renderRecognitionReferences() {
  const grid = document.getElementById("referenceList");
  if (!grid) return;

  const references = Array.isArray(recognitionState.references) ? recognitionState.references : [];

  if (!references.length) {
    grid.innerHTML = `<div class="status-box">Noch keine Referenzen geladen.</div>`;
    return;
  }

  grid.innerHTML = references.map((ref) => `
    <div class="reference-card">
      ${ref.imageUrl ? `<img class="reference-image" src="${escapeHtml(ref.imageUrl)}" alt="Referenzbild" ondblclick="window.openImageModal('${escapeJsString(ref.imageUrl)}')">` : ""}
      <div class="reference-content">
        <div class="reference-top">
          <div class="reference-title">${escapeHtml(ref.markerName || ref.markerId || "Unbekannt")}</div>
          <div class="type-pill">${ref.imageType === "ingame" ? "Ingame" : "Karte"}</div>
        </div>

        <div class="reference-meta">
          Marker-ID: ${escapeHtml(ref.markerId || "-")}<br>
          Status: ${escapeHtml(getStatusLabel(ref.status))}<br>
          Koordinaten: ${escapeHtml(formatValue(ref.lat))}, ${escapeHtml(formatValue(ref.lng))}<br>
          Erstellt von: ${escapeHtml(ref.createdBy || "-")}<br>
          Erstellt: ${escapeHtml(formatDateTime(ref.createdAt))}
        </div>

        <div class="reference-actions">
          <button class="secondary" onclick="window.openImageModal('${escapeJsString(ref.imageUrl || "")}')">Bild</button>
          <button class="secondary" onclick="window.focusReference('${escapeJsString(ref.markerId || "")}', ${Number(ref.lat ?? 0)}, ${Number(ref.lng ?? 0)})">Auf Karte</button>
          <button class="secondary" onclick="window.deleteReference(${Number(ref.referenceId)})">Löschen</button>
        </div>
      </div>
    </div>
  `).join("");
}

async function refreshRecognitionOverview() {
  if (!isAdmin()) return;

  try {
    const res = await fetch("/api/image-intelligence/overview");
    const data = await res.json();
    if (!res.ok || data.success === false) {
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
    const res = await fetch("/api/image-intelligence/uploads");
    const data = await res.json();
    if (!res.ok || data.success === false) {
      throw new Error(data.error || "Uploads konnten nicht geladen werden.");
    }

    recognitionState.uploads = Array.isArray(data.uploads) ? data.uploads : [];

    if (recognitionState.currentUpload) {
      const fresh = recognitionState.uploads.find((entry) => entry.uploadId === recognitionState.currentUpload.uploadId);
      if (fresh) {
        recognitionState.currentUpload = fresh;
        recognitionState.currentMatches = Array.isArray(fresh.matches) ? fresh.matches : [];
        if (recognitionState.currentMatches.length) {
          const selectedStillExists = recognitionState.currentMatches.find((entry) => entry.markerId === recognitionState.selectedMatch?.markerId);
          recognitionState.selectedMatch = selectedStillExists || recognitionState.currentMatches[0];
        } else {
          recognitionState.selectedMatch = null;
        }
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
    const res = await fetch(`/api/image-intelligence/references?type=${encodeURIComponent(type)}`);
    const data = await res.json();
    if (!res.ok || data.success === false) {
      throw new Error(data.error || "Referenzen konnten nicht geladen werden.");
    }

    recognitionState.references = Array.isArray(data.references) ? data.references : [];
    renderRecognitionReferences();
  } catch (error) {
    console.error(error);
  }
}

async function uploadRecognitionImage(imageType, file) {
  if (!isAdmin()) return;
  if (!file) return;

  const formData = new FormData();
  formData.append("file", file);
  formData.append("imageType", imageType);

  try {
    showMessage("Bild wird verarbeitet...");
    const res = await fetch("/api/image-intelligence/upload", {
      method: "POST",
      body: formData
    });

    const data = await res.json();

    if (!res.ok || data.success === false) {
      throw new Error(data.error || "Bild konnte nicht erkannt werden.");
    }

    recognitionState.currentUpload = data.upload || null;
    recognitionState.currentMatches = Array.isArray(data.matches) ? data.matches : [];
    recognitionState.selectedMatch = recognitionState.currentMatches[0] || null;
    recognitionState.manualPlacementMode = false;

    if (recognitionState.selectedMatch) {
      setRecognitionMapMarker(
        recognitionState.selectedMatch.lat,
        recognitionState.selectedMatch.lng,
        `${recognitionState.selectedMatch.markerName} • ${recognitionState.selectedMatch.score}%`
      );
    } else {
      clearRecognitionMarker();
    }

    renderRecognitionSection();
    switchToTab("recognition");
    await refreshRecognitionUploads();
    await refreshRecognitionReferences();
    await refreshRecognitionOverview();
    showMessage("Bild erkannt. Treffer wurden vorbereitet.");
  } catch (error) {
    console.error(error);
    showMessage(error.message || "Bild konnte nicht verarbeitet werden.", "error");
  }
}

window.chooseRecognitionMatch = function (markerId) {
  const match = recognitionState.currentMatches.find((entry) => entry.markerId === markerId);
  if (!match) return;
  selectRecognitionMatch(match);
};

window.focusRecognitionMatch = function (markerId) {
  const match = recognitionState.currentMatches.find((entry) => entry.markerId === markerId);
  if (!match) return;
  selectRecognitionMatch(match);
};

window.loadRecognitionUpload = function (uploadId) {
  const upload = recognitionState.uploads.find((entry) => Number(entry.uploadId) === Number(uploadId));
  if (!upload) return;

  recognitionState.currentUpload = upload;
  recognitionState.currentMatches = Array.isArray(upload.matches) ? upload.matches : [];
  recognitionState.selectedMatch = recognitionState.currentMatches[0] || null;
  recognitionState.manualPlacementMode = false;

  if (recognitionState.selectedMatch) {
    setRecognitionMapMarker(
      recognitionState.selectedMatch.lat,
      recognitionState.selectedMatch.lng,
      `${recognitionState.selectedMatch.markerName} • ${recognitionState.selectedMatch.score}%`
    );
  } else {
    clearRecognitionMarker();
  }

  renderRecognitionSection();
  switchToTab("recognition");
};

window.focusReference = function (markerId, lat, lng) {
  if (markerId) {
    focusMarkerById(markerId, true);
    return;
  }

  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    setRecognitionMapMarker(lat, lng, "Referenz");
  }
};

window.deleteReference = async function (referenceId) {
  if (!isAdmin()) return;
  if (!confirm("Referenz wirklich löschen?")) return;

  try {
    const res = await fetch(`/api/image-intelligence/references/${encodeURIComponent(referenceId)}`, {
      method: "DELETE"
    });
    const data = await res.json();
    if (!res.ok || data.success === false) {
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

async function confirmRecognitionSelection() {
  if (!isAdmin()) return;
  if (!recognitionState.currentUpload || !recognitionState.selectedMatch) return;

  const lat = Number(document.getElementById("markerLat").value);
  const lng = Number(document.getElementById("markerLng").value);

  const res = await fetch("/api/image-intelligence/confirm", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      uploadId: recognitionState.currentUpload.uploadId,
      markerId: recognitionState.selectedMatch.markerId,
      lat,
      lng,
      status: recognitionState.manualPlacementMode ? "manuell korrigiert" : "bestätigt",
      notes: recognitionState.manualPlacementMode ? "Position wurde manuell auf der Karte gesetzt." : "Treffer wurde übernommen."
    })
  });

  const data = await res.json();
  if (!res.ok || data.success === false) {
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

  downloadJson("markers-visible.json", getVisibleMarkers());
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
