const map = L.map("map", {
  crs: L.CRS.Simple,
  minZoom: -4,
  maxZoom: 2
});

const bounds = [
  [0, 0],
  [8192, 8192]
];

const image = L.imageOverlay("GTAV-HD-MAP-satellite.jpg", bounds).addTo(map);

map.setView([4096,4096],-2);

let markers=[];
let markerObjects=[];
let selectedMarker=null;
let user={loggedIn:false,isVip:false};

/* ICONS */

const icons={
Dealer:L.divIcon({html:"💊",className:"marker-icon"}),
UG:L.divIcon({html:"🔫",className:"marker-icon"}),
Feld:L.divIcon({html:"🌿",className:"marker-icon"}),
Schwarzmarkt:L.divIcon({html:"🕶",className:"marker-icon"})
};

/* USER CHECK */

async function checkUser(){

const res=await fetch("/api/user");
user=await res.json();

if(user.loggedIn){

document.getElementById("loginStatus").innerText="👤 "+user.username;

if(user.isVip){
document.querySelectorAll(".vip-only").forEach(el=>{
el.style.display="block";
});
}

}

}

/* LOAD MARKERS */

async function loadMarkers(){

const res=await fetch("/markers");
markers=await res.json();

renderMarkers();
updateStats();

}

/* RENDER */

function renderMarkers(){

markerObjects.forEach(m=>map.removeLayer(m));
markerObjects=[];

markers.forEach(m=>{

if(m.category==="Schwarzmarkt" && !user.isVip) return;

const marker=L.marker([m.lat,m.lng],{
icon:icons||icons.Dealer,
draggable:true
}).addTo(map);

marker.bindPopup(`<b>${m.name}</b><br>
Kategorie: ${m.category}<br>
Lat: ${m.lat}<br>
Lng: ${m.lng}<br><br> <button onclick="editMarker('${m.id}')">Bearbeiten</button> <button onclick="deleteMarker('${m.id}')">Löschen</button>`);

marker.on("dragend",e=>{

const pos=e.target.getLatLng();

m.lat=pos.lat;
m.lng=pos.lng;

saveMarkers();

});

markerObjects.push(marker);

});

}

/* CLICK COORDS */

map.on("click", e => {

const lat = e.latlng.lat.toFixed(2);
const lng = e.latlng.lng.toFixed(2);

document.getElementById("markerLat").value = lat;
document.getElementById("markerLng").value = lng;

});

/* EDIT MARKER */

function editMarker(id){

const marker=markers.find(m=>m.id===id);

selectedMarker=marker;

document.getElementById("markerName").value=marker.name;
document.getElementById("markerCategory").value=marker.category;
document.getElementById("markerLat").value=marker.lat;
document.getElementById("markerLng").value=marker.lng;

}

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
adminName:user.username||"Admin"
})
});

}

/* SAVE BUTTON */

document.getElementById("saveMarker").onclick=async()=>{

const name=document.getElementById("markerName").value;
const category=document.getElementById("markerCategory").value;
const lat=parseFloat(document.getElementById("markerLat").value);
const lng=parseFloat(document.getElementById("markerLng").value);

if(!name||!lat||!lng){
alert("Bitte Felder ausfüllen");
return;
}

if(selectedMarker){

selectedMarker.name=name;
selectedMarker.category=category;
selectedMarker.lat=lat;
selectedMarker.lng=lng;

}else{

markers.push({
id:Date.now().toString(),
name,
category,
lat,
lng
});

}

selectedMarker=null;

await saveMarkers();

renderMarkers();
updateStats();

};

/* STATS */

function updateStats(){

document.getElementById("statTotal").innerText="Marker: "+markers.length;

document.getElementById("statDealer").innerText=
"Dealer: "+markers.filter(m=>m.category==="Dealer").length;

document.getElementById("statUG").innerText=
"UG: "+markers.filter(m=>m.category==="UG").length;

document.getElementById("statField").innerText=
"Felder: "+markers.filter(m=>m.category==="Feld").length;

}

/* TABS */

document.querySelectorAll(".tab").forEach(btn=>{

btn.onclick=()=>{

document.querySelectorAll(".tab").forEach(b=>b.classList.remove("active"));
document.querySelectorAll(".tab-content").forEach(c=>c.classList.remove("active"));

btn.classList.add("active");
document.getElementById(btn.dataset.tab).classList.add("active");

};

});

/* PANEL */

document.getElementById("panelToggle").onclick=()=>{
document.getElementById("panel").classList.toggle("collapsed");
};

/* DISCORD LOGIN */

document.getElementById("discordLogin").onclick=()=>{
window.location.href="/auth/discord";
};

/* ADMIN LOGIN */

document.getElementById("adminLogin").onclick=()=>{

const pw=prompt("Admin Passwort");

if(pw==="admin123"){
alert("Admin Login erfolgreich");
}else{
alert("Falsches Passwort");
}

};

/* INIT */

async function init(){

await checkUser();
await loadMarkers();

}

init();




