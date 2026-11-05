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
//
// Cleaning requests can include up to 4 photos. They are kept for 30 days
// in the PhotoStore Durable Object and served from /api/photo/<id>.jpg so
// LINE can show them as images.

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
const MAX_BODY = 8 * 1024; // the JSON part of a request
const MAX_PHOTOS = 4;
const MAX_PHOTO_BYTES = 1500 * 1024;
const MAX_UPLOAD = MAX_PHOTOS * MAX_PHOTO_BYTES + 64 * 1024;
const PHOTO_DAYS = 30;
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const PROPERTY_TYPES = { house: "House or villa", condo: "Condo", room: "Rental room or dorm room", other: "Other" };

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
    cleaning: null,
  };
  if (services.includes("cleaning")) {
    const c = b.cleaning && typeof b.cleaning === "object" ? b.cleaning : {};
    booking.cleaning = {
      type: PROPERTY_TYPES[c.type] ? c.type : "",
      bedrooms: text(c.bedrooms, 2),
      bathrooms: text(c.bathrooms, 2),
      area: text(c.area, 5),
      estimate: text(c.estimate, 40),
    };
  }
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
  const c = booking.cleaning;
  if (c) {
    const count = (v) => /^\d{1,2}$/.test(v) && +v <= 20;
    if (!c.type) problems.push("property type");
    if (!count(c.bedrooms)) problems.push("bedrooms");
    if (!count(c.bathrooms)) problems.push("bathrooms");
    if (c.area && !(/^\d{1,4}$/.test(c.area) && +c.area >= 5 && +c.area <= 5000)) problems.push("area");
  }
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
  if (b.cleaning) {
    const c = b.cleaning;
    lines.push(
      "",
      "Cleaning: " + PROPERTY_TYPES[c.type] + " · " + c.bedrooms + " bed, " + c.bathrooms + " bath" + (c.area ? " · " + c.area + " m²" : ""),
      "Estimate shown: " + (c.estimate || "none"),
      "Photos: " + (b.photoCount ? b.photoCount + " (below)" : "none"),
    );
  }
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
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_UPLOAD) return json(413, { ok: false, error: "Request is too large." });

  let raw = "";
  let files = [];
  const type = request.headers.get("content-type") || "";
  if (type.startsWith("multipart/form-data")) {
    let form;
    try { form = await request.formData(); } catch { return json(400, { ok: false, error: "Invalid request." }); }
    raw = String(form.get("data") || "");
    files = form.getAll("photos").filter((f) => typeof f === "object" && f && "arrayBuffer" in f);
  } else {
    raw = await request.text();
  }
  if (raw.length > MAX_BODY) return json(413, { ok: false, error: "Request is too large." });
  let input;
  try { input = JSON.parse(raw); } catch { return json(400, { ok: false, error: "Invalid request." }); }

  // Bots that fill the hidden "website" field get a quiet success and no message.
  if (text(input && input.website, 200)) return json(200, { ok: true });

  const { booking, problems } = readBooking(input);
  if (files.length && !booking.cleaning) files = [];
  if (files.length > MAX_PHOTOS) problems.push("photos (up to " + MAX_PHOTOS + ")");
  for (const f of files) {
    if (!PHOTO_TYPES.includes(f.type) || f.size > MAX_PHOTO_BYTES) { problems.push("photos (JPG or PNG, under 1.5 MB)"); break; }
  }
  if (problems.length) return json(400, { ok: false, error: "Please check: " + problems.join(", ") + "." });

  // Keep the photos so LINE can fetch them, then reference them as images.
  const origin = new URL(request.url).origin;
  const imageUrls = [];
  if (files.length) {
    if (!env.PHOTOS) return json(503, { ok: false, error: "Photo uploads are not set up yet." });
    const store = env.PHOTOS.get(env.PHOTOS.idFromName("photos"));
    for (const f of files) {
      const id = crypto.randomUUID().replace(/-/g, "");
      const put = await store.fetch("https://photos/" + id, {
        method: "PUT",
        headers: { "content-type": f.type },
        body: await f.arrayBuffer(),
      });
      if (!put.ok) return json(500, { ok: false, error: "We couldn't save your photos. Please try again." });
      imageUrls.push(origin + "/api/photo/" + id + ".jpg");
    }
  }
  booking.photoCount = imageUrls.length;

  const recipients = String(env.LINE_TO).split(",").map((id) => id.trim()).filter(Boolean);
  const messages = [{ type: "text", text: bookingMessage(booking) }].concat(
    imageUrls.map((u) => ({ type: "image", originalContentUrl: u, previewImageUrl: u })),
  );
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

    // Booking requests and their photos work on every host.
    if (url.pathname === "/api/booking") return handleBooking(request, env);
    const photo = url.pathname.match(/^\/api\/photo\/([a-f0-9]{32})\.jpg$/);
    if (photo) {
      if (!env.PHOTOS || !["GET", "HEAD"].includes(request.method)) return new Response("Not found", { status: 404 });
      const store = env.PHOTOS.get(env.PHOTOS.idFromName("photos"));
      return store.fetch("https://photos/" + photo[1]);
    }
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

// Stores booking photos for PHOTO_DAYS days. One instance holds them all;
// a daily alarm deletes expired photos.
export class PhotoStore {
  constructor(state) {
    this.storage = state.storage;
  }

  async fetch(request) {
    const id = new URL(request.url).pathname.slice(1);
    if (!/^[a-f0-9]{32}$/.test(id)) return new Response("Not found", { status: 404 });
    if (request.method === "PUT") {
      const body = await request.arrayBuffer();
      if (!body.byteLength || body.byteLength > MAX_PHOTO_BYTES) return new Response("Bad photo", { status: 400 });
      await this.storage.put({
        ["photo:" + id]: body,
        ["meta:" + id]: { type: request.headers.get("content-type") || "image/jpeg", at: Date.now() },
      });
      if (!(await this.storage.getAlarm())) await this.storage.setAlarm(Date.now() + 86400000);
      return new Response("Saved", { status: 201 });
    }
    const [body, meta] = await Promise.all([this.storage.get("photo:" + id), this.storage.get("meta:" + id)]);
    if (!body || !meta) return new Response("Not found", { status: 404 });
    return new Response(request.method === "HEAD" ? null : body, {
      headers: {
        "content-type": meta.type,
        "cache-control": "private, max-age=86400",
        "x-robots-tag": "noindex",
      },
    });
  }

  async alarm() {
    const cutoff = Date.now() - PHOTO_DAYS * 86400000;
    const metas = await this.storage.list({ prefix: "meta:" });
    const expired = [];
    for (const [key, meta] of metas) {
      if (meta.at < cutoff) expired.push(key, "photo:" + key.slice(5));
    }
    for (let i = 0; i < expired.length; i += 128) await this.storage.delete(expired.slice(i, i + 128));
    if (metas.size > expired.length / 2) await this.storage.setAlarm(Date.now() + 86400000);
  }
}
