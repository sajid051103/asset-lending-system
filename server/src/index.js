require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { pool } = require('../db/pool');

const app = express();

app.use(cors());

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

const port = process.env.PORT || 4000;

pool.query('SELECT NOW()')
  .then(() => {
    console.log('Database connection successful');
  })
  .catch((error) => {
    console.error('Database connection failed:', error.message);
  });

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
