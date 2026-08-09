const express = require('express');
const fs = require('fs');
const path = require('path');
const runManager = require('../lib/runManager');
const { ROOT, DATA_DIR } = require('../lib/scraperRegistry');
const { CONFIG_PATH } = require('../lib/config');

const router = express.Router();
const BOT_DIR = path.join(ROOT, 'contact_form_bot');
const BOT_SCRIPT = path.join(BOT_DIR, 'index.js');
const DEFAULT_OUT = path.join(DATA_DIR, 'contact_form_bot', 'results.csv');
const CONTACT_PATH = path.join(DATA_DIR, 'contact.json');

// Accepts a brand shorthand ("toyota" -> toyota_ontario_dealerships.csv), a filename
// relative to DATA_DIR (e.g. a retry-*.csv), or an absolute path.
function resolveCsvIn(csvIn) {
  if (!csvIn) throw new Error('csvIn is required');
  if (path.isAbsolute(csvIn)) {
    if (fs.existsSync(csvIn)) return csvIn;
    throw new Error(`File not found: ${csvIn}`);
  }
  if (csvIn.includes('..')) throw new Error('Invalid csvIn path');

  const brandPath = path.join(DATA_DIR, `${csvIn}_ontario_dealerships.csv`);
  if (fs.existsSync(brandPath)) return brandPath;

  const directPath = path.join(DATA_DIR, csvIn);
  if (fs.existsSync(directPath)) return directPath;

  throw new Error(`Could not resolve csvIn "${csvIn}" to an existing CSV file`);
}

function resolveCsvOut(csvOut) {
  if (!csvOut) return DEFAULT_OUT;
  return path.isAbsolute(csvOut) ? csvOut : path.join(DATA_DIR, 'contact_form_bot', csvOut);
}

router.get('/status', (req, res) => {
  res.json(runManager.getStatus());
});

router.get('/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders?.();
  runManager.subscribe(res);
});

router.post('/start', (req, res) => {
  const { csvIn, csvOut, dryRun, headed } = req.body || {};

  let resolvedIn;
  let resolvedOut;
  try {
    resolvedIn = resolveCsvIn(csvIn);
    resolvedOut = resolveCsvOut(csvOut);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  const args = [BOT_SCRIPT, `--csv=${resolvedIn}`, `--out=${resolvedOut}`];
  if (dryRun) args.push('--dry-run');
  if (headed) args.push('--headed');

  try {
    fs.mkdirSync(path.dirname(resolvedOut), { recursive: true });
    const status = runManager.start({
      type: 'bot',
      label: `Run bot on ${path.basename(resolvedIn)}`,
      command: 'node',
      args,
      cwd: BOT_DIR,
      env: { CONTACT_PATH, CAPSOLVER_CONFIG_PATH: CONFIG_PATH },
    });
    // Sidecar recording the input CSV, so "Retry failed" can later re-join it to
    // recover the Website column that results CSVs don't carry.
    fs.writeFileSync(`${resolvedOut}.meta.json`, JSON.stringify({ inputCsv: resolvedIn }, null, 2) + '\n');
    res.json({ ...status, csvIn: resolvedIn, csvOut: resolvedOut });
  } catch (e) {
    res.status(e.code === 'ALREADY_RUNNING' ? 409 : 500).json({ error: e.message });
  }
});

router.post('/stop', (req, res) => {
  res.json({ stopped: runManager.stop() });
});

module.exports = router;
