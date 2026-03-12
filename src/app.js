// src/app.js
//
// Hoved-entry-point for Express-applikasjonen.
// Setter opp middleware, ruter og starter HTTP-serveren.

require('dotenv').config();

const Sentry = require('@sentry/node');
const express = require('express');
const path = require('path');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const logger = require('./config/logger');
const uploadRouter = require('./routes/upload');
const chatRouter = require('./routes/chat');
const documentsRouter = require('./routes/documents');
const { sanitizeBody } = require('./middleware/sanitize');
const { requireAuth, requireAdmin, isAdmin, authRouter } = require('./middleware/auth');

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: 0.2,
  });
}

const app = express();
const PORT = process.env.PORT || 3000;

const hasLegacyDbConfig = Boolean(process.env.DB_HOST && process.env.DB_NAME && process.env.DB_USER);
const hasPgDbConfig = Boolean(process.env.PGHOST && process.env.PGDATABASE && process.env.PGUSER);
const hasDatabaseUrl = Boolean(process.env.DATABASE_URL || process.env.DATABASE_PRIVATE_URL);
const hasAnyDbConfig = hasDatabaseUrl || hasLegacyDbConfig || hasPgDbConfig;

const MISSING_ENV = [];
if (!process.env.OPENAI_API_KEY) MISSING_ENV.push('OPENAI_API_KEY');
if (!hasAnyDbConfig) {
  MISSING_ENV.push('DATABASE_URL (eller DB_HOST/DB_NAME/DB_USER, eller PGHOST/PGDATABASE/PGUSER)');
}
if (MISSING_ENV.length > 0) {
  console.error(`❌ Manglende miljøvariabler: ${MISSING_ENV.join(', ')}`);
  console.error('   Kopier .env.example til .env og fyll inn verdiene.');
  process.exit(1);
}

if (!process.env.DB_PASSWORD && !process.env.PGPASSWORD && !hasDatabaseUrl) {
  console.warn('⚠️ DB_PASSWORD/PGPASSWORD er ikke satt – appen kan feile mot PostgreSQL.');
}

if (process.env.NODE_ENV === 'production' && !process.env.ACCESS_PASSWORD) {
  console.warn('⚠️ ACCESS_PASSWORD er ikke satt i produksjon – appen er åpen for alle.');
}

app.use(
  morgan('combined', {
    stream: { write: (msg) => logger.http(msg.trim()) },
  })
);
app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../public')));

app.use(authRouter);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

// Sikkerhet og stabilitet
const chatLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'For mange meldinger. Vent litt og prøv igjen.' },
});

const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'For mange opplastinger. Prøv igjen om en time.' },
});

app.use(requireAuth);

app.use('/api/upload',    requireAdmin, uploadLimiter, sanitizeBody, uploadRouter);
app.use('/api/chat',      chatLimiter,   sanitizeBody, chatRouter);
app.use('/api/documents', sanitizeBody, documentsRouter);

app.get('/', (req, res) => {
  const canManageKb = isAdmin(req);
  const adminModeConfigured = Boolean(process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD.length > 0);
  const authEnabled = Boolean(process.env.ACCESS_PASSWORD && process.env.ACCESS_PASSWORD.length > 0);

  res.render('index', {
    canManageKb,
    adminModeActive: adminModeConfigured && canManageKb,
    authEnabled,
  });
});

app.use((err, _req, res, _next) => {
  const status  = err.status || err.statusCode || 500;
  const message = err.message || 'En ukjent feil oppstod.';
  logger.error(`Uhåndtert feil [${status}]: ${message}`, { stack: err.stack });
  if (process.env.SENTRY_DSN && status >= 500) Sentry.captureException(err);
  res.status(status).json({ error: message });
});

app.listen(PORT, () => {
  logger.info(`IS-217 Universellutforming startet på http://localhost:${PORT}`);
  logger.info(`Modell: ${process.env.CHAT_MODEL || 'gpt-4o-mini'}`);
});

module.exports = app; // Eksporter for testing
