// Errand price calculator (chauffeur page): pin pickup and drop-off on an
// OpenStreetMap map, get the road distance (OSRM, via /api/route), and show
// ฿200 service + ฿12 per km.
(function () {
  "use strict";
  var BASE = 200, PER_KM = 12;
  var mapEl = document.getElementById("calc-map");
  if (!mapEl || typeof L === "undefined") return;

  var map = L.map(mapEl, { scrollWheelZoom: false }).setView([9.51, 100.02], 11); // Koh Samui
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);
  // The map box can change size with the layout; keep Leaflet in step.
  if ("ResizeObserver" in window) new ResizeObserver(function () { map.invalidateSize(); }).observe(mapEl);

  var els = {
    modeBtns: document.querySelectorAll("[data-calc-mode]"),
    search: document.getElementById("calc-search"),
    searchBtn: document.getElementById("calc-search-btn"),
    locate: document.getElementById("calc-locate"),
    status: document.getElementById("calc-status"),
    distance: document.getElementById("calc-distance"),
    price: document.getElementById("calc-price"),
    result: document.getElementById("calc-result"),
    book: document.getElementById("calc-book"),
    pickupLabel: document.getElementById("calc-pickup"),
    dropLabel: document.getElementById("calc-drop")
  };
  var mode = "pickup";
  var points = { pickup: null, drop: null };
  var markers = {};
  var line = null;
  var last = null; // { km, price, approx }

  function icon(letter, cls) {
    return L.divIcon({ className: "calc-pin " + cls, html: "<span>" + letter + "</span>", iconSize: [30, 30], iconAnchor: [15, 15] });
  }
  function fmt(n) { return n.toLocaleString("en-US"); }
  function priceFor(km) { return Math.ceil((BASE + PER_KM * km) / 10) * 10; }
  function setStatus(t) { els.status.textContent = t; }

  function setMode(m) {
    mode = m;
    els.modeBtns.forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-calc-mode") === m)); });
    setStatus(m === "pickup" ? "Tap the map or search to set the pickup point." : "Tap the map or search to set the drop-off point.");
  }

  function place(which, latlng, label) {
    points[which] = { lat: latlng.lat, lng: latlng.lng, label: label || "" };
    if (markers[which]) markers[which].setLatLng(latlng);
    else {
      markers[which] = L.marker(latlng, { draggable: true, icon: icon(which === "pickup" ? "A" : "B", which) }).addTo(map);
      markers[which].on("dragend", function () {
        points[which].lat = markers[which].getLatLng().lat;
        points[which].lng = markers[which].getLatLng().lng;
        points[which].label = "";
        update();
      });
    }
    if (which === "pickup" && !points.drop) setMode("drop");
    update();
  }

  function haversineKm(a, b) {
    var R = 6371, toRad = Math.PI / 180;
    var dLat = (b.lat - a.lat) * toRad, dLng = (b.lng - a.lng) * toRad;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function labelFor(p) { return p.label || (p.lat.toFixed(5) + ", " + p.lng.toFixed(5)); }

  function showResult(km, approx) {
    var price = priceFor(km);
    last = { km: km, price: price, approx: approx };
    els.distance.textContent = (approx ? "about " : "") + km.toFixed(1) + " km";
    els.price.textContent = "฿" + fmt(price);
    els.result.hidden = false;
    els.book.disabled = false;
    setStatus(approx ? "Road route unavailable right now, so this uses an estimate of the road distance." : "Drag the pins to adjust. We confirm the final price before we go.");
  }

  function update() {
    els.pickupLabel.textContent = points.pickup ? labelFor(points.pickup) : "Not set";
    els.dropLabel.textContent = points.drop ? labelFor(points.drop) : "Not set";
    if (!points.pickup || !points.drop) return;
    var a = points.pickup, b = points.drop;
    map.invalidateSize();
    map.fitBounds(L.latLngBounds([a, b]).pad(0.25));
    setStatus("Calculating the road distance…");
    var url = "/api/route?from=" + a.lng.toFixed(6) + "," + a.lat.toFixed(6) + "&to=" + b.lng.toFixed(6) + "," + b.lat.toFixed(6);
    fetch(url).then(function (r) { return r.json(); }).then(function (d) {
      if (!d.ok) throw new Error("no route");
      var route = d;
      if (line) map.removeLayer(line);
      line = L.geoJSON(route.geometry, { style: { color: "#0f2a2a", weight: 5, opacity: .8 } }).addTo(map);
      map.fitBounds(line.getBounds().pad(0.15));
      showResult(route.distance / 1000, false);
    }).catch(function () {
      if (line) { map.removeLayer(line); line = null; }
      showResult(haversineKm(a, b) * 1.3, true);
    });
  }

  map.on("click", function (e) { place(mode, e.latlng); });
  els.modeBtns.forEach(function (b) {
    b.addEventListener("click", function () { setMode(b.getAttribute("data-calc-mode")); });
  });

  function search() {
    var q = els.search.value.trim();
    if (!q) return;
    setStatus("Searching…");
    fetch("https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=th&q=" + encodeURIComponent(q))
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res.length) { setStatus("No place found. Try another name, or tap the map."); return; }
        var p = res[0], ll = L.latLng(+p.lat, +p.lon);
        map.setView(ll, 15);
        place(mode, ll, p.display_name.split(",").slice(0, 2).join(","));
        els.search.value = "";
      })
      .catch(function () { setStatus("Search isn't available right now. Tap the map instead."); });
  }
  els.searchBtn.addEventListener("click", search);
  els.search.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); search(); } });

  els.locate.addEventListener("click", function () {
    if (!("geolocation" in navigator)) { setStatus("Your browser can't share location."); return; }
    setStatus("Finding your location…");
    navigator.geolocation.getCurrentPosition(function (pos) {
      var ll = L.latLng(pos.coords.latitude, pos.coords.longitude);
      map.setView(ll, 15);
      place("pickup", ll, "My location");
    }, function () { setStatus("Location access was blocked. Tap the map or search instead."); },
    { enableHighAccuracy: true, timeout: 15000 });
  });

  // Carry the route into the booking form.
  els.book.addEventListener("click", function () {
    if (!last) return;
    var form = document.getElementById("book-form");
    if (!form) return;
    form.querySelectorAll('input[name="service"]').forEach(function (cb) { if (cb.value === "chauffeur") cb.checked = true; });
    var a = points.pickup, b = points.drop;
    var summary = "Errand route: " + labelFor(a) + " → " + labelFor(b) + " (" + (last.approx ? "about " : "") + last.km.toFixed(1) + " km). Estimated ฿" + fmt(last.price) + ".";
    var notes = form.elements.notes;
    notes.value = summary + (notes.value && notes.value.indexOf("Errand route:") !== 0 ? "\n" + notes.value : "");
    if (!form.elements.address.value.trim()) form.elements.address.value = "Pickup: " + labelFor(a);
    if (form.elements.lat && !form.elements.lat.value) { form.elements.lat.value = a.lat.toFixed(6); form.elements.lng.value = a.lng.toFixed(6); }
    document.getElementById("book").scrollIntoView();
    form.elements.name.focus({ preventScroll: true });
  });

  setMode("pickup");
})();
