const map = L.map("map",{
crs:L.CRS.Simple,
minZoom:-4,
maxZoom:2
});

const bounds=[[0,0],[8192,8192]];

L.imageOverlay("GTAV-HD-MAP-satellite.jpg",bounds).addTo(map);

/* MAP START ZENTRIERT */

map.setView([4096,4096],-2);

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

/* HOVER TOOLTIP */

marker.bindTooltip(m.name,{
direction:"top"
});

/* POPUP */

marker.bindPopup(` <b>${m.name}</b><br>
${m.description||""}<br>
Kategorie: ${m.category}<br>

${m.image ? `<img src="${m.image}" style="width:200px;margin-top:5px;">` : ""}

<br><br> <button onclick="deleteMarker('${m.id}')">Löschen</button>
`);

/* DRAG */

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
const description=document.getElementById("markerDescription").value;
const category=document.getElementById("markerCategory").value;

const lat=parseFloat(document.getElementById("markerLat").value);
const lng=parseFloat(document.getElementById("markerLng").value);

const file=document.getElementById("markerImage").files[0];

let image="";

if(file){
image=URL.createObjectURL(file);
}

markers.push({
id:Date.now().toString(),
name,
description,
category,
lat,
lng,
image
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

/* SAVE */

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

/* SEARCH */

document.getElementById("markerSearch").addEventListener("input",function(){

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

panel.classList.toggle("collapsed");

if(panel.classList.contains("collapsed")){
mapDiv.style.width="100%";
}else{
mapDiv.style.width="calc(100% - 340px)";
}

};

/* DISCORD LOGIN FIX */

document.getElementById("discordLogin").onclick=()=>{
window.location.href="/auth/discord";
};

document.getElementById("adminLogin").onclick=()=>{
window.location.href="/auth/discord";
};

/* STATS */

function updateStats(){

document.getElementById("statTotal").innerText=
"Marker: "+markers.length;

document.getElementById("statDealer").innerText=
"Dealer: "+markers.filter(m=>m.category==="Dealer").length;

document.getElementById("statUG").innerText=
"UG: "+markers.filter(m=>m.category==="UG").length;

document.getElementById("statField").innerText=
"Felder: "+markers.filter(m=>m.category==="Feld").length;

}

/* INIT */

loadMarkers();
