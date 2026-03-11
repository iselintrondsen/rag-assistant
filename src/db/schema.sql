-- ─────────────────────────────────────────────────────────────────────────────
-- RAG Fagassistent – Databaseskjema
-- Kjør med: psql -U <bruker> -d rag_assistant -f src/db/schema.sql
-- ─────────────────────────────────────────────────────────────────────────────

-- Aktiver pgvector-utvidelsen (krever at den er installert i PostgreSQL)
CREATE EXTENSION IF NOT EXISTS vector;

-- ─────────────────────────────────────────────────────────────────────────────
-- Tabell: documents
-- Lagrer metadata om hvert opplastet dokument.
-- Selve teksten og vektorene lagres i chunks-tabellen.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS documents (
  id            SERIAL PRIMARY KEY,
  filename      VARCHAR(255) NOT NULL,       -- Internt filnavn på disk (unikt)
  original_name VARCHAR(255) NOT NULL,       -- Originalt navn fra bruker
  file_type     VARCHAR(50)  NOT NULL,       -- pdf | docx | txt | md
  file_size     INTEGER,                     -- Størrelse i bytes
  chunk_count   INTEGER      DEFAULT 0,     -- Antall chunks generert fra filen
  uploaded_at   TIMESTAMP    DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Tabell: chunks
-- Lagrer tekstbiter fra dokumentene + OpenAI-embedding-vektorer.
--
-- embedding-kolonnen bruker pgvector-typen vector(1536).
-- 1536 dimensjoner matcher OpenAI text-embedding-3-small.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chunks (
  id            SERIAL PRIMARY KEY,
  document_id   INTEGER      NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chunk_index   INTEGER      NOT NULL,       -- Rekkefølge i originaldokumentet
  content       TEXT         NOT NULL,       -- Selve teksten i chunken
  embedding     vector(1536),                -- OpenAI text-embedding-3-small
  created_at    TIMESTAMP    DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Indeks for vector similarity search (HNSW)
--
-- HNSW (Hierarchical Navigable Small World) gir svært rask approximate nearest
-- neighbor-søk. Vi bruker cosine distance (vector_cosine_ops) fordi OpenAI-
-- embeddings er optimalisert for cosine similarity.
--
-- Alternativ: IVFFlat – raskere å bygge, men tregere ved søk og krever VACUUM.
-- HNSW er bedre for interaktive applikasjoner.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS chunks_embedding_hnsw_idx
  ON chunks USING hnsw (embedding vector_cosine_ops);

-- Vanlig indeks for raske oppslag på document_id (brukes ved sletting/JOIN)
CREATE INDEX IF NOT EXISTS chunks_document_id_idx
  ON chunks (document_id);
