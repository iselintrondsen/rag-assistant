'use strict';

const express = require('express');
const request = require('supertest');

let consoleLogSpy;

beforeAll(() => {
  consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterAll(() => {
  consoleLogSpy.mockRestore();
});

function createUploadTestApp(overrides = {}) {
  jest.resetModules();

  const mockDb = {
    query: jest.fn(async (sql) => {
      if (sql.includes('INSERT INTO documents')) return { rows: [{ id: 101 }] };
      if (sql.includes('SELECT id, original_name FROM documents')) return { rows: [{ id: 101, original_name: 'old.txt' }] };
      if (sql.includes('SELECT id, original_name, file_type, file_size')) {
        return { rows: [{ id: 101, original_name: 'new.txt', file_type: 'txt', file_size: 123, chunk_count: '1' }] };
      }
      return { rows: [], rowCount: 1 };
    }),
    connect: jest.fn(async () => ({
      query: jest.fn(async () => ({ rows: [], rowCount: 1 })),
      release: jest.fn(),
    })),
  };

  const parseFile = jest.fn(async () => 'Dette er en testtekst med nok innhold.');
  const chunkText = jest.fn(() => ['Chunk 1']);
  const createEmbeddings = jest.fn(async () => [[0.1, 0.2, 0.3]]);

  jest.doMock('../src/config/database', () => overrides.db || mockDb);
  jest.doMock('../src/services/parser', () => ({ parseFile: overrides.parseFile || parseFile }));
  jest.doMock('../src/services/chunker', () => ({ chunkText: overrides.chunkText || chunkText }));
  jest.doMock('../src/services/embeddings', () => ({ createEmbeddings: overrides.createEmbeddings || createEmbeddings }));

  const uploadRouter = require('../src/routes/upload');

  const app = express();
  app.use('/api/upload', uploadRouter);
  app.use((err, _req, res, _next) => {
    res.status(500).json({ error: err.message || 'Ukjent feil' });
  });

  return {
    app,
    mockDb: overrides.db || mockDb,
  };
}

describe('upload routes', () => {
  test('POST /api/upload avviser request uten filer', async () => {
    const { app } = createUploadTestApp();

    const res = await request(app).post('/api/upload');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/ingen filer/i);
  });

  test('POST /api/upload prosesserer gyldig tekstfil', async () => {
    const { app } = createUploadTestApp();

    const res = await request(app)
      .post('/api/upload')
      .attach('documents', Buffer.from('Dette er filinnhold for upload-test.'), {
        filename: 'testfil.txt',
        contentType: 'text/plain',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.documents)).toBe(true);
    expect(res.body.documents[0].chunks).toBe(1);
  });

  test('PUT /api/upload/:id avviser request uten fil', async () => {
    const { app } = createUploadTestApp();

    const res = await request(app).put('/api/upload/101');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/ingen fil/i);
  });

  test('PUT /api/upload/:id oppdaterer dokument og returnerer resultat', async () => {
    const { app, mockDb } = createUploadTestApp();

    const res = await request(app)
      .put('/api/upload/101')
      .attach('document', Buffer.from('Nytt innhold for re-upload.'), {
        filename: 'new.txt',
        contentType: 'text/plain',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const updateCall = mockDb.query.mock.calls.find(([sql]) =>
      typeof sql === 'string' && sql.includes('UPDATE documents')
    );
    expect(updateCall).toBeDefined();
    expect(updateCall[0]).toContain('uploaded_at = NOW()');
  });
});
