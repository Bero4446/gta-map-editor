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
draggable:true,
title:m.name
}).addTo(map);

marker.bindPopup(` <b>${m.name}</b><br>
Kategorie: ${m.category}<br>
Lat: ${m.lat}<br>
Lng: ${m.lng}<br>

${m.image ? `<img src="${m.image}" style="width:200px;margin-top:5px;">` : ""}

<br><br> <button onclick="deleteMarker('${m.id}')">Löschen</button>
`);

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

const file=document.getElementById("markerImage")?.files[0];

let image="";

if(file){
image=U
