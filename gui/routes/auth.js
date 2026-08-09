const express = require('express');
const { authRequired, checkPassword } = require('../lib/auth');

const router = express.Router();

router.get('/session', (req, res) => {
  res.json({
    required: authRequired(),
    authenticated: !authRequired() || !!(req.session && req.session.authenticated),
  });
});

router.post('/login', (req, res) => {
  if (!authRequired()) return res.json({ ok: true });
  const { password } = req.body || {};
  if (!checkPassword(password)) {
    return res.status(401).json({ error: 'Incorrect password' });
  }
  req.session.authenticated = true;
  res.json({ ok: true });
});

router.post('/logout', (req, res) => {
  if (req.session) req.session.destroy(() => {});
  res.json({ ok: true });
});

module.exports = router;
