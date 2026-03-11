// tests/sanitize.test.js
//
// Unit-tester for input-saniterings-middleware

'use strict';

// Hent sanitize-funksjoner direkte uten å starte Express
const { sanitizeBody, validateUploadRequest } =
  require('../src/middleware/sanitize');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mockReq(body = {}, files = null) {
  return { body, files, path: '/api/chat' };
}

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json   = jest.fn().mockReturnValue(res);
  return res;
}

const next = jest.fn();

beforeEach(() => next.mockClear());

// ─── sanitizeBody ─────────────────────────────────────────────────────────────

describe('sanitizeBody', () => {
  test('fjerner HTML-tegn fra strenger', () => {
    const req = mockReq({ message: '<script>alert(1)</script>' });
    sanitizeBody(req, mockRes(), next);
    expect(req.body.message).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(next).toHaveBeenCalled();
  });

  test('fjerner nullbytes', () => {
    const req = mockReq({ message: 'hei\0verden' });
    sanitizeBody(req, mockRes(), next);
    expect(req.body.message).not.toContain('\0');
    expect(next).toHaveBeenCalled();
  });

  test('håndterer nestede objekter', () => {
    const req = mockReq({ data: { name: '<b>test</b>' } });
    sanitizeBody(req, mockRes(), next);
    expect(req.body.data.name).toBe('&lt;b&gt;test&lt;/b&gt;');
    expect(next).toHaveBeenCalled();
  });

  test('kaller next() selv om body er tomt', () => {
    const req = mockReq({});
    sanitizeBody(req, mockRes(), next);
    expect(next).toHaveBeenCalled();
  });
});

// ─── validateUploadRequest ────────────────────────────────────────────────────

describe('validateUploadRequest', () => {
  test('godtar PDF-fil', () => {
    const req = mockReq({}, [{ mimetype: 'application/pdf', size: 1024, originalname: 'test.pdf' }]);
    validateUploadRequest(req, mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  test('avviser ikke-støttet filtype', () => {
    const req = mockReq({}, [{ mimetype: 'image/png', size: 1024, originalname: 'bilde.png' }]);
    const res = mockRes();
    validateUploadRequest(req, res, next);
    expect(res.status).toHaveBeenCalledWith(415);
    expect(next).not.toHaveBeenCalled();
  });

  test('avviser tom filliste', () => {
    const req = mockReq({}, []);
    const res = mockRes();
    validateUploadRequest(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  test('avviser fil over 50 MB', () => {
    const req = mockReq({}, [{
      mimetype: 'application/pdf',
      size: 51 * 1024 * 1024,
      originalname: 'stor.pdf',
    }]);
    const res = mockRes();
    validateUploadRequest(req, res, next);
    expect(res.status).toHaveBeenCalledWith(413);
    expect(next).not.toHaveBeenCalled();
  });
});
