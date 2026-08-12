//
// IDENTIFY THE BRAND - Google Sheets webhook (Apps Script Web App).
//
// Setup (see SHEETS.md):
//   1. Create a Google Sheet, then: Extensions > Apps Script.
//   2. Paste this whole file (replace the default Code.gs contents).
//   3. Set SECRET below to a long random string. Only change the text
//      between the quotes - keep the straight quotes.
//   4. Deploy > New deployment > Web app:
//        Execute as: Me
//        Who has access: Anyone
//      Copy the Web app URL.
//   5. On the server set SHEETS_WEBHOOK_URL to that URL and
//      SHEETS_SECRET to the same value as SECRET.
//
// The server sends JSON { secret, action, ... } and this replies with JSON.
// Requests with the wrong secret are rejected.
//

var SECRET = 'REPLACE_WITH_A_LONG_RANDOM_STRING';

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    if (String(body.secret) !== String(SECRET)) {
      return json({ error: 'unauthorized' });
    }
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (body.action === 'ping') {
      return json({ ok: true });
    }
    if (body.action === 'ensure') {
      return ensureTabs(ss, body.tabs || {});
    }
    if (body.action === 'append') {
      return appendRow(ss, body.tab, body.row || {});
    }
    if (body.action === 'read') {
      return readRows(ss, body.tab);
    }
    return json({ error: 'unknown action' });
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
  if (!sh) {
    sh = ss.insertSheet(name);
  }
  if (header && sh.getLastRow() === 0) {
    sh.appendRow(header);
  }
  return sh;
}

function ensureTabs(ss, tabs) {
  var names = Object.keys(tabs);
  for (var i = 0; i < names.length; i++) {
    sheetFor(ss, names[i], tabs[names[i]]);
  }
  return json({ ok: true });
}

function appendRow(ss, name, row) {
  var sh = sheetFor(ss, name, null);
  var header = [];
  if (sh.getLastRow() > 0) {
    header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  }
  if (!header.length) {
    header = Object.keys(row);
    sh.appendRow(header);
  }
  var values = [];
  for (var i = 0; i < header.length; i++) {
    var key = header[i];
    values.push(row[key] !== undefined && row[key] !== null ? row[key] : '');
  }
  sh.appendRow(values);
  return json({ ok: true });
}

function readRows(ss, name) {
  var sh = ss.getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) {
    return json({ rows: [] });
  }
  var data = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  var header = data[0];
  var rows = [];
  for (var r = 1; r < data.length; r++) {
    var o = {};
    for (var c = 0; c < header.length; c++) {
      o[header[c]] = data[r][c];
    }
    rows.push(o);
  }
  return json({ rows: rows });
}
