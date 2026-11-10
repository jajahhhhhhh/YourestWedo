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
// POST /api/line-webhook receives LINE events (needs LINE_CHANNEL_SECRET).
// When the Official Account joins a group, or someone types "id" in a chat
// with it, it replies with that chat's ID so it can be put in LINE_TO.
//
// Payments (PromptPay): in the LINE group, an admin types "pay 1500 note"
// (or "จ่าย 1500 note"). The bot replies with a signed link to /pay that
// shows a PromptPay QR for exactly that amount. The customer pays in their
// bank app and uploads the slip, which is sent back to the group with
// POST /api/pay/slip. Set PROMPTPAY_ID (mobile number, 13-digit tax ID
// or the 15-digit e-wallet ID from a bank app's PromptPay QR) and
// PROMPTPAY_NAME (account name shown to customers) as Worker variables.
// Links are signed with LINE_CHANNEL_SECRET so amounts can't be edited.
//
// Jobs (jobs.js): each booking becomes a job (J-1001, …) with buttons in
// the admin group to send it to the maids or drivers group
// (LINE_TEAM_MAIDS, LINE_TEAM_DRIVERS), where the team leader assigns it and
// staff update its status. Every change is logged to a Google Sheet through
// an Apps Script web app (SHEET_URL, SHEET_SECRET; see tools/job-sheet.gs).
//
// Cleaning requests can include up to 4 photos. They are kept for 30 days
// in the PhotoStore Durable Object and served from /api/photo/<id>.jpg so
// LINE can show them as images.

import { JobStore, createJob, adminCard, linkPayment, recordSlip, slipCard, applyPayCheck, syncSheet, sheetTest, onPostback, onText, onImage, teamOfChat, jobIdIn, ids } from "./jobs.js";
export { JobStore };
import { checkSlip } from "./slipcheck.js";

const MAIN_DOMAIN = "chowrest-property.com";
const HOME_HOST = "services." + MAIN_DOMAIN; // YourestWedo main page
const SERVICES = ["cleaning", "chauffeur", "carwash", "grocery"];
const ASSET = /\.(css|js|png|jpe?g|gif|svg|webp|ico|woff2?|txt|xml|json)$/i;

const SERVICE_LABELS = {
  cleaning: "Home cleaning",
  chauffeur: "Chauffeur & errands",
  carwash: "Car wash at home",
  grocery: "Grocery delivery",
};
const MAX_BODY = 8 * 1024; // the JSON part of a request
const MAX_PHOTOS = 4;
const MAX_PHOTO_BYTES = 1500 * 1024; // customer uploads
const MAX_STORED_PHOTO = 2000 * 1000; // staff photos from LINE (storage limit is 2 MB)
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
    route: services.includes("chauffeur") ? text(b.route, 400) : "",
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
    "🔔 New booking request – YourestWedo" + (b.jobId ? " · " + b.jobId : ""),
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
  if (b.route) lines.push("Route: " + b.route);
  if (b.notes) lines.push("", "Details: " + b.notes);
  if (b.page) lines.push("", "Sent from: " + b.page);
  return lines.join("\n").slice(0, 4900);
}

async function handleBooking(request, env, ctx) {
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
  booking.photoUrls = imageUrls;
  let job = null;
  try { job = await createJob(env, booking); } catch (e) { console.error("Job create failed", String(e)); }
  if (job) booking.jobId = job.id;

  const recipients = String(env.LINE_TO).split(",").map((id) => id.trim()).filter(Boolean);
  const messages = [{ type: "text", text: bookingMessage(booking) }].concat(
    imageUrls.map((u) => ({ type: "image", originalContentUrl: u, previewImageUrl: u })),
  );
  // LINE allows 5 messages per push: add the job card, or send it after.
  let extraCard = null;
  if (job) { if (messages.length < 5) messages.push(adminCard(job)); else extraCard = adminCard(job); }
  // Push to each user or group separately: multicast only accepts user IDs.
  let results = await Promise.all(recipients.map((to) => lineApi(env, "/v2/bot/message/push", { to, messages })));
  // If LINE rejects the job card, still deliver the booking itself.
  if (job && results.every((r) => !r.ok && r.status === 400)) {
    const plain = messages.filter((m) => m.type !== "flex");
    results = await Promise.all(recipients.map((to) => lineApi(env, "/v2/bot/message/push", { to, messages: plain })));
  }
  const failed = results.filter((r) => !r.ok);
  for (const r of failed) console.error("LINE push failed", r.status, r.body);
  if (failed.length === results.length) {
    return json(502, { ok: false, error: "We couldn't send your request right now." });
  }
  if (extraCard) ctx.waitUntil(Promise.all(recipients.map((to) => lineApi(env, "/v2/bot/message/push", { to, messages: [extraCard] }))));
  if (job) ctx.waitUntil(syncSheet(env, job));
  return json(200, { ok: true });
}

async function lineApi(env, path, payload) {
  const api = env.LINE_API_URL || "https://api.line.me";
  const res = await fetch(api + path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + env.LINE_CHANNEL_ACCESS_TOKEN,
    },
    body: JSON.stringify(payload),
  });
  return { ok: res.ok, status: res.status, body: res.ok ? "" : await res.text() };
}

// Keep a photo (staff job photo) in the PhotoStore; returns its public URL.
async function savePhotoBytes(env, origin, body, type) {
  if (!env.PHOTOS || !body.byteLength || body.byteLength > MAX_STORED_PHOTO) return "";
  const id = crypto.randomUUID().replace(/-/g, "");
  const put = await env.PHOTOS.get(env.PHOTOS.idFromName("photos")).fetch("https://photos/" + id, {
    method: "PUT", headers: { "content-type": PHOTO_TYPES.includes(type) ? type : "image/jpeg" }, body,
  });
  return put.ok ? origin + "/api/photo/" + id + ".jpg" : "";
}

// LINE signs each webhook body with the channel secret (HMAC-SHA256, base64).
async function lineSignatureValid(secret, body, signature) {
  if (!signature) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  const expected = btoa(String.fromCharCode(...mac));
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

function chatIdReply(source, joined) {
  if (source.type === "group" || source.type === "room") {
    const id = source.groupId || source.roomId;
    return (joined ? "✅ YourestWedo bookings bot joined this group.\n\n" : "") +
      "This group's ID:\n" + id +
      "\n\nIn Cloudflare (Workers & Pages → yourestwedo → Settings → Variables and Secrets) put this ID in:" +
      "\n• LINE_TO for the admin group (bookings, payments)" +
      "\n• LINE_TEAM_MAIDS for the maids group" +
      "\n• LINE_TEAM_DRIVERS for the drivers group";
  }
  return "Your LINE user ID:\n" + source.userId +
    "\n\nTo get booking requests in this chat, add this ID to LINE_TO in Cloudflare.";
}

// Road distance for the errand price calculator. Proxies OSRM so the page
// doesn't depend on a third-party server allowing browser requests.
async function handleRoute(url) {
  const coord = /^-?\d{1,3}(\.\d+)?,-?\d{1,3}(\.\d+)?$/;
  const from = url.searchParams.get("from") || "", to = url.searchParams.get("to") || "";
  if (!coord.test(from) || !coord.test(to)) return json(400, { ok: false, error: "Use from=lng,lat&to=lng,lat." });
  const api = "https://router.project-osrm.org/route/v1/driving/" + from + ";" + to + "?overview=full&geometries=geojson";
  try {
    const res = await fetch(api, { headers: { "user-agent": "YourestWedo errand calculator (services.chowrest-property.com)" }, cf: { cacheTtl: 86400, cacheEverything: true } });
    const d = await res.json();
    if (!res.ok || !d.routes || !d.routes.length) return json(502, { ok: false, error: "No route found." });
    return json(200, { ok: true, distance: d.routes[0].distance, duration: d.routes[0].duration, geometry: d.routes[0].geometry });
  } catch {
    return json(502, { ok: false, error: "Routing is unavailable right now." });
  }
}

// ---- Payments ----------------------------------------------------------

// PromptPay QR payload (EMVCo / Thai QR) for a mobile number or tax ID.
export function promptPayPayload(id, amount) {
  const digits = String(id || "").replace(/\D/g, "");
  let target;
  if (digits.length === 13) target = "02" + "13" + digits; // tax ID / national ID
  else if (digits.length === 10 && digits[0] === "0") target = "01" + "13" + ("0066" + digits.slice(1)); // mobile
  else if (digits.length === 11 && digits.startsWith("66")) target = "01" + "13" + ("00" + digits);
  else if (digits.length === 15) target = "03" + "15" + digits; // e-wallet ID (e.g. K PLUS shop QR)
  else return "";
  const f = (tag, v) => tag + String(v.length).padStart(2, "0") + v;
  let p = f("00", "01") + f("01", "12") +
    f("29", f("00", "A000000677010111") + target) +
    f("58", "TH") + f("53", "764") + f("54", Number(amount).toFixed(2)) + "6304";
  let crc = 0xffff;
  for (let i = 0; i < p.length; i++) {
    crc ^= p.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return p + crc.toString(16).toUpperCase().padStart(4, "0");
}

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
  return btoa(String.fromCharCode(...mac)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "").slice(0, 22);
}

const AMOUNT = /^\d{1,6}(\.\d{1,2})?$/;
function payString(p) { return ["pay", p.a, p.r, p.n].join("|"); }

// Read and check a payment link's fields (a = amount, r = ref, n = note, s = signature).
async function readPayLink(get, env) {
  const p = { a: text(get("a"), 12), r: text(get("r"), 12), n: text(get("n"), 120), s: text(get("s"), 40) };
  if (!env.LINE_CHANNEL_SECRET || !AMOUNT.test(p.a) || !(+p.a > 0) || !/^[A-Z0-9]{4,12}$/.test(p.r)) return null;
  const expected = await hmac(env.LINE_CHANNEL_SECRET, payString(p));
  if (expected.length !== p.s.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ p.s.charCodeAt(i);
  return diff === 0 ? p : null;
}

function baht(a) { return "฿" + Number(a).toLocaleString("en-US", { minimumFractionDigits: a.includes(".") ? 2 : 0, maximumFractionDigits: 2 }); }

export async function makePayLink(env, amount, note) {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  const p = { a: amount, r: Array.from(bytes, (b) => abc[b % abc.length]).join(""), n: note.slice(0, 120) };
  p.s = await hmac(env.LINE_CHANNEL_SECRET, payString(p));
  const q = new URLSearchParams({ a: p.a, r: p.r });
  if (p.n) q.set("n", p.n);
  q.set("s", p.s);
  return { ref: p.r, url: "https://" + HOME_HOST + "/pay?" + q.toString() };
}

// "pay 1500 Cleaning 19 Nov, Khun A" → { amount: "1500", note: "..." }
export function parsePayCommand(t) {
  const m = /^\s*(?:pay|จ่าย|ชำระ|เก็บเงิน)(?:\s+|$)(.*)$/is.exec(t || "");
  if (!m) return null;
  const rest = m[1].trim();
  const n = /^฿?\s*([\d,]+(?:\.\d{1,2})?)\s*(?:บาท|thb|baht)?(?:\s+|$)(.*)$/is.exec(rest);
  if (!n) return { help: true };
  const amount = n[1].replace(/,/g, "");
  if (!AMOUNT.test(amount) || !(+amount > 0)) return { help: true };
  return { amount: String(+amount), note: n[2].replace(/\s+/g, " ").trim() };
}

async function payReply(env, cmd, ctx) {
  if (cmd.help) {
    return "To make a payment link, type:\npay <amount> <what it's for>\n\nFor example:\npay 1500 Cleaning 19 Nov, Khun Somchai";
  }
  const link = await makePayLink(env, cmd.amount, cmd.note);
  const jobId = jobIdIn(cmd.note);
  const job = jobId ? await linkPayment(env, jobId, link.ref, cmd.amount).catch(() => null) : null;
  if (job && ctx) ctx.waitUntil(syncSheet(env, job));
  return "💳 Payment link · " + baht(cmd.amount) + " · Ref " + link.ref +
    (cmd.note ? "\nFor: " + cmd.note : "") +
    (job ? "\nJob: " + job.id + " (the slip will be matched to this job)" : jobId ? "\n⚠️ Job " + jobId + " not found" : "") +
    "\n\n" + link.url +
    "\n\nSend this link to the customer. They scan the PromptPay QR, pay, and upload the slip. The slip will arrive in this group with Ref " + link.ref + "." +
    (env.PROMPTPAY_ID ? "" : "\n\n⚠️ PROMPTPAY_ID is not set in Cloudflare yet, so the page can't show a QR code.");
}

async function handlePayInfo(url, env) {
  const p = await readPayLink((k) => url.searchParams.get(k), env);
  if (!p) return json(400, { ok: false, error: "This payment link isn't valid. Please ask us for a new one." });
  const payload = promptPayPayload(env.PROMPTPAY_ID, p.a);
  return json(200, {
    ok: true, amount: p.a, ref: p.r, note: p.n,
    promptpay: payload ? { payload, name: text(env.PROMPTPAY_NAME, 100) } : null,
  });
}

async function handlePaySlip(request, env, ctx) {
  if (request.method !== "POST") return json(405, { ok: false, error: "Use POST." });
  if (!env.LINE_CHANNEL_ACCESS_TOKEN || !env.LINE_TO) return json(503, { ok: false, error: "Payments are not set up yet." });
  if (Number(request.headers.get("content-length") || 0) > MAX_PHOTO_BYTES + 16 * 1024) return json(413, { ok: false, error: "The slip image is too large." });
  let form;
  try { form = await request.formData(); } catch { return json(400, { ok: false, error: "Invalid request." }); }
  const p = await readPayLink((k) => (typeof form.get(k) === "string" ? form.get(k) : ""), env);
  if (!p) return json(400, { ok: false, error: "This payment link isn't valid. Please ask us for a new one." });
  const slip = form.get("slip");
  if (!slip || typeof slip !== "object" || !PHOTO_TYPES.includes(slip.type) || slip.size > MAX_PHOTO_BYTES) {
    return json(400, { ok: false, error: "Please attach the slip as a JPG or PNG under 1.5 MB." });
  }
  const name = text(form.get("name"), 80);
  if (!env.PHOTOS) return json(503, { ok: false, error: "Slip uploads are not set up yet." });
  const store = env.PHOTOS.get(env.PHOTOS.idFromName("photos"));
  const id = crypto.randomUUID().replace(/-/g, "");
  const put = await store.fetch("https://photos/" + id, { method: "PUT", headers: { "content-type": slip.type }, body: await slip.arrayBuffer() });
  if (!put.ok) return json(500, { ok: false, error: "We couldn't save your slip. Please try again." });
  const img = new URL(request.url).origin + "/api/photo/" + id + ".jpg";

  // The QR printed on the slip (read in the browser): the same QR twice means a reused slip.
  const qrRaw = text(form.get("slipQr"), 400);
  const qr = /^[\x21-\x7e]{16,400}$/.test(qrRaw) ? qrRaw : "";
  let rec = { pay: null, job: null, dup: null };
  try { rec = await recordSlip(env, { ref: p.r, amount: p.a, note: p.n, url: img, qr, name }); } catch (e) { console.error("Slip record failed", String(e)); }
  const { pay, job, dup } = rec;

  // Check the slip with the bank (EasySlip) when it's set up.
  let verdict = null;
  if (pay && dup && dup.ref === p.r && pay.status === "confirmed") verdict = { status: "already" };
  else if (pay && env.EASYSLIP_KEY) verdict = await checkSlip(env, { qr, amount: p.a });
  let finalJob = job;
  if (verdict && (verdict.status === "ok" || verdict.status === "reject")) {
    try {
      const r = await applyPayCheck(env, p.r, verdict.status === "ok", "ระบบตรวจสลิป", verdict.status === "reject" ? verdict.th : "");
      finalJob = r.job || job;
    } catch (e) { console.error("Pay check failed", String(e)); }
  }

  const lines = ["💳 Payment slip received" + (job ? " · " + job.id : ""), "Amount: " + baht(p.a), "Ref: " + p.r];
  if (p.n) lines.push("For: " + p.n);
  if (name) lines.push("From: " + name);
  let card = null;
  if (verdict && verdict.status === "ok") {
    lines.push("", "✅ ตรวจสลิปกับธนาคารแล้ว: " + verdict.th, "บันทึกว่าเงินเข้าแล้วอัตโนมัติ");
  } else if (verdict && verdict.status === "reject") {
    lines.push("", "❌ ระบบปฏิเสธสลิปนี้: " + verdict.th, "ลูกค้าได้รับแจ้งให้ส่งสลิปที่ถูกต้องจากลิงก์เดิม");
  } else if (verdict && verdict.status === "already") {
    lines.push("", "ℹ️ ลูกค้าส่งสลิปใบเดิมซ้ำ การชำระนี้ยืนยันไปแล้ว");
  } else {
    if (dup && dup.ref === p.r) lines.push("", "ℹ️ Same slip sent again for this link.");
    else if (dup) lines.push("", "⚠️ This slip was already used for another payment (Ref " + dup.ref + "). It may be a reused slip.");
    if (verdict && verdict.th) lines.push("", "ℹ️ ตรวจอัตโนมัติไม่ได้: " + verdict.th);
    lines.push("", "Check the bank account, then tap ✅ or ❌ below.");
    if (pay) card = slipCard(pay, job, dup, !!qr);
  }
  const messages = [{ type: "text", text: lines.join("\n") }, { type: "image", originalContentUrl: img, previewImageUrl: img }];
  if (card) messages.push(card);
  const recipients = String(env.LINE_TO).split(",").map((v) => v.trim()).filter(Boolean);
  let results = await Promise.all(recipients.map((to) => lineApi(env, "/v2/bot/message/push", { to, messages })));
  if (card && results.every((r) => !r.ok && r.status === 400)) {
    results = await Promise.all(recipients.map((to) => lineApi(env, "/v2/bot/message/push", { to, messages: messages.slice(0, 2) })));
  }
  results.filter((r) => !r.ok).forEach((r) => console.error("LINE push failed", r.status, r.body));
  if (finalJob) ctx.waitUntil(syncSheet(env, finalJob));
  if (verdict && verdict.status === "reject") {
    return json(422, { ok: false, rejected: true, error: verdict.reason });
  }
  if (!results.some((r) => r.ok)) return json(502, { ok: false, error: "We couldn't send your slip right now. Please try again." });
  return json(200, { ok: true, verified: !!verdict && (verdict.status === "ok" || verdict.status === "already") });
}

async function handleLineWebhook(request, env, ctx) {
  if (request.method !== "POST") return json(405, { ok: false, error: "Use POST." });
  if (!env.LINE_CHANNEL_SECRET || !env.LINE_CHANNEL_ACCESS_TOKEN) {
    return json(503, { ok: false, error: "LINE webhook is not set up yet." });
  }
  const body = await request.text();
  if (body.length > 64 * 1024) return json(413, { ok: false, error: "Too large." });
  if (!(await lineSignatureValid(env.LINE_CHANNEL_SECRET, body, request.headers.get("x-line-signature")))) {
    return json(401, { ok: false, error: "Bad signature." });
  }
  let events = [];
  try { events = JSON.parse(body).events || []; } catch { return json(400, { ok: false, error: "Invalid body." }); }

  const admins = ids(env.LINE_TO);
  const origin = new URL(request.url).origin;
  const savePhoto = (body, type) => savePhotoBytes(env, origin, body, type);
  const replies = [];
  for (const e of events) {
    if (!e.replyToken || !e.source) continue;
    // Only the admin chats (LINE_TO) and team groups can use commands.
    const chat = e.source.groupId || e.source.roomId || e.source.userId;
    const role = { admin: admins.includes(chat), team: teamOfChat(env, chat) };
    const msg = e.type === "message" && e.message ? e.message : null;
    if (role.admin || role.team) {
      const job = e.type === "postback" ? onPostback(env, e, role, ctx)
        : msg && msg.type === "text" ? onText(env, e, role, ctx)
        : msg && msg.type === "image" ? onImage(env, e, role, ctx, savePhoto)
        : null;
      if (job && (await job.catch((err) => { console.error("Job event failed", String(err)); return false; }))) continue;
    }
    if (role.admin && msg && msg.type === "text" && /^\s*sheet\s*test\s*$/i.test(msg.text)) {
      replies.push(sheetTest(env).then((t) => lineApi(env, "/v2/bot/message/reply", {
        replyToken: e.replyToken, messages: [{ type: "text", text: t }],
      })));
      continue;
    }
    // "มอบ J-…" in a group that isn't set up as a team group: say how to set it up.
    if (!role.admin && !role.team && msg && msg.type === "text" && /^\s*(มอบ|มอบหมาย|assign)/i.test(msg.text) && jobIdIn(msg.text)) {
      replies.push(lineApi(env, "/v2/bot/message/reply", {
        replyToken: e.replyToken,
        messages: [{ type: "text", text: "กลุ่มนี้ยังไม่ได้ตั้งเป็นกลุ่มทีม\nไอดีกลุ่มนี้: " + chat +
          "\n\nใส่ไอดีนี้ใน Cloudflare เป็น LINE_TEAM_MAIDS (กลุ่มแม่บ้าน) หรือ LINE_TEAM_DRIVERS (กลุ่มคนขับ) แล้วกด Deploy" }],
      }));
      continue;
    }
    const pay = role.admin && msg && msg.type === "text" ? parsePayCommand(msg.text) : null;
    if (pay) {
      replies.push(payReply(env, pay, ctx).then((t) => lineApi(env, "/v2/bot/message/reply", {
        replyToken: e.replyToken, messages: [{ type: "text", text: t }],
      })));
      continue;
    }
    const asked = e.type === "message" && e.message && e.message.type === "text" &&
      /^\s*(id|groupid|group id|chat id|ไอดี)\s*$/i.test(e.message.text);
    if (e.type === "join" || asked) {
      replies.push(lineApi(env, "/v2/bot/message/reply", {
        replyToken: e.replyToken,
        messages: [{ type: "text", text: chatIdReply(e.source, e.type === "join") }],
      }));
    }
  }
  // Answer LINE quickly; replies finish in the background.
  if (replies.length) {
    const done = Promise.all(replies).then((rs) => rs.filter((r) => !r.ok).forEach((r) => console.error("LINE reply failed", r.status, r.body)));
    if (ctx && ctx.waitUntil) ctx.waitUntil(done); else await done;
  }
  return json(200, { ok: true });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const host = url.hostname.toLowerCase();

    // Booking requests and their photos work on every host.
    if (url.pathname === "/api/booking") return handleBooking(request, env, ctx);
    if (url.pathname === "/api/line-webhook") return handleLineWebhook(request, env, ctx);
    if (url.pathname === "/api/route") return handleRoute(url);
    if (url.pathname === "/api/pay") return handlePayInfo(url, env);
    if (url.pathname === "/api/pay/slip") return handlePaySlip(request, env, ctx);
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
    // Only chowrest-property.com hosts should appear in search results.
    if (!SERVICES.includes(sub) || ASSET.test(url.pathname)) {
      const res = await env.ASSETS.fetch(request);
      if (host === MAIN_DOMAIN || host.endsWith("." + MAIN_DOMAIN)) return res;
      const out = new Response(res.body, res);
      out.headers.set("x-robots-tag", "noindex");
      return out;
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
      if (!body.byteLength || body.byteLength > MAX_STORED_PHOTO) return new Response("Bad photo", { status: 400 });
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
