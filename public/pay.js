// Payment page: shows a PromptPay QR for a signed payment link made in the
// team's LINE group, and sends the customer's slip back to the group.
(function () {
  "use strict";
  var params = new URLSearchParams(location.search);
  var $ = function (id) { return document.getElementById(id); };
  var link = { a: params.get("a") || "", r: params.get("r") || "", n: params.get("n") || "", s: params.get("s") || "" };

  function fail(msg) {
    $("pay-amount").textContent = "Payment";
    $("pay-error").textContent = msg;
    $("pay-error").hidden = false;
  }
  function baht(a) {
    var n = Number(a);
    return "฿" + n.toLocaleString("en-US", { minimumFractionDigits: a.indexOf(".") !== -1 ? 2 : 0, maximumFractionDigits: 2 });
  }

  // Draw the QR on a canvas with a white quiet zone so bank apps read it easily.
  function drawQR(payload) {
    var qr = qrcode(0, "M");
    qr.addData(payload);
    qr.make();
    var n = qr.getModuleCount(), quiet = 4, size = 600, cell = size / (n + quiet * 2);
    var c = $("pay-qr"), ctx = c.getContext("2d");
    c.width = c.height = size;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = "#000";
    for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) {
      if (qr.isDark(y, x)) ctx.fillRect(Math.floor((x + quiet) * cell), Math.floor((y + quiet) * cell), Math.ceil(cell), Math.ceil(cell));
    }
    $("pay-save").href = c.toDataURL("image/png");
  }

  fetch("/api/pay?" + new URLSearchParams(link).toString())
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (!d.ok) return fail(d.error || "This payment link isn't valid.");
      $("pay-amount").textContent = baht(d.amount);
      $("pay-ref").textContent = d.ref;
      $("pay-meta").hidden = false;
      if (d.note) { $("pay-note").textContent = d.note; $("pay-note").hidden = $("pay-note-label").hidden = false; }
      if (d.promptpay && window.qrcode) {
        if (d.promptpay.name) { $("pay-name").textContent = d.promptpay.name; $("pay-name").hidden = $("pay-name-label").hidden = false; }
        drawQR(d.promptpay.payload);
        $("pay-qr-box").hidden = false;
      } else {
        fail("The QR code isn't available right now. Please contact us on LINE to pay, then upload your slip here.");
      }
      $("slip-form").hidden = false;
    })
    .catch(function () { fail("We couldn't load this payment. Please check your connection and reload the page."); });

  // Shrink the slip photo to at most 1600 px and about 900 KB as JPEG.
  function compress(file) {
    return new Promise(function (resolve, reject) {
      var img = new Image(), src = URL.createObjectURL(file);
      img.onload = function () {
        URL.revokeObjectURL(src);
        var scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
        var c = document.createElement("canvas");
        c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
        var ctx = c.getContext("2d");
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        (function attempt(q) {
          c.toBlob(function (b) {
            if (!b) return reject(new Error("encode"));
            if (b.size > 900 * 1024 && q > 0.45) return attempt(q - 0.15);
            resolve(b);
          }, "image/jpeg", q);
        })(0.85);
      };
      img.onerror = function () { URL.revokeObjectURL(src); reject(new Error("decode")); };
      img.src = src;
    });
  }

  // Read the small QR printed on Thai bank slips. The team uses it to spot a
  // slip that was sent before. jsQR loads only when a slip is sent.
  var JSQR = "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js";
  var JSQR_SRI = "sha384-b5Ya4Bq3qCyz39m2ISh+4DxjAIljdeFwK/BsXLuj9gugaNwAcj/ia15fxNZL9Nlx";
  function loadJsQR() {
    if (window.jsQR) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var sc = document.createElement("script");
      sc.src = JSQR; sc.integrity = JSQR_SRI; sc.crossOrigin = "anonymous";
      sc.onload = resolve; sc.onerror = reject;
      document.head.appendChild(sc);
    });
  }
  function readSlipQR(file) {
    return loadJsQR().then(function () {
      return new Promise(function (resolve) {
        var img = new Image(), src = URL.createObjectURL(file);
        img.onload = function () {
          URL.revokeObjectURL(src);
          var found = "";
          // Try a couple of sizes: slip QR codes are small.
          [1600, 2400, 1000].some(function (max) {
            var scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
            var c = document.createElement("canvas");
            c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
            var ctx = c.getContext("2d");
            ctx.drawImage(img, 0, 0, c.width, c.height);
            var code = window.jsQR(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height, { inversionAttempts: "attemptBoth" });
            if (code && code.data) found = code.data;
            return !!found;
          });
          resolve(found);
        };
        img.onerror = function () { URL.revokeObjectURL(src); resolve(""); };
        img.src = src;
      });
    }).catch(function () { return ""; });
  }

  var form = $("slip-form"), btn = $("slip-submit");
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var file = $("slip-file").files[0];
    $("slip-error").hidden = !!file;
    $("pay-error").hidden = true;
    if (!file) { $("slip-file").focus(); return; }
    btn.disabled = true; btn.textContent = "Sending…";
    var slipQr = "";
    readSlipQR(file).then(function (qr) {
      slipQr = qr;
      return compress(file);
    }).then(function (blob) {
      var body = new FormData();
      body.append("slipQr", slipQr);
      Object.keys(link).forEach(function (k) { body.append(k, link[k]); });
      body.append("name", $("slip-name").value.trim());
      body.append("slip", blob, "slip.jpg");
      return fetch("/api/pay/slip", { method: "POST", body: body }).then(function (r) { return r.json(); });
    }).then(function (d) {
      if (!d.ok) throw new Error(d.error || "send");
      form.hidden = true; $("pay-qr-box").hidden = true;
      $("slip-done").hidden = false; $("slip-done").focus();
    }).catch(function (err) {
      $("pay-error").textContent = err && err.message && err.message.length > 12 ? err.message : "We couldn't send your slip. Please try again.";
      $("pay-error").hidden = false;
      btn.disabled = false; btn.textContent = "Send slip · ส่งสลิป";
    });
  });
})();
