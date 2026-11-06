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
}

// ---- Google Sheet ----------------------------------------------------------

export function sheetRow(j) {
  const t = (k) => (j.times[k] ? bkk(j.times[k]) : "");
  return {
    id: j.id,
    created: bkk(j.createdAt),
    services: j.services.map((s) => SERVICE_TH[s] || s).join(", "),
    customer: j.name, phone: j.phone, email: j.email || "",
    address: j.address, map: mapUrl(j),
    date: j.date, time: j.time || "", details: j.notes || "",
    estimate: j.estimate || "", route: j.route || "",
    status: STATUS_TH[j.status] || j.status,
    teams: j.teams.map((t) => TEAM_LABEL[t]).join(", "),
    assignee: j.assignees.map((a) => a.name).join(", "),
    assigned: t("assigned"), travel: t("travel"), started: t("started"), done: t("done"),
    price: j.price, payRef: j.payRef, paid: j.paidAt ? bkk(j.paidAt) : "",
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
    "ชำระเงิน: " + (job.paidAt ? "ได้รับสลิปแล้ว " + bkk(job.paidAt) : job.payRef ? "รอสลิป (Ref " + job.payRef + ")" : "ยังไม่ส่งลิงก์"),
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

export async function slipReceived(env, ref, slipUrl) {
  if (!env.JOBS) return null;
  const s = store(env);
  const job = await s.byRef(ref);
  if (!job) return null;
  job.paidAt = Date.now(); job.slips.push(slipUrl);
  job.log.push({ at: job.paidAt, by: "customer", what: "slip uploaded (Ref " + ref + ")" });
  return s.save(job);
}

// Button taps. role: "admin" | "maids" | "drivers"
export async function onPostback(env, e, role, ctx) {
  const q = new URLSearchParams(e.postback.data || "");
  const action = q.get("job"), id = q.get("id");
  if (!action || !id || !env.JOBS) return false;
  const s = store(env);
  const job = await s.get(id);
  if (!job) { await reply(env, e.replyToken, [t("ไม่พบงาน " + id)]); return true; }
  const who = await nameOf(env, e.source, e.source.userId);
  const now = Date.now();

  if (action === "send" || action === "cancel") {
    if (role !== "admin") return true;
    if (action === "cancel") {
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
    if (job.status === "new") job.status = "sent";
    job.log.push({ at: now, by: who, what: "sent to " + job.teams.join(", ") });
    await s.save(job);
    await reply(env, e.replyToken, [t("📤 ส่งงาน " + job.id + " ให้ " + job.teams.map((x) => TEAM_LABEL[x]).join(", ") + " แล้ว (" + who + ")")]);
    ctx.waitUntil(Promise.all(job.teams.map((tm) => push(env, teamChats(env, tm).join(","), [t(teamText(job))])).concat(syncSheet(env, job))));
    return true;
  }

  if (ACTIONS[action]) {
    if (role === "admin" || !job.teams.includes(role)) return true;
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
        (action === "done" ? "\nรูปทั้งหมด: " + job.photos.length + " · ชำระเงิน: " + (job.paidAt ? "ได้รับสลิปแล้ว" : "ยังไม่ได้รับสลิป") : ""))]));
    }
    ctx.waitUntil(Promise.all(tasks));
    return true;
  }
  return false;
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

  if (/^\s*(มอบ|มอบหมาย|assign)/i.test(text) && role !== "admin") {
    const job = await s.get(id);
    if (!job || !job.teams.includes(role)) { await reply(env, e.replyToken, [t("ไม่พบงาน " + id + " ของ" + TEAM_LABEL[role])]); return true; }
    if (job.status === "cancelled") { await reply(env, e.replyToken, [t(id + " ถูกยกเลิกแล้ว")]); return true; }
    const mentioned = ((e.message.mention && e.message.mention.mentionees) || []).filter((m) => m.type !== "all");
    let people = await Promise.all(mentioned.map(async (m) => ({
      id: m.userId || "", name: m.userId ? await nameOf(env, e.source, m.userId) : text.substr(m.index + 1, m.length - 1),
    })));
    if (!people.length) {
      const after = text.replace(/^\s*\S+\s+J-?\d+\s*/i, "").trim();
      if (!after) { await reply(env, e.replyToken, [t("พิมพ์ มอบ " + id + " แล้วแท็ก @คนที่จะไปทำงาน")]); return true; }
      people = [{ id: "", name: after.slice(0, 60) }];
    }
    const by = await nameOf(env, e.source, e.source.userId);
    const now = Date.now();
    job.assignees = job.assignees.filter((a) => a.team !== role).concat(people.map((p) => ({ team: role, id: p.id, name: p.name })));
    job.status = "assigned"; job.times.assigned = now;
    job.log.push({ at: now, by, what: "assigned " + people.map((p) => p.name).join(", ") });
    await s.save(job);
    for (const p of people) if (p.id) await s.setActive(p.id, job.id);
    const names = people.map((p) => p.name).join(", ");
    await reply(env, e.replyToken, assignedMessages(job, names));
    ctx.waitUntil(Promise.all([
      push(env, env.LINE_TO, [t("👷 " + job.id + " มอบให้ " + names + " แล้ว (" + TEAM_LABEL[role] + ", โดย " + by + ")")]),
      syncSheet(env, job),
    ]));
    return true;
  }
  return false;
}

// Photos in a team group go to the sender's current job.
export async function onImage(env, e, role, ctx, savePhoto) {
  if (!env.JOBS || role === "admin" || !e.source.userId) return false;
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
