const db = require('../config/database');
const { createQueryEmbedding } = require('./embeddings');

const TOP_K = 16;
const MIN_SIMILARITY = 0.35;

async function retrieveRelevantChunks(query, topK = TOP_K, groupId = null) {
  const queryEmbedding = await createQueryEmbedding(query);
  const embeddingStr = `[${queryEmbedding.join(',')}]`;
  const groupFilter = groupId ? 'AND d.group_id = $3' : '';
  const params = groupId ? [embeddingStr, topK, groupId] : [embeddingStr, topK];

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

function hasStrongEnoughContext(chunks) {
  if (!chunks || chunks.length === 0) return false;
  return chunks.some((c) => parseFloat(c.similarity) >= MIN_SIMILARITY);
}

module.exports = {
  retrieveRelevantChunks,
  retrieveWithMultipleQueries,
  hasStrongEnoughContext,
  TOP_K,
  MIN_SIMILARITY,
};
