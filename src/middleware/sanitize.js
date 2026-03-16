'use strict';

function escapeHtml(value) {
  return value
    .replace(/\0/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function sanitizeDeep(value) {
  if (typeof value === 'string') return escapeHtml(value);
  if (Array.isArray(value)) return value.map(sanitizeDeep);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = sanitizeDeep(val);
    }
    return out;
  }
  return value;
}

function sanitizeBody(req, _res, next) {
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeDeep(req.body);
  }
  next();
}

function validateUploadRequest(req, res, next) {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'Ingen filer ble lastet opp.' });
  }

  const allowedMimeTypes = new Set([
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'text/markdown',
    'text/x-markdown',
    'application/octet-stream',
  ]);

  const allowedExtensions = new Set(['pdf', 'docx', 'txt', 'md']);

  for (const file of req.files) {
    const originalName = typeof file.originalname === 'string' ? file.originalname : '';
    const ext = originalName.includes('.')
      ? originalName.split('.').pop().toLowerCase()
      : '';

    const hasAllowedExtension = allowedExtensions.has(ext);
    const hasAllowedMimeType = allowedMimeTypes.has(file.mimetype);

    if (!hasAllowedExtension && !hasAllowedMimeType) {
      return res.status(415).json({
        error: `Filtypen "${file.mimetype}" støttes ikke. Tillatte typer: PDF, DOCX, TXT, MD.`,
      });
    }

    if (file.size > 50 * 1024 * 1024) {
      return res.status(413).json({
        error: `Filen "${file.originalname}" er for stor (maks 50 MB).`,
      });
    }
  }

  next();
}

module.exports = { sanitizeBody, validateUploadRequest };
