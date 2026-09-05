const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { query } = require('../../db/pool'); 
const { requireAuth, requireRole } = require('../middleware/auth');
const router = express.Router();


router.post('/signup', async (req, res) => {
  const { email, password, name } = req.body;

 
  if (!email || !password || !name) {
    return res.status(400).json({ error: 'email, password and name are all required' });
  }

  try {
    const password_hash = await bcrypt.hash(password, 10);

    const result = await query(
      `INSERT INTO users (email, password_hash, name, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, name, role, created_at`,
      [email, password_hash, name, 'member']
    );

    return res.status(201).json({ user: result.rows[0] });
  } catch (err) {
 
    if (err.code === '23505') {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }
    console.error('Signup error:', err);
    return res.status(500).json({ error: 'Something went wrong creating the account' });
  }
});

// POST /api/auth/create-librarian — only librarians can create librarian accounts.
router.post('/create-librarian', requireAuth, requireRole('librarian'), async (req, res) => {
  const { email, password, name } = req.body;

  if (!email || !password || !name) {
    return res.status(400).json({ error: 'email, password and name are all required' });
  }

  try {
    const password_hash = await bcrypt.hash(password, 10);
    const result = await query(
      `INSERT INTO users (email, password_hash, name, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, name, role, created_at`,
      [email, password_hash, name, 'librarian']
    );

    return res.status(201).json({ user: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }
    console.error('Create librarian error:', err);
    return res.status(500).json({ error: 'Something went wrong creating the librarian account' });
  }
});


router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  try {
    const result = await query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const passwordMatches = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatches) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Something went wrong logging in' });
  }
});

module.exports = router;
