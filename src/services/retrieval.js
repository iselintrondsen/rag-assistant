const db = require('../config/database');
const { createQueryEmbedding } = require('./embeddings');

const TOP_K = 16;
const MIN_SIMILARITY = 0.35;
let groupIdColumnSupported = null;

async function supportsGroupIdColumn() {
  if (groupIdColumnSupported !== null) return groupIdColumnSupported;

  try {
    const result = await db.query(
      `SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'documents'
         AND column_name = 'group_id'
       LIMIT 1`
    );

    groupIdColumnSupported = result.rowCount > 0;
  } catch {
    groupIdColumnSupported = false;
  }

  return groupIdColumnSupported;
}

async function retrieveRelevantChunks(query, topK = TOP_K, groupId = null) {
  const queryEmbedding = await createQueryEmbedding(query);
  const embeddingStr = `[${queryEmbedding.join(',')}]`;
  const useGroupFilter = Boolean(groupId) && await supportsGroupIdColumn();
  const groupFilter = useGroupFilter ? 'AND d.group_id = $3' : '';
  const params = useGroupFilter ? [embeddingStr, topK, groupId] : [embeddingStr, topK];

  const result = await db.query(
    `SELECT
       c.id,
       c.content,
       c.chunk_index,
       d.original_name AS document_name,
       d.id AS document_id,
       1 - (c.embedding <=> $1::vector) AS similarity
     FROM chunks c
     JOIN documents d ON c.document_id = d.id
     WHERE 1=1 ${groupFilter}
     ORDER BY c.embedding <=> $1::vector
     LIMIT $2`,
    params
  );

  return result.rows;
}

async function retrieveWithMultipleQueries(queries, topK = TOP_K, groupId = null) {
  const allResults = await Promise.all(
    queries.map((q) => retrieveRelevantChunks(q, topK, groupId))
  );

  const best = new Map();

  for (const results of allResults) {
    for (const chunk of results) {
      const existing = best.get(chunk.id);
      if (!existing || parseFloat(chunk.similarity) > parseFloat(existing.similarity)) {
        best.set(chunk.id, chunk);
      }
    }
  }

  return Array.from(best.values())
    .sort((a, b) => parseFloat(b.similarity) - parseFloat(a.similarity))
    .slice(0, topK);
}

async function retrieveRecentChunks(limit = TOP_K, groupId = null) {
  const useGroupFilter = Boolean(groupId) && await supportsGroupIdColumn();
  const groupFilter = useGroupFilter ? 'WHERE d.group_id = $2' : '';
  const params = useGroupFilter ? [limit, groupId] : [limit];

  const result = await db.query(
    `SELECT
       c.id,
       c.content,
       c.chunk_index,
       d.original_name AS document_name,
       d.id AS document_id,
       0.0 AS similarity
     FROM chunks c
     JOIN documents d ON c.document_id = d.id
     ${groupFilter}
     ORDER BY d.uploaded_at DESC, c.chunk_index ASC
     LIMIT $1`,
    params
  );

  return result.rows;
}

async function findDocumentByName(documentName, groupId = null) {
  if (!documentName || typeof documentName !== 'string') return null;

  const trimmed = documentName.trim();
  if (!trimmed) return null;

  const useGroupFilter = Boolean(groupId) && await supportsGroupIdColumn();
  const paramsExact = useGroupFilter ? [trimmed, groupId] : [trimmed];
  const groupFilter = useGroupFilter ? 'AND group_id = $2' : '';

  const exact = await db.query(
    `SELECT id, original_name, uploaded_at
     FROM documents
     WHERE lower(original_name) = lower($1)
     ${groupFilter}
     ORDER BY uploaded_at DESC
     LIMIT 1`,
    paramsExact
  );
  if (exact.rows.length > 0) return exact.rows[0];

  const likeTerm = `%${trimmed}%`;
  const paramsLike = useGroupFilter ? [likeTerm, groupId] : [likeTerm];
  const like = await db.query(
    `SELECT id, original_name, uploaded_at
     FROM documents
     WHERE lower(original_name) LIKE lower($1)
     ${groupFilter}
     ORDER BY uploaded_at DESC
     LIMIT 1`,
    paramsLike
  );

  return like.rows[0] || null;
}

async function getLatestDocument(groupId = null) {
  const useGroupFilter = Boolean(groupId) && await supportsGroupIdColumn();
  const groupFilter = useGroupFilter ? 'WHERE group_id = $1' : '';
  const params = useGroupFilter ? [groupId] : [];

  const result = await db.query(
    `SELECT id, original_name, uploaded_at
     FROM documents
     ${groupFilter}
     ORDER BY uploaded_at DESC
     LIMIT 1`,
    params
  );

  return result.rows[0] || null;
}

async function retrieveChunksForDocument(documentId, limit = TOP_K) {
  const result = await db.query(
    `SELECT
       c.id,
       c.content,
       c.chunk_index,
       d.original_name AS document_name,
       d.id AS document_id,
       1.0 AS similarity
     FROM chunks c
     JOIN documents d ON c.document_id = d.id
     WHERE c.document_id = $1
     ORDER BY c.chunk_index ASC
     LIMIT $2`,
    [documentId, limit]
  );

  return result.rows;
}

async function retrieveRelevantChunksInDocument(query, documentId, topK = TOP_K) {
  const queryEmbedding = await createQueryEmbedding(query);
  const embeddingStr = `[${queryEmbedding.join(',')}]`;

  const result = await db.query(
    `SELECT
       c.id,
       c.content,
       c.chunk_index,
       d.original_name AS document_name,
       d.id AS document_id,
       1 - (c.embedding <=> $1::vector) AS similarity
     FROM chunks c
     JOIN documents d ON c.document_id = d.id
     WHERE c.document_id = $2
     ORDER BY c.embedding <=> $1::vector
     LIMIT $3`,
    [embeddingStr, documentId, topK]
  );

  return result.rows;
}

function hasStrongEnoughContext(chunks) {
  if (!chunks || chunks.length === 0) return false;
  return chunks.some((c) => parseFloat(c.similarity) >= MIN_SIMILARITY);
}

module.exports = {
  retrieveRelevantChunks,
  retrieveWithMultipleQueries,
  retrieveRecentChunks,
  findDocumentByName,
  retrieveChunksForDocument,
  retrieveRelevantChunksInDocument,
  getLatestDocument,
  hasStrongEnoughContext,
  TOP_K,
  MIN_SIMILARITY,
};
