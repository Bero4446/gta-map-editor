const MAP_IMAGE = "GTAV-HD-MAP-satellite.jpg";
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
let currentUser = {
  loggedIn: false,
  username: "",
  isVip: false,
  isAdmin: false,
  id: ""
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

function canAccessAdminArea() {
  return !!currentUser.loggedIn && !!currentUser.isAdmin;
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
  return String(value);
}

function getActiveFilters() {
  return Array.from(document.querySelectorAll("[data-filter]:checked")).map((el) => el.dataset.filter);
}

function getSearchValue() {
  return document.getElementById("globalSearch")?.value.trim().toLowerCase() || "";
}

function getOwnerFilterValue() {
  if (!isAdmin()) return "";
  return document.getElementById("ownerFilter")?.value.trim().toLowerCase() || "";
}

function getRadiusValueFromForm() {
  const raw = Number(document.getElementById("markerRadius")?.value || 0);
  if (!Number.isFinite(raw) || raw <= 0) return 200;
  return Math.max(50, Math.round(raw));
}

function getSearchText(marker) {
  const base = `${marker.name} ${marker.description} ${marker.category}`.toLowerCase();
  if (!isAdmin()) return base;
  return `${base} ${marker.owner || ""}`.toLowerCase();
}

function shouldShowMarker(marker) {
  const activeFilters = getActiveFilters();
  const searchValue = getSearchValue();
  const favoritesOnly = !!document.getElementById("favoritesOnly")?.checked;
  const ownerFilter = getOwnerFilterValue();
  const myMarkersOnly = isAdmin() && !!document.getElementById("myMarkersOnly")?.checked;

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
  const saveButton = document.getElementById("saveMarker");
  const historyHint = document.getElementById("historyHint");

  if (!currentUser.loggedIn) {
    if (loginStatus) loginStatus.textContent = "Nicht eingeloggt";
    if (roleInfo) roleInfo.textContent = "Discord Login nötig. Marker erstellen/bearbeiten nur mit Admin-Rolle.";
    if (logoutBtn) logoutBtn.classList.add("hidden");
    if (historyHint) historyHint.textContent = "Historie erst nach Admin-Login sichtbar.";

    vipElements.forEach((el) => el.classList.add("hidden"));
    adminElements.forEach((el) => el.classList.add("hidden"));

    if (saveButton) {
      saveButton.disabled = true;
      saveButton.textContent = "Nur Admin";
    }

    ensureAllowedActiveTab();
    renderSearchResults();
    return;
  }

  const roles = [];
  if (currentUser.isAdmin) roles.push("Admin");
  if (currentUser.isVip) roles.push("VIP");

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

  if (logoutBtn) logoutBtn.classList.remove("hidden");

  if (isVipOrAdmin()) {
    vipElements.forEach((el) => el.classList.remove("hidden"));
  } else {
    vipElements.forEach((el) => el.classList.add("hidden"));
  }

  if (canAccessAdminArea()) {
    adminElements.forEach((el) => el.classList.remove("hidden"));
  } else {
    adminElements.forEach((el) => el.classList.add("hidden"));
  }

  if (saveButton) {
    if (isAdmin()) {
      saveButton.disabled = false;
      saveButton.textContent = selectedMarkerId ? "Änderungen speichern" : "Speichern";
    } else {
      saveButton.disabled = true;
      saveButton.textContent = "Nur Admin";
    }
  }

  ensureAllowedActiveTab();
  renderSearchResults();
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
    body: JSON.stringify({
      markers
    })
  });

  const data = await response.json();

  if (!response.ok || data.success === false) {
    throw new Error(data.error || "Marker konnten nicht gespeichert werden.");
  }

  if (Array.isArray(data.markers)) {
    markers = data.markers;
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

  const ownerHtml = isAdmin()
    ? `<div class="popup-meta">Besitzer/Zuständigkeit: ${escapeHtml(marker.owner || "-")}</div>`
    : "";

  const favoriteHtml = marker.favorite
    ? `<div class="popup-meta">⭐ Favorit</div>`
    : "";

  const territoryHtml = marker.category === "Fraktionsgebiet"
    ? `<div class="popup-meta">Gebietsradius: ${escapeHtml(formatValue(marker.radius || 200))} m</div>`
    : "";

  const adminButtons = isAdmin()
    ? `
      <button onclick="window.editMarker('${marker.id}')">Bearbeiten</button>
      <button onclick="window.toggleMarkerFavorite('${marker.id}')">${marker.favorite ? "Favorit entfernen" : "Als Favorit"}</button>
      <button onclick="window.showMarkerHistory('${marker.id}')">Verlauf</button>
      <button class="secondary" onclick="window.copyMarkerOwner('${marker.id}')">Besitzer kopieren</button>
      <button class="secondary" onclick="window.deleteMarker('${marker.id}')">Löschen</button>
    `
    : "";

  const adminMeta = isAdmin()
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
      draggable: isAdmin(),
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
      if (!isAdmin()) return;

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
    .concat([...grouped.keys()].filter((category) => !categoryOrder.includes(category)).sort((a, b) => a.localeCompare(b, "de")));

  list.innerHTML = sortedCategories.map((category, index) => {
    const items = grouped.get(category) || [];
    const meta = CATEGORY_META[category] || { icon: "📍", label: category };
    const isOpen = searchValue ? "open" : index === 0 ? "open" : "";

    const cards = items.map((marker) => {
      const owner = isAdmin() ? `<div class="search-result-meta">Besitzer: ${escapeHtml(marker.owner || "-")}</div>` : "";
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
            ${isAdmin() ? `<button class="secondary" onclick="window.editMarker('${marker.id}')">Bearbeiten</button>` : ""}
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
  if (!file) return null;

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

  return data.path || "";
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
  if (!isAdmin()) return;
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

async function handleSaveMarker() {
  if (!isAdmin()) {
    showMessage("Nur Admins dürfen Marker erstellen oder bearbeiten.", "error");
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
        image: imagePath || "",
        createdBy: currentUser.username,
        updatedBy: currentUser.username,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }

    await saveMarkers();
    clearForm();
    renderMarkers();
    updateStats();
    renderSearchResults();
    showMessage(wasEditing ? "Marker gespeichert." : "Marker erstellt.");
  } catch (error) {
    console.error(error);
    showMessage(error.message || "Marker konnte nicht gespeichert werden.", "error");
  }
}

function cryptoRandomId() {
  if (window.crypto && window.crypto.randomUUID) {
    return window.crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

window.editMarker = function (id) {
  if (!isAdmin()) return;

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
  if (!isAdmin()) return;

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

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    window.closeImageModal();
  }
});

(async function init() {
  await fetchUser();
  await loadMarkers();
  clearForm();
})();
