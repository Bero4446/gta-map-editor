const map = L.map("map",{
crs:L.CRS.Simple,
minZoom:-2
});

const bounds=[[0,0],[8192,8192]];

L.imageOverlay("map.jpg",bounds).addTo(map);

map.fitBounds(bounds);

let markers=[];
let markerObjects=[];
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

try{

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

}catch(e){
console.log("User check failed");
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
${m.category}<br><br> <button onclick="deleteMarker('${m.id}')">Löschen</button>`);

marker.on("dragend",e=>{

const pos=e.target.getLatLng();

m.lat=pos.lat;
m.lng=pos.lng;

saveMarkers();

});

markerObjects.push(marker);

});

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

/* MAP CLICK */

map.on("click",e=>{

document.getElementById("markerLat").value=e.latlng.lat.toFixed(2);
document.getElementById("markerLng").value=e.latlng.lng.toFixed(2);

});

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

const newMar
