(() => {
  "use strict";

  const TASHKENT = [41.3111, 69.2797];
  const STORAGE = { favorites: "maksoy:favorites", reports: "maksoy:reports" };
  const state = {
    map: null,
    position: null,
    userMarker: null,
    accuracyCircle: null,
    destination: null,
    destinationMarker: null,
    routeControl: null,
    route: null,
    navigating: false,
    following: true,
    voice: true,
    lastInstruction: "",
    lastReroute: 0,
    routeRequestId: 0,
    reportLayers: []
  };

  const el = Object.fromEntries([
    "searchForm", "searchInput", "searchResults", "guidance", "instruction", "instructionDistance", "turnIcon", "voiceBtn",
    "favoritesBtn", "reportBtn", "locateBtn", "placePanel", "placeName", "closePanelBtn", "routeSummary", "routeDistance",
    "routeTime", "arrivalTime", "routeBtn", "startBtn", "saveBtn", "stopBtn", "favoritesDialog", "favoritesList",
    "reportDialog", "reportOptions", "toast"
  ].map(id => [id, document.getElementById(id)]));

  function init() {
    if (!window.L || !L.Routing) {
      showToast("Не удалось загрузить карту. Проверьте интернет.", 5000);
      return;
    }
    state.map = L.map("map", { zoomControl: false, attributionControl: true }).setView(TASHKENT, 12);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap"
    }).addTo(state.map);
    L.control.zoom({ position: "bottomleft" }).addTo(state.map);
    state.map.on("dragstart", () => { state.following = false; });
    bindEvents();
    renderReports();
    startGeolocation();
  }

  function bindEvents() {
    el.searchForm.addEventListener("submit", event => { event.preventDefault(); searchPlaces(); });
    el.searchInput.addEventListener("input", () => { if (!el.searchInput.value.trim()) hideResults(); });
    el.locateBtn.addEventListener("click", centerOnUser);
    el.routeBtn.addEventListener("click", () => buildRoute(false));
    el.startBtn.addEventListener("click", startNavigation);
    el.stopBtn.addEventListener("click", stopNavigation);
    el.saveBtn.addEventListener("click", toggleFavorite);
    el.closePanelBtn.addEventListener("click", () => { el.placePanel.hidden = true; });
    el.voiceBtn.addEventListener("click", toggleVoice);
    el.favoritesBtn.addEventListener("click", openFavorites);
    el.reportBtn.addEventListener("click", openReports);
    el.reportOptions.addEventListener("click", addReport);
    document.querySelectorAll("[data-close-dialog]").forEach(button => button.addEventListener("click", () => button.closest("dialog").close()));
    document.addEventListener("click", event => {
      if (!el.searchForm.contains(event.target) && !el.searchResults.contains(event.target)) hideResults();
    });
  }

  function startGeolocation() {
    if (!navigator.geolocation) {
      showToast("Геолокация не поддерживается этим браузером.", 5000);
      return;
    }
    navigator.geolocation.watchPosition(updatePosition, handleLocationError, {
      enableHighAccuracy: true,
      maximumAge: 3000,
      timeout: 15000
    });
  }

  function updatePosition(position) {
    const { latitude: lat, longitude: lng, accuracy } = position.coords;
    const firstFix = !state.position;
    state.position = { lat, lng, accuracy };

    if (!state.userMarker) {
      state.userMarker = L.circleMarker([lat, lng], {
        radius: 8, weight: 4, color: "#fff", fillColor: "#2563eb", fillOpacity: 1, className: "user-location"
      }).addTo(state.map).bindPopup("Вы здесь");
      state.accuracyCircle = L.circle([lat, lng], { radius: accuracy, weight: 1, color: "#2563eb", fillOpacity: .08 }).addTo(state.map);
    } else {
      state.userMarker.setLatLng([lat, lng]);
      state.accuracyCircle.setLatLng([lat, lng]).setRadius(accuracy);
    }

    if (firstFix || state.following) state.map.setView([lat, lng], firstFix ? 15 : state.map.getZoom(), { animate: true });
    if (state.navigating && state.route) updateGuidance();
  }

  function handleLocationError(error) {
    const messages = {
      1: "Разрешите доступ к геолокации в настройках браузера.",
      2: "Не удалось определить местоположение.",
      3: "GPS отвечает слишком долго. Попробуйте ещё раз."
    };
    showToast(messages[error.code] || "Ошибка геолокации.", 5000);
  }

  function centerOnUser() {
    if (!state.position) {
      showToast("Ждём сигнал GPS…");
      return;
    }
    state.following = true;
    state.map.setView([state.position.lat, state.position.lng], 17, { animate: true });
  }

  async function searchPlaces() {
    const query = el.searchInput.value.trim();
    if (!query) return;
    el.searchResults.hidden = false;
    el.searchResults.innerHTML = '<div class="empty">Ищем…</div>';
    try {
      const params = new URLSearchParams({ format: "jsonv2", q: query, limit: "5", addressdetails: "1", countrycodes: "uz" });
      const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, { headers: { "Accept-Language": "ru" } });
      if (!response.ok) throw new Error(`Search ${response.status}`);
      const places = await response.json();
      renderSearchResults(places);
    } catch (error) {
      console.error(error);
      el.searchResults.innerHTML = '<div class="empty">Поиск сейчас недоступен</div>';
    }
  }

  function renderSearchResults(places) {
    if (!places.length) {
      el.searchResults.innerHTML = '<div class="empty">Ничего не найдено</div>';
      return;
    }
    el.searchResults.replaceChildren(...places.map(place => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "search-result";
      const title = place.name || place.display_name.split(",")[0];
      button.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(place.display_name)}</span>`;
      button.addEventListener("click", () => selectDestination({
        lat: Number(place.lat), lng: Number(place.lon), name: title, address: place.display_name
      }));
      return button;
    }));
  }

  function selectDestination(destination) {
    state.destination = destination;
    state.route = null;
    state.navigating = false;
    state.lastInstruction = "";
    hideResults();
    el.searchInput.value = destination.name;
    el.placeName.textContent = destination.name;
    el.placePanel.hidden = false;
    el.routeSummary.hidden = true;
    el.routeBtn.hidden = false;
    el.startBtn.hidden = true;
    el.stopBtn.hidden = true;
    el.guidance.hidden = true;
    updateSaveButton();
    if (state.destinationMarker) state.map.removeLayer(state.destinationMarker);
    state.destinationMarker = L.marker([destination.lat, destination.lng]).addTo(state.map).bindPopup(escapeHtml(destination.name));
    state.map.setView([destination.lat, destination.lng], 16, { animate: true });
  }

  function buildRoute(isReroute) {
    if (!state.position) {
      showToast("Сначала дождитесь сигнала GPS.");
      return;
    }
    if (!state.destination) return;
    const requestId = ++state.routeRequestId;
    if (!isReroute) showToast("Строим маршрут…");
    if (state.routeControl) state.map.removeControl(state.routeControl);

    state.routeControl = L.Routing.control({
      waypoints: [L.latLng(state.position.lat, state.position.lng), L.latLng(state.destination.lat, state.destination.lng)],
      router: L.Routing.osrmv1({ serviceUrl: "https://router.project-osrm.org/route/v1" }),
      lineOptions: { styles: [{ color: "#1d4ed8", opacity: .9, weight: 7 }, { color: "#60a5fa", opacity: .9, weight: 3 }] },
      routeWhileDragging: false,
      addWaypoints: false,
      draggableWaypoints: false,
      fitSelectedRoutes: !isReroute,
      showAlternatives: false,
      createMarker: () => null
    }).addTo(state.map);

    state.routeControl.once("routesfound", event => {
      if (requestId !== state.routeRequestId) return;
      state.route = event.routes[0];
      renderRouteSummary(state.route.summary);
      if (isReroute) {
        showToast("Маршрут обновлён");
        updateGuidance();
      }
    });
    state.routeControl.once("routingerror", () => {
      if (requestId === state.routeRequestId) showToast("Не удалось построить маршрут. Проверьте интернет.", 5000);
    });
  }

  function renderRouteSummary(summary) {
    el.routeDistance.textContent = formatDistance(summary.totalDistance);
    el.routeTime.textContent = formatDuration(summary.totalTime);
    el.arrivalTime.textContent = new Date(Date.now() + summary.totalTime * 1000).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
    el.routeSummary.hidden = false;
    el.routeBtn.hidden = true;
    el.startBtn.hidden = false;
  }

  function startNavigation() {
    if (!state.route) return;
    state.navigating = true;
    state.following = true;
    el.startBtn.hidden = true;
    el.stopBtn.hidden = false;
    el.guidance.hidden = false;
    el.placePanel.hidden = true;
    centerOnUser();
    updateGuidance();
    showToast("Навигация началась");
  }

  function stopNavigation() {
    state.navigating = false;
    state.route = null;
    state.lastInstruction = "";
    el.guidance.hidden = true;
    el.placePanel.hidden = true;
    if (state.routeControl) {
      state.map.removeControl(state.routeControl);
      state.routeControl = null;
    }
    showToast("Маршрут завершён");
  }

  function updateGuidance() {
    const coords = state.route.coordinates || [];
    if (!coords.length || !state.position) return;
    const current = L.latLng(state.position.lat, state.position.lng);
    let nearestIndex = 0;
    let nearestDistance = Infinity;
    coords.forEach((coord, index) => {
      const distance = current.distanceTo(coord);
      if (distance < nearestDistance) { nearestDistance = distance; nearestIndex = index; }
    });

    const destinationDistance = current.distanceTo(L.latLng(state.destination.lat, state.destination.lng));
    if (destinationDistance < 30) {
      el.instruction.textContent = "Вы прибыли";
      el.instructionDistance.textContent = state.destination.name;
      el.turnIcon.textContent = "✓";
      if (state.lastInstruction !== "arrived") speak("Вы прибыли в пункт назначения");
      state.lastInstruction = "arrived";
      return;
    }

    if (nearestDistance > 70 && Date.now() - state.lastReroute > 20000) {
      state.lastReroute = Date.now();
      buildRoute(true);
      return;
    }

    const instructions = state.route.instructions || [];
    const next = instructions.find(item => (item.index ?? 0) >= nearestIndex) || instructions[instructions.length - 1];
    if (!next) return;
    const point = coords[next.index] || coords[coords.length - 1];
    const distance = current.distanceTo(point);
    const text = next.text || instructionLabel(next.type, next.modifier);
    el.instruction.textContent = text;
    el.instructionDistance.textContent = distance < 25 ? "Сейчас" : `Через ${formatDistance(distance)}`;
    el.turnIcon.textContent = turnIcon(next.type, next.modifier);

    const key = `${next.index}:${text}`;
    if (key !== state.lastInstruction && distance < 220) {
      speak(`${distance < 25 ? "Сейчас" : `Через ${formatDistance(distance)}`}. ${text}`);
      state.lastInstruction = key;
    }
  }

  function instructionLabel(type = "", modifier = "") {
    const value = `${type} ${modifier}`.toLowerCase();
    if (value.includes("destination")) return "Пункт назначения впереди";
    if (value.includes("roundabout")) return "Въезжайте на круговое движение";
    if (value.includes("left")) return "Поверните налево";
    if (value.includes("right")) return "Поверните направо";
    if (value.includes("uturn")) return "Развернитесь";
    return "Продолжайте движение прямо";
  }

  function turnIcon(type = "", modifier = "") {
    const value = `${type} ${modifier}`.toLowerCase();
    if (value.includes("left")) return "↰";
    if (value.includes("right")) return "↱";
    if (value.includes("uturn")) return "↶";
    if (value.includes("destination")) return "●";
    return "↑";
  }

  function toggleVoice() {
    state.voice = !state.voice;
    el.voiceBtn.textContent = state.voice ? "🔊" : "🔇";
    el.voiceBtn.setAttribute("aria-label", state.voice ? "Выключить голос" : "Включить голос");
    if (!state.voice && "speechSynthesis" in window) window.speechSynthesis.cancel();
  }

  function speak(text) {
    if (!state.voice || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "ru-RU";
    utterance.rate = .95;
    window.speechSynthesis.speak(utterance);
  }

  function toggleFavorite() {
    if (!state.destination) return;
    const favorites = readStorage(STORAGE.favorites);
    const index = favorites.findIndex(item => samePlace(item, state.destination));
    if (index >= 0) {
      favorites.splice(index, 1);
      showToast("Удалено из сохранённых");
    } else {
      favorites.unshift({ ...state.destination, savedAt: Date.now() });
      showToast("Место сохранено");
    }
    writeStorage(STORAGE.favorites, favorites);
    updateSaveButton();
  }

  function updateSaveButton() {
    const saved = state.destination && readStorage(STORAGE.favorites).some(item => samePlace(item, state.destination));
    el.saveBtn.textContent = saved ? "★ Сохранено" : "☆ Сохранить";
  }

  function openFavorites() {
    renderFavorites();
    el.favoritesDialog.showModal();
  }

  function renderFavorites() {
    const favorites = readStorage(STORAGE.favorites);
    if (!favorites.length) {
      el.favoritesList.innerHTML = '<div class="empty">Здесь появятся ваши места</div>';
      return;
    }
    el.favoritesList.replaceChildren(...favorites.map((place, index) => {
      const row = document.createElement("div");
      row.className = "list-row";
      const open = document.createElement("button");
      open.type = "button";
      open.innerHTML = `<strong>${escapeHtml(place.name)}</strong><span>${escapeHtml(place.address || "")}</span>`;
      open.addEventListener("click", () => { el.favoritesDialog.close(); selectDestination(place); });
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "delete-button";
      remove.textContent = "Удалить";
      remove.addEventListener("click", () => {
        favorites.splice(index, 1);
        writeStorage(STORAGE.favorites, favorites);
        renderFavorites();
        updateSaveButton();
      });
      row.append(open, remove);
      return row;
    }));
  }

  function openReports() {
    if (!state.position) {
      showToast("Сначала дождитесь сигнала GPS.");
      return;
    }
    el.reportDialog.showModal();
  }

  function addReport(event) {
    const button = event.target.closest("[data-report]");
    if (!button || !state.position) return;
    const reports = readStorage(STORAGE.reports);
    reports.unshift({
      type: button.dataset.report,
      icon: button.dataset.icon,
      lat: state.position.lat,
      lng: state.position.lng,
      createdAt: Date.now()
    });
    writeStorage(STORAGE.reports, reports.slice(0, 50));
    el.reportDialog.close();
    renderReports();
    showToast("Событие отмечено на карте");
  }

  function renderReports() {
    state.reportLayers.forEach(layer => state.map?.removeLayer(layer));
    state.reportLayers = [];
    if (!state.map) return;
    const active = readStorage(STORAGE.reports).filter(report => Date.now() - report.createdAt < 24 * 60 * 60 * 1000);
    active.forEach(report => {
      const icon = L.divIcon({ className: "", html: `<div class="report-marker">${escapeHtml(report.icon)}</div>`, iconSize: [34, 34], iconAnchor: [17, 17] });
      const marker = L.marker([report.lat, report.lng], { icon }).addTo(state.map)
        .bindPopup(`<strong>${escapeHtml(report.type)}</strong><br>${new Date(report.createdAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`);
      state.reportLayers.push(marker);
    });
  }

  function readStorage(key) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "[]");
      return Array.isArray(value) ? value : [];
    } catch { return []; }
  }

  function writeStorage(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch { showToast("Не удалось сохранить данные."); }
  }

  function samePlace(a, b) {
    return Math.abs(a.lat - b.lat) < .00001 && Math.abs(a.lng - b.lng) < .00001;
  }

  function formatDistance(meters) {
    if (meters < 1000) return `${Math.max(10, Math.round(meters / 10) * 10)} м`;
    return `${(meters / 1000).toFixed(meters < 10000 ? 1 : 0)} км`;
  }

  function formatDuration(seconds) {
    const minutes = Math.max(1, Math.round(seconds / 60));
    if (minutes < 60) return `${minutes} мин`;
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? `${hours} ч ${rest} мин` : `${hours} ч`;
  }

  function hideResults() { el.searchResults.hidden = true; }

  let toastTimer;
  function showToast(message, duration = 2600) {
    clearTimeout(toastTimer);
    el.toast.textContent = message;
    el.toast.hidden = false;
    toastTimer = setTimeout(() => { el.toast.hidden = true; }, duration);
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
  }

  init();
})();
