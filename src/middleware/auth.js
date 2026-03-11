'use strict';

const express = require('express');
const crypto = require('crypto');
const router = express.Router();

const PASSWORD = process.env.ACCESS_PASSWORD || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const AUTH_ENABLED = PASSWORD.length > 0;
const ADMIN_AUTH_ENABLED = ADMIN_PASSWORD.length > 0;

function timingSafeEqual(a, b) {
  const expected = Buffer.from(a);
  const actual = Buffer.from(b);
  if (expected.length !== actual.length) {
    crypto.timingSafeEqual(expected, expected);
    return false;
  }
  return crypto.timingSafeEqual(expected, actual);
}

function isAuthenticated(req) {
  if (!AUTH_ENABLED) return true;
  return req.cookies && timingSafeEqual(req.cookies['rag_session'] || '', PASSWORD);
}

function isAdmin(req) {
  if (!ADMIN_AUTH_ENABLED) return true;
  return req.cookies && timingSafeEqual(req.cookies['rag_admin'] || '', ADMIN_PASSWORD);
}

function requireAuth(req, res, next) {
  if (isAuthenticated(req)) return next();

  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Ikke autorisert. Logg inn på /login.' });
  }

  return res.redirect('/login');
}

function requireAdmin(req, res, next) {
  if (isAdmin(req)) return next();
  return res.status(403).json({
    error: 'Kun admin kan endre eller se dokumentbasen.',
  });
}

router.get('/login', (req, res) => {
  if (!AUTH_ENABLED || isAuthenticated(req)) return res.redirect('/');

  res.send(`<!DOCTYPE html>
<html lang="no">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Logg inn – IS-217</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body { font-family: 'Segoe UI', system-ui, sans-serif; background: #f0f2f5; display: flex; align-items: center; justify-content: center; height: 100dvh; margin: 0; }
    .card { background: white; border-radius: 12px; padding: 2rem; width: 100%; max-width: 360px; box-shadow: 0 4px 20px rgba(0,0,0,.1); text-align: center; }
    h1 { font-size: 1.25rem; margin: 0 0 .25rem; }
    p { color: #64748b; font-size: .875rem; margin: 0 0 1.5rem; }
    input { width: 100%; padding: .6rem .875rem; border: 1.5px solid #e2e8f0; border-radius: 8px; font-size: 1rem; outline: none; margin-bottom: .75rem; }
    button { width: 100%; padding: .65rem; background: #0f766e; color: white; border: none; border-radius: 8px; font-size: 1rem; cursor: pointer; }
    .alt-link { display: inline-block; margin-top: .75rem; width: 100%; padding: .62rem; border-radius: 8px; border: 1px solid #d4dee8; color: #334155; text-decoration: none; font-size: .92rem; background: #fff; }
    .alt-link:hover { background: #f8fafc; }
  </style>
</head>
<body>
  <div class="card">
    <h1>IS-217 Universellutforming</h1>
    <p>Velg vanlig innlogging eller admin-innlogging</p>
    <form method="POST" action="/api/auth/login">
      <input type="password" name="password" placeholder="Passord" autofocus required>
      ${req.query.error ? '<p style="color:#ef4444;font-size:.8rem;margin-top:.5rem;">Feil passord. Prøv igjen.</p>' : ''}
      <button type="submit">Logg inn (vanlig)</button>
    </form>
    ${ADMIN_AUTH_ENABLED ? '<a class="alt-link" href="/admin/login">Logg inn som admin</a>' : ''}
  </div>
</body>
</html>`);
});

router.post('/api/auth/login', express.urlencoded({ extended: false }), (req, res) => {
  const { password } = req.body;

  if (!AUTH_ENABLED || timingSafeEqual(password || '', PASSWORD)) {
    res.cookie('rag_session', PASSWORD, {
      httpOnly: true,
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      secure: process.env.NODE_ENV === 'production',
    });
    return res.redirect('/');
  }

  return res.redirect('/login?error=1');
});

router.get('/admin/login', (req, res) => {
  if (!ADMIN_AUTH_ENABLED) return res.redirect('/');
  if (isAdmin(req)) return res.redirect('/');

  res.send(`<!DOCTYPE html>
<html lang="no">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Admin-innlogging – IS-217</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body { font-family: 'Segoe UI', system-ui, sans-serif; background: #eef3f8; display: flex; align-items: center; justify-content: center; height: 100dvh; margin: 0; }
    .card { background: #fff; border: 1px solid #d4dee8; border-radius: 12px; padding: 2rem; width: 100%; max-width: 380px; box-shadow: 0 8px 24px rgba(15,23,42,.08); text-align: center; }
    h1 { font-size: 1.2rem; margin: 0 0 .3rem; color: #0f172a; }
    p { color: #475569; font-size: .9rem; margin: 0 0 1.2rem; }
    input { width: 100%; padding: .6rem .875rem; border: 1.5px solid #d4dee8; border-radius: 8px; font-size: 1rem; outline: none; margin-bottom: .75rem; }
    button { width: 100%; padding: .65rem; background: #0f766e; color: white; border: none; border-radius: 8px; font-size: 1rem; cursor: pointer; }
    .alt-link { display: inline-block; margin-top: .75rem; width: 100%; padding: .62rem; border-radius: 8px; border: 1px solid #d4dee8; color: #334155; text-decoration: none; font-size: .92rem; background: #fff; }
    .alt-link:hover { background: #f8fafc; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Admin-tilgang</h1>
    <p>Skriv inn admin-passord for opplasting og dokumentadministrasjon.</p>
    <form method="POST" action="/api/auth/admin-login">
      <input type="password" name="password" placeholder="Admin-passord" autofocus required>
      ${req.query.error ? '<p style="color:#ef4444;font-size:.8rem;margin-top:.5rem;">Feil passord. Prøv igjen.</p>' : ''}
      <button type="submit">Aktiver admin</button>
    </form>
    <a class="alt-link" href="/login">Til vanlig innlogging</a>
  </div>
</body>
</html>`);
});

router.post('/api/auth/admin-login', express.urlencoded({ extended: false }), (req, res) => {
  if (!ADMIN_AUTH_ENABLED) return res.redirect('/');

  const { password } = req.body;
  if (!timingSafeEqual(password || '', ADMIN_PASSWORD)) {
    return res.redirect('/admin/login?error=1');
  }

  if (AUTH_ENABLED) {
    res.cookie('rag_session', PASSWORD, {
      httpOnly: true,
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      secure: process.env.NODE_ENV === 'production',
    });
  }

  res.cookie('rag_admin', ADMIN_PASSWORD, {
    httpOnly: true,
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    secure: process.env.NODE_ENV === 'production',
  });
  return res.redirect('/');
});

router.get('/api/auth/logout', (req, res) => {
  res.clearCookie('rag_session');
  res.clearCookie('rag_admin');
  return res.redirect('/login');
});

router.get('/api/auth/admin-logout', (req, res) => {
  res.clearCookie('rag_admin');
  return res.redirect('/');
});

module.exports = {
  requireAuth,
  requireAdmin,
  isAdmin,
  authRouter: router,
};
