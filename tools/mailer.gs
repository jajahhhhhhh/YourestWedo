/**
 * YourestWedo customer emails — Google Apps Script web app.
 *
 * The website sends booking, confirmation and payment emails through this
 * script. Emails come from the Google account that deploys it.
 *
 * Setup (signed in to Google as the account emails should come from,
 * e.g. chowtorest@gmail.com):
 * 1. Go to https://script.new, name the project "YourestWedo mailer",
 *    replace the code with this file and save.
 * 2. Project Settings (gear) → Script Properties → Add property:
 *    SECRET = a long random password (letters and numbers only).
 * 3. Deploy → New deployment → type "Web app". Execute as: Me.
 *    Who has access: Anyone. Deploy, authorise, copy the Web app URL.
 * 4. In Cloudflare (Workers & Pages → yourestwedo → Settings → Variables and
 *    Secrets) add MAIL_URL = that URL and MAIL_SECRET = the password, both as
 *    type Secret, then Deploy.
 * 5. In the LINE admin group type:  mail test you@example.com
 *
 * Moving to a company email later: repeat these steps signed in to the new
 * account and replace MAIL_URL and MAIL_SECRET in Cloudflare.
 * Free Gmail accounts can send about 100 emails a day from Apps Script.
 */

function doPost(e) {
  var body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return out({ ok: false, error: "bad json" }); }
  var secret = PropertiesService.getScriptProperties().getProperty("SECRET");
  if (!secret || body.secret !== secret) return out({ ok: false, error: "bad secret" });
  var to = String(body.to || "");
  if (!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(to)) return out({ ok: false, error: "bad address" });
  if (MailApp.getRemainingDailyQuota() < 1) return out({ ok: false, error: "daily email limit reached" });
  MailApp.sendEmail({
    to: to,
    subject: String(body.subject || "YourestWedo").slice(0, 200),
    htmlBody: String(body.html || ""),
    body: String(body.text || ""),
    name: String(body.name || "YourestWedo").slice(0, 60)
  });
  return out({ ok: true, remaining: MailApp.getRemainingDailyQuota() });
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
