const map = L.map("map").setView([0,0],3);

L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",{
maxZoom:19
}).addTo(map);

let markers = [];
let markerObjects = [];
let user = {
loggedIn:false,
isVip:false
};

/* ---------------- USER CHECK ---------------- */

async function checkUser(){

try{

const res = await fetch("/api/user");
user = await res.json();

if(user.loggedIn){

document.getElementById("loginStatus").innerText="👤 "+user.username;

if(user.isVip){

document.querySelectorAll(".vip-only").forEach(el=>{
el.style.display="block";
});

}

}else{

document.getElementById("loginStatus").innerText="Nicht eingeloggt";

}

}catch(err){

console.error("User check Fehler",err);

}

}

/* ---------------- LOAD MARKERS ---------------- */

async function loadMarkers(){

try{

const res = await fetch("/markers");
const data = await res.json();

markers = data;

renderMarkers();
updateStats();

}catch(err){

console.error("Marker laden fehlgeschlagen",err);

}

}

/* ---------------- RENDER MARKERS ---------------- */

function renderMarkers(){

markerObjects.forEach(m=>map.removeLayer(m));
markerObjects=[];

markers.forEach(m=>{

/* VIP Marker verstecken */

if(m.category==="Schwarzmarkt" && !user.isVip){
return;
}

const marker=L.marker([m.lat,m.lng]).addTo(map);

marker.bindPopup(`
<b>${m.name}</b><br>
Kategorie: ${m.category}
`);

markerObjects.push(marker);

});

}

/* ---------------- STATS ---------------- */

function updateStats(){

document.getElementById("statTotal").innerText=
"Marker gesamt: "+markers.length;

document.getElementById("statDealer").innerText=
"Dealer: "+markers.filter(m=>m.category==="Dealer").length;

document.getElementById("statFaction").innerText=
"Fraktionen: "+markers.filter(m=>m.category==="Fraktion").length;

document.getElementById("statUG").innerText=
"UGs: "+markers.filter(m=>m.category==="UG").length;

}

/* ---------------- MAP CLICK ---------------- */

map.on("click",e=>{

document.getElementById("markerLat").value=
e.latlng.lat.toFixed(6);

document.getElementById("markerLng").value=
e.latlng.lng.toFixed(6);

});

/* ---------------- SAVE MARKER ---------------- */

document.getElementById("saveMarker").onclick=async()=>{

const name=document.getElementById("markerName").value;
const category=document.getElementById("markerCategory").value;
const lat=parseFloat(document.getElementById("markerLat").value);
const lng=parseFloat(document.getElementById("markerLng").value);

if(!name || !lat || !lng){

alert("Bitte alle Felder ausfüllen");
return;

}

const newMarker={
id:Date.now(),
name,
category,
lat,
lng
};

markers.push(newMarker);

await fetch("/markers",{

method:"POST",

headers:{
"Content-Type":"application/json"
},

body:JSON.stringify({
markers,
adminName:user.username || "Admin"
})

});

renderMarkers();
updateStats();

};

/* ---------------- TABS ---------------- */

document.querySelectorAll(".tab").forEach(btn=>{

btn.onclick=()=>{

document.querySelectorAll(".tab").forEach(b=>{
b.classList.remove("active");
});

document.querySelectorAll(".tab-content").forEach(c=>{
c.classList.remove("active");
});

btn.classList.add("active");

document.getElementById(btn.dataset.tab).classList.add("active");

};

});

/* ---------------- PANEL TOGGLE ---------------- */

document.getElementById("panelToggle").onclick=()=>{

document.getElementById("panel").classList.toggle("collapsed");

};

/* ---------------- DISCORD LOGIN ---------------- */

document.getElementById("discordLogin").onclick=()=>{

window.location.href="/auth/discord";

};

/* ---------------- FILTER ---------------- */

document.querySelectorAll("[data-filter]").forEach(box=>{

box.onchange=()=>{

const active=[];

document.querySelectorAll("[data-filter]:checked").forEach(b=>{
active.push(b.dataset.filter);
});

markerObjects.forEach(m=>map.removeLayer(m));
markerObjects=[];

markers.forEach(m=>{

if(!active.includes(m.category)) return;

if(m.category==="Schwarzmarkt" && !user.isVip) return;

const marker=L.marker([m.lat,m.lng]).addTo(map);
marker.bindPopup(`<b>${m.name}</b>`);

markerObjects.push(marker);

});

};

});

/* ---------------- INIT ---------------- */

async function init(){

await checkUser();
await loadMarkers();

}

init();
