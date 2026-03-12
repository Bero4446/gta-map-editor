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

/* MARKER ICONS */

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

/* CREATE MARKER */

document.getElementById("saveMarker").onclick=async()=>{

const name=document.getElementById("markerName").value;
const category=document.getElementById("markerCategory").value;
const lat=parseFloat(document.getElementById("markerLat").value);
const lng=parseFloat(document.getElementById("markerLng").value);

const file=document.getElementById("markerImage")?.files[0];

let image="";

if(file){
image=URL.createObjectURL(file);
}

const newMarker={
id:Date.now().toString(),
name,
category,
lat,
lng,
image
};

markers.push(newMarker);

await saveMarkers();

renderMarkers();
updateStats();

};

/* DELETE MARKER */

function deleteMarker(id){

if(!confirm("Marker wirklich löschen?")) return;

markers=markers.filter(m=>m.id!==id);

saveMarkers();
renderMarkers();
updateStats();

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

/* MARKER SEARCH */

document.getElementById("markerSearch")?.addEventListener("input",function(){

const search=this.value.toLowerCase();

markerObjects.forEach(marker=>{

const name=marker.options.title||"";

if(name.toLowerCase().includes(search)){
marker.addTo(map);
}else{
map.removeLayer(marker);
}

});

});

/* PANEL TOGGLE */

document.getElementById("panelToggle").onclick=()=>{

const panel=document.getElementById("panel");
const mapDiv=document.getElementById("map");

panel.classList.to
