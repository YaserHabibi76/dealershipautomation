const path = require('path');

// ROOT is always the deployed code checkout (scripts + node_modules) — ephemeral on
// platforms like Render. DATA_DIR is where user data lives (contact.json, config.json,
// dealer/results CSVs, uploads); defaults to ROOT so local behavior is unchanged, but
// can point at a mounted persistent disk (e.g. DATA_DIR=/data) when hosted.
const ROOT = path.resolve(__dirname, '../..');
const DATA_DIR = process.env.DATA_DIR || ROOT;

// Extensible: add a new entry here to wire up a "Scrape now" button for another brand.
const REGISTRY = {
  toyota: {
    label: 'Toyota',
    script: path.join(ROOT, 'scrape_toyota_dealers.js'),
    output: path.join(DATA_DIR, 'toyota_ontario_dealerships.csv'),
  },
  lexus: {
    label: 'Lexus',
    script: path.join(ROOT, 'scrape_lexus_dealers.js'),
    output: path.join(DATA_DIR, 'lexus_ontario_dealerships.csv'),
  },
};

module.exports = { REGISTRY, ROOT, DATA_DIR };
