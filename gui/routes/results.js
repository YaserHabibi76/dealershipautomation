const express = require('express');
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../lib/scraperRegistry');
const { readCsvFile, buildRetryRows, writeCsvFile, listBrandCsvs } = require('../lib/csvUtils');

const router = express.Router();
const BOT_DATA_DIR = path.join(DATA_DIR, 'contact_form_bot');
const RESULT_COLUMNS = ['name', 'city', 'url', 'status', 'notes'];

function isResultsShaped(filePath) {
  try {
    const rows = readCsvFile(filePath);
    if (!rows.length) return false;
    const headers = Object.keys(rows[0]);
    return RESULT_COLUMNS.every((c) => headers.includes(c));
  } catch {
    return false;
  }
}

function scanResultsFiles() {
  const out = [];
  for (const dir of [BOT_DATA_DIR, DATA_DIR]) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.toLowerCase().endsWith('.csv')) continue;
      const filePath = path.join(dir, f);
      if (!isResultsShaped(filePath)) continue;
      const stat = fs.statSync(filePath);
      const rows = readCsvFile(filePath);
      const counts = {};
      for (const r of rows) counts[r.status] = (counts[r.status] || 0) + 1;
      out.push({ file: filePath, name: f, updatedAt: stat.mtime.toISOString(), rowCount: rows.length, counts });
    }
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function resolveExisting(filePath) {
  if (!filePath) throw new Error('file is required');
  if (path.isAbsolute(filePath)) {
    if (fs.existsSync(filePath)) return filePath;
    throw new Error(`File not found: ${filePath}`);
  }
  if (filePath.includes('..')) throw new Error('Invalid file path');
  for (const dir of [BOT_DATA_DIR, DATA_DIR]) {
    const candidate = path.join(dir, filePath);
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`File not found: ${filePath}`);
}

router.get('/list', (req, res) => {
  res.json({ files: scanResultsFiles() });
});

router.get('/', (req, res) => {
  try {
    const filePath = resolveExisting(req.query.file);
    const rows = readCsvFile(filePath);
    const counts = {};
    for (const r of rows) counts[r.status] = (counts[r.status] || 0) + 1;
    res.json({ file: filePath, rows, counts });
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

router.post('/retry', (req, res) => {
  const { resultsFile, inputCsv } = req.body || {};
  let resolvedResults;
  let resolvedInput;

  try {
    resolvedResults = resolveExisting(resultsFile);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  if (inputCsv) {
    try {
      resolvedInput = resolveExisting(inputCsv);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
  } else {
    const metaPath = `${resolvedResults}.meta.json`;
    if (fs.existsSync(metaPath)) {
      try {
        resolvedInput = JSON.parse(fs.readFileSync(metaPath, 'utf8')).inputCsv;
        if (resolvedInput && !fs.existsSync(resolvedInput)) resolvedInput = null;
      } catch {}
    }

    // Legacy results files (predating the GUI, e.g. chevrolet_NOT_sent.csv) never got a
    // sidecar — fall back to matching a known brand's dealer-list CSV against the
    // results filename (e.g. "chevrolet_NOT_sent.csv" -> the "chevrolet" brand CSV).
    if (!resolvedInput) {
      const resultsName = path.basename(resolvedResults).toLowerCase();
      const candidate = listBrandCsvs(DATA_DIR)
        .sort((a, b) => b.brand.length - a.brand.length)
        .find(({ brand }) => resultsName.includes(brand));
      if (candidate) resolvedInput = candidate.path;
    }
  }

  if (!resolvedInput || !fs.existsSync(resolvedInput)) {
    return res.status(400).json({
      error:
        'Could not determine which dealer-list CSV this results file came from (no .meta.json sidecar, and the ' +
        'filename doesn\'t match a known brand). Pass inputCsv explicitly.',
    });
  }

  const resultRows = readCsvFile(resolvedResults);
  const inputRows = readCsvFile(resolvedInput);
  const { retryRows, unmatched } = buildRetryRows(resultRows, inputRows);

  if (!retryRows.length) {
    return res.status(400).json({ error: 'Nothing to retry — no non-SUBMITTED rows matched an input dealer.' });
  }

  const brandGuess = path
    .basename(resolvedResults)
    .replace(/\.csv$/i, '')
    .replace(/[^a-z0-9-]/gi, '-')
    .toLowerCase();
  const outPath = path.join(DATA_DIR, `retry-${brandGuess}-${Date.now()}.csv`);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  writeCsvFile(outPath, retryRows, ['Dealership Name', 'City', 'Website', 'Contact Page URL']);

  res.json({ file: outPath, rowCount: retryRows.length, unmatched });
});

module.exports = router;
