const express = require('express');
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../lib/scraperRegistry');

const router = express.Router();
const CONTACT_PATH = path.join(DATA_DIR, 'contact.json');
const REQUIRED_FIELDS = ['firstName', 'lastName', 'email', 'phone', 'message'];

router.get('/', (req, res) => {
  if (!fs.existsSync(CONTACT_PATH)) {
    return res.json({ firstName: '', lastName: '', email: '', phone: '', message: '' });
  }
  try {
    res.json(JSON.parse(fs.readFileSync(CONTACT_PATH, 'utf8')));
  } catch (e) {
    res.status(500).json({ error: `Could not read contact.json: ${e.message}` });
  }
});

router.put('/', (req, res) => {
  const body = req.body || {};
  const missing = REQUIRED_FIELDS.filter((f) => !String(body[f] || '').trim());
  if (missing.length) {
    return res.status(400).json({ error: `Missing required field(s): ${missing.join(', ')}` });
  }
  const next = {};
  for (const f of REQUIRED_FIELDS) next[f] = String(body[f]).trim();
  fs.mkdirSync(path.dirname(CONTACT_PATH), { recursive: true });
  fs.writeFileSync(CONTACT_PATH, JSON.stringify(next, null, 2) + '\n');
  res.json(next);
});

module.exports = router;
