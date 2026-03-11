// src/routes/documents.js
//
// GET    /api/documents        – List alle dokumenter i kunnskapsbasen
// DELETE /api/documents/:id    – Slett et dokument (chunks slettes via CASCADE)
//
// Disse endepunktene brukes av frontend til å vise og administrere
// kunnskapsbasen.

const express = require('express');
const router  = express.Router();
const db      = require('../config/database');

// ── GET /api/documents ────────────────────────────────────────────────────────

router.get('/', async (_req, res) => {
  try {
    const result = await db.query(
      `SELECT
         id,
         original_name,
         file_type,
         file_size,
         chunk_count,
         uploaded_at
       FROM documents
       ORDER BY uploaded_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[documents] Feil ved listing:', err.message);
    res.status(500).json({ error: 'Kunne ikke hente dokumentlisten.' });
  }
});

// ── DELETE /api/documents/:id ─────────────────────────────────────────────────

router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);

  if (isNaN(id) || id <= 0) {
    return res.status(400).json({ error: 'Ugyldig dokument-ID.' });
  }

  try {
    // ON DELETE CASCADE i schema.sql sørger for at alle tilknyttede chunks
    // automatisk slettes når dokumentet slettes.
    const result = await db.query(
      `DELETE FROM documents WHERE id = $1 RETURNING original_name`,
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Dokument ikke funnet.' });
    }

    return res.json({
      success: true,
      deleted: result.rows[0].original_name,
    });
  } catch (err) {
    console.error('[documents] Feil ved sletting:', err.message);
    return res.status(500).json({ error: 'Kunne ikke slette dokumentet.' });
  }
});

module.exports = router;
