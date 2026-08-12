/**
 * IDENTIFY THE BRAND — Google Sheets webhook (Apps Script Web App).
 *
 * Setup (see SHEETS.md):
 *   1. Create a Google Sheet. Extensions ▸ Apps Script.
 *   2. Paste this file. Set SECRET below to a long random string.
 *   3. Deploy ▸ New deployment ▸ Web app:
 *        Execute as: Me
 *        Who has access: Anyone
 *      Copy the Web app URL.
 *   4. On the server set SHEETS_WEBHOOK_URL = that URL and
 *      SHEETS_SECRET = the same SECRET.
 *
 * The server sends JSON { secret, action, ... } and this responds with JSON.
 * Requests with the wrong secret are rejected.
 */

var SECRET = 'REPLACE_WITH_A_LONG_RANDOM_STRING';

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    if (String(body.secret) !== String(SECRET)) return json({ error: 'unauthorized' });

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    switch (body.action) {
      case 'ping':
        return json({ ok: true });
      case 'ensure':
        return ensureTabs(ss, body.tabs || {});
      case 'append':
        return appendRow(ss, body.tab, body.row || {});
      case 'read':
        return readRows(ss, body.tab);
      default:
        return json({ error: 'unknown action' });
    }
  } catch (err) {
    return json({ error: String(err) });
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

function sheetFor(ss, name, header) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (header && sh.getLastRow() === 0) sh.appendRow(header);
  return sh;
}

function ensureTabs(ss, tabs) {
  Object.keys(tabs).forEach(function (name) {
    sheetFor(ss, name, tabs[name]);
  });
  return json({ ok: true });
}

function appendRow(ss, name, row) {
  var sh = sheetFor(ss, name, null);
  var header =
    sh.getLastRow() > 0 ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0] : [];
  if (!header.length) {
    header = Object.keys(row);
    sh.appendRow(header);
  }
  var values = header.map(function (h) {
    return row[h] !== undefined && row[h] !== null ? row[h] : '';
  });
  sh.appendRow(values);
  return json({ ok: true });
}

function readRows(ss, name) {
  var sh = ss.getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return json({ rows: [] });
  var data = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  var header = data[0];
  var rows = [];
  for (var i = 1; i < data.length; i++) {
    var o = {};
    for (var c = 0; c < header.length; c++) o[header[c]] = data[i][c];
    rows.push(o);
  }
  return json({ rows: rows }); // Date cells serialize to ISO strings via JSON
}
