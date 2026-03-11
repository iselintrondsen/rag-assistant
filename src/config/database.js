// src/config/database.js
//
// Deler én pg.Pool gjennom hele applikasjonen.
// Pool-mønsteret lar Node.js gjenbruke databasetilkoblinger i stedet for å
// åpne én ny per request – viktig for ytelse under flerbrukerbelastning.

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME     || 'rag_assistant',
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD || '',
  // Maks antall samtidige tilkoblinger i poolen
  max: 10,
  // Hvor lenge en inaktiv tilkobling holdes åpen (ms)
  idleTimeoutMillis: 30000,
  // Maks ventetid for å få en ledig tilkobling (ms)
  connectionTimeoutMillis: 5000,
});

pool.on('connect', () => {
  console.log('✅ Ny databasetilkobling opprettet');
});

pool.on('error', (err) => {
  console.error('❌ Uventet databasefeil:', err.message);
});

module.exports = pool;
