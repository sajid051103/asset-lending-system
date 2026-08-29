const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 20,
  idleTimeoutMillis: 0, // Connections never timeout due to inactivity
  connectionTimeoutMillis: 2000,
});

const query = (text, params) => pool.query(text, params);

module.exports = { pool, query };
