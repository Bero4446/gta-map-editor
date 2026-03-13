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
  Workstation: createEmojiIcon("🖥️"),
  Schwarzmarkt: createEmojiIcon("🕶")
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

function getActiveFilters() {
  return Array.from(document.querySelectorAll("[data-filter]:checked")).map((el) => el.dataset.filter);
}

function shouldShowMarker(marker) {
  const activeFilters = getActiveFilters();
  const searchValue = document.getElementById("markerSearch")?.value.trim().toLowerCase() || "";

  if (!activeFilters.includes(marker.category)) return false;
  if (marker.category === "Schwarzmarkt" && !(currentUser.isVip || currentUser.isAdmin)) return false;

  if (!searchValue) return true;

  const text = `${marker.name} ${marker.description} ${marker.category}`.toLowerCase();
  return text.includes(searchValue);
}

function isAdmin() {
  return !!currentUser.isAdmin;
}

function isVipOrAdmin() {
  return !!currentUser.isVip || !!currentUser.isAdmin;
}

function clearForm() {
  selectedMarkerId = null;
  document.getElementById("markerName").value = "";
  document.getElementById("markerDescription").value = "";
  document.getElementById("markerCategory").value = "Dealer";
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
    if (loginStatus) loginStatus.textContent = "Nicht eingeloggt";
    if (roleInfo) roleInfo.textContent = "Discord Login nötig. Marker erstellen/bearbeiten nur mit Admin-Rolle.";
    if (logoutBtn) logoutBtn.classList.add("hidden");
    vipElements.forEach((el) => el.classList.add("hidden"));
    if (saveButton) {
      saveButton.disabled = true;
      saveButton.textContent = "Nur Admin";
    }
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

  if (logoutBtn) logoutBtn.classList.remove("hidden");

  if (isVipOrAdmin()) {
    vipElements.forEach((el) => el.classList.remove("hidden"));
  } else {
    vipElements.forEach((el) => el.classList.add("hidden"));
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

    const layer = L.marker([Number(marker.lat), Number(marker.lng)], {
      icon: icons[marker.category] || icons.Dealer,
      draggable: isAdmin(),
      title: marker.name
    }).addTo(map);

    layer.bindTooltip(marker.name || "Marker", {
      direction: "top",
      opacity: 0.95
    });

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

    const popupMeta = `
      <div class="popup-meta">
        Lat: ${Number(marker.lat).toFixed(2)} | Lng: ${Number(marker.lng).toFixed(2)}
      </div>
    `;

    const adminActions = isAdmin()
      ? `
        <div class="popup-actions">
          <button onclick="window.editMarker('${marker.id}')">Bearbeiten</button>
          <button class="secondary" onclick="window.deleteMarker('${marker.id}')">Löschen</button>
        </div>
      `
      : "";

    layer.bindPopup(`
      <div>
        <div class="popup-title">${escapeHtml(marker.name)}</div>
        <div class="popup-category">Kategorie: ${escapeHtml(marker.category)}</div>
        ${descriptionHtml}
        ${popupMeta}
        ${imageHtml}
        ${adminActions}
      </div>
    `);

    layer.on("click", () => {
      map.flyTo([Number(marker.lat), Number(marker.lng)], Math.max(map.getZoom(), -1.5), {
        duration: 0.45
      });
    });

    layer.on("dragend", async (e) => {
      if (!isAdmin()) return;

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
    (m) => m.category === "Schwarzmarkt" && isVipOrAdmin()
  );

  const statTotal = document.getElementById("statTotal");
  const statDealer = document.getElementById("statDealer");
  const statUG = document.getElementById("statUG");
  const statField = document.getElementById("statField");
  const statWorkstation = document.getElementById("statWorkstation");
  const statVip = document.getElementById("statVip");

  if (statTotal) statTotal.textContent = `Marker: ${visible.length}`;
  if (statDealer) statDealer.textContent = `Dealer: ${markers.filter((m) => m.category === "Dealer").length}`;
  if (statUG) statUG.textContent = `UG: ${markers.filter((m) => m.category === "UG").length}`;
  if (statField) statField.textContent = `Felder: ${markers.filter((m) => m.category === "Feld").length}`;
  if (statWorkstation) statWorkstation.textContent = `Workstations: ${markers.filter((m) => m.category === "Workstation").length}`;
  if (statVip) statVip.textContent = `Schwarzmarkt: ${vipVisible.length}`;
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

function escapeJsString(str) {
  return String(str)
    .replaceAll("\\", "\\\\")
    .replaceAll("'", "\\'");
}

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

async function handleSaveMarker() {
  if (!isAdmin()) {
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
  renderMarkers();
  updateStats();
}

window.editMarker = function (id) {
  if (!isAdmin()) return;
  const marker = markers.find((m) => m.id === id);
  if (!marker) return;

  fillForm(marker);

  document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
  document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));
  document.querySelector('[data-tab="editor"]')?.classList.add("active");
  document.getElementById("editor")?.classList.add("active");
};

window.deleteMarker = async function (id) {
  if (!isAdmin()) return;
  if (!confirm("Marker wirklich löschen?")) return;

  markers = markers.filter((m) => m.id !== id);
  await saveMarkers();
  clearForm();
  renderMarkers();
  updateStats();
};

map.on("click", (e) => {
  document.getElementById("markerLat").value = roundCoord(e.latlng.lat);
  document.getElementById("markerLng").value = roundCoord(e.latlng.lng);

  const coordInfo = document.getElementById("coordInfo");
  if (coordInfo) {
    coordInfo.textContent =
      `Koordinaten übernommen: Lat ${roundCoord(e.latlng.lat)} | Lng ${roundCoord(e.latlng.lng)}`;
  }
});

document.getElementById("saveMarker")?.addEventListener("click", handleSaveMarker);
document.getElementById("clearForm")?.addEventListener("click", clearForm);

document.getElementById("markerSearch")?.addEventListener("input", () => {
  const search = document.getElementById("markerSearch").value.trim().toLowerCase();

  renderMarkers();
  updateStats();

  if (!search) return;

  const found = markers.find((marker) => {
    if (marker.category === "Schwarzmarkt" && !isVipOrAdmin()) return false;
    const text = `${marker.name} ${marker.description} ${marker.category}`.toLowerCase();
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

document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(btn.dataset.tab)?.classList.add("active");
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
  await fetchUser();
  await loadMarkers();
  setTimeout(() => map.invalidateSize(), 150);
}

init();
