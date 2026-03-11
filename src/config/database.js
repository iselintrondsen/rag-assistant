// src/config/database.js
//
// Deler én pg.Pool gjennom hele applikasjonen.
// Pool-mønsteret lar Node.js gjenbruke databasetilkoblinger i stedet for å
// åpne én ny per request – viktig for ytelse under flerbrukerbelastning.

require('dotenv').config();
const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || process.env.DATABASE_PRIVATE_URL;
const DB_SSL = String(process.env.DB_SSL || '').toLowerCase();
const USE_SSL = DB_SSL === 'true' || DB_SSL === '1' || DB_SSL === 'require';

const basePoolConfig = {
  // Maks antall samtidige tilkoblinger i poolen
  max: 10,
  // Hvor lenge en inaktiv tilkobling holdes åpen (ms)
  idleTimeoutMillis: 30000,
  // Maks ventetid for å få en ledig tilkobling (ms)
  connectionTimeoutMillis: 5000,
};

const connectionConfig = DATABASE_URL
  ? {
      connectionString: DATABASE_URL,
      ...(USE_SSL ? { ssl: { rejectUnauthorized: false } } : {}),
    }
  : {
      host: process.env.DB_HOST || process.env.PGHOST || 'localhost',
      port: parseInt(process.env.DB_PORT || process.env.PGPORT || '5432', 10),
      database: process.env.DB_NAME || process.env.PGDATABASE || 'rag_assistant',
      user: process.env.DB_USER || process.env.PGUSER || 'postgres',
      password: process.env.DB_PASSWORD || process.env.PGPASSWORD || '',
      ...(USE_SSL ? { ssl: { rejectUnauthorized: false } } : {}),
    };

const pool = new Pool({
  ...connectionConfig,
  ...basePoolConfig,
});

pool.on('connect', () => {
  console.log('✅ Ny databasetilkobling opprettet');
});

pool.on('error', (err) => {
  console.error('❌ Uventet databasefeil:', err.message);
});

module.exports = pool;
