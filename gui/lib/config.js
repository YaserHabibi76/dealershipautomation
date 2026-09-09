const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./scraperRegistry');

const CONFIG_PATH = path.join(DATA_DIR, 'contact_form_bot', 'config.json');
// Falls back to the CAPSOLVER_API_KEY env var (set in Render's Environment tab,
// same as APP_PASSWORD) so the key survives free-tier disk resets. config.json,
// written via the Settings tab, still overrides this for a one-off session key.
const DEFAULTS = { capsolverApiKey: process.env.CAPSOLVER_API_KEY || 'YOUR_KEY_HERE', headlessDefault: true };

function readConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return { ...DEFAULTS };
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    return { ...DEFAULTS, ...raw };
  } catch {
    return { ...DEFAULTS };
  }
}

function writeConfig(partial) {
  const next = { ...readConfig(), ...partial };
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2) + '\n');
  return next;
}

module.exports = { readConfig, writeConfig, CONFIG_PATH };
