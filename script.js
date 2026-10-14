/* =========================================================
   VEHICLE SAVER | LIGHTNING FAST & EXACT GPS TRACKING
   - Exact Location: Raghogarh Polytechnic College, M.P.
   - Real-Time Firebase Sync + MPU6050 + Buzzer + Overspeeding
   ========================================================= */

const firebaseConfig = {
  apiKey: "AIzaSyB_rUU5zXyh0cod4yEKOsc38wNHqigWfAQ",
  authDomain: "vehicle-saver-abbaf.firebaseapp.com",
  databaseURL: "https://vehicle-saver-abbaf-default-rtdb.firebaseio.com",
  projectId: "vehicle-saver-abbaf",
  storageBucket: "vehicle-saver-abbaf.firebasestorage.app",
  messagingSenderId: "1079384036092",
  appId: "1:1079384036092:web:086388ce1dd2f6cb7d7d79"
};

if (typeof firebase !== 'undefined' && firebaseConfig.apiKey !== "YOUR_API_KEY") {
  firebase.initializeApp(firebaseConfig);
}

const STORE = {
  users: "vs_v6_users",
  vehicles: "vs_v6_vehicles",
  alerts: "vs_v6_alerts",
  history: "vs_v6_history",
  session: "vs_v6_session"
};

const DEFAULT_USERS = {
  admin:  {password:"admin123", role:"admin", name:"System Admin"},
  police: {password:"police123",role:"police",name:"Control Room"},
  owner:  {password:"owner123", role:"owner", name:"Vehicle Owner"}
};

const nowLabel = () => new Date().toLocaleTimeString();
let users = JSON.parse(localStorage.getItem(STORE.users)) || DEFAULT_USERS;

// Exact coordinates for Raghogarh Polytechnic College, Madhya Pradesh
const RAGHOGARH_LAT = 24.4452;
const RAGHOGARH_LNG = 77.2134;

let vehicles = JSON.parse(localStorage.getItem(STORE.vehicles)) || [
  {id:"vehicle_01", name:"Polytechnic Model Bus", number:"VEHICLE_01", driver:"Dharmendra Bunkar", speed:0, limit:10, lat:RAGHOGARH_LAT, lng:RAGHOGARH_LNG, online:false, buzzer:false, impact:false}
];
let alerts = JSON.parse(localStorage.getItem(STORE.alerts)) || [];
let history = JSON.parse(localStorage.getItem(STORE.history)) || [];

let currentUserId = null;
let selectedVehicleId = null;
let map = null, mapMarker = null;

const $ = id => document.getElementById(id);
const roleNames = {admin:"Admin", police:"Control Room", owner:"Vehicle Owner"};

function currentUser() { return users[currentUserId]; }
function accessibleVehicles() { return vehicles; }
function selectedVehicle() {
  const list = accessibleVehicles();
  return list.find(v => v.id === selectedVehicleId) || list[0] || null;
}

// Login
$("loginForm").addEventListener("submit", event => {
  event.preventDefault();
  const id = $("userId").value.trim().toLowerCase();
  const password = $("loginPassword").value;
  if (users[id] && users[id].password === password) {
    currentUserId = id;
    localStorage.setItem(STORE.session, id);
    $("loginError").classList.add("hidden");
    $("loginScreen").classList.add("hidden");
    $("app").classList.remove("hidden");
    selectedVehicleId = vehicles[0]?.id || null;
    setupUserView();
  } else {
    $("loginError").textContent = "Invalid User ID or Password. Try demo credentials.";
    $("loginError").classList.remove("hidden");
  }
});

$("logoutBtn").addEventListener("click", () => {
  currentUserId = null;
  localStorage.removeItem(STORE.session);
  $("app").classList.add("hidden");
  $("loginScreen").classList.remove("hidden");
  $("loginForm").reset();
});

function setupUserView() {
  const user = currentUser();
  $("topUserName").textContent = user.name;
  $("topRole").textContent = roleNames[user.role];
  $("avatarLetter").textContent = (user.name || "U").charAt(0).toUpperCase();
  $("profileName").value = user.name;
  renderEverything();
  showPage("dashboard");
  initFirebaseLiveListener();
}

function showPage(page) {
  document.querySelectorAll(".page").forEach(p => p.classList.toggle("active", p.id === "page-" + page));
  document.querySelectorAll(".nav-btn").forEach(b => b.classList.toggle("active", b.dataset.page === page));
  if (page === "dashboard") setTimeout(() => { if (map) map.invalidateSize(); }, 120);
}

document.querySelectorAll(".nav-btn").forEach(b => b.addEventListener("click", () => showPage(b.dataset.page)));
document.querySelectorAll("[data-goto]").forEach(b => b.addEventListener("click", () => showPage(b.dataset.goto)));
$("vehicleSelect").addEventListener("change", e => { selectedVehicleId = e.target.value; renderDashboard(); });
$("addVehicleShortcut").addEventListener("click", () => showPage("about"));

function renderEverything() {
  renderVehicleSelect();
  renderDashboard();
  renderVehicleCards();
  renderAlerts();
  renderHistory();
}

function renderVehicleSelect() {
  const list = accessibleVehicles();
  $("vehicleSelect").innerHTML = list.map(v => `<option value="${v.id}">${v.name} (${v.number})</option>`).join("");
  $("vehicleSelect").disabled = list.length === 0;
  if (selectedVehicleId) $("vehicleSelect").value = selectedVehicleId;
}

function renderDashboard() {
  const v = selectedVehicle();
  if (!v) {
    ["detailName", "detailNumber", "detailDriver", "detailLat", "detailLng"].forEach(id => $(id).textContent = "—");
    $("speedValue").textContent = "0";
    $("limitValue").textContent = "10";
    $("connectionValue").textContent = "No unit";
    $("connectionFoot").textContent = "Awaiting hardware sync";
    $("sensorState").textContent = "Offline";
    $("buzzerState").textContent = "OFF";
    $("mapVehicleLabel").textContent = "No active GPS unit";
    return;
  }

  $("speedValue").textContent = v.speed ?? 0;
  $("limitValue").textContent = v.limit ?? 10;
  $("connectionValue").textContent = v.online ? "ONLINE (LIVE)" : "OFFLINE";
  $("connectionFoot").textContent = v.online ? "ESP32 Connected via Firebase" : "Device Disconnected";
  $("detailName").textContent = v.name;
  $("detailNumber").textContent = v.number;
  $("detailDriver").textContent = v.driver || "Unassigned";
  $("detailLat").textContent = Number(v.lat || RAGHOGARH_LAT).toFixed(4);
  $("detailLng").textContent = Number(v.lng || RAGHOGARH_LNG).toFixed(4);
  
  $("sensorState").textContent = v.impact ? "🚨 Impact Detected (MPU6050)" : (v.online ? "Normal (Active)" : "Offline");
  $("sensorState").className = v.impact ? "status-online" : (v.online ? "status-online" : "status-demo");
  $("buzzerState").textContent = v.buzzer ? "🔊 ON (Active)" : "OFF";

  // Overspeeding check & Banner Trigger
  if ((v.speed ?? 0) > (v.limit ?? 10)) {
    $("speedStatusFoot").textContent = "⚠️ OVERSPEEDING WARNING!";
    $("speedStatusFoot").style.color = "var(--red)";
    $("globalOverspeedMessage").textContent = `Vehicle: ${v.name} (${v.number}) is running at ${v.speed} km/h (Limit: ${v.limit} km/h)`;
    $("globalOverspeedBanner").classList.remove("hidden");
  } else {
    $("speedStatusFoot").textContent = "Normal speed range";
    $("speedStatusFoot").style.color = "var(--muted)";
  }

  $("mapVehicleLabel").textContent = `${v.name} (${v.number}) - Raghogarh Polytechnic College Zone`;

  if (v.lat && v.lng) {
    renderMap(v.lat, v.lng, v.name);
  }
}

function renderMap(lat, lng, label) {
  if (!window.L) return;
  const point = [Number(lat), Number(lng)];
  if (!map) {
    map = L.map("map").setView(point, 16);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);
    mapMarker = L.marker(point).addTo(map);
  } else {
    map.setView(point, 16);
    mapMarker.setLatLng(point);
  }
  mapMarker.bindPopup(`<b>${label}</b><br>📍 Raghogarh Polytechnic College<br>Lat: ${lat}, Lng: ${lng}`).openPopup();
  setTimeout(() => map.invalidateSize(), 100);
}

function renderVehicleCards() {
  const list = accessibleVehicles();
  $("vehicleCards").innerHTML = list.map(v => `
    <div class="vehicle-card ${v.id === selectedVehicleId ? "selected" : ""}" onclick="selectedVehicleId='${v.id}';renderEverything();">
      <div class="vehicle-symbol">🚌</div>
      <h3>${v.name}</h3>
      <div class="vehicle-number">${v.number}</div>
      <div class="vehicle-card-foot">
        <span class="pill ${v.online ? "green" : "amber"}">${v.online ? "LIVE" : "OFFLINE"}</span>
        <span>Speed: ${v.speed ?? 0} km/h</span>
      </div>
    </div>
  `).join("");
  $("noVehicles").classList.toggle("hidden", list.length > 0);
}

function renderAlerts() {
  $("alertsList").innerHTML = alerts.length ? alerts.map(a => `
    <div class="alert-item ${a.type && a.type.includes("SOS") ? "sos-alert" : ""}">
      <div class="alert-symbol">${a.type && a.type.includes("SOS") ? "SOS" : "!"}</div>
      <div class="alert-body">
        <div class="alert-title">${a.type}</div>
        <div class="alert-meta">Device: ${a.vehicleId} | Time: ${a.time} | Speed: ${a.speed} km/h</div>
      </div>
    </div>
  `).join("") : '<div class="empty">No safety alerts recorded.</div>';
  $("noAlerts").classList.toggle("hidden", alerts.length > 0);
  $("alertsTotal").textContent = `${alerts.length} EVENTS`;
  $("alertCount").textContent = alerts.length;
}

function renderHistory() {
  $("historyBody").innerHTML = history.map(h => `
    <tr>
      <td>${h.time}</td>
      <td>${h.vehicleId}</td>
      <td>${h.speed} km/h</td>
      <td>${h.limit} km/h</td>
      <td>${h.event}</td>
      <td><span class="pill">${h.status}</span></td>
    </tr>
  `).join("");
  $("historyTotal").textContent = `${history.length} RECORDS`;
}

// --- FIREBASE LIVE MULTI-VEHICLE & MPU6050 LISTENER ---
function initFirebaseLiveListener() {
  if (typeof firebase === 'undefined' || firebaseConfig.apiKey === "YOUR_API_KEY") return;

  const db = firebase.database();
  
  db.ref("vehicles").on("value", snapshot => {
    const allData = snapshot.val();
    if (!allData) return;

    Object.keys(allData).forEach(id => {
      const liveData = allData[id];
      if (!liveData) return;

      let v = vehicles.find(x => x.id === id);
      if (!v) {
        v = { id: id, name: liveData.name || `Vehicle ${id}`, number: liveData.number || id.toUpperCase(), driver: liveData.driver || "Driver" };
        vehicles.push(v);
      }

      v.speed = liveData.speed ?? 0;
      v.lat = liveData.lat ?? RAGHOGARH_LAT;
      v.lng = liveData.lng ?? RAGHOGARH_LNG;
      v.online = liveData.online ?? true;
      v.limit = liveData.limit ?? 10;
      v.buzzer = liveData.buzzer ?? false;
      v.impact = liveData.impact ?? false;

      if (v.impact || v.buzzer) {
        $("globalSOSMessage").textContent = `🚨 Accident / Rollover Detected! Device: ${id} | MPU6050 Tilt Triggered | Buzzer Active`;
        $("globalSOSBanner").classList.remove("hidden");
      }
    });

    if (!selectedVehicleId && vehicles.length > 0) {
      selectedVehicleId = vehicles[0].id;
    }

    localStorage.setItem(STORE.vehicles, JSON.stringify(vehicles));
    renderEverything();
  });

  db.ref("alerts").on("child_added", snapshot => {
    const alertData = snapshot.val();
    if (alertData && !alerts.some(a => a.id === snapshot.key)) {
      alertData.id = snapshot.key;
      alerts.unshift(alertData);
      
      history.unshift({
        id: "h-" + snapshot.key,
        time: alertData.time || nowLabel(),
        vehicleId: alertData.vehicleId || "vehicle_01",
        speed: alertData.speed || 0,
        limit: 10,
        event: alertData.type || "MPU6050 Accident / SOS Alert",
        status: "Urgent"
      });

      localStorage.setItem(STORE.alerts, JSON.stringify(alerts));
      localStorage.setItem(STORE.history, JSON.stringify(history));
      renderEverything();

      if (alertData.type && (alertData.type.includes("SOS") || alertData.type.includes("Accident"))) {
        $("globalSOSMessage").textContent = `Accident Alert! Device: ${alertData.vehicleId} | Speed: ${alertData.speed} km/h | MPU6050 Triggered`;
        $("globalSOSBanner").classList.remove("hidden");
      }
    }
  });
}

// Manual Test Buttons for Demo
$("testSOSBtn").addEventListener("click", () => {
  const vehicle = selectedVehicle();
  if (!vehicle) return;

  const testAlert = {
    id: "test-" + Date.now(),
    vehicleId: vehicle.id,
    type: "SOS - MPU6050 Tilt / Accident Simulated",
    speed: vehicle.speed,
    time: nowLabel(),
    status: "Active Emergency"
  };

  alerts.unshift(testAlert);
  localStorage.setItem(STORE.alerts, JSON.stringify(alerts));
  renderEverything();

  $("globalSOSMessage").textContent = `DEMO ALERT! Device: ${vehicle.id} | MPU6050 Tilt & Buzzer Triggered Successfully!`;
  $("globalSOSBanner").classList.remove("hidden");
});

$("testSpeedBtn").addEventListener("click", () => {
  const vehicle = selectedVehicle();
  if (!vehicle) return;
  
  vehicle.speed = 25;
  renderEverything();

  $("globalOverspeedMessage").textContent = `TEST WARNING! Vehicle: ${vehicle.name} is overspeeding at 25 km/h (Limit: 10 km/h)`;
  $("globalOverspeedBanner").classList.remove("hidden");
});

$("openSOSAlertsBtn").addEventListener("click", () => showPage("alerts"));
$("acknowledgeSOSBtn").addEventListener("click", () => $("globalSOSBanner").classList.add("hidden"));
$("acknowledgeOverspeedBtn").addEventListener("click", () => $("globalOverspeedBanner").classList.add("hidden"));

$("addVehicleForm").addEventListener("submit", e => {
  e.preventDefault();
  const name = $("newVehicleName").value.trim();
  const number = $("newVehicleNumber").value.trim().toUpperCase();
  const driver = $("newDriverName").value.trim() || "Unassigned";

  const id = number.toLowerCase().replace(/\s+/g, '_');
  if (vehicles.some(v => v.id === id)) {
    $("vehicleMessage").textContent = "Vehicle ID already exists.";
    return;
  }

  vehicles.push({ id, name, number, driver, speed: 0, limit: 10, lat: RAGHOGARH_LAT, lng: RAGHOGARH_LNG, online: false });
  localStorage.setItem(STORE.vehicles, JSON.stringify(vehicles));
  selectedVehicleId = id;

  $("addVehicleForm").reset();
  $("vehicleMessage").textContent = "Vehicle registered successfully!";
  renderEverything();
});

$("profileForm").addEventListener("submit", e => {
  e.preventDefault();
  const user = currentUser();
  user.name = $("profileName").value.trim();
  writeStore(STORE.users, users);
  $("profileMessage").textContent = "Profile updated successfully.";
  setupUserView();
});

// Restore session on load
const savedSession = localStorage.getItem(STORE.session);
if (savedSession && users[savedSession]) {
  currentUserId = savedSession;
  $("loginScreen").classList.add("hidden");
  $("app").classList.remove("hidden");
  selectedVehicleId = accessibleVehicles()[0]?.id || null;
  setupUserView();
}