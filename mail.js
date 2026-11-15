// Customer emails. The Worker can't send email itself, so it posts to a small
// Apps Script web app (tools/mailer.gs) deployed under the Gmail account the
// emails should come from (MAIL_URL, MAIL_SECRET). Emails go out:
//   - when a booking with an email address arrives ("we got your request")
//   - when the team leader assigns the job ("your booking is confirmed")
//   - when a payment is confirmed ("payment received")
// Each kind is sent once per job (job.mailed).

const SERVICE_EN = {
  cleaning: "Home cleaning", chauffeur: "Chauffeur & errands", carwash: "Car wash at home", grocery: "Grocery delivery",
};
const SITE = "https://services.chowrest-property.com";
const WHATSAPP = "https://wa.me/66925791876";
const LINE = "https://line.me/R/ti/p/%40chowrest";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
function niceDate(iso) {
  const d = new Date(iso + "T00:00:00+07:00");
  if (isNaN(d)) return iso || "";
  return d.toLocaleDateString("en-GB", { timeZone: "Asia/Bangkok", weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

export async function sendMail(env, { to, subject, html, text }) {
  if (!env.MAIL_URL || !env.MAIL_SECRET) return { ok: false, error: "not set up" };
  if (!EMAIL_RE.test(to || "")) return { ok: false, error: "bad address" };
  try {
    const res = await fetch(String(env.MAIL_URL).trim(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: String(env.MAIL_SECRET).trim(), to, subject, html, text, name: "YourestWedo" }),
    });
    const body = await res.text();
    let data = null;
    try { data = JSON.parse(body); } catch { /* not JSON */ }
    if (data && data.ok) return { ok: true, remaining: data.remaining };
    console.error("Mail failed", res.status, body.slice(0, 300));
    return { ok: false, error: data && data.error ? data.error : "HTTP " + res.status, body: body.slice(0, 2000), status: res.status };
  } catch (e) {
    console.error("Mail failed", String(e));
    return { ok: false, error: String(e).slice(0, 200) };
  }
}

function layout(title, intro, rows, outro) {
  const table = rows.filter((r) => r[1]).map((r) =>
    `<tr><td style="padding:6px 16px 6px 0;color:#5b6b69;vertical-align:top;white-space:nowrap">${esc(r[0])}</td><td style="padding:6px 0;color:#1f2a2a">${esc(r[1])}</td></tr>`).join("");
  const html = `<div style="background:#fbf8f2;padding:24px 12px;font-family:Arial,Helvetica,sans-serif">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e4dccb;border-radius:14px;overflow:hidden">
<div style="background:#0f2a2a;padding:18px 24px;color:#d8b56a;font-family:Georgia,serif;font-size:20px">YourestWedo <span style="color:#9fb2b0;font-size:12px;letter-spacing:2px">CHOWREST</span></div>
<div style="padding:24px">
<h1 style="margin:0 0 12px;font-family:Georgia,serif;font-size:24px;color:#0f2a2a">${esc(title)}</h1>
<p style="margin:0 0 16px;color:#1f2a2a;line-height:1.5">${esc(intro)}</p>
<table style="border-collapse:collapse;font-size:14px;margin:0 0 16px">${table}</table>
<p style="margin:0 0 16px;color:#1f2a2a;line-height:1.5">${esc(outro)}</p>
<p style="margin:0 0 6px;color:#1f2a2a">Questions? Message us:</p>
<p style="margin:0"><a href="${WHATSAPP}" style="display:inline-block;background:#1fa855;color:#fff;text-decoration:none;padding:9px 16px;border-radius:999px;margin:0 8px 8px 0">WhatsApp</a><a href="${LINE}" style="display:inline-block;background:#06c755;color:#fff;text-decoration:none;padding:9px 16px;border-radius:999px;margin:0 8px 8px 0">LINE @chowrest</a></p>
</div>
<div style="padding:14px 24px;background:#f2ece0;color:#5b6b69;font-size:12px">YourestWedo Co.,Ltd. · Koh Samui · <a href="${SITE}" style="color:#5b6b69">${SITE.replace("https://", "")}</a></div>
</div></div>`;
  const text = [title, "", intro, "", ...rows.filter((r) => r[1]).map((r) => r[0] + ": " + r[1]), "", outro, "",
    "WhatsApp: " + WHATSAPP, "LINE: @chowrest", "", "YourestWedo Co.,Ltd. · Koh Samui"].join("\n");
  return { html, text };
}

function jobRows(job) {
  return [
    ["Booking", job.id],
    ["Service", (job.services || []).map((s) => SERVICE_EN[s] || s).join(", ")],
    ["Date", niceDate(job.date)],
    ["Time", job.time || "Any time"],
    ["Address", job.address],
    ["Size & estimate", job.estimate],
    ["Route & estimate", job.route],
  ];
}

export function bookingReceivedMail(job) {
  const first = String(job.name || "").split(" ")[0];
  const { html, text } = layout(
    "We've got your request",
    `Hi ${first}, thank you for booking with YourestWedo. Here are the details you sent.`,
    jobRows(job),
    "Our team will contact you shortly to confirm the details and the price. Nothing is charged until we've agreed the price with you.",
  );
  return { subject: `We've received your booking ${job.id} – YourestWedo`, html, text };
}

export function bookingConfirmedMail(job) {
  const first = String(job.name || "").split(" ")[0];
  const { html, text } = layout(
    "Your booking is confirmed",
    `Hi ${first}, good news: our team has been scheduled for your booking.`,
    jobRows(job),
    "If anything changes, just reply to this email or message us on WhatsApp or LINE.",
  );
  return { subject: `Booking ${job.id} confirmed – YourestWedo`, html, text };
}

export function paymentReceivedMail(job, amount, ref) {
  const first = String(job.name || "").split(" ")[0];
  const rows = [["Booking", job.id], ["Amount", "฿" + Number(amount).toLocaleString("en-US", { maximumFractionDigits: 2 })], ["Reference", ref],
    ["Service", (job.services || []).map((s) => SERVICE_EN[s] || s).join(", ")], ["Date", niceDate(job.date)]];
  const { html, text } = layout("Payment received", `Hi ${first}, we've received your payment. Thank you!`, rows,
    "Keep this email as your receipt.");
  return { subject: `Payment received for ${job.id} – YourestWedo`, html, text };
}

export function testMail() {
  const { html, text } = layout("Test email", "This is a test from the YourestWedo booking system. If you can read it, customer emails are working.",
    [["Sent", new Date().toLocaleString("en-GB", { timeZone: "Asia/Bangkok" })]], "No action needed.");
  return { subject: "Test email – YourestWedo", html, text };
}
