require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { pool } = require('../db/pool');

console.log('Loading auth router...');
const authRouter = require('./routes/auth')
console.log('Auth router loaded:', typeof authRouter);
const itemsRouter = require('./routes/items'); 

const loansRouter = require('./routes/loans');
const custodiansRouter = require('./routes/custodians'); 
const bulkRouter = require('./routes/bulk');
const dashboardRouter = require('./routes/dashboard'); 
const alertsRouter = require('./routes/alerts.js');
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
app.use('/api/items', itemsRouter); 
app.use('/api/loans', loansRouter); 
app.use('/api', custodiansRouter); 
app.use('/api/bulk', bulkRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api', alertsRouter);
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