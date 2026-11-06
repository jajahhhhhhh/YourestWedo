// Jobs: dispatch, acceptance and records between the admin group and the
// staff groups on LINE.
//
//   booking on the website ──► admin group (LINE_TO): job card J-1042
//     [Send to team] [Cancel]          (payment: "pay 1500 J-1042 …")
//   team group (LINE_TEAM_MAIDS / LINE_TEAM_DRIVERS): job details without
//     the customer's phone; the team leader types "มอบ J-1042 @name"
//   bot replies with full details and status buttons:
//     [On the way] [Started] [Done] [Problem]
//   photos sent by the assigned person go to their current job
//   every change is written to the Google Sheet (SHEET_URL + SHEET_SECRET)
//
// Jobs live in the JobStore Durable Object; the sheet is the team's record.

import { DurableObject } from "cloudflare:workers";

export const TEAM_OF = { cleaning: "maids", carwash: "drivers", chauffeur: "drivers", grocery: "drivers" };
const TEAM_ENV = { maids: "LINE_TEAM_MAIDS", drivers: "LINE_TEAM_DRIVERS" };
const TEAM_LABEL = { maids: "ทีมแม่บ้าน", drivers: "ทีมคนขับ" };
const SERVICE_TH = { cleaning: "ทำความสะอาด", chauffeur: "คนขับ / ธุระ", carwash: "ล้างรถ", grocery: "ซื้อของ" };
const STATUS_TH = {
  new: "ใหม่", sent: "ส่งให้ทีมแล้ว", assigned: "มอบหมายแล้ว", travel: "กำลังเดินทาง",
  started: "กำลังทำ", done: "เสร็จแล้ว", problem: "มีปัญหา", cancelled: "ยกเลิก",
};
const ACTIONS = {
  travel: { label: "🚗 กำลังเดินทาง", say: "กำลังเดินทาง" },
  started: { label: "▶️ เริ่มงาน", say: "เริ่มงาน" },
  done: { label: "✅ เสร็จงาน", say: "เสร็จงาน" },
  problem: { label: "⚠️ มีปัญหา", say: "มีปัญหา" },
};
const JOB_ID = /\bJ-?(\d{3,6})\b/i;

export function ids(v) {
  return String(v || "").split(",").map((s) => s.trim()).filter(Boolean);
}
export function teamChats(env, team) { return ids(env[TEAM_ENV[team]]); }
export function teamOfChat(env, chat) {
  return Object.keys(TEAM_ENV).find((t) => teamChats(env, t).includes(chat)) || null;
}
export function jobIdIn(text) {
  const m = JOB_ID.exec(text || "");
  return m ? "J-" + m[1] : null;
}
function store(env) { return env.JOBS.get(env.JOBS.idFromName("jobs")); }

function bkk(at) {
  return new Date(at).toLocaleString("en-GB", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
function mapUrl(j) {
  const q = j.lat && j.lng ? `${j.lat},${j.lng}` : j.address;
  return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(q || "");
}
function teamsFor(services) { return [...new Set(services.map((s) => TEAM_OF[s]).filter(Boolean))]; }

// ---- Durable Object --------------------------------------------------------

export class JobStore extends DurableObject {
  async create(fields) {
    const n = ((await this.ctx.storage.get("seq")) || 1000) + 1;
    const job = Object.assign({}, fields, {
      id: "J-" + n, createdAt: Date.now(), status: "new", teams: teamsFor(fields.services || []),
      assignees: [], photos: [], payRef: "", price: "", paidAt: 0, slips: [], times: {}, log: [],
    });
    job.log.push({ at: job.createdAt, by: "website", what: "booking" });
    await this.ctx.storage.put({ seq: n, ["job:" + job.id]: job });
    return job;
  }
  async get(id) { return (await this.ctx.storage.get("job:" + id)) || null; }
  async save(job) { await this.ctx.storage.put("job:" + job.id, job); return job; }
  async byRef(ref) {
    const id = await this.ctx.storage.get("ref:" + ref);
    return id ? this.get(id) : null;
  }
  async linkRef(ref, id) { await this.ctx.storage.put("ref:" + ref, id); }
  // The job a person is working on now: their latest job that isn't closed,
  // or one they finished in the last 3 hours (for after photos).
  async activeFor(userId) {
    const id = await this.ctx.storage.get("active:" + userId);
    const job = id ? await this.get(id) : null;
    if (!job || job.status === "cancelled") return null;
    if (job.status === "done" && Date.now() - (job.times.done || 0) > 3 * 3600000) return null;
    return job;
  }
  async setActive(userId, id) { await this.ctx.storage.put("active:" + userId, id); }
  // Payments: one record per payment link (ref), and every slip QR seen.
  async getPay(ref) { return (await this.ctx.storage.get("pay:" + ref)) || null; }
  async savePay(rec) { await this.ctx.storage.put("pay:" + rec.ref, rec); return rec; }
  async slipSeen(qr, ref) {
    const prev = (await this.ctx.storage.get("slipqr:" + qr)) || null;
    if (!prev) await this.ctx.storage.put("slipqr:" + qr, { ref, at: Date.now() });
    return prev;
  }
}

// ---- Google Sheet ----------------------------------------------------------

// A leading apostrophe makes Google Sheets keep the value as text, so phone
// numbers keep their leading 0 (it isn't shown in the cell).
function asText(v) { return v ? "'" + v : ""; }

export function sheetRow(j) {
  const t = (k) => (j.times[k] ? bkk(j.times[k]) : "");
  return {
    id: j.id,
    created: bkk(j.createdAt),
    services: j.services.map((s) => SERVICE_TH[s] || s).join(", "),
    customer: j.name, phone: asText(j.phone), email: j.email || "",
    address: j.address, map: mapUrl(j),
    date: j.date, time: j.time || "", details: j.notes || "",
    estimate: j.estimate || "", route: j.route || "",
    status: STATUS_TH[j.status] || j.status,
    teams: j.teams.map((t) => TEAM_LABEL[t]).join(", "),
    assignee: j.assignees.map((a) => a.name).join(", "),
    assigned: t("assigned"), travel: t("travel"), started: t("started"), done: t("done"),
    price: j.price, payRef: asText(j.payRef), paid: (j.paidAt ? "สลิป " + bkk(j.paidAt) : "") + (j.payCheck ? (j.payCheck.ok ? " · ✅ เงินเข้า" : " · ❌ " + (j.payCheck.note || "ไม่พบยอด")) + " (" + j.payCheck.by + " " + bkk(j.payCheck.at) + ")" : j.paidAt ? " · รอตรวจ" : ""),
    photos: j.photos.map((p) => p.url),
    slips: j.slips,
    log: j.log.map((l) => bkk(l.at) + " " + l.by + ": " + l.what).join("\n"),
  };
}

// "sheet test" in the admin group: call the sheet script with no job and
// explain what came back, so setup problems can be fixed without logs.
export async function sheetTest(env) {
  const lines = ["🧪 Google Sheet test"];
  if (!env.SHEET_URL || !env.SHEET_SECRET) {
    if (!env.SHEET_URL) lines.push("❌ SHEET_URL is empty in Cloudflare.");
    if (!env.SHEET_SECRET) lines.push("❌ SHEET_SECRET is empty in Cloudflare.");
    lines.push("Add it, then press Deploy in Cloudflare.");
    return lines.join("\n");
  }
  const url = String(env.SHEET_URL).trim();
  lines.push("URL: " + url.slice(0, 45) + "…" + url.slice(-12));
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(url)) {
    lines.push("⚠️ The URL should look like https://script.google.com/macros/s/…/exec (Deploy → Manage deployments → Web app URL).");
  }
  let status = 0, type = "", body = "";
  try {
    const res = await fetch(url, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: String(env.SHEET_SECRET).trim(), job: null }),
    });
    status = res.status; type = res.headers.get("content-type") || ""; body = (await res.text()).slice(0, 2000);
  } catch (e) {
    lines.push("❌ Could not reach the URL: " + String(e).slice(0, 200));
    return lines.join("\n");
  }
  let data = null;
  try { data = JSON.parse(body); } catch { /* not JSON */ }
  lines.push("Answer: HTTP " + status + (type ? " · " + type.split(";")[0] : ""));
  if (data && data.error === "bad job") {
    lines.push("✅ Connected. The script accepted the secret, so new jobs will be written to the sheet.");
  } else if (data && data.error === "bad secret") {
    lines.push("❌ The script is reachable but the secret doesn't match. SHEET_SECRET in Cloudflare must be exactly the same as SECRET in Apps Script (Project Settings → Script Properties), with no spaces.");
  } else if (data) {
    lines.push("⚠️ Unexpected answer: " + body.slice(0, 200));
  } else if (/accounts\.google\.com|ServiceLogin|Sign in/i.test(body)) {
    lines.push("❌ Google asked for a sign-in. In Apps Script: Deploy → Manage deployments → edit → Who has access: Anyone, Execute as: Me → Deploy.");
  } else if (/doPost|Script function not found/i.test(body)) {
    lines.push("❌ The deployment has no doPost. Paste tools/job-sheet.gs into Apps Script, Save, then Deploy → Manage deployments → edit → Version: New version → Deploy.");
  } else if (status === 404 || /not found|ไม่พบ/i.test(body)) {
    lines.push("❌ Google says this URL doesn't exist. Copy the Web app URL again from Deploy → Manage deployments.");
  } else {
    const text = body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    lines.push("❌ The script answered with a web page, not data: " + text.slice(0, 220));
  }
  return lines.join("\n");
}

export async function syncSheet(env, job) {
  if (!env.SHEET_URL || !env.SHEET_SECRET || !job) return;
  const url = String(env.SHEET_URL).trim();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: String(env.SHEET_SECRET).trim(), job: sheetRow(job) }),
    });
    const body = (await res.text()).slice(0, 300);
    if (!res.ok || !/"ok"\s*:\s*true/.test(body)) console.error("Sheet sync failed", res.status, body);
  } catch (e) { console.error("Sheet sync failed", String(e)); }
}

// ---- Messages --------------------------------------------------------------

function button(label, data, display, style) {
  return {
    type: "button", style: style || "secondary", height: "sm",
    action: { type: "postback", label, data, displayText: display },
  };
}
function card(title, lines, buttons, alt) {
  return {
    type: "flex", altText: (alt || title).slice(0, 380),
    contents: {
      type: "bubble", size: "kilo",
      body: {
        type: "box", layout: "vertical", spacing: "sm",
        contents: [{ type: "text", text: title, weight: "bold", size: "md", wrap: true }].concat(
          lines.filter(Boolean).map((l) => ({ type: "text", text: l, size: "sm", wrap: true, color: "#555555" }))),
      },
      footer: buttons.length ? { type: "box", layout: "vertical", spacing: "sm", contents: buttons } : undefined,
    },
  };
}
function t(text) { return { type: "text", text: text.slice(0, 4900) }; }

export function adminCard(job) {
  return card("🆕 งาน " + job.id + " · " + job.services.map((s) => SERVICE_TH[s]).join(", "),
    [job.date + (job.time ? " · " + job.time : ""), job.name + " · " + job.phone,
      "ส่งให้: " + job.teams.map((x) => TEAM_LABEL[x]).join(", "),
      "ชำระเงิน: พิมพ์ pay <ยอด> " + job.id],
    [button("ส่งงานให้ทีม", "job=send&id=" + job.id, "ส่งงาน " + job.id + " ให้ทีม", "primary"),
      button("ยกเลิกงาน", "job=cancel&id=" + job.id, "ยกเลิกงาน " + job.id)]);
}

function teamText(job) {
  const lines = [
    "📋 งานใหม่ " + job.id + " · " + job.services.map((s) => SERVICE_TH[s]).join(", "),
    "วันที่: " + job.date + (job.time ? " · " + job.time : " · เวลาไหนก็ได้"),
    "พื้นที่: " + (job.address || "ปักหมุดบนแผนที่"),
  ];
  if (job.estimate) lines.push("ขนาดงาน: " + job.estimate);
  if (job.route) lines.push("เส้นทาง: " + job.route);
  if (job.notes) lines.push("รายละเอียด: " + job.notes);
  lines.push("", "หัวหน้าทีม: พิมพ์ มอบ " + job.id + " แล้วแท็ก @คนที่จะไปทำงาน");
  return lines.join("\n");
}

function assignedMessages(job, names) {
  const lines = [
    "✅ " + job.id + " มอบให้ " + names,
    "ลูกค้า: " + job.name + " · " + job.phone,
    "วันที่: " + job.date + (job.time ? " · " + job.time : ""),
    "ที่อยู่: " + (job.address || "ปักหมุดบนแผนที่"),
    "แผนที่: " + mapUrl(job),
  ];
  if (job.route) lines.push("เส้นทาง: " + job.route);
  if (job.notes) lines.push("รายละเอียด: " + job.notes);
  lines.push("", "กดปุ่มด้านล่างเมื่อสถานะเปลี่ยน และส่งรูปก่อน/หลังทำงานในกลุ่มนี้ได้เลย");
  return [t(lines.join("\n")), statusCard(job)];
}

function statusCard(job) {
  return card("งาน " + job.id + " · อัปเดตสถานะ", ["สถานะตอนนี้: " + STATUS_TH[job.status]],
    Object.keys(ACTIONS).map((k) => button(ACTIONS[k].label, "job=" + k + "&id=" + job.id, ACTIONS[k].say + " " + job.id, k === "done" ? "primary" : "secondary")));
}

export function jobSummary(job) {
  const lines = [
    "📄 " + job.id + " · " + STATUS_TH[job.status],
    job.services.map((s) => SERVICE_TH[s]).join(", ") + " · " + job.date,
    "ลูกค้า: " + job.name + " · " + job.phone,
    "ผู้รับงาน: " + (job.assignees.map((a) => a.name).join(", ") || "ยังไม่มอบหมาย"),
    "ชำระเงิน: " + payText(job),
    "รูป: " + job.photos.length,
  ];
  for (const k of ["assigned", "travel", "started", "done"]) if (job.times[k]) lines.push(STATUS_TH[k] + ": " + bkk(job.times[k]));
  return lines.join("\n");
}

// ---- LINE helpers ----------------------------------------------------------

async function lineApi(env, path, payload) {
  const api = env.LINE_API_URL || "https://api.line.me";
  const res = await fetch(api + path, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + env.LINE_CHANNEL_ACCESS_TOKEN },
    body: JSON.stringify(payload),
  });
  if (!res.ok) console.error("LINE " + path + " failed", res.status, await res.text());
  return res.ok;
}
export function push(env, to, messages) {
  return Promise.all(ids(to).map((id) => lineApi(env, "/v2/bot/message/push", { to: id, messages })));
}
function reply(env, token, messages) {
  return lineApi(env, "/v2/bot/message/reply", { replyToken: token, messages });
}

// Display name of someone in a group (works without them adding the bot).
async function nameOf(env, source, userId) {
  if (!userId) return "ไม่ทราบชื่อ";
  const api = env.LINE_API_URL || "https://api.line.me";
  const chat = source.groupId ? "/v2/bot/group/" + source.groupId : source.roomId ? "/v2/bot/room/" + source.roomId : "";
  try {
    const res = await fetch(api + (chat ? chat + "/member/" : "/v2/bot/profile/") + userId, {
      headers: { authorization: "Bearer " + env.LINE_CHANNEL_ACCESS_TOKEN },
    });
    if (res.ok) return (await res.json()).displayName || "ไม่ทราบชื่อ";
  } catch { /* fall through */ }
  return "ไม่ทราบชื่อ";
}

// ---- Handlers (called from worker.js) ---------------------------------------

export async function createJob(env, booking) {
  if (!env.JOBS) return null;
  const c = booking.cleaning;
  return store(env).create({
    services: booking.services, name: booking.name, phone: booking.phone, email: booking.email,
    address: booking.address, lat: booking.lat, lng: booking.lng, date: booking.date, time: booking.time,
    notes: booking.notes, route: booking.route,
    estimate: c ? [c.bedrooms + " bed, " + c.bathrooms + " bath" + (c.area ? ", " + c.area + " m²" : ""), c.estimate].filter(Boolean).join(" · ") : "",
    bookingPhotos: booking.photoUrls || [],
  });
}

// "pay 1500 J-1042 …" links the payment ref to the job.
export async function linkPayment(env, jobId, ref, amount) {
  if (!env.JOBS || !jobId) return null;
  const s = store(env);
  const job = await s.get(jobId);
  if (!job) return null;
  job.payRef = ref; job.price = amount;
  job.log.push({ at: Date.now(), by: "admin", what: "payment link ฿" + amount + " (Ref " + ref + ")" });
  await s.linkRef(ref, job.id);
  return s.save(job);
}

// A customer uploaded a slip for payment link `ref`. Keeps a payment record
// (pending until an admin confirms), flags a slip QR that was used before,
// and attaches the slip to the job if the link was made for one.
export async function recordSlip(env, { ref, amount, note, url, qr, name }) {
  if (!env.JOBS) return { pay: null, job: null, dup: null };
  const s = store(env);
  const now = Date.now();
  const dup = qr ? await s.slipSeen(qr, ref) : null;
  const pay = (await s.getPay(ref)) || { ref, amount, note, slips: [], status: "pending", jobId: "" };
  pay.slips.push({ url, qr: qr || "", name: name || "", at: now, dup: dup ? dup.ref : "" });
  if (pay.status !== "confirmed") pay.status = "pending";
  let job = await s.byRef(ref);
  if (job) {
    pay.jobId = job.id;
    job.paidAt = now; job.slips.push(url);
    job.log.push({ at: now, by: "customer", what: "slip uploaded (Ref " + ref + ")" + (dup ? " ⚠️ duplicate of Ref " + dup.ref : "") });
    job = await s.save(job);
  }
  await s.savePay(pay);
  return { pay, job, dup };
}

export function slipCard(pay, job, dup, qrRead) {
  const lines = [
    job ? "งาน " + job.id + (job.name ? " · " + job.name : "") : (pay.note || "ไม่ได้ผูกกับเลขงาน"),
    "QR บนสลิป: " + (qrRead ? "อ่านได้" : "อ่านไม่ได้ (ตรวจจากรูปแทน)"),
  ];
  if (dup && dup.ref === pay.ref) lines.push("ℹ️ ลูกค้าส่งสลิปใบเดิมซ้ำในลิงก์เดียวกัน (ครั้งแรก " + bkk(dup.at) + ")");
  else if (dup) lines.push("⚠️ สลิปนี้เคยใช้กับอีกรายการแล้ว (Ref " + dup.ref + ", " + bkk(dup.at) + ") อาจเป็นสลิปซ้ำ");
  lines.push("เช็กยอดในแอปธนาคารก่อนกดยืนยัน");
  return card("💳 สลิป ฿" + Number(pay.amount).toLocaleString("en-US") + " · Ref " + pay.ref, lines,
    [button("✅ เงินเข้าแล้ว", "job=payok&id=" + pay.ref, "ยืนยันเงินเข้า Ref " + pay.ref, "primary"),
      button("❌ ไม่พบยอด", "job=paybad&id=" + pay.ref, "ไม่พบยอด Ref " + pay.ref)]);
}

function payText(job) {
  if (job.payCheck) return job.payCheck.ok ? "✅ เงินเข้าแล้ว (" + job.payCheck.by + " " + bkk(job.payCheck.at) + ")" : "❌ " + (job.payCheck.note || "ไม่พบยอด") + " (" + job.payCheck.by + " " + bkk(job.payCheck.at) + ")";
  if (job.paidAt) return "ได้รับสลิปแล้ว " + bkk(job.paidAt) + " · รอตรวจยอด";
  return job.payRef ? "รอสลิป (Ref " + job.payRef + ")" : "ยังไม่ส่งลิงก์";
}

// Button taps. role: { admin: chat is in LINE_TO, team: "maids" | "drivers" | null }.
// One group can be both (e.g. while testing with a single group).
export async function onPostback(env, e, role, ctx) {
  const q = new URLSearchParams(e.postback.data || "");
  const action = q.get("job"), id = q.get("id");
  if (!action || !id || !env.JOBS) return false;
  const s = store(env);
  if (action === "payok" || action === "paybad") return onPayCheck(env, e, role, ctx, s, action === "payok", id);
  const job = await s.get(id);
  if (!job) { await reply(env, e.replyToken, [t("ไม่พบงาน " + id)]); return true; }
  const who = await nameOf(env, e.source, e.source.userId);
  const now = Date.now();

  if (action === "send" || action === "cancel") {
    if (!role.admin) return true;
    if (action === "cancel") {
      if (job.status === "cancelled") { await reply(env, e.replyToken, [t(job.id + " ถูกยกเลิกไปแล้ว")]); return true; }
      const wasSent = job.status !== "new";
      job.status = "cancelled"; job.log.push({ at: now, by: who, what: "cancelled" });
      await s.save(job);
      await reply(env, e.replyToken, [t("🚫 ยกเลิกงาน " + job.id + " แล้ว (" + who + ")")]);
      const notify = wasSent ? job.teams.map((tm) => push(env, teamChats(env, tm).join(","), [t("🚫 งาน " + job.id + " ถูกยกเลิก")])) : [];
      ctx.waitUntil(Promise.all(notify.concat(syncSheet(env, job))));
      return true;
    }
    if (job.status === "cancelled") { await reply(env, e.replyToken, [t(job.id + " ถูกยกเลิกไปแล้ว")]); return true; }
    const missing = job.teams.filter((tm) => !teamChats(env, tm).length);
    if (missing.length) {
      await reply(env, e.replyToken, [t("ยังไม่ได้ตั้งกลุ่ม " + missing.map((m) => TEAM_LABEL[m]).join(", ") + " ใน Cloudflare (" + missing.map((m) => TEAM_ENV[m]).join(", ") + ")")]);
      return true;
    }
    // Push first so the admin hears whether each team group really got it.
    const sent = await Promise.all(job.teams.map((tm) => push(env, teamChats(env, tm).join(","), [t(teamText(job))])));
    const ok = job.teams.filter((tm, i) => sent[i].some(Boolean));
    const failed = job.teams.filter((tm, i) => !sent[i].some(Boolean));
    if (ok.length) {
      if (job.status === "new") job.status = "sent";
      job.log.push({ at: now, by: who, what: "sent to " + ok.join(", ") });
      await s.save(job);
    }
    const lines = [];
    if (ok.length) lines.push("📤 ส่งงาน " + job.id + " ให้ " + ok.map((x) => TEAM_LABEL[x]).join(", ") + " แล้ว (" + who + ")");
    if (failed.length) {
      lines.push("❌ ส่งเข้า " + failed.map((x) => TEAM_LABEL[x]).join(", ") + " ไม่สำเร็จ ตรวจว่า " +
        failed.map((x) => TEAM_ENV[x]).join(", ") + " ใน Cloudflare เป็นไอดีของกลุ่มที่มีบอทอยู่ (พิมพ์ id ในกลุ่มนั้นเพื่อดูไอดี)");
    }
    await reply(env, e.replyToken, [t(lines.join("\n"))]);
    if (ok.length) ctx.waitUntil(syncSheet(env, job));
    return true;
  }

  if (ACTIONS[action]) {
    if (!role.team || !job.teams.includes(role.team)) return true;
    if (job.status === "cancelled") { await reply(env, e.replyToken, [t(job.id + " ถูกยกเลิกแล้ว")]); return true; }
    job.status = action; job.times[action] = now;
    job.log.push({ at: now, by: who, what: ACTIONS[action].say });
    await s.save(job);
    if (e.source.userId) await s.setActive(e.source.userId, job.id);
    let text = ACTIONS[action].label + " · " + job.id + " · " + who + " · " + bkk(now);
    if (action === "done") text += "\nส่งรูปหลังทำงานในกลุ่มนี้ได้เลย ระบบจะเก็บเข้างานนี้ให้";
    if (action === "problem") text += "\nพิมพ์รายละเอียดปัญหาในกลุ่มนี้ แอดมินได้รับแจ้งแล้ว";
    await reply(env, e.replyToken, [t(text)]);
    const tasks = [syncSheet(env, job)];
    if (action === "done" || action === "problem") {
      tasks.push(push(env, env.LINE_TO, [t((action === "done" ? "✅ " : "⚠️ ") + job.id + " " + ACTIONS[action].say + " · " + who + " · " + bkk(now) +
        (action === "done" ? "\nรูปทั้งหมด: " + job.photos.length + " · ชำระเงิน: " + payText(job) : ""))]));
    }
    ctx.waitUntil(Promise.all(tasks));
    return true;
  }
  return false;
}

// Record a payment as confirmed or rejected (by an admin or by the slip
// check) on its payment record and on the job it belongs to.
export async function applyPayCheck(env, ref, ok, who, note) {
  if (!env.JOBS) return { pay: null, job: null };
  const s = store(env);
  const pay = await s.getPay(ref);
  if (!pay) return { pay: null, job: null };
  const now = Date.now();
  pay.status = ok ? "confirmed" : "rejected"; pay.by = who; pay.at = now; pay.note = note || "";
  await s.savePay(pay);
  let job = pay.jobId ? await s.get(pay.jobId) : null;
  if (job) {
    job.payCheck = { ok, by: who, at: now, note: note || "" };
    job.log.push({ at: now, by: who, what: (ok ? "payment confirmed" : "payment rejected" + (note ? ": " + note : "")) + " ฿" + pay.amount + " (Ref " + ref + ")" });
    job = await s.save(job);
  }
  return { pay, job };
}

export async function getPay(env, ref) { return env.JOBS ? store(env).getPay(ref) : null; }

// Admin taps ✅ เงินเข้าแล้ว / ❌ ไม่พบยอด on a slip card.
async function onPayCheck(env, e, role, ctx, s, ok, ref) {
  if (!role.admin) return true;
  const pay = await s.getPay(ref);
  if (!pay) { await reply(env, e.replyToken, [t("ไม่พบการชำระ Ref " + ref)]); return true; }
  const who = await nameOf(env, e.source, e.source.userId);
  if (pay.status === "confirmed" && ok) {
    await reply(env, e.replyToken, [t("Ref " + ref + " ยืนยันเงินเข้าไปแล้วโดย " + pay.by + " (" + bkk(pay.at) + ")")]);
    return true;
  }
  const { job } = await applyPayCheck(env, ref, ok, who, ok ? "" : "ไม่พบยอด");
  const amount = "฿" + Number(pay.amount).toLocaleString("en-US");
  await reply(env, e.replyToken, [t(ok
    ? "✅ ยืนยันเงินเข้า " + amount + " · Ref " + ref + (job ? " · " + job.id : "") + " · โดย " + who
    : "❌ ไม่พบยอด " + amount + " · Ref " + ref + (job ? " · " + job.id : "") + " · โดย " + who + "\nแจ้งลูกค้าให้ตรวจสอบการโอน หรือส่งสลิปใหม่จากลิงก์เดิม")]);
  if (job) ctx.waitUntil(syncSheet(env, job));
  return true;
}

// Text commands. Returns true if handled.
//  team: "มอบ J-1042 @name" (or "assign J-1042 @name")
//  admin/team: "งาน J-1042" (or "job J-1042") shows the job's status
export async function onText(env, e, role, ctx) {
  if (!env.JOBS) return false;
  const text = e.message.text || "";
  const id = jobIdIn(text);
  if (!id) return false;
  const s = store(env);

  if (/^\s*(งาน|job|status|สถานะ)(?=\s|J|$)/i.test(text)) {
    const job = await s.get(id);
    await reply(env, e.replyToken, [t(job ? jobSummary(job) : "ไม่พบงาน " + id)]);
    return true;
  }

  if (/^\s*(มอบ|มอบหมาย|assign)/i.test(text) && !role.team) {
    await reply(env, e.replyToken, [t("คำสั่ง มอบ ใช้ในกลุ่มทีม (กลุ่มแม่บ้านหรือกลุ่มคนขับ) ที่ตั้งไว้ใน LINE_TEAM_MAIDS / LINE_TEAM_DRIVERS")]);
    return true;
  }
  if (/^\s*(มอบ|มอบหมาย|assign)/i.test(text)) {
    const team = role.team;
    const job = await s.get(id);
    if (!job || !job.teams.includes(team)) { await reply(env, e.replyToken, [t("ไม่พบงาน " + id + " ของ" + TEAM_LABEL[team])]); return true; }
    if (job.status === "cancelled") { await reply(env, e.replyToken, [t(id + " ถูกยกเลิกแล้ว")]); return true; }
    const mentioned = ((e.message.mention && e.message.mention.mentionees) || []).filter((m) => m.type !== "all");
    let people = await Promise.all(mentioned.map(async (m) => ({
      id: m.userId || "", name: m.userId ? await nameOf(env, e.source, m.userId) : mentionName(text, m),
    })));
    if (!people.length) {
      const after = text.replace(/^\s*\S+\s+J-?\d+\s*/i, "").trim();
      if (!after) { await reply(env, e.replyToken, [t("พิมพ์ มอบ " + id + " แล้วแท็ก @คนที่จะไปทำงาน")]); return true; }
      people = [{ id: "", name: after.slice(0, 60) }];
    }
    const by = await nameOf(env, e.source, e.source.userId);
    const now = Date.now();
    job.assignees = job.assignees.filter((a) => a.team !== team).concat(people.map((p) => ({ team, id: p.id, name: p.name })));
    job.status = "assigned"; job.times.assigned = now;
    job.log.push({ at: now, by, what: "assigned " + people.map((p) => p.name).join(", ") });
    await s.save(job);
    for (const p of people) if (p.id) await s.setActive(p.id, job.id);
    const names = people.map((p) => p.name).join(", ");
    await reply(env, e.replyToken, assignedMessages(job, names));
    ctx.waitUntil(Promise.all([
      push(env, env.LINE_TO, [t("👷 " + job.id + " มอบให้ " + names + " แล้ว (" + TEAM_LABEL[team] + ", โดย " + by + ")")]),
      syncSheet(env, job),
    ]));
    return true;
  }
  return false;
}

// Name of a tagged person, from the message text (used when LINE doesn't
// give their user ID because they haven't added the bot as a friend).
// LINE's index/length cover "@Name"; read the whole word around it so a
// small offset can't cut the name short.
export function mentionName(text, m) {
  let start = Math.max(0, Math.min(m.index, text.length));
  while (start > 0 && text[start - 1] !== "@" && !/\s/.test(text[start - 1])) start--;
  if (start > 0 && text[start - 1] === "@") start--;
  let end = Math.min(text.length, m.index + m.length);
  while (end < text.length && !/\s/.test(text[end])) end++;
  return text.slice(start, end).replace(/^@/, "").trim().slice(0, 60) || "ไม่ทราบชื่อ";
}

// Photos in a team group go to the sender's current job.
export async function onImage(env, e, role, ctx, savePhoto) {
  if (!env.JOBS || !role.team || !e.source.userId) return false;
  const s = store(env);
  const job = await s.activeFor(e.source.userId);
  if (!job) return false;
  const api = env.LINE_DATA_URL || "https://api-data.line.me";
  const res = await fetch(api + "/v2/bot/message/" + e.message.id + "/content", {
    headers: { authorization: "Bearer " + env.LINE_CHANNEL_ACCESS_TOKEN },
  });
  if (!res.ok) { console.error("LINE content failed", res.status); return false; }
  const url = await savePhoto(await res.arrayBuffer(), res.headers.get("content-type") || "image/jpeg");
  if (!url) return false;
  const fresh = await s.get(job.id);
  const who = await nameOf(env, e.source, e.source.userId);
  fresh.photos.push({ url, at: Date.now(), by: who, stage: fresh.status === "done" ? "after" : fresh.status === "started" ? "during" : "before" });
  await s.save(fresh);
  ctx.waitUntil(syncSheet(env, fresh));
  return true;
}
