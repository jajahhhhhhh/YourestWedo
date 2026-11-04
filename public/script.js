(function () {
  "use strict";

  // Footer year
  var yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  // Mobile navigation
  var toggle = document.querySelector(".nav-toggle");
  var nav = document.getElementById("site-nav");
  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      var open = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", String(!open));
      nav.classList.toggle("open", !open);
    });
    nav.addEventListener("click", function (e) {
      if (e.target.closest("a")) {
        toggle.setAttribute("aria-expanded", "false");
        nav.classList.remove("open");
      }
    });
  }

  // Fully booked days for each service (YYYY-MM-DD). Each service has its
  // own calendar. Update these lists when a schedule changes.
  var BOOKED = {
    cleaning: [
      "2026-11-01", "2026-11-02", "2026-11-06", "2026-11-07", "2026-11-09",
      "2026-11-11", "2026-11-15", "2026-11-19", "2026-11-22", "2026-11-30",
      "2026-12-01"
    ],
    chauffeur: [],
    carwash: [],
    grocery: []
  };

  function isBooked(service, iso) {
    return (BOOKED[service] || []).indexOf(iso) !== -1;
  }

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function isoOf(y, m, d) { return y + "-" + pad(m + 1) + "-" + pad(d); }

  // Availability calendar
  var calDays = document.getElementById("cal-days");
  var calTitle = document.getElementById("cal-title");
  var calPrev = document.getElementById("cal-prev");
  var calNext = document.getElementById("cal-next");
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July",
    "August", "September", "October", "November", "December"];
  var now = new Date();
  var view = { y: now.getFullYear(), m: now.getMonth() };
  var minView = { y: now.getFullYear(), m: now.getMonth() };
  // A service's own page sets data-service-page on <body>
  var pageService = document.body.getAttribute("data-service-page");
  var calService = pageService || "cleaning";
  var SERVICE_NAMES = {
    cleaning: "home cleaning", chauffeur: "a chauffeur",
    carwash: "a car wash", grocery: "grocery delivery"
  };

  function renderCalendar() {
    if (!calDays) return;
    var today = isoOf(now.getFullYear(), now.getMonth(), now.getDate());
    calTitle.textContent = MONTHS[view.m] + " " + view.y;
    calPrev.disabled = view.y === minView.y && view.m === minView.m;
    calDays.textContent = "";
    var first = new Date(view.y, view.m, 1);
    var lead = (first.getDay() + 6) % 7; // Monday-first
    var count = new Date(view.y, view.m + 1, 0).getDate();
    for (var i = 0; i < lead; i++) {
      var blank = document.createElement("span");
      blank.className = "cal-day cal-blank";
      calDays.appendChild(blank);
    }
    for (var d = 1; d <= count; d++) {
      var iso = isoOf(view.y, view.m, d);
      var cell;
      if (iso < today) {
        cell = document.createElement("span");
        cell.className = "cal-day is-past";
        cell.innerHTML = '<span class="cal-num">' + d + "</span>";
      } else if (isBooked(calService, iso)) {
        cell = document.createElement("span");
        cell.className = "cal-day is-booked";
        cell.innerHTML = '<span class="cal-num">' + d + '</span><span class="cal-tag">Booked</span>';
        cell.setAttribute("aria-label", MONTHS[view.m] + " " + d + ", booked");
      } else {
        cell = document.createElement("button");
        cell.type = "button";
        cell.className = "cal-day is-open";
        cell.dataset.date = iso;
        cell.innerHTML = '<span class="cal-num">' + d + "</span>";
        cell.setAttribute("aria-label", MONTHS[view.m] + " " + d + ", available — book " + SERVICE_NAMES[calService]);
      }
      if (iso === today) cell.classList.add("is-today");
      calDays.appendChild(cell);
    }
  }

  if (calDays) {
    calPrev.addEventListener("click", function () {
      view.m -= 1;
      if (view.m < 0) { view.m = 11; view.y -= 1; }
      renderCalendar();
    });
    calNext.addEventListener("click", function () {
      view.m += 1;
      if (view.m > 11) { view.m = 0; view.y += 1; }
      renderCalendar();
    });
    calDays.addEventListener("click", function (e) {
      var btn = e.target.closest("button.is-open");
      if (!btn || !form) return;
      showForm();
      form.elements.date.value = btn.dataset.date;
      form.querySelectorAll('input[name="service"]').forEach(function (cb) {
        if (cb.value === calService) cb.checked = true;
      });
      document.getElementById("book").scrollIntoView(); // CSS scroll-behavior decides, so reduced motion is respected
      form.elements.name.focus({ preventScroll: true });
    });
    document.querySelectorAll("[data-cal-service]").forEach(function (tab) {
      tab.addEventListener("click", function () {
        calService = tab.getAttribute("data-cal-service");
        document.querySelectorAll("[data-cal-service]").forEach(function (t) {
          t.setAttribute("aria-selected", String(t === tab));
        });
        renderCalendar();
      });
    });
    renderCalendar();
  }

  // Booking form
  var form = document.getElementById("book-form");
  var success = document.getElementById("book-success");
  var summary = document.getElementById("book-summary");
  var again = document.getElementById("book-again");
  var submitBtn = document.getElementById("book-submit");
  var formStatus = document.getElementById("form-status");
  if (!form) return;

  var SERVICE_LABELS = {
    cleaning: "Home cleaning",
    chauffeur: "Chauffeur",
    carwash: "Car wash at home",
    grocery: "Grocery delivery"
  };

  function todayISO() {
    var d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  }

  var dateInput = form.elements.date;
  dateInput.min = todayISO();

  function preselectPageService() {
    if (!pageService) return;
    form.querySelectorAll('input[name="service"]').forEach(function (cb) {
      if (cb.value === pageService) cb.checked = true;
    });
  }
  preselectPageService();

  // "Book X →" links on service cards preselect that service
  document.querySelectorAll("[data-service]").forEach(function (link) {
    link.addEventListener("click", function () {
      var value = link.getAttribute("data-service");
      form.querySelectorAll('input[name="service"]').forEach(function (cb) {
        if (cb.value === value) cb.checked = true;
      });
      showForm();
    });
  });

  // The control each error message describes. Two messages can describe the date.
  function errorTarget(name) {
    if (name === "service") return document.getElementById("service-group");
    if (name === "date-booked") return form.elements.date;
    return form.elements[name];
  }

  function setError(name, show) {
    var msg = form.querySelector('[data-error-for="' + name + '"]');
    if (msg) msg.hidden = !show;
    var target = errorTarget(name);
    if (!target || !target.setAttribute || !msg) return;
    var ids = (target.getAttribute("aria-describedby") || "").split(" ").filter(function (id) {
      return id && id !== msg.id;
    });
    if (show) ids.push(msg.id);
    if (ids.length) target.setAttribute("aria-describedby", ids.join(" "));
    else target.removeAttribute("aria-describedby");
    var invalid = show || Array.prototype.some.call(
      form.querySelectorAll(".field-error:not([hidden])"),
      function (m) { return errorTarget(m.getAttribute("data-error-for")) === target; }
    );
    if (target.tagName === "FIELDSET") return;
    if (invalid) target.setAttribute("aria-invalid", "true");
    else target.removeAttribute("aria-invalid");
  }

  // Service address: current location and Google Maps
  var locUse = document.getElementById("loc-use");
  var locFind = document.getElementById("loc-find");
  var locStatus = document.getElementById("loc-status");
  var locMap = document.getElementById("loc-map");
  var locFrame = document.getElementById("loc-frame");
  var locLink = document.getElementById("loc-link");

  function mapLinkFor(address, lat, lng) {
    var q = lat && lng ? lat + "," + lng : address;
    return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(q);
  }

  function setLocStatus(text, isError) {
    locStatus.textContent = text;
    locStatus.hidden = !text;
    locStatus.classList.toggle("is-error", !!isError);
  }

  function showMap(address, lat, lng) {
    var q = lat && lng ? lat + "," + lng : address;
    locFrame.src = "https://maps.google.com/maps?q=" + encodeURIComponent(q) + "&z=16&output=embed";
    locLink.href = mapLinkFor(address, lat, lng);
    locMap.hidden = false;
  }

  function clearPin() {
    form.elements.lat.value = "";
    form.elements.lng.value = "";
  }

  function resetLocation() {
    clearPin();
    setLocStatus("");
    locMap.hidden = true;
    locFrame.removeAttribute("src");
  }

  if (locUse) {
    locUse.addEventListener("click", function () {
      if (!("geolocation" in navigator)) {
        setLocStatus("Your browser can't share location. Please type your address instead.", true);
        return;
      }
      locUse.disabled = true;
      setLocStatus("Finding your location…");
      navigator.geolocation.getCurrentPosition(function (pos) {
        locUse.disabled = false;
        var lat = pos.coords.latitude.toFixed(6);
        var lng = pos.coords.longitude.toFixed(6);
        form.elements.lat.value = lat;
        form.elements.lng.value = lng;
        showMap(form.elements.address.value.trim(), lat, lng);
        setLocStatus("Location pinned (accurate to about " + Math.round(pos.coords.accuracy) + " m). Add your house number, building or floor above if needed.");
        if (form.querySelector('[data-error-for="address"]:not([hidden])')) validate();
      }, function (err) {
        locUse.disabled = false;
        var msg = err.code === 1
          ? "Location access was blocked. Allow location for this site in your browser settings, or type your address instead."
          : "We couldn't get your location. Please try again or type your address instead.";
        setLocStatus(msg, true);
      }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
    });

    locFind.addEventListener("click", function () {
      var address = form.elements.address.value.trim();
      var lat = form.elements.lat.value, lng = form.elements.lng.value;
      if (!address && !(lat && lng)) {
        setLocStatus("Type your address first, or use your current location.", true);
        form.elements.address.focus();
        return;
      }
      setLocStatus("");
      showMap(address, lat, lng);
    });
  }

  function validate() {
    var errors = [];
    var services = Array.prototype.filter.call(
      form.querySelectorAll('input[name="service"]'),
      function (cb) { return cb.checked; }
    ).map(function (cb) { return cb.value; });

    var name = form.elements.name.value.trim();
    var phone = form.elements.phone.value.trim();
    var email = form.elements.email.value.trim();
    var address = form.elements.address.value.trim();
    var lat = form.elements.lat.value;
    var lng = form.elements.lng.value;
    var date = form.elements.date.value;

    var checks = {
      service: services.length > 0,
      name: name.length > 1,
      phone: /^\+?[\d\s\-().]+$/.test(phone) && phone.replace(/\D/g, "").length >= 9,
      email: email === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
      address: address.length > 3 || (lat !== "" && lng !== ""),
      date: date !== "" && date >= todayISO()
    };

    Object.keys(checks).forEach(function (key) {
      setError(key, !checks[key]);
      if (!checks[key]) errors.push(key);
    });

    // A service can't be booked on a day its calendar is already full
    var blocked = checks.date ? services.filter(function (sv) { return isBooked(sv, date); }) : [];
    var bookedMsg = form.querySelector('[data-error-for="date-booked"]');
    if (bookedMsg && blocked.length) {
      bookedMsg.textContent = blocked.map(function (sv) { return SERVICE_LABELS[sv]; }).join(", ") +
        (blocked.length > 1 ? " are" : " is") + " fully booked on this day. Please choose another date.";
    }
    setError("date-booked", blocked.length > 0);
    if (blocked.length) {
      form.elements.date.setAttribute("aria-invalid", "true");
      errors.push("date");
    }

    return {
      ok: errors.length === 0,
      firstError: errors[0],
      data: {
        services: services,
        name: name,
        phone: phone,
        email: email,
        address: address || "Current location (pinned on map)",
        lat: lat,
        lng: lng,
        mapUrl: mapLinkFor(address, lat, lng),
        date: date,
        time: form.elements.time.value,
        notes: form.elements.notes.value.trim()
      }
    };
  }

  function renderSummary(data) {
    var rows = [
      ["Services", data.services.map(function (s) { return SERVICE_LABELS[s]; }).join(", ")],
      ["Name", data.name],
      ["Phone", data.phone],
      ["Email", data.email || "—"],
      ["Address", data.address],
      ["Map", data.mapUrl],
      ["Date", data.date],
      ["Time", data.time || "Any time"],
      ["Details", data.notes || "—"]
    ];
    summary.textContent = "";
    rows.forEach(function (r) {
      var dt = document.createElement("dt");
      var dd = document.createElement("dd");
      dt.textContent = r[0];
      if (r[0] === "Map") {
        var a = document.createElement("a");
        a.href = r[1];
        a.target = "_blank";
        a.rel = "noopener";
        a.textContent = "Open in Google Maps ↗";
        dd.appendChild(a);
      } else {
        dd.textContent = r[1];
      }
      summary.appendChild(dt);
      summary.appendChild(dd);
    });
  }

  function showForm() {
    if (!success.hidden) {
      success.hidden = true;
      form.hidden = false;
    }
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var result = validate();
    if (!result.ok) {
      var target = result.firstError === "service"
        ? form.querySelector('input[name="service"]')
        : form.elements[result.firstError];
      if (target) target.focus();
      return;
    }

    // Send the request to the team on LINE (see /api/booking in worker.js).
    var payload = Object.assign({}, result.data, {
      lat: form.elements.lat.value,
      lng: form.elements.lng.value,
      address: form.elements.address.value.trim(),
      website: form.elements.website.value,
      page: location.href.split("#")[0]
    });
    delete payload.mapUrl;

    setFormStatus("");
    submitBtn.disabled = true;
    submitBtn.textContent = "Sending…";

    fetch("/api/booking", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (!res.ok || !body.ok) throw new Error(body.error || "Request failed");
      });
    }).then(function () {
      renderSummary(result.data);
      form.hidden = true;
      success.hidden = false;
      success.focus();
    }).catch(function () {
      setFormStatus("Sorry, we couldn't send your request. Please check your connection and try again.");
    }).then(function () {
      submitBtn.disabled = false;
      submitBtn.textContent = "Send request";
    });
  });

  function setFormStatus(message) {
    formStatus.textContent = message;
    formStatus.hidden = !message;
  }

  // Clear an error as soon as the user fixes the field
  form.addEventListener("input", function (e) {
    if (form.querySelector(".field-error:not([hidden])")) validate();
  });

  again.addEventListener("click", function () {
    form.reset();
    if (locUse) resetLocation();
    setFormStatus("");
    dateInput.min = todayISO();
    preselectPageService();
    success.hidden = true;
    form.hidden = false;
    form.querySelector('input[name="service"]').focus();
  });
})();
