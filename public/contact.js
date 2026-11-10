// Floating "Chat on WhatsApp" and "LINE" buttons on every page. The numbers
// come from /api/contact so they're set in Cloudflare, not in the page.
(function () {
  "use strict";
  var TOPICS = {
    "cleaning": "home cleaning", "chauffeur": "a driver or errand", "carwash": "a car wash at home",
    "grocery": "grocery delivery", "villa-turnover-cleaning": "villa turnover cleaning",
    "koh-samui-airport-transfer": "an airport transfer", "deep-cleaning-koh-samui": "a deep clean",
    "villa-check-koh-samui": "a villa check"
  };
  function topic() {
    var sub = location.hostname.split(".")[0];
    if (TOPICS[sub]) return TOPICS[sub];
    var path = location.pathname.replace(/^\/+|\.html$|\/+$/g, "");
    return TOPICS[path] || "";
  }
  var WA = '<svg viewBox="0 0 32 32" aria-hidden="true"><path fill="currentColor" d="M16 3a13 13 0 0 0-11.2 19.6L3 29l6.6-1.7A13 13 0 1 0 16 3zm0 23.6c-2 0-3.9-.5-5.6-1.5l-.4-.2-3.9 1 1-3.8-.3-.4A10.6 10.6 0 1 1 16 26.6zm5.8-7.9c-.3-.2-1.9-.9-2.2-1-.3-.1-.5-.2-.7.2l-1 1.2c-.2.2-.4.2-.7.1a8.7 8.7 0 0 1-4.3-3.8c-.3-.5.3-.5.9-1.6.1-.2 0-.4 0-.5l-1-2.4c-.3-.6-.5-.5-.7-.5h-.6c-.2 0-.6.1-.9.4-.3.3-1.2 1.2-1.2 2.9s1.2 3.4 1.4 3.6c.2.2 2.4 3.7 5.9 5.2 2.2.9 3 1 4.1.8.7-.1 1.9-.8 2.2-1.5.3-.8.3-1.4.2-1.5-.1-.2-.3-.2-.6-.4z"/></svg>';
  var LN = '<svg viewBox="0 0 32 32" aria-hidden="true"><path fill="currentColor" d="M16 4C8.8 4 3 8.7 3 14.5c0 5.2 4.6 9.6 10.9 10.4.4.1 1 .3 1.1.7.1.4.1.9 0 1.2l-.2 1.1c-.1.3-.3 1.3 1.1.7 1.4-.6 7.7-4.5 10.5-7.8 1.9-2.1 2.8-4.2 2.8-6.3C29.2 8.7 23.4 4 16 4zm-5.6 13.6H7.8c-.4 0-.7-.3-.7-.7v-5.2c0-.4.3-.7.7-.7s.7.3.7.7v4.5h1.9c.4 0 .7.3.7.7 0 .4-.3.7-.7.7zm2.7-.7c0 .4-.3.7-.7.7s-.7-.3-.7-.7v-5.2c0-.4.3-.7.7-.7s.7.3.7.7v5.2zm6.3 0c0 .3-.2.6-.5.7h-.2c-.2 0-.4-.1-.6-.3l-2.7-3.6v3.2c0 .4-.3.7-.7.7s-.7-.3-.7-.7v-5.2c0-.3.2-.6.5-.7h.2c.2 0 .4.1.6.3l2.7 3.6v-3.2c0-.4.3-.7.7-.7s.7.3.7.7v5.2zm4.2-3.3c.4 0 .7.3.7.7s-.3.7-.7.7h-1.9v1.2h1.9c.4 0 .7.3.7.7s-.3.7-.7.7h-2.6c-.4 0-.7-.3-.7-.7v-5.2c0-.4.3-.7.7-.7h2.6c.4 0 .7.3.7.7s-.3.7-.7.7h-1.9v1.2h1.9z"/></svg>';
  fetch("/api/contact").then(function (r) { return r.json(); }).then(function (c) {
    if (!c || (!c.whatsapp && !c.line)) return;
    var box = document.createElement("div");
    box.className = "contact-fab";
    box.setAttribute("aria-label", "Contact us");
    var t = topic();
    if (c.whatsapp) {
      var msg = "Hi YourestWedo, I'd like to ask about " + (t || "your services") + ".";
      var a = document.createElement("a");
      a.className = "fab fab-wa";
      a.href = "https://wa.me/" + c.whatsapp + "?text=" + encodeURIComponent(msg);
      a.target = "_blank"; a.rel = "noopener";
      a.innerHTML = WA + '<span class="fab-label">WhatsApp</span>';
      a.setAttribute("aria-label", "Chat with us on WhatsApp");
      box.appendChild(a);
    }
    if (c.line) {
      var l = document.createElement("a");
      l.className = "fab fab-line";
      l.href = c.line; l.target = "_blank"; l.rel = "noopener";
      l.innerHTML = LN + '<span class="fab-label">LINE</span>';
      l.setAttribute("aria-label", "Chat with us on LINE");
      box.appendChild(l);
    }
    document.body.appendChild(box);
  }).catch(function () { /* no buttons */ });
})();
