'use strict';

const express = require('express');
const request = require('supertest');
const cookieParser = require('cookie-parser');

function createTestApp(authModule) {
  const app = express();
  app.use(cookieParser());
  app.use(express.urlencoded({ extended: false }));
  app.use(authModule.authRouter);
  app.get('/api/protected', authModule.requireAuth, (_req, res) => {
    res.json({ ok: true });
  });
  app.get('/api/admin-protected', authModule.requireAdmin, (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

function loadAuthModuleWithEnv(overrides = {}) {
  jest.resetModules();
  const previous = {
    ACCESS_PASSWORD: process.env.ACCESS_PASSWORD,
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
    AUTH_COOKIE_SECRET: process.env.AUTH_COOKIE_SECRET,
    NODE_ENV: process.env.NODE_ENV,
  };

  process.env.ACCESS_PASSWORD = overrides.ACCESS_PASSWORD ?? 'user-pass';
  process.env.ADMIN_PASSWORD = overrides.ADMIN_PASSWORD ?? 'admin-pass';
  process.env.AUTH_COOKIE_SECRET = overrides.AUTH_COOKIE_SECRET ?? 'test-secret';
  process.env.NODE_ENV = overrides.NODE_ENV ?? 'test';

  const authModule = require('../src/middleware/auth');

  return {
    authModule,
    restore: () => {
      process.env.ACCESS_PASSWORD = previous.ACCESS_PASSWORD;
      process.env.ADMIN_PASSWORD = previous.ADMIN_PASSWORD;
      process.env.AUTH_COOKIE_SECRET = previous.AUTH_COOKIE_SECRET;
      process.env.NODE_ENV = previous.NODE_ENV;
    },
  };
}

describe('auth middleware and routes', () => {
  test('avviser tilgang til beskyttet API uten gyldig session-cookie', async () => {
    const { authModule, restore } = loadAuthModuleWithEnv();
    const app = createTestApp(authModule);

    const res = await request(app).get('/api/protected');

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/ikke autorisert/i);
    restore();
  });

  test('vanlig login setter rag_session-cookie og gir tilgang til beskyttet API', async () => {
    const { authModule, restore } = loadAuthModuleWithEnv();
    const app = createTestApp(authModule);

    const loginRes = await request(app)
      .post('/api/auth/login')
      .type('form')
      .send({ password: 'user-pass' });

    expect(loginRes.status).toBe(302);
    expect(loginRes.headers['set-cookie']).toEqual(
      expect.arrayContaining([expect.stringContaining('rag_session=')])
    );

    const sessionCookie = loginRes.headers['set-cookie'].find((c) => c.startsWith('rag_session='));
    const protectedRes = await request(app)
      .get('/api/protected')
      .set('Cookie', sessionCookie);

    expect(protectedRes.status).toBe(200);
    expect(protectedRes.body).toEqual({ ok: true });
    restore();
  });

  test('feil passord gir redirect tilbake til login med feilkode', async () => {
    const { authModule, restore } = loadAuthModuleWithEnv();
    const app = createTestApp(authModule);

    const res = await request(app)
      .post('/api/auth/login')
      .type('form')
      .send({ password: 'wrong-pass' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login?error=1');
    restore();
  });

  test('admin-login setter rag_admin-cookie og gir tilgang til admin-endepunkt', async () => {
    const { authModule, restore } = loadAuthModuleWithEnv();
    const app = createTestApp(authModule);

    const loginRes = await request(app)
      .post('/api/auth/admin-login')
      .type('form')
      .send({ password: 'admin-pass' });

    expect(loginRes.status).toBe(302);
    expect(loginRes.headers['set-cookie']).toEqual(
      expect.arrayContaining([expect.stringContaining('rag_admin=')])
    );

    const adminCookie = loginRes.headers['set-cookie'].find((c) => c.startsWith('rag_admin='));
    const adminRes = await request(app)
      .get('/api/admin-protected')
      .set('Cookie', adminCookie);

    expect(adminRes.status).toBe(200);
    expect(adminRes.body).toEqual({ ok: true });
    restore();
  });
});
