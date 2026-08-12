// Injection-safe, serialized CSV persistence layer.
//
// Design goals (see spec §14 CSV INTEGRITY):
//   - Never lose an append: each file has a single-writer promise chain so
//     concurrent requests can never interleave a read-modify-write.
//   - Escape correctly: RFC-4180 quoting for commas, quotes, newlines, unicode.
//   - Prevent CSV/formula injection: cells starting with = + - @ (or tab/CR)
//     are prefixed with a single quote so spreadsheets treat them as text.
//   - Excel-friendly export: helper to emit a UTF-8 BOM.
//   - Fail loudly: header validation at startup; missing files auto-created.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const BOM = '﻿';

// One serialization queue per absolute file path.
const writeChains = new Map();

function chainFor(file) {
  if (!writeChains.has(file)) writeChains.set(file, Promise.resolve());
  return writeChains.get(file);
}

// Run `fn` after all previously-queued writes for this file have settled.
function serialize(file, fn) {
  const next = chainFor(file).then(fn, fn);
  // Keep the chain alive but swallow rejection so one failure doesn't poison
  // the queue; callers still receive their own rejection via `result`.
  writeChains.set(
    file,
    next.then(
      () => {},
      () => {},
    ),
  );
  return next;
}

// Sanitize a single cell value against CSV/formula injection, then RFC-4180
// quote it if it contains a delimiter, quote, or newline.
export function escapeCell(value) {
  let s = value === null || value === undefined ? '' : String(value);
  // Neutralize formula-injection triggers at the START of a cell.
  if (/^[=+\-@\t\r]/.test(s)) {
    s = "'" + s;
  }
  if (/[",\n\r]/.test(s)) {
    s = '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

export function toRow(values) {
  return values.map(escapeCell).join(',') + '\n';
}

// Parse a CSV file back into array-of-objects. Small, dependency-free, handles
// quoted fields with embedded commas/newlines/escaped quotes. Sufficient for
// our own well-formed files; not a general-purpose parser.
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  if (text.startsWith(BOM)) i = 1;
  for (; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c === '\r') {
      // ignore; handled by the following \n
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  if (rows.length === 0) return { header: [], records: [] };
  const header = rows[0];
  const records = rows.slice(1).map((r) => {
    const obj = {};
    header.forEach((h, idx) => {
      obj[h] = r[idx] ?? '';
    });
    return obj;
  });
  return { header, records };
}

export class CsvTable {
  constructor(file, header) {
    this.file = path.resolve(file);
    this.header = header;
  }

  // Create the file with a header row if it is missing; validate the header if
  // it exists. Throws (fail loudly) on header mismatch.
  ensure() {
    const dir = path.dirname(this.file);
    fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(this.file)) {
      fs.writeFileSync(this.file, toRow(this.header), 'utf8');
      return;
    }
    const firstLine = fs.readFileSync(this.file, 'utf8').split('\n')[0] || '';
    const existing = parseCsv(firstLine + '\n').header;
    const expected = this.header;
    const mismatch =
      existing.length !== expected.length ||
      existing.some((h, idx) => h !== expected[idx]);
    if (mismatch) {
      throw new Error(
        `CSV header mismatch in ${this.file}\n  expected: ${expected.join(',')}\n  found:    ${existing.join(',')}`,
      );
    }
  }

  // Append one record (object keyed by header). Serialized per file so two
  // requests can never corrupt the append.
  append(record) {
    const values = this.header.map((h) => record[h]);
    return serialize(this.file, async () => {
      await fsp.appendFile(this.file, toRow(values), 'utf8');
    });
  }

  // Read all records. Reads are queued behind writes so a reader never sees a
  // torn line mid-append.
  readAll() {
    return serialize(this.file, async () => {
      const text = await fsp.readFile(this.file, 'utf8').catch(() => '');
      return parseCsv(text).records;
    });
  }

  // Copy the current file to data/backups with a timestamped name.
  async backup(backupDir) {
    return serialize(this.file, async () => {
      await fsp.mkdir(backupDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const base = path.basename(this.file, '.csv');
      const dest = path.join(backupDir, `${base}-${stamp}.csv`);
      await fsp.copyFile(this.file, dest);
      return dest;
    });
  }
}

// Build an Excel-friendly CSV string (UTF-8 BOM + header + rows) from records.
export function buildCsvExport(header, records) {
  let out = BOM + toRow(header);
  for (const rec of records) {
    out += toRow(header.map((h) => rec[h]));
  }
  return out;
}
