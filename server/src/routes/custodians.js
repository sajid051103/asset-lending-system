const express = require('express');
const { query } = require('../../db/pool');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// POST /api/items/:itemId/custodians — assign a librarian as custodian
router.post('/items/:itemId/custodians', requireAuth, requireRole('librarian'), async (req, res) => {
  const { itemId } = req.params;
  const { librarian_id } = req.body;

  if (!librarian_id) {
    return res.status(400).json({ error: 'librarian_id is required' });
  }

  try {
    // Confirm the item exists
    const itemResult = await query('SELECT id FROM catalogue_items WHERE id = $1', [itemId]);
    if (itemResult.rows.length === 0) {
      return res.status(404).json({ error: 'Item not found' });
    }

    // Confirm the target user exists and is actually a librarian
    const userResult = await query('SELECT id, role FROM users WHERE id = $1', [librarian_id]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    if (userResult.rows[0].role !== 'librarian') {
      return res.status(400).json({ error: 'Only librarians can be assigned as custodians' });
    }

    const result = await query(
      `INSERT INTO custodians (item_id, librarian_id)
       VALUES ($1, $2)
       RETURNING id, item_id, librarian_id`,
      [itemId, librarian_id]
    );

    return res.status(201).json({ custodian: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'This librarian is already a custodian for this item' });
    }
    console.error('Add custodian error:', err);
    return res.status(500).json({ error: 'Something went wrong assigning the custodian' });
  }
});

// DELETE /api/items/:itemId/custodians/:librarianId — remove a custodian
router.delete('/items/:itemId/custodians/:librarianId', requireAuth, requireRole('librarian'), async (req, res) => {
  const { itemId, librarianId } = req.params;

  try {
    const result = await query(
      `DELETE FROM custodians WHERE item_id = $1 AND librarian_id = $2 RETURNING id`,
      [itemId, librarianId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'This librarian is not a custodian for this item' });
    }

    return res.json({ message: 'Custodian removed' });
  } catch (err) {
    console.error('Remove custodian error:', err);
    return res.status(500).json({ error: 'Something went wrong removing the custodian' });
  }
});

// GET /api/items/:itemId/custodians — list custodians for one item
router.get('/items/:itemId/custodians', requireAuth, async (req, res) => {
  const { itemId } = req.params;

  try {
    const result = await query(
      `SELECT users.id, users.name, users.email
       FROM custodians
       JOIN users ON users.id = custodians.librarian_id
       WHERE custodians.item_id = $1
       ORDER BY users.name ASC`,
      [itemId]
    );

    return res.json({ custodians: result.rows });
  } catch (err) {
    console.error('List custodians error:', err);
    return res.status(500).json({ error: 'Something went wrong fetching custodians' });
  }
});

// GET /api/my-custodianships — logged-in librarian sees every item they're a custodian for
router.get('/my-custodianships', requireAuth, requireRole('librarian'), async (req, res) => {
  try {
    const result = await query(
      `SELECT catalogue_items.*
       FROM custodians
       JOIN catalogue_items ON catalogue_items.id = custodians.item_id
       WHERE custodians.librarian_id = $1
       ORDER BY catalogue_items.title ASC`,
      [req.user.id]
    );

    return res.json({ items: result.rows });
  } catch (err) {
    console.error('My custodianships error:', err);
    return res.status(500).json({ error: 'Something went wrong fetching your custodianships' });
  }
});

module.exports = router;