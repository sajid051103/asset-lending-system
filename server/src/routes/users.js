const express = require('express');
const { query } = require('../../db/pool');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/users?role=member  -> list every member (id, name, email)
// GET /api/users?role=librarian -> list every librarian (id, name, email)
// Librarian-only: members don't need to see the user list, and this avoids
// leaking every user's email/name to any logged-in account.
//
// Used by the frontend to populate dropdowns, e.g. picking a borrower when
// a librarian creates a loan directly (goal 3), or picking a librarian when
// assigning a custodian (goal 5).
router.get('/', requireAuth, requireRole('librarian'), async (req, res) => {
  const { role } = req.query;

  if (role !== 'member' && role !== 'librarian') {
    return res.status(400).json({ error: 'role query param must be "member" or "librarian"' });
  }

  try {
    const result = await query(
      `SELECT id, name, email FROM users WHERE role = $1 ORDER BY name ASC`,
      [role]
    );

    return res.json({ users: result.rows });
  } catch (err) {
    console.error('List users error:', err);
    return res.status(500).json({ error: 'Something went wrong fetching users' });
  }
});

module.exports = router;