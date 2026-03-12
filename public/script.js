const ADMIN_PASSWORD = "gta44";
const ADMIN_NAME = "bero";

let isAdmin = false;
let markers = [];
let markerLayers = [];

const searchInput = document.getElementById("searchInput");
const searchBtn = document.getElementById("searchBtn");
const categorySelect = document.getElementById("categorySelect");
const adminLoginBtn = document.getElementById("adminLoginBtn");
const adminStatus = document.getElementById("adminStatus");
const screenshotInput = document.getElementById("screenshotInput");

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
    iconSize: [40, 40]
  }),
  vagos: L.icon({
    iconUrl: "icons/vagos.png",
    iconSize: [40, 40]
  }),
  normal: L.icon({
    iconUrl: "icons/normal.png",
    iconSize: [40, 40]
  })
};

function updateAdminStatus() {
  adminStatus.textContent = isAdmin
    ? `Admin eingeloggt: ${ADMIN_NAME}`
    : "Nicht eingeloggt";
}

function getIcon(category) {
  return icons[category] || icons.normal;
}

function buildPopup(marker) {
  const imageHtml = marker.screenshot
    ? `<img class="popup-img" src="screenshots/${marker.screenshot}" style="width:200px;margin-top:10px;">`
    : `<div style="margin-top:10px;color:#bbb;">Kein Screenshot</div>`;

  const adminButtons = isAdmin
    ? `
      <div style="margin-top:10px;">
        <button onclick="editMarker('${marker.id}')">Bearbeiten</button>
        <button onclick="deleteMarker('${marker.id}')">Löschen</button>
      </div>
    `
    : "";

  return `
    <b>${marker.name}</b><br>
    Kategorie: ${marker.category}
    ${imageHtml}
    ${adminButtons}
  `;
}

function clearMarkerLayers() {
  markerLayers.forEach(layer => map.removeLayer(layer));
  markerLayers = [];
}

function drawMarkers() {
  clearMarkerLayers();

  markers.forEach(marker => {

    const layer = L.marker(marker.pos, {
      icon: getIcon(marker.category),
      draggable: isAdmin
    }).addTo(map);

    layer.bindPopup(buildPopup(marker));

    if (isAdmin) {
      layer.on("dragend", async function (e) {
        const newPos = e.target.getLatLng();
        marker.pos = newPos;

        await saveMarkers();
        drawMarkers();
      });
    }

    markerLayers.push(layer);
  });
}

async function loadMarkers() {
  const res = await fetch("/markers");
  markers = await res.json();
  drawMarkers();
}

async function saveMarkers() {
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

searchBtn.addEventListener("click", () => {

  const text = searchInput.value.trim().toLowerCase();

  if (!text) return;

  const found = markers.find(m =>
    m.name.toLowerCase().includes(text)
  );

  if (!found) {
    alert("Kein Ort gefunden.");
    return;
  }

  map.setView(found.pos, 2);

});

map.on("click", async (e) => {

  if (!isAdmin) {
    alert("Nur Admins können Marker erstellen.");
    return;
  }

  const name = prompt("Ort Name:");

  if (!name) return;

  const wantsScreenshot = confirm("Screenshot hinzufügen?");
  let screenshotFile = "";

  if (wantsScreenshot) {

    screenshotInput.value = "";
    screenshotInput.click();

    const file = await new Promise(resolve => {
      screenshotInput.onchange = () =>
        resolve(screenshotInput.files[0] || null);
    });

    if (file) {
      const uploadResult = await uploadScreenshot(file);
      screenshotFile = uploadResult.file || "";
    }
  }

  const newMarker = {
    id: String(Date.now()),
    name,
    category: categorySelect.value,
    pos: e.latlng,
    screenshot: screenshotFile
  };

  markers.push(newMarker);

  await saveMarkers();

  drawMarkers();

});

window.deleteMarker = async function (id) {

  const ok = confirm("Marker wirklich löschen?");

  if (!ok) return;

  markers = markers.filter(marker => marker.id !== id);

  await saveMarkers();

  drawMarkers();

};

window.editMarker = async function (id) {

  const marker = markers.find(m => m.id === id);

  if (!marker) return;

  const newName = prompt("Neuer Name:", marker.name);

  if (!newName) return;

  marker.name = newName;

  await saveMarkers();

  drawMarkers();

};

updateAdminStatus();
loadMarkers();
