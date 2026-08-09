const express = require('express');
const fs = require('fs');
const path = require('path');
const { REGISTRY, ROOT, DATA_DIR } = require('../lib/scraperRegistry');
const { readCsvFile, validateDealerCsv, listBrandCsvs } = require('../lib/csvUtils');
const runManager = require('../lib/runManager');

const router = express.Router();

function scanBrands() {
  return listBrandCsvs(DATA_DIR)
    .map(({ brand, file, path: filePath }) => {
      const stat = fs.statSync(filePath);
      let rowCount = 0;
      try {
        rowCount = readCsvFile(filePath).length;
      } catch {}
      return {
        brand,
        label: REGISTRY[brand] ? REGISTRY[brand].label : brand.charAt(0).toUpperCase() + brand.slice(1),
        file,
        path: filePath,
        rowCount,
        updatedAt: stat.mtime.toISOString(),
        hasScraper: !!REGISTRY[brand],
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

router.get('/', (req, res) => {
  res.json({ brands: scanBrands(), runStatus: runManager.getStatus() });
});

router.post('/:brand/scrape', (req, res) => {
  const brand = req.params.brand.toLowerCase();
  const entry = REGISTRY[brand];
  if (!entry) return res.status(404).json({ error: `No scraper registered for "${brand}"` });

  try {
    const status = runManager.start({
      type: 'scrape',
      label: `Scrape ${entry.label} dealers`,
      command: 'node',
      args: [entry.script],
      cwd: ROOT,
      env: { SCRAPE_OUTPUT: entry.output },
    });
    res.json(status);
  } catch (e) {
    res.status(e.code === 'ALREADY_RUNNING' ? 409 : 500).json({ error: e.message });
  }
});

router.post('/import', (req, res) => {
  const { brand, csvText, overwrite } = req.body || {};
  if (!brand || !String(brand).trim()) return res.status(400).json({ error: 'brand is required' });
  if (!csvText || !String(csvText).trim()) return res.status(400).json({ error: 'csvText is required' });

  const safeBrand = String(brand).trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const filePath = path.join(DATA_DIR, `${safeBrand}_ontario_dealerships.csv`);
  if (fs.existsSync(filePath) && !overwrite) {
    return res
      .status(409)
      .json({ error: `${safeBrand}_ontario_dealerships.csv already exists — pass overwrite:true to replace it.` });
  }

  let rows;
  try {
    rows = validateDealerCsv(csvText);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  fs.writeFileSync(filePath, csvText);
  res.json({ brand: safeBrand, file: path.basename(filePath), rowCount: rows.length });
});

module.exports = router;
