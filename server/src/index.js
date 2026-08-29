require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { pool } = require('../db/pool');

console.log('Loading auth router...');
const authRouter = require('./routes/auth');
console.log('Auth router loaded:', typeof authRouter);

const app = express();

app.use(cors());
app.use(express.json());

// Debug: log all requests FIRST
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

console.log('Mounting auth router at /api/auth');
app.use('/api/auth', authRouter);
console.log('Auth router mounted');

const port = process.env.PORT || 4000;

pool.query('SELECT NOW()')
  .then(() => {
    console.log('Database connection successful');
    app.listen(port, () => {
      console.log(`Server listening on port ${port}`);
    });
  })
  .catch((error) => {
    console.error('Database connection failed:', error.message);
    process.exit(1);
  });