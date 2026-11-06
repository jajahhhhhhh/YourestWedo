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
    cleaning: "home cleaning", chauffeur: "a chauffeur or errand",
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
      syncCleaning();
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
    chauffeur: "Chauffeur & errands",
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
    syncCleaning();
  }
  preselectPageService();

  // "Book X →" links on service cards preselect that service
  document.querySelectorAll("[data-service]").forEach(function (link) {
    link.addEventListener("click", function () {
      var value = link.getAttribute("data-service");
      form.querySelectorAll('input[name="service"]').forEach(function (cb) {
        if (cb.value === value) cb.checked = true;
      });
      syncCleaning();
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

  // Cleaning details: property, rooms, area, photos and a rough estimate.
  // Prices mirror the table on cleaning.html.
  var MAX_PHOTOS = 4;
  var photos = []; // { blob, url, name }

  function isCleaningSelected() {
    var cb = form.querySelector('input[name="service"][value="cleaning"]');
    return !!(cb && cb.checked);
  }

  function syncCleaning() {
    var box = document.getElementById("clean-details");
    if (!box) return;
    box.hidden = !isCleaningSelected();
    updateEstimate();
    syncRoute();
  }

  // Errand route: when "Chauffeur & errands" is ticked, show a map to pin
  // pickup and drop-off and price it at ฿200 + ฿12/km (see errand-calc.js).
  var routeBox = document.getElementById("route-details");
  var routeCalc = null;
  function isChauffeurSelected() {
    var cb = form.querySelector('input[name="service"][value="chauffeur"]');
    return !!(cb && cb.checked);
  }
  function mountRoute() {
    if (!routeBox || !window.YWCalc) return Promise.resolve(null);
    return window.YWCalc.mount(routeBox, {
      onChange: function (r) { form.elements.route.value = r ? r.text : ""; }
    }).then(function (calc) { routeCalc = calc; return calc; });
  }
  function syncRoute() {
    if (!routeBox) return;
    var on = isChauffeurSelected();
    routeBox.hidden = !on;
    if (on) mountRoute().catch(function () {});
  }
  function resetRoute() {
    if (form.elements.route) form.elements.route.value = "";
    if (routeCalc) routeCalc.reset();
  }
  // Used by the calculator on the chauffeur page: "Book this errand"
  window.YWBooking = {
    useRoute: function (r) {
      if (!routeBox) return;
      showForm();
      var cb = form.querySelector('input[name="service"][value="chauffeur"]');
      if (cb) cb.checked = true;
      syncCleaning();
      document.getElementById("book").scrollIntoView();
      mountRoute().then(function (calc) { if (calc) calc.setPoints(r.pickup, r.drop); });
    }
  };

  function cleaningInfo() {
    var el = form.elements;
    return {
      type: el.propType.value,
      bedrooms: el.bedrooms.value,
      bathrooms: el.bathrooms.value,
      area: el.area.value
    };
  }

  function estimateFor(info) {
    var beds = parseInt(info.bedrooms, 10);
    var baths = parseInt(info.bathrooms, 10);
    if (info.type === "condo") return "฿700";
    if (info.type === "room") return "฿500 per room";
    if (info.type !== "house" || isNaN(beds)) return "";
    var size = Math.max(beds, isNaN(baths) ? 0 : baths);
    if (size <= 2) return "฿1,000–1,500";
    if (size === 3) return "฿2,000";
    if (size === 4) return "฿3,000";
    return "Priced on site";
  }

  function updateEstimate() {
    var out = document.getElementById("estimate");
    if (!out) return;
    var est = isCleaningSelected() ? estimateFor(cleaningInfo()) : "";
    out.hidden = !est;
    out.innerHTML = est
      ? '<span>Rough estimate</span> <strong></strong> <small>Final price after we review your photos or visit.</small>'
      : "";
    if (est) out.querySelector("strong").textContent = est;
  }

  // Shrink a photo to at most 1600 px and about 900 KB as JPEG, so it
  // uploads quickly and LINE can show it.
  function compressPhoto(file) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      var src = URL.createObjectURL(file);
      img.onload = function () {
        URL.revokeObjectURL(src);
        var scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
        var canvas = document.createElement("canvas");
        canvas.width = Math.round(img.naturalWidth * scale);
        canvas.height = Math.round(img.naturalHeight * scale);
        var ctx = canvas.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        (function attempt(quality) {
          canvas.toBlob(function (blob) {
            if (!blob) return reject(new Error("encode"));
            if (blob.size > 900 * 1024 && quality > 0.45) return attempt(quality - 0.15);
            resolve(blob);
          }, "image/jpeg", quality);
        })(0.82);
      };
      img.onerror = function () { URL.revokeObjectURL(src); reject(new Error("decode")); };
      img.src = src;
    });
  }

  function photoError(message) {
    var msg = document.getElementById("err-photos");
    msg.textContent = message;
    msg.hidden = !message;
  }

  function renderPhotos() {
    var list = document.getElementById("photo-list");
    list.textContent = "";
    photos.forEach(function (p, i) {
      var li = document.createElement("li");
      var img = document.createElement("img");
      img.src = p.url;
      img.alt = "Photo " + (i + 1);
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "photo-remove";
      btn.setAttribute("aria-label", "Remove photo " + (i + 1));
      btn.textContent = "×";
      btn.addEventListener("click", function () {
        URL.revokeObjectURL(p.url);
        photos.splice(i, 1);
        photoError("");
        renderPhotos();
      });
      li.appendChild(img);
      li.appendChild(btn);
      list.appendChild(li);
    });
    document.querySelector(".photo-drop").hidden = photos.length >= MAX_PHOTOS;
  }

  function clearPhotos() {
    photos.forEach(function (p) { URL.revokeObjectURL(p.url); });
    photos = [];
    photoError("");
    var list = document.getElementById("photo-list");
    if (list) renderPhotos();
  }

  var photoInput = document.getElementById("photos");
  if (photoInput) {
    photoInput.addEventListener("change", function () {
      var files = Array.prototype.slice.call(photoInput.files || []);
      photoInput.value = "";
      var room = MAX_PHOTOS - photos.length;
      var skipped = files.length > room;
      files = files.slice(0, Math.max(0, room)).filter(function (f) { return /^image\//.test(f.type) || !f.type; });
      Promise.all(files.map(function (f) {
        return compressPhoto(f).then(function (blob) {
          return { blob: blob, url: URL.createObjectURL(blob), name: f.name };
        }, function () { return null; });
      })).then(function (done) {
        var bad = done.filter(function (d) { return !d; }).length;
        done.forEach(function (d) { if (d) photos.push(d); });
        renderPhotos();
        photoError(
          bad ? "Some photos couldn't be read. Please use JPG or PNG photos." :
          skipped ? "You can add up to " + MAX_PHOTOS + " photos." : ""
        );
      });
    });
    form.addEventListener("change", function (e) {
      if (e.target.name === "service") syncCleaning();
    });
    ["propType", "bedrooms", "bathrooms"].forEach(function (n) {
      form.elements[n].addEventListener("input", updateEstimate);
      form.elements[n].addEventListener("change", updateEstimate);
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

    var cleaning = services.indexOf("cleaning") !== -1 && !!form.elements.propType;
    var info = cleaning ? cleaningInfo() : null;
    function count(v) { return /^\d{1,2}$/.test(v) && +v <= 20; }

    var checks = {
      service: services.length > 0,
      name: name.length > 1,
      phone: /^\+?[\d\s\-().]+$/.test(phone) && phone.replace(/\D/g, "").length >= 9,
      email: email === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
      address: address.length > 3 || (lat !== "" && lng !== ""),
      date: date !== "" && date >= todayISO()
    };
    if (form.elements.propType) {
      checks.propType = !cleaning || info.type !== "";
      checks.bedrooms = !cleaning || count(info.bedrooms);
      checks.bathrooms = !cleaning || count(info.bathrooms);
      checks.area = !cleaning || info.area === "" || (+info.area >= 5 && +info.area <= 5000);
    }

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
        notes: form.elements.notes.value.trim(),
        route: form.elements.route && services.indexOf("chauffeur") !== -1 ? form.elements.route.value : "",
        cleaning: cleaning ? {
          type: info.type,
          bedrooms: info.bedrooms,
          bathrooms: info.bathrooms,
          area: info.area,
          estimate: estimateFor(info),
          photos: photos.length
        } : null
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
    if (data.route) rows.splice(rows.length - 1, 0, ["Route", data.route]);
    if (data.cleaning) {
      var TYPES = { house: "House or villa", condo: "Condo", room: "Rental room or dorm room", other: "Other" };
      var c = data.cleaning;
      rows.splice(1, 0,
        ["Property", TYPES[c.type] + " · " + c.bedrooms + " bed, " + c.bathrooms + " bath" + (c.area ? " · " + c.area + " m²" : "")],
        ["Estimate", c.estimate || "We'll quote after reviewing"],
        ["Photos", c.photos ? c.photos + " attached" : "None"]
      );
    }
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
    var body = new FormData();
    body.append("data", JSON.stringify(payload));
    if (result.data.cleaning) {
      photos.forEach(function (p, i) { body.append("photos", p.blob, "photo-" + (i + 1) + ".jpg"); });
    }

    setFormStatus("");
    submitBtn.disabled = true;
    submitBtn.textContent = "Sending…";

    fetch("/api/booking", { method: "POST", body: body }).then(function (res) {
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
    clearPhotos();
    resetRoute();
    setFormStatus("");
    dateInput.min = todayISO();
    preselectPageService();
    success.hidden = true;
    form.hidden = false;
    form.querySelector('input[name="service"]').focus();
  });
})();

// Work gallery (cleaning page): each job card opens its photos in a viewer.
(function () {
  "use strict";
  var dialog = document.getElementById("work-viewer");
  if (!dialog || typeof dialog.showModal !== "function") return;
  var img = dialog.querySelector(".viewer-img");
  var caption = dialog.querySelector(".viewer-caption");
  var counter = dialog.querySelector(".viewer-count");
  var photos = [], index = 0, title = "", opener = null;

  function show(i) {
    index = (i + photos.length) % photos.length;
    img.src = photos[index];
    img.alt = title + ", photo " + (index + 1) + " of " + photos.length;
    counter.textContent = (index + 1) + " / " + photos.length;
    // Warm the next photo so paging feels instant.
    var next = new Image();
    next.src = photos[(index + 1) % photos.length];
  }

  document.querySelectorAll("[data-work-photos]").forEach(function (card) {
    card.addEventListener("click", function (e) {
      e.preventDefault();
      opener = card;
      photos = card.getAttribute("data-work-photos").split("|");
      title = card.getAttribute("data-work-title");
      caption.textContent = title;
      show(parseInt(card.getAttribute("data-work-start") || "0", 10));
      dialog.showModal();
    });
  });

  dialog.querySelector(".viewer-prev").addEventListener("click", function () { show(index - 1); });
  dialog.querySelector(".viewer-next").addEventListener("click", function () { show(index + 1); });
  dialog.querySelector(".viewer-close").addEventListener("click", function () { dialog.close(); });
  dialog.addEventListener("click", function (e) { if (e.target === dialog) dialog.close(); });
  dialog.addEventListener("keydown", function (e) {
    if (e.key === "ArrowLeft") { e.preventDefault(); show(index - 1); }
    if (e.key === "ArrowRight") { e.preventDefault(); show(index + 1); }
  });
  dialog.addEventListener("close", function () {
    img.removeAttribute("src");
    if (opener) opener.focus();
  });

  // Swipe left/right on phones.
  var startX = null;
  img.addEventListener("touchstart", function (e) { startX = e.touches[0].clientX; }, { passive: true });
  img.addEventListener("touchend", function (e) {
    if (startX === null) return;
    var dx = e.changedTouches[0].clientX - startX;
    if (Math.abs(dx) > 40) show(index + (dx < 0 ? 1 : -1));
    startX = null;
  });
})();
