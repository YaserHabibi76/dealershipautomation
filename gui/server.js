const fs = require('fs');
const path = require('path');
const express = require('express');
const session = require('express-session');

const authRoutes = require('./routes/auth');
const contactRoutes = require('./routes/contact');
const settingsRoutes = require('./routes/settings');
const dealersRoutes = require('./routes/dealers');
const runRoutes = require('./routes/run');
const resultsRoutes = require('./routes/results');
const { requireAuth, authRequired } = require('./lib/auth');
const { DATA_DIR } = require('./lib/scraperRegistry');

// Ensure the data dir (a mounted persistent disk in production) is usable from the
// first request, even before any route lazily creates a subpath.
fs.mkdirSync(path.join(DATA_DIR, 'contact_form_bot'), { recursive: true });

const app = express();
const PORT = process.env.PORT || 4173;

if (authRequired()) app.set('trust proxy', 1); // needed for secure cookies behind Render's proxy

app.use(express.json({ limit: '10mb' })); // imported CSVs are posted as raw text
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: authRequired() && process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  })
);
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api', authRoutes); // /api/session, /api/login, /api/logout — never gated

app.use('/api/contact', requireAuth, contactRoutes);
app.use('/api/settings', requireAuth, settingsRoutes);
app.use('/api/dealers', requireAuth, dealersRoutes);
app.use('/api/run', requireAuth, runRoutes);
app.use('/api/results', requireAuth, resultsRoutes);

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Internal error' });
});

app.listen(PORT, () => {
  console.log(`Dealer Contact Bot GUI running at http://localhost:${PORT}`);
  if (authRequired()) console.log('Password gate: ON (APP_PASSWORD is set)');
  else console.log('Password gate: OFF (set APP_PASSWORD to require login)');
});
