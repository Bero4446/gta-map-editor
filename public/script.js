const map = L.map("map",{
crs:L.CRS.Simple,
minZoom:-2
});

const bounds=[[0,0],[8192,8192]];

L.imageOverlay("map.jpg",bounds).addTo(map);

map.fitBounds(bounds);

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
icon:icons()
