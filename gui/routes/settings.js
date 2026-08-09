const express = require('express');
const { readConfig, writeConfig } = require('../lib/config');

const router = express.Router();

function publicView(cfg) {
  return {
    hasKey: !!(cfg.capsolverApiKey && cfg.capsolverApiKey !== 'YOUR_KEY_HERE'),
    headlessDefault: cfg.headlessDefault !== false,
  };
}

router.get('/', (req, res) => {
  res.json(publicView(readConfig()));
});

router.put('/', (req, res) => {
  const body = req.body || {};
  const patch = {};
  if (typeof body.capsolverApiKey === 'string' && body.capsolverApiKey.trim()) {
    patch.capsolverApiKey = body.capsolverApiKey.trim();
  }
  if (typeof body.headlessDefault === 'boolean') {
    patch.headlessDefault = body.headlessDefault;
  }
  res.json(publicView(writeConfig(patch)));
});

module.exports = router;
