// Distance price calculator: ฿200 service + ฿12 per km, pickup to drop-off,
// rounded up to the nearest ฿10. Pin A (pickup) and B (drop-off) on an
// OpenStreetMap map; road distance comes from OSRM via /api/route.
// Used by the calculator on the chauffeur page ([data-calc-auto]) and by the
// route section of the booking form on every page (mounted from script.js).
(function () {
  "use strict";
  var BASE = 200, PER_KM = 12;
  var LEAFLET = "https://unpkg.com/leaflet@1.9.4/dist/leaflet";
  var leafletReady = null;

  function loadLeaflet() {
    if (window.L) return Promise.resolve();
    if (leafletReady) return leafletReady;
    leafletReady = new Promise(function (resolve, reject) {
      var css = document.createElement("link");
      css.rel = "stylesheet"; css.href = LEAFLET + ".css"; css.crossOrigin = "";
      document.head.appendChild(css);
      var js = document.createElement("script");
      js.src = LEAFLET + ".js"; js.crossOrigin = "";
      js.onload = resolve; js.onerror = reject;
      document.head.appendChild(js);
    });
    return leafletReady;
  }

  function priceFor(km) { return Math.ceil((BASE + PER_KM * km) / 10) * 10; }
  function fmt(n) { return n.toLocaleString("en-US"); }
  function haversineKm(a, b) {
    var R = 6371, r = Math.PI / 180;
    var dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function labelFor(p) { return p.label || (p.lat.toFixed(5) + ", " + p.lng.toFixed(5)); }

  function create(root, opts) {
    var q = function (name) { return root.querySelector('[data-calc="' + name + '"]'); };
    var el = {
      map: q("map"), search: q("search"), searchBtn: q("search-btn"), locate: q("locate"),
      status: q("status"), distance: q("distance"), price: q("price"), result: q("result"),
      pickup: q("pickup"), drop: q("drop"), modes: root.querySelectorAll("[data-calc-mode]")
    };
    var map = L.map(el.map, { scrollWheelZoom: false }).setView([9.51, 100.02], 11); // Koh Samui
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);
    if ("ResizeObserver" in window) new ResizeObserver(function () { map.invalidateSize(); }).observe(el.map);

    var mode = "pickup", points = { pickup: null, drop: null }, markers = {}, line = null, last = null, seq = 0;

    function setStatus(t) { el.status.textContent = t; }
    function setMode(m) {
      mode = m;
      el.modes.forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-calc-mode") === m)); });
      setStatus(m === "pickup" ? "Tap the map or search to set the pickup point." : "Tap the map or search to set the drop-off point.");
    }
    function icon(which) {
      return L.divIcon({ className: "calc-pin " + which, html: "<span>" + (which === "pickup" ? "A" : "B") + "</span>", iconSize: [30, 30], iconAnchor: [15, 15] });
    }
    function emit() { if (opts.onChange) opts.onChange(api.get()); }

    function place(which, latlng, label, silent) {
      points[which] = { lat: latlng.lat, lng: latlng.lng, label: label || "" };
      if (markers[which]) markers[which].setLatLng(latlng);
      else {
        markers[which] = L.marker(latlng, { draggable: true, icon: icon(which) }).addTo(map);
        markers[which].on("dragend", function () {
          var ll = markers[which].getLatLng();
          points[which] = { lat: ll.lat, lng: ll.lng, label: "" };
          update();
        });
      }
      if (which === "pickup" && !points.drop) setMode("drop");
      if (!silent) update();
    }

    function show(km, approx) {
      last = { km: km, price: priceFor(km), approx: approx };
      el.distance.textContent = (approx ? "about " : "") + km.toFixed(1) + " km";
      el.price.textContent = "฿" + fmt(last.price);
      el.result.hidden = false;
      setStatus(approx ? "Road route unavailable right now, so this uses an estimate of the road distance." : "Drag the pins to adjust. We confirm the final price before we go.");
      emit();
    }

    function update() {
      el.pickup.textContent = points.pickup ? labelFor(points.pickup) : "Not set";
      el.drop.textContent = points.drop ? labelFor(points.drop) : "Not set";
      last = null; el.result.hidden = true; emit();
      if (!points.pickup || !points.drop) return;
      var a = points.pickup, b = points.drop, mine = ++seq;
      map.invalidateSize();
      map.fitBounds(L.latLngBounds([a, b]).pad(0.25));
      setStatus("Calculating the road distance…");
      fetch("/api/route?from=" + a.lng.toFixed(6) + "," + a.lat.toFixed(6) + "&to=" + b.lng.toFixed(6) + "," + b.lat.toFixed(6))
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (mine !== seq) return;
          if (!d.ok) throw new Error("no route");
          if (line) map.removeLayer(line);
          line = L.geoJSON(d.geometry, { style: { color: "#0f2a2a", weight: 5, opacity: .8 } }).addTo(map);
          map.fitBounds(line.getBounds().pad(0.15));
          show(d.distance / 1000, false);
        })
        .catch(function () {
          if (mine !== seq) return;
          if (line) { map.removeLayer(line); line = null; }
          show(haversineKm(a, b) * 1.3, true);
        });
    }

    map.on("click", function (e) { place(mode, e.latlng); });
    el.modes.forEach(function (b) { b.addEventListener("click", function () { setMode(b.getAttribute("data-calc-mode")); }); });

    function search() {
      var text = el.search.value.trim();
      if (!text) return;
      setStatus("Searching…");
      fetch("https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=th&q=" + encodeURIComponent(text))
        .then(function (r) { return r.json(); })
        .then(function (res) {
          if (!res.length) { setStatus("No place found. Try another name, or tap the map."); return; }
          var ll = L.latLng(+res[0].lat, +res[0].lon);
          map.setView(ll, 15);
          place(mode, ll, res[0].display_name.split(",").slice(0, 2).join(","));
          el.search.value = "";
        })
        .catch(function () { setStatus("Search isn't available right now. Tap the map instead."); });
    }
    el.searchBtn.addEventListener("click", search);
    el.search.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); search(); } });

    el.locate.addEventListener("click", function () {
      if (!("geolocation" in navigator)) { setStatus("Your browser can't share location."); return; }
      setStatus("Finding your location…");
      navigator.geolocation.getCurrentPosition(function (pos) {
        var ll = L.latLng(pos.coords.latitude, pos.coords.longitude);
        map.setView(ll, 15);
        place("pickup", ll, "My location");
      }, function () { setStatus("Location access was blocked. Tap the map or search instead."); },
      { enableHighAccuracy: true, timeout: 15000 });
    });

    var api = {
      // Current route and price, or null until both pins and a distance exist.
      get: function () {
        if (!last || !points.pickup || !points.drop) return null;
        var a = points.pickup, b = points.drop;
        return {
          pickup: a, drop: b, km: last.km, price: last.price, approx: last.approx,
          text: labelFor(a) + " → " + labelFor(b) + " · " + (last.approx ? "about " : "") + last.km.toFixed(1) + " km · estimate ฿" + fmt(last.price)
        };
      },
      setPoints: function (a, b) {
        place("pickup", L.latLng(a.lat, a.lng), a.label, true);
        place("drop", L.latLng(b.lat, b.lng), b.label, true);
        setMode("drop");
        update();
      },
      reset: function () {
        ["pickup", "drop"].forEach(function (w) { if (markers[w]) { map.removeLayer(markers[w]); delete markers[w]; } points[w] = null; });
        if (line) { map.removeLayer(line); line = null; }
        last = null; el.result.hidden = true;
        el.pickup.textContent = el.drop.textContent = "Not set";
        setMode("pickup"); map.setView([9.51, 100.02], 11); emit();
      }
    };
    setMode("pickup");
    return api;
  }

  window.YWCalc = {
    priceFor: priceFor,
    // Mount a calculator inside `root` (once). Resolves with its API.
    mount: function (root, opts) {
      if (root._ywcalc) return Promise.resolve(root._ywcalc);
      if (root._ywcalcLoading) return root._ywcalcLoading;
      root._ywcalcLoading = loadLeaflet().then(function () {
        root._ywcalc = create(root, opts || {});
        return root._ywcalc;
      });
      return root._ywcalcLoading;
    }
  };

  // Chauffeur page calculator: "Book this errand" copies the route into the form.
  var page = document.querySelector("[data-calc-auto]");
  if (page) {
    window.YWCalc.mount(page, {
      onChange: function (r) { var b = page.querySelector('[data-calc="book"]'); if (b) b.disabled = !r; }
    }).then(function (calc) {
      var book = page.querySelector('[data-calc="book"]');
      book.addEventListener("click", function () {
        var r = calc.get();
        if (!r || !window.YWBooking) return;
        window.YWBooking.useRoute(r);
      });
    });
  }
})();
