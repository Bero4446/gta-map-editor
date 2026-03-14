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
map.fitBounds(BOUNDS);
map.setZoom(-2);

let markers = [];
let markerLayers = [];
let selectedMarkerId = null;
let selectedHistoryMarkerId = null;
let currentUser = {
  loggedIn: false,
  username: "",
  isVip: false,
  isAdmin: false,
  id: ""
};

const icons = {
  Dealer: createEmojiIcon("💊"),
  UG: createEmojiIcon("🔫"),
  Feld: createEmojiIcon("🌿"),
  Workstation: createEmojiIcon("🖥️"),
  Schwarzmarkt: createEmojiIcon("🕶"),
  "Fraktions Krankenhaus": createEmojiIcon("🏥"),
  Systempunkteshop: createEmojiIcon("🛒"),
  Fraktion: createEmojiIcon("🛡️")
};

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

function shouldShowMarker(marker) {
  const activeFilters = getActiveFilters();
  const searchValue = document.getElementById("markerSearch")?.value.trim().toLowerCase() || "";
  const favoritesOnly = !!document.getElementById("favoritesOnly")?.checked;

  if (!activeFilters.includes(marker.category)) return false;
  if (marker.category === "Schwarzmarkt" && !isVipOrAdmin()) return false;
  if (favoritesOnly && !marker.favorite) return false;

  if (!searchValue) return true;

  const text = `${marker.name} ${marker.description} ${marker.category} ${marker.owner || ""}`.toLowerCase();
  return text.includes(searchValue);
}

function getVisibleMarkers() {
  return markers.filter((marker) => shouldShowMarker(marker));
}

function getSortedMarkers() {
  return [...markers].sort((a, b) => {
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

function clearForm() {
  selectedMarkerId = null;
  document.getElementById("markerName").value = "";
  document.getElementById("markerDescription").value = "";
  document.getElementById("markerCategory").value = "Dealer";
  document.getElementById("markerOwner").value = "";
  document.getElementById("markerFavorite").checked = false;
  document.getElementById("markerLat").value = "";
  document.getElementById("markerLng").value = "";

  const img = document.getElementById("markerImage");
  if (img) img.value = "";

  const editModeInfo = document.getElementById("editModeInfo");
  if (editModeInfo) editModeInfo.classList.add("hidden");

  updateUserUi();
}

function fillForm(marker) {
  selectedMarkerId = marker.id;
  document.getElementById("markerName").value = marker.name || "";
  document.getElementById("markerDescription").value = marker.description || "";
  document.getElementById("markerCategory").value = marker.category || "Dealer";
  document.getElementById("markerOwner").value = marker.owner || "";
  document.getElementById("markerFavorite").checked = !!marker.favorite;
  document.getElementById("markerLat").value = marker.lat;
  document.getElementById("markerLng").value = marker.lng;

  const editModeInfo = document.getElementById("editModeInfo");
  if (editModeInfo) editModeInfo.classList.remove("hidden");

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
      ? "Wähle einen Marker aus, um seinen Verlauf zu sehen."
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
}

async function loadMarkers() {
  try {
    const res = await fetch("/markers");
    if (!res.ok) throw new Error("Marker konnten nicht geladen werden.");

    markers = await res.json();
    renderMarkers();
    updateStats();
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
    ? `<div class="popup-meta">Besitzer: ${escapeHtml(marker.owner || "-")}</div>`
    : "";

  const favoriteHtml = marker.favorite
    ? `<div class="popup-meta">⭐ Favorit</div>`
    : "";

  const adminButtons = isAdmin()
    ? `
      <button onclick="window.editMarker('${marker.id}')">Bearbeiten</button>
      <button onclick="window.toggleMarkerFavorite('${marker.id}')">${marker.favorite ? "Favorit entfernen" : "Als Favorit"}</button>
      <button onclick="window.showMarkerHistory('${marker.id}')">Verlauf</button>
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

function renderMarkers() {
  markerLayers.forEach((layer) => map.removeLayer(layer));
  markerLayers = [];

  getSortedMarkers().forEach((marker) => {
    if (!shouldShowMarker(marker)) return;

    const layer = L.marker([Number(marker.lat), Number(marker.lng)], {
      icon: icons[marker.category] || icons.Dealer,
      draggable: isAdmin(),
      title: marker.favorite ? `⭐ ${marker.name}` : marker.name
    }).addTo(map);

    layer.bindTooltip(marker.favorite ? `⭐ ${marker.name}` : (marker.name || "Marker"), {
      direction: "top",
      opacity: 0.95
    });

    layer.bindPopup(buildPopupHtml(marker));

    layer.on("click", () => {
      map.flyTo([Number(marker.lat), Number(marker.lng)], Math.max(map.getZoom(), -1.5), {
        duration: 0.45
      });
    });

    layer.on("dragend", async (e) => {
      if (!isAdmin()) return;

      try {
        const pos = e.target.getLatLng();
        marker.lat = roundCoord(pos.lat);
        marker.lng = roundCoord(pos.lng);

        await saveMarkers();
        updateStats();
        renderMarkers();
        showMessage("Marker verschoben und gespeichert.");
      } catch (error) {
        console.error(error);
        showMessage("Marker konnte nicht verschoben werden.", "error");
      }
    });

    markerLayers.push(layer);
  });
}

function updateStats() {
  const visible = getVisibleMarkers();
  const allVisibleForUser = markers.filter((m) => m.category !== "Schwarzmarkt" || isVipOrAdmin());
  const favoriteCount = allVisibleForUser.filter((m) => m.favorite).length;
  const vipVisible = markers.filter((m) => m.category === "Schwarzmarkt" && isVipOrAdmin());

  const statTotal = document.getElementById("statTotal");
  const statDealer = document.getElementById("statDealer");
  const statUG = document.getElementById("statUG");
  const statField = document.getElementById("statField");
  const statWorkstation = document.getElementById("statWorkstation");
  const statHospital = document.getElementById("statHospital");
  const statPointShop = document.getElementById("statPointShop");
  const statFaction = document.getElementById("statFaction");
  const statVip = document.getElementById("statVip");
  const statFavorites = document.getElementById("statFavorites");

  if (statTotal) statTotal.textContent = `Marker sichtbar: ${visible.length}`;
  if (statDealer) statDealer.textContent = `Dealer: ${markers.filter((m) => m.category === "Dealer").length}`;
  if (statUG) statUG.textContent = `UG: ${markers.filter((m) => m.category === "UG").length}`;
  if (statField) statField.textContent = `Felder: ${markers.filter((m) => m.category === "Feld").length}`;
  if (statWorkstation) statWorkstation.textContent = `Workstations: ${markers.filter((m) => m.category === "Workstation").length}`;
  if (statHospital) statHospital.textContent = `Fraktions Krankenhaus: ${markers.filter((m) => m.category === "Fraktions Krankenhaus").length}`;
  if (statPointShop) statPointShop.textContent = `Systempunkteshop: ${markers.filter((m) => m.category === "Systempunkteshop").length}`;
  if (statFaction) statFaction.textContent = `Fraktion: ${markers.filter((m) => m.category === "Fraktion").length}`;
  if (statVip) statVip.textContent = `Schwarzmarkt: ${vipVisible.length}`;
  if (statFavorites) statFavorites.textContent = `Favoriten: ${favoriteCount}`;
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
    markers = markers.filter((m) => m.id !== id);
    await saveMarkers();
    clearForm();
    renderMarkers();
    updateStats();

    if (selectedHistoryMarkerId === id) {
      selectedHistoryMarkerId = null;
      renderHistory([]);
    }

    showMessage("Marker gelöscht.");
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
  title.textContent = marker ? `Verlauf: ${marker.name}` : "Verlauf";

  if (!history.length) {
    list.innerHTML = `<div class="status-box">Keine Historie gefunden.</div>`;
    return;
  }

  list.innerHTML = history
    .map((entry) => {
      const changesHtml = Array.isArray(entry.changes) && entry.changes.length
        ? `<ul>${entry.changes.map((change) => `<li><strong>${escapeHtml(change.label || change.field || "Änderung")}</strong>: ${escapeHtml(formatValue(change.before))} → ${escapeHtml(formatValue(change.after))}</li>`).join("")}</ul>`
        : "";

      return `
        <div class="stat-card">
          <strong>${escapeHtml(entry.action)}</strong><br>
          ${escapeHtml(formatDateTime(entry.createdAt))}<br>
          Admin: ${escapeHtml(entry.adminName || "-")}<br>
          ${escapeHtml(entry.changeSummary || "-")}
          ${changesHtml}
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

document.getElementById("markerSearch")?.addEventListener("input", () => {
  const search = document.getElementById("markerSearch").value.trim().toLowerCase();

  renderMarkers();
  updateStats();

  if (!search) return;

  const found = getSortedMarkers().find((marker) => {
    if (!shouldShowMarker(marker)) return false;
    const text = `${marker.name} ${marker.description} ${marker.category} ${marker.owner || ""}`.toLowerCase();
    return text.includes(search);
  });

  if (found) {
    map.flyTo([Number(found.lat), Number(found.lng)], Math.max(map.getZoom(), -1.25), {
      duration: 0.6
    });
  }
});

document.querySelectorAll("[data-filter]").forEach((checkbox) => {
  checkbox.addEventListener("change", () => {
    renderMarkers();
    updateStats();
  });
});

document.getElementById("favoritesOnly")?.addEventListener("change", () => {
  renderMarkers();
  updateStats();
});

document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (btn.classList.contains("hidden")) return;
    switchToTab(btn.dataset.tab);
  });
});

document.getElementById("panelToggle")?.addEventListener("click", () => {
  document.getElementById("panel")?.classList.toggle("collapsed");
  setTimeout(() => map.invalidateSize(), 260);
});

document.getElementById("discordLogin")?.addEventListener("click", () => {
  window.location.href = "/auth/discord";
});

document.getElementById("logoutBtn")?.addEventListener("click", () => {
  window.location.href = "/logout";
});

document.getElementById("closeImageModal")?.addEventListener("click", () => {
  window.closeImageModal();
});

document.querySelector(".image-modal-backdrop")?.addEventListener("click", () => {
  window.closeImageModal();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    window.closeImageModal();
  }
});

async function init() {
  renderHistory([]);
  await fetchUser();
  await loadMarkers();
  setTimeout(() => map.invalidateSize(), 150);
}

init();
