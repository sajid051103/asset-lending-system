const { Pool, types } = require('pg');

types.setTypeParser(1082, (value) => value);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 20,
  idleTimeoutMillis: 3000, 
  connectionTimeoutMillis: 5000,
});

const query = (text, params) => pool.query(text, params);

module.exports = { pool, query };
