// Cloudflare Worker: serves the static site and gives each service its own
// subdomain of chowrest-property.com. The bare chowrest-property.com is a
// separate Chowrest property site, so the YourestWedo main page lives on
// services.chowrest-property.com.
//   services.chowrest-property.com  -> index.html (YourestWedo main page)
//   cleaning.chowrest-property.com  -> cleaning.html
//   chauffeur.chowrest-property.com -> chauffeur.html
//   carwash.chowrest-property.com   -> carwash.html
//   grocery.chowrest-property.com   -> grocery.html
// On a service subdomain, a link to another service goes to that service's
// subdomain, and links to the main page go to services.chowrest-property.com.
//
// POST /api/booking sends a booking request to LINE through the LINE
// Messaging API. It needs two Worker secrets:
//   LINE_CHANNEL_ACCESS_TOKEN  long-lived channel access token
//   LINE_TO                    LINE user or group ID(s) to notify, comma-separated

const MAIN_DOMAIN = "chowrest-property.com";
const HOME_HOST = "services." + MAIN_DOMAIN; // YourestWedo main page
const SERVICES = ["cleaning", "chauffeur", "carwash", "grocery"];
const ASSET = /\.(css|js|png|jpe?g|gif|svg|webp|ico|woff2?|txt|xml|json)$/i;

const SERVICE_LABELS = {
  cleaning: "Home cleaning",
  chauffeur: "Chauffeur",
  carwash: "Car wash at home",
  grocery: "Grocery delivery",
};
const MAX_BODY = 8 * 1024;

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function text(v, max) {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

// Check a booking the same way the form does, and keep only known fields.
export function readBooking(input) {
  const b = input && typeof input === "object" ? input : {};
  const services = Array.isArray(b.services)
    ? [...new Set(b.services.filter((s) => SERVICE_LABELS[s]))]
    : [];
  const booking = {
    services,
    name: text(b.name, 100),
    phone: text(b.phone, 30),
    email: text(b.email, 120),
    address: text(b.address, 300),
    lat: text(b.lat, 20),
    lng: text(b.lng, 20),
    date: text(b.date, 10),
    time: text(b.time, 40),
    notes: text(b.notes, 1000),
    page: text(b.page, 200),
  };
  const coords = /^-?\d{1,3}\.\d+$/;
  const hasPin = coords.test(booking.lat) && coords.test(booking.lng);
  if (!hasPin) booking.lat = booking.lng = "";
  const problems = [];
  if (!services.length) problems.push("services");
  if (booking.name.length < 2) problems.push("name");
  if (!/^\+?[\d\s\-().]+$/.test(booking.phone) || booking.phone.replace(/\D/g, "").length < 9) problems.push("phone");
  if (booking.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(booking.email)) problems.push("email");
  if (booking.address.length < 4 && !hasPin) problems.push("address");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(booking.date)) problems.push("date");
  return { booking, problems };
}

export function bookingMessage(b) {
  const q = b.lat && b.lng ? `${b.lat},${b.lng}` : b.address;
  const map = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(q);
  const lines = [
    "🔔 New booking request – YourestWedo",
    "",
    "Services: " + b.services.map((s) => SERVICE_LABELS[s]).join(", "),
    "Date: " + b.date + (b.time ? " · " + b.time : " · Any time"),
    "",
    "Name: " + b.name,
    "Phone: " + b.phone,
  ];
  if (b.email) lines.push("Email: " + b.email);
  lines.push("Address: " + (b.address || "Current location (pinned on map)"));
  lines.push("Map: " + map);
  if (b.notes) lines.push("", "Details: " + b.notes);
  if (b.page) lines.push("", "Sent from: " + b.page);
  return lines.join("\n").slice(0, 4900);
}

async function handleBooking(request, env) {
  if (request.method !== "POST") return json(405, { ok: false, error: "Use POST." });
  if (!env.LINE_CHANNEL_ACCESS_TOKEN || !env.LINE_TO) {
    return json(503, { ok: false, error: "Booking messages are not set up yet." });
  }
  const raw = await request.text();
  if (raw.length > MAX_BODY) return json(413, { ok: false, error: "Request is too large." });
  let input;
  try { input = JSON.parse(raw); } catch { return json(400, { ok: false, error: "Invalid request." }); }

  // Bots that fill the hidden "website" field get a quiet success and no message.
  if (text(input && input.website, 200)) return json(200, { ok: true });

  const { booking, problems } = readBooking(input);
  if (problems.length) return json(400, { ok: false, error: "Please check: " + problems.join(", ") + "." });

  const recipients = String(env.LINE_TO).split(",").map((id) => id.trim()).filter(Boolean);
  const messages = [{ type: "text", text: bookingMessage(booking) }];
  const api = env.LINE_API_URL || "https://api.line.me";
  const single = recipients.length === 1;
  const res = await fetch(api + (single ? "/v2/bot/message/push" : "/v2/bot/message/multicast"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + env.LINE_CHANNEL_ACCESS_TOKEN,
    },
    body: JSON.stringify(single ? { to: recipients[0], messages } : { to: recipients, messages }),
  });
  if (!res.ok) {
    console.error("LINE API error", res.status, await res.text());
    return json(502, { ok: false, error: "We couldn't send your request right now." });
  }
  return json(200, { ok: true });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const host = url.hostname.toLowerCase();

    // Booking requests work on every host.
    if (url.pathname === "/api/booking") return handleBooking(request, env);
    const sub = host.endsWith("." + MAIN_DOMAIN)
      ? host.slice(0, -(MAIN_DOMAIN.length + 1))
      : "";

    // services., workers.dev and anything else: serve files as they are.
    if (!SERVICES.includes(sub) || ASSET.test(url.pathname)) {
      return env.ASSETS.fetch(request);
    }

    // The subdomain's home page is its service page.
    if (url.pathname === "/") {
      return env.ASSETS.fetch(new Request(new URL("/" + sub, url), request));
    }

    // Links to a service page go to that service's subdomain.
    const name = url.pathname.replace(/^\/+/, "").replace(/\.html$/, "");
    if (SERVICES.includes(name)) {
      return Response.redirect(`https://${name}.${MAIN_DOMAIN}/${url.search}`, 302);
    }

    // Everything else lives on the YourestWedo main page host.
    const path = url.pathname === "/index.html" || url.pathname === "/index" ? "/" : url.pathname;
    return Response.redirect(`https://${HOME_HOST}${path}${url.search}`, 302);
  },
};
