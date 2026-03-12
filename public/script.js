const map = L.map("map").setView([0,0],3);

L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19}).addTo(map);

let markers=[];
let markerObjects=[];
let user={loggedIn:false,isVip:false};

const icons={
Dealer:L.divIcon({html:"💊",className:"marker-icon"}),
UG:L.divIcon({html:"🔫",className:"marker-icon"}),
Feld:L.divIcon({html:"🌿",className:"marker-icon"}),
Schwarzmarkt:L.divIcon({html:"🕶",className:"marker-icon"})
};

async function checkUser(){

const res=await fetch("/api/user");
user=await res.json();

if(user.loggedIn){

document.getElementById("loginStatus").innerText="👤 "+user.username;

if(user.isVip){

document.querySelectorAll(".vip-only").forEach(el=>el.style.display="block");

}

}

}

async function loadMarkers(){

const res=await fetch("/markers");
markers=await res.json();

renderMarkers();
updateStats();

}

function renderMarkers(){

markerObjects.forEach(m=>map.removeLayer(m));
markerObjects=[];

markers.forEach(m=>{

if(m.category==="Schwarzmarkt" && !user.isVip) return;

const marker=L.marker([m.lat,m.lng],{
icon:icons[m.category]||icons.Dealer
}).addTo(map);

marker.bindPopup(`<b>${m.name}</b><br>${m.category}`);

markerObjects.push(marker);

});

}

function updateStats(){

document.getElementById("statTotal").innerText="Marker: "+markers.length;

document.getElementById("statDealer").innerText=
"Dealer: "+markers.filter(m=>m.category==="Dealer").length;

document.getElementById("statUG").innerText=
"UG: "+markers.filter(m=>m.category==="UG").length;

document.getElementById("statField").innerText=
"Felder: "+markers.filter(m=>m.category==="Feld").length;

}

map.on("click",e=>{

document.getElementById("markerLat").value=e.latlng.lat.toFixed(6);
document.getElementById("markerLng").value=e.latlng.lng.toFixed(6);

});

document.getElementById("saveMarker").onclick=async()=>{

const name=document.getElementById("markerName").value;
const category=document.getElementById("markerCategory").value;
const lat=parseFloat(document.getElementById("markerLat").value);
const lng=parseFloat(document.getElementById("markerLng").value);

const marker={
id:Date.now(),
name,
category,
lat,
lng
};

markers.push(marker);

await fetch("/markers",{
method:"POST",
headers:{"Content-Type":"application/json"},
body:JSON.stringify({
markers,
adminName:user.username||"Admin"
})
});

renderMarkers();
updateStats();

};

document.querySelectorAll(".tab").forEach(btn=>{

btn.onclick=()=>{

document.querySelectorAll(".tab").forEach(b=>b.classList.remove("active"));
document.querySelectorAll(".tab-content").forEach(c=>c.classList.remove("active"));

btn.classList.add("active");
document.getElementById(btn.dataset.tab).classList.add("active");

};

});

document.getElementById("panelToggle").onclick=()=>{
document.getElementById("panel").classList.toggle("collapsed");
};

document.getElementById("discordLogin").onclick=()=>{
window.location.href="/auth/discord";
};

async function init(){

await checkUser();
await loadMarkers();

}

init();
