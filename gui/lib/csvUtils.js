const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');

const REQUIRED_DEALER_COLUMNS = ['Dealership Name', 'City', 'Website', 'Contact Page URL'];

// Existing dealer-list files use two orderings: "toyota_ontario_dealerships.csv"
// (brand first) and "ontario_chevrolet_dealerships.csv" (ontario first).
const DEALER_FILE_PATTERNS = [/^(.+)_ontario_dealerships\.csv$/i, /^ontario_(.+)_dealerships\.csv$/i];

function brandFromFilename(f) {
  for (const re of DEALER_FILE_PATTERNS) {
    const m = re.exec(f);
    if (m) return m[1].toLowerCase();
  }
  return null;
}

// {brand, file, path} for every root-level dealer-list CSV, regardless of naming order.
function listBrandCsvs(rootDir) {
  if (!fs.existsSync(rootDir)) return [];
  return fs
    .readdirSync(rootDir)
    .map((f) => ({ f, brand: brandFromFilename(f) }))
    .filter(({ brand }) => brand)
    .map(({ f, brand }) => ({ brand, file: f, path: path.join(rootDir, f) }));
}

function readCsvFile(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return parse(fs.readFileSync(filePath), { columns: true, skip_empty_lines: true });
}

function validateDealerCsv(text) {
  const rows = parse(text, { columns: true, skip_empty_lines: true });
  const headers = rows.length ? Object.keys(rows[0]) : [];
  const missing = REQUIRED_DEALER_COLUMNS.filter((c) => !headers.includes(c));
  if (missing.length) {
    throw new Error(`CSV is missing required column(s): ${missing.join(', ')}`);
  }
  return rows;
}

function writeCsvFile(filePath, rows, columns) {
  fs.writeFileSync(filePath, stringify(rows, { header: true, columns }));
}

// Results CSVs (name/city/url/status/notes) don't carry a Website column, so retrying
// failed dealers means re-joining back against the original input CSV to recover it —
// the same thing chevrolet_retry_batch.csv did by hand before this GUI existed.
function buildRetryRows(resultRows, inputRows) {
  const byName = new Map();
  for (const row of inputRows) {
    const key = row['Dealership Name'];
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(row);
  }

  const retryRows = [];
  const unmatched = [];

  for (const r of resultRows) {
    if (r.status === 'SUBMITTED') continue;
    const candidates = byName.get(r.name) || [];
    const match = candidates.length <= 1 ? candidates[0] : candidates.find((c) => c.City === r.city) || candidates[0];

    if (!match) {
      unmatched.push(r.name);
      continue;
    }
    retryRows.push({
      'Dealership Name': match['Dealership Name'],
      City: match.City,
      Website: match.Website,
      'Contact Page URL': match['Contact Page URL'],
    });
  }

  return { retryRows, unmatched };
}

module.exports = {
  REQUIRED_DEALER_COLUMNS,
  readCsvFile,
  validateDealerCsv,
  writeCsvFile,
  buildRetryRows,
  brandFromFilename,
  listBrandCsvs,
};
