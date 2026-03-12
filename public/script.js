const map = L.map("map",{
crs:L.CRS.Simple,
minZoom:-4,
maxZoom:2
});

const bounds=[[0,0],[8192,8192]];

L.imageOverlay("GTAV-HD-MAP-satellite.jpg",bounds).addTo(map);

map.fitBounds(bounds);

let markers=[];
let markerObjects=[];
let selectedMarker=null;

/* ICONS */

const icons={
Dealer:L.divIcon({html:"💊",className:"marker-icon"}),
UG:L.divIcon({html:"🔫",className:"marker-icon"}),
Feld:L.divIcon({html:"🌿",className:"marker-icon"}),
Schwarzmarkt:L.divIcon({html:"🕶",className:"marker-icon"})
};

/* LOAD MARKERS */

async function loadMarkers(){

const res=await fetch("/markers");
markers=await res.json();

renderMarkers();
updateStats();

}

/* RENDER MARKERS */

function renderMarkers(){

markerObjects.forEach(m=>map.removeLayer(m));
markerObjects=[];

markers.forEach(m=>{

const marker=L.marker([m.lat,m.lng],{
icon:icons||icons.Dealer,
draggable:true
}).addTo(map);

marker.bindPopup(`<b>${m.name}</b><br>
Kategorie: ${m.category}<br><br> <button onclick="editMarker('${m.id}')">Bearbeiten</button> <button onclick="deleteMarker('${m.id}')">Löschen</button>`);

marker.on("dragend",e=>{

const pos=e.target.getLatLng();

m.lat=pos.lat;
m.lng=pos.lng;

saveMarkers();

});

markerObjects.push(marker);

});

}

/* MAP CLICK */

map.on("click",e=>{

const lat=e.latlng.lat.toFixed(2);
const lng=e.latlng.lng.toFixed(2);

document.getElementById("markerLat").value=lat;
document.getElementById("markerLng").value=lng;

});

/* SAVE MARKER */

document.getElementById("saveMarker").onclick=async()=>{

const name=document.getElementById("markerName").value;
const category=document.getElementById("markerCategory").value;
const lat=parseFloat(document.getElementById("markerLat").value);
const lng=parseFloat(document.getElementById("markerLng").value);

if(!name||!lat||!lng){
alert("Bitte Felder ausfüllen");
return;
}

markers.push({
id:Date.now().toString(),
name,
category,
lat,
lng
});

await saveMarkers();

renderMarkers();
updateStats();

};

/* DELETE */

function deleteMarker(id){

if(!confirm("Marker wirklich löschen?")) return;

markers=markers.filter(m=>m.id!==id);

saveMarkers();
renderMarkers();
updateStats();

}

/* EDIT */

function editMarker(id){

const marker=markers.find(m=>m.id===id);

selectedMarker=marker;

document.getElementById("markerName").value=marker.name;
document.getElementById("markerCategory").value=marker.category;
document.getElementById("markerLat").value=marker.lat;
document.getElementById("markerLng").value=marker.lng;

}

/* SAVE TO SERVER */

async function saveMarkers(){

await fetch("/markers",{
method:"POST",
headers:{"Content-Type":"application/json"},
body:JSON.stringify({
markers,
adminName:"Admin"
})
});

}

/* PANEL TOGGLE */

document.getElementById("panelToggle").onclick=()=>{

const panel=document.getElementById("panel");
const mapDiv=document.getElementById("map");

panel.classList.toggle("collapsed");

if(panel.classList.contains("collapsed")){
mapDiv.style.width="100%";
}else{
mapDiv.style.width="calc(100% - 340px)";
}

};

/* TABS */

document.querySelectorAll(".tab").forEach(btn=>{

btn.onclick=()=>{

document.querySelectorAll(".tab").forEach(b=>b.classList.remove("active"));
document.querySelectorAll(".tab-content").forEach(c=>c.classList.remove("active"));

btn.classList.add("active");
document.getElementById(btn.dataset.tab).classList.add("active");

};

});

/* INIT */

loadMarkers();
