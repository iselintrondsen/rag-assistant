// src/services/embeddings.js
//
// Ansvar: Lage vektorrepresentasjoner (embeddings) av tekst via OpenAI API.
//
// Modell: text-embedding-3-small
//   - 1536 dimensjoner (matcher schema.sql)
//   - Billigst og raskest av OpenAIs embedding-modeller
//   - God nok kvalitet for de fleste norsk/engelsk fagtekst
//   - Alternativ: text-embedding-3-large (3072 dim, bedre, dyrere)
//
// Batching:
//   Vi sender BATCH_SIZE tekster per API-kall for å unngå rate limits
//   og timeout ved store dokumenter.

require('dotenv').config();
const OpenAI = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMENSIONS = 1536;

// OpenAI støtter opptil 2048 inputs per kall, men 100 er trygt
const BATCH_SIZE = 100;

/**
 * Lager embeddings for en liste med tekster (batched).
 *
 * @param {string[]} texts - Array med tekststrenger
 * @returns {Promise<number[][]>} - Array av embedding-vektorer (float[1536])
 */
async function createEmbeddings(texts) {
  if (!texts || texts.length === 0) return [];

  const allEmbeddings = [];

  // Del opp i batches og kall API for hver batch
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);

    // Tomme strenger vil krasje API-et
    const cleanBatch = batch.map(t => t.replace(/\n/g, ' ').trim() || ' ');

    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: cleanBatch,
    });

    // API returnerer ikke nødvendigvis i samme rekkefølge – sorter på index
    const batchEmbeddings = response.data
      .sort((a, b) => a.index - b.index)
      .map(item => item.embedding);

    allEmbeddings.push(...batchEmbeddings);

    // Enkel rate limit-beskyttelse ved store batches
    if (i + BATCH_SIZE < texts.length) {
      await sleep(200);
    }
  }

  return allEmbeddings;
}

/**
 * Lager embedding for én enkelt tekst.
 * Brukes ved chat-spørringer der vi bare har én tekst.
 *
 * @param {string} text - Tekststreng
 * @returns {Promise<number[]>} - Embedding-vektor (float[1536])
 */
async function createQueryEmbedding(text) {
  const embeddings = await createEmbeddings([text]);
  return embeddings[0];
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  createEmbeddings,
  createQueryEmbedding,
  EMBEDDING_DIMENSIONS,
};
