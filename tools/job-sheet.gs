/**
 * YourestWedo job log — Google Apps Script for the "Jobs" Google Sheet.
 *
 * The website (Cloudflare Worker) sends every job change here. This script
 * keeps one row per job (updated in place) and copies job photos and payment
 * slips into Google Drive, because the website only keeps photos for 30 days.
 *
 * Setup (once):
 * 1. Open the Google Sheet → Extensions → Apps Script. Replace the code with
 *    this file and save.
 * 2. Project Settings (gear) → Script Properties → Add property:
 *    SECRET = a long random password (the same value goes in Cloudflare as
 *    the SHEET_SECRET secret).
 * 3. Deploy → New deployment → type "Web app". Execute as: Me. Who has
 *    access: Anyone. Deploy, allow access, and copy the Web app URL.
 * 4. In Cloudflare (Workers & Pages → yourestwedo → Settings → Variables and
 *    Secrets) add SHEET_URL = that URL and SHEET_SECRET = the password,
 *    both as type Secret, then Deploy.
 * After changing this code later: Deploy → Manage deployments → edit →
 * Version: New version, so the same URL keeps working.
 */

var SHEET_NAME = "Jobs";
var FOLDER_NAME = "YourestWedo job photos";
var COLUMNS = [
  ["id", "Job"], ["created", "Created"], ["status", "Status"], ["services", "Services"],
  ["date", "Date"], ["time", "Time"], ["customer", "Customer"], ["phone", "Phone"], ["email", "Email"],
  ["address", "Address"], ["map", "Map"], ["details", "Details"], ["estimate", "Size / estimate"],
  ["route", "Route"], ["teams", "Team"], ["assignee", "Assigned to"], ["assigned", "Assigned at"],
  ["travel", "On the way"], ["started", "Started"], ["done", "Done"], ["price", "Price (฿)"],
  ["payRef", "Pay ref"], ["paid", "Slip received"], ["photoCount", "Photos"], ["folder", "Photo folder"],
  ["log", "Log"]
];

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var body = JSON.parse(e.postData.contents);
    var secret = PropertiesService.getScriptProperties().getProperty("SECRET");
    if (!secret || body.secret !== secret) return out({ ok: false, error: "bad secret" });
    var job = body.job;
    if (!job || !/^J-\d+$/.test(job.id)) return out({ ok: false, error: "bad job" });

    var files = savePhotos(job);
    job.photoCount = files.count;
    job.folder = files.folder;

    var sheet = getSheet();
    var row = findRow(sheet, job.id);
    var values = COLUMNS.map(function (c) { return job[c[0]] == null ? "" : String(job[c[0]]); });
    if (row) sheet.getRange(row, 1, 1, values.length).setValues([values]);
    else sheet.appendRow(values);
    return out({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

function getSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(COLUMNS.map(function (c) { return c[1]; }));
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, COLUMNS.length).setFontWeight("bold");
  }
  return sheet;
}

function findRow(sheet, id) {
  var last = sheet.getLastRow();
  if (last < 2) return 0;
  var ids = sheet.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (ids[i][0] === id) return i + 2;
  return 0;
}

// Copy new photo and slip URLs into Drive: YourestWedo job photos / J-1042.
function savePhotos(job) {
  var urls = (job.photos || []).concat(job.slips || []);
  var props = PropertiesService.getScriptProperties();
  var key = "saved:" + job.id;
  var saved = JSON.parse(props.getProperty(key) || "{}");
  var folderUrl = props.getProperty("folder:" + job.id) || "";
  var fresh = urls.filter(function (u) { return !saved[u]; });
  if (fresh.length) {
    var folder = jobFolder(job.id);
    folderUrl = folder.getUrl();
    props.setProperty("folder:" + job.id, folderUrl);
    fresh.forEach(function (u, i) {
      try {
        var blob = UrlFetchApp.fetch(u).getBlob();
        var isSlip = (job.slips || []).indexOf(u) !== -1;
        blob.setName(job.id + (isSlip ? "-slip-" : "-photo-") + (Object.keys(saved).length + 1) + ".jpg");
        folder.createFile(blob);
        saved[u] = true;
      } catch (err) {
        console.error("Could not save " + u + ": " + err);
      }
    });
    props.setProperty(key, JSON.stringify(saved));
  }
  return { count: (job.photos || []).length, folder: folderUrl };
}

function jobFolder(id) {
  var roots = DriveApp.getFoldersByName(FOLDER_NAME);
  var root = roots.hasNext() ? roots.next() : DriveApp.createFolder(FOLDER_NAME);
  var found = root.getFoldersByName(id);
  return found.hasNext() ? found.next() : root.createFolder(id);
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
