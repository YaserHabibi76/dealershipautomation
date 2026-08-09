const crypto = require('crypto');

// No APP_PASSWORD set (plain local `npm start`) => no gate at all, so local usage is
// unaffected. Set APP_PASSWORD in the environment (e.g. on Render) to require login.
function authRequired() {
  return !!process.env.APP_PASSWORD;
}

function checkPassword(candidate) {
  const expected = process.env.APP_PASSWORD || '';
  const a = Buffer.from(String(candidate || ''));
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function requireAuth(req, res, next) {
  if (!authRequired() || (req.session && req.session.authenticated)) return next();
  res.status(401).json({ error: 'Not signed in' });
}

module.exports = { authRequired, checkPassword, requireAuth };
