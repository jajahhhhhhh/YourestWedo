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

  // Booking form
  var form = document.getElementById("book-form");
  var success = document.getElementById("book-success");
  var summary = document.getElementById("book-summary");
  var again = document.getElementById("book-again");
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

  function setError(name, show) {
    var msg = form.querySelector('[data-error-for="' + name + '"]');
    if (msg) msg.hidden = !show;
    var input = form.elements[name];
    if (input && input.setAttribute && !(input instanceof RadioNodeList)) {
      if (show) input.setAttribute("aria-invalid", "true");
      else input.removeAttribute("aria-invalid");
    }
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
    var date = form.elements.date.value;

    var checks = {
      service: services.length > 0,
      name: name.length > 1,
      phone: /^[+\d][\d\s\-()]{7,}$/.test(phone),
      email: email === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
      address: address.length > 3,
      date: date !== "" && date >= todayISO()
    };

    Object.keys(checks).forEach(function (key) {
      setError(key, !checks[key]);
      if (!checks[key]) errors.push(key);
    });

    return {
      ok: errors.length === 0,
      firstError: errors[0],
      data: {
        services: services,
        name: name,
        phone: phone,
        email: email,
        address: address,
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
      ["Date", data.date],
      ["Time", data.time || "Any time"],
      ["Details", data.notes || "—"]
    ];
    summary.textContent = "";
    rows.forEach(function (r) {
      var dt = document.createElement("dt");
      var dd = document.createElement("dd");
      dt.textContent = r[0];
      dd.textContent = r[1];
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

    // NOTE: No backend is connected yet. Requests are kept in this browser
    // only, so the business can wire up email/LINE/CRM delivery later.
    try {
      var key = "yw-requests";
      var saved = JSON.parse(localStorage.getItem(key) || "[]");
      saved.push(Object.assign({ submittedAt: new Date().toISOString() }, result.data));
      localStorage.setItem(key, JSON.stringify(saved));
    } catch (err) { /* storage unavailable — ignore */ }

    renderSummary(result.data);
    form.hidden = true;
    success.hidden = false;
    success.focus();
  });

  // Clear an error as soon as the user fixes the field
  form.addEventListener("input", function (e) {
    var name = e.target.name;
    if (name && form.querySelector('[data-error-for="' + name + '"]:not([hidden])')) {
      validate();
    }
  });

  again.addEventListener("click", function () {
    form.reset();
    dateInput.min = todayISO();
    success.hidden = true;
    form.hidden = false;
    form.querySelector('input[name="service"]').focus();
  });
})();
