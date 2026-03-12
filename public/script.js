const map = L.map("map").setView([0,0],2);

L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",{
maxZoom:19
}).addTo(map);

let markers = [];

async function loadMarkers(){

const res = await fetch("/api/markers");
const data = await res.json();

markers=data;

updateStats();
renderMarkers();

}

function renderMarkers(){

markers.forEach(m=>{

const marker=L.marker([m.lat,m.lng]).addTo(map);

marker.bindPopup(m.name);

});

}

function updateStats(){

document.getElementById("statTotal").innerText="Marker gesamt: "+markers.length;

}

map.on("click",e=>{

document.getElementById("markerLat").value=e.latlng.lat;
document.getElementById("markerLng").value=e.latlng.lng;

});

document.getElementById("saveMarker").onclick=async()=>{

const name=document.getElementById("markerName").value;
const category=document.getElementById("markerCategory").value;
const lat=document.getElementById("markerLat").value;
const lng=document.getElementById("markerLng").value;

await fetch("/api/markers",{

method:"POST",

headers:{
"Content-Type":"application/json"
},

body:JSON.stringify({
name,
category,
lat,
lng
})

});

location.reload();

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

async function checkUser(){

const res=await fetch("/api/user");
const data=await res.json();

if(data.loggedIn){

document.getElementById("loginStatus").innerText=data.username;

if(data.isVip){

document.querySelectorAll(".vip-only").forEach(el=>{

el.style.display="block";

});

}

}

}

checkUser();
loadMarkers();
