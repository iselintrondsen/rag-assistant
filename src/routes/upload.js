// src/routes/upload.js
//
// POST /api/upload
//
// Støtter nå opplasting av én eller flere filer samtidig.
//
// Pipeline per fil:
//   1. Multer mottar filen(e) og lagrer dem midlertidig på disk
//   2. Parser leser tekst fra fil (PDF/DOCX/TXT/MD)
//   3. Chunker deler teksten i biter
//   4. Embeddings lager vektorer (batched OpenAI-kall)
//   5. Alt lagres i PostgreSQL (transaksjon)
//   6. Midlertidig fil slettes fra disk
//
// Respons:
//   { documents: [...], errors: [...] }
//   Returnerer 207 Multi-Status hvis noen filer feilet og noen lyktes.

const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');

const router      = express.Router();
const db          = require('../config/database');
const { parseFile }        = require('../services/parser');
const { chunkText }        = require('../services/chunker');
const { createEmbeddings } = require('../services/embeddings');
const { validateUploadRequest } = require('../middleware/sanitize');

// ─── Multer-konfigurasjon ──────────────────────────────────────────────────

const UPLOAD_DIR = path.join(__dirname, '../../uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext    = path.extname(file.originalname).toLowerCase();
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}${ext}`);
  },
});

const ALLOWED_EXTENSIONS = new Set(['.pdf', '.docx', '.txt', '.md']);
const MAX_FILES = 50;

const upload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_EXTENSIONS.has(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Filtype "${ext}" er ikke støttet. Bruk: PDF, DOCX, TXT, MD`));
    }
  },
  limits: {
    fileSize: 20 * 1024 * 1024, // 20 MB per fil
  },
});

// ─── Hjelpefunksjon: prosesser én fil ─────────────────────────────────────────

async function processFile(file) {
  const originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
  const filePath     = file.path;
  const fileType     = path.extname(originalname).slice(1).toLowerCase();
  const { filename, size } = file;

  let documentId = null;

  try {
    // Lagre dokumentmetadata
    const docResult = await db.query(
      `INSERT INTO documents (filename, original_name, file_type, file_size)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [filename, originalname, fileType, size]
    );
    documentId = docResult.rows[0].id;
    console.log(`[upload] Registrert: id=${documentId}, fil="${originalname}"`);

    // Parse tekst
    const text = await parseFile(filePath, fileType);
    if (!text || text.trim().length < 50) {
      throw new Error(
        'Filen ser ut til å være tom eller inneholder for lite tekst. ' +
        'Sjekk at filen ikke er passordbeskyttet eller skannet uten OCR.'
      );
    }

    // Chunk tekst
    const chunks = chunkText(text);
    if (chunks.length === 0) {
      throw new Error('Ingen meningsfull tekst å prosessere etter chunking.');
    }

    // Lag embeddings
    const embeddings = await createEmbeddings(chunks);

    // Lagre i DB (transaksjon)
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      for (let i = 0; i < chunks.length; i++) {
        const embeddingStr = `[${embeddings[i].join(',')}]`;
        await client.query(
          `INSERT INTO chunks (document_id, chunk_index, content, embedding)
           VALUES ($1, $2, $3, $4::vector)`,
          [documentId, i, chunks[i], embeddingStr]
        );
      }
      await client.query(
        `UPDATE documents SET chunk_count = $1 WHERE id = $2`,
        [chunks.length, documentId]
      );
      await client.query('COMMIT');
    } catch (dbErr) {
      await client.query('ROLLBACK');
      throw dbErr;
    } finally {
      client.release();
    }

    // Slett midlertidig fil
    fs.unlinkSync(filePath);

    return {
      success: true,
      document: { id: documentId, name: originalname, type: fileType, chunks: chunks.length },
    };

  } catch (err) {
    console.error(`[upload] Feil for "${file.originalname}":`, err.message);

    // Rydd opp
    if (documentId) {
      await db.query('DELETE FROM documents WHERE id = $1', [documentId]).catch(() => {});
    }
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    return { success: false, name: file.originalname, error: err.message };
  }
}

// ─── Route ────────────────────────────────────────────────────────────────────

// upload.array('documents', MAX_FILES) aksepterer 1–10 filer under feltet 'documents'
router.post('/', upload.array('documents', MAX_FILES), validateUploadRequest, async (req, res) => {
  const files = req.files;

  if (!files || files.length === 0) {
    return res.status(400).json({ error: 'Ingen filer ble lastet opp.' });
  }

  // Prosesser filene sekvensielt for å unngå å treffe OpenAI rate limits
  // ved mange store filer. Sekvensielt gir også jevnere logg-output.
  const results    = [];
  const errors     = [];

  for (const file of files) {
    const result = await processFile(file);
    if (result.success) {
      results.push(result.document);
    } else {
      errors.push({ name: result.name, error: result.error });
    }
  }

  // 207 Multi-Status: noen lyktes, noen feilet
  // 200 OK: alle lyktes
  // 500: ingen lyktes
  if (results.length === 0) {
    return res.status(500).json({
      error: 'Ingen av filene ble prosessert. Sjekk feilmeldingene nedenfor.',
      errors,
    });
  }

  return res.status(results.length < files.length ? 207 : 200).json({
    success: true,
    documents: results,
    errors,
  });
});

// ─── Re-upload / versjonering ─────────────────────────────────────────────────
//
// PUT /api/upload/:id  – Erstatter et eksisterende dokument med en ny versjon.
// Sletter alle gamle chunks og embeddings, prosesserer den nye filen,
// og beholder samme dokument-ID slik at historiske referanser fremdeles gjelder.

router.put('/:id', upload.single('document'), async (req, res) => {
  const docId = parseInt(req.params.id, 10);
  if (isNaN(docId)) {
    return res.status(400).json({ error: 'Ugyldig dokument-ID.' });
  }

  if (!req.file) {
    return res.status(400).json({ error: 'Ingen fil ble lastet opp.' });
  }

  // Sjekk at dokumentet finnes
  const existing = await db.query('SELECT id, original_name FROM documents WHERE id = $1', [docId]);
  if (existing.rows.length === 0) {
    fs.unlinkSync(req.file.path);
    return res.status(404).json({ error: 'Dokumentet ble ikke funnet.' });
  }

  const file         = req.file;
  const originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
  const fileType     = path.extname(originalname).slice(1).toLowerCase();

  try {
    // 1. Slett eksisterende chunks (cascader til embeddings)
    await db.query('DELETE FROM chunks WHERE document_id = $1', [docId]);

    // 2. Oppdater dokumentmetadata
    await db.query(
      `UPDATE documents
         SET original_name = $1, filename = $2, file_type = $3, file_size = $4, created_at = NOW()
       WHERE id = $5`,
      [originalname, file.filename, fileType, file.size, docId]
    );

    // 3. Parse og chunk den nye filen
    const text   = await parseFile(file.path, fileType);
    const chunks = chunkText(text);

    if (chunks.length === 0) {
      throw new Error('Ingen tekst ble funnet i filen.');
    }

    // 4. Lag embeddings og lagre
    const embeddings = await createEmbeddings(chunks);

    for (let i = 0; i < chunks.length; i++) {
      const vector = '[' + embeddings[i].join(',') + ']';
      await db.query(
        `INSERT INTO chunks (document_id, chunk_index, content, embedding)
         VALUES ($1, $2, $3, $4::vector)`,
        [docId, i, chunks[i], vector]
      );
    }

    // 5. Rydd opp midlertidig fil
    fs.unlinkSync(file.path);

    const updated = await db.query(
      `SELECT id, original_name, file_type, file_size,
              (SELECT COUNT(*) FROM chunks WHERE document_id = $1) AS chunk_count
         FROM documents WHERE id = $1`,
      [docId]
    );

    return res.json({ success: true, document: updated.rows[0] });
  } catch (err) {
    if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
