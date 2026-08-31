const express = require('express');
const { query } = require('../../db/pool');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// POST /api/items — librarian creates a new catalogue item
router.post('/', requireAuth, requireRole('librarian'), async (req, res) => {
  const { title, category, code } = req.body;

  if (!title || !category || !code) {
    return res.status(400).json({ error: 'title, category and code are all required' });
  }

  try {
    const result = await query(
      `INSERT INTO catalogue_items (title, category, code)
       VALUES ($1, $2, $3)
       RETURNING id, title, category, code, is_archived, created_at, updated_at`,
      [title, category, code]
    );
    return res.status(201).json({ item: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'An item with this code already exists' });
    }
    console.error('Create item error:', err);
    return res.status(500).json({ error: 'Something went wrong creating the item' });
  }
});

// GET /api/items — list catalogue items (default: only non-archived)
// Query param ?includeArchived=true shows everything
router.get('/', requireAuth, async (req, res) => {
  const includeArchived = req.query.includeArchived === 'true';

  try {
    const result = includeArchived
      ? await query('SELECT * FROM catalogue_items ORDER BY title ASC')
      : await query('SELECT * FROM catalogue_items WHERE is_archived = false ORDER BY title ASC');

    return res.json({ items: result.rows });
  } catch (err) {
    console.error('List items error:', err);
    return res.status(500).json({ error: 'Something went wrong fetching items' });
  }
});

// GET /api/items/:id — item detail + full loan history (goal 3)
router.get('/:id', requireAuth, async (req, res) => {
  const { id } = req.params;

  try {
    const itemResult = await query('SELECT * FROM catalogue_items WHERE id = $1', [id]);
    const item = itemResult.rows[0];

    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }

    // every loan ever made against this item, newest first
    const loansResult = await query(
      `SELECT loans.*, users.name AS borrower_name, users.email AS borrower_email
       FROM loans
       JOIN users ON users.id = loans.borrower_id
       WHERE loans.item_id = $1
       ORDER BY loans.requested_at DESC`,
      [id]
    );

    return res.json({ item, loans: loansResult.rows });
  } catch (err) {
    console.error('Get item error:', err);
    return res.status(500).json({ error: 'Something went wrong fetching the item' });
  }
});

// PATCH /api/items/:id — librarian edits title/category/code
router.patch('/:id', requireAuth, requireRole('librarian'), async (req, res) => {
  const { id } = req.params;
  const { title, category, code } = req.body;

  if (!title || !category || !code) {
    return res.status(400).json({ error: 'title, category and code are all required' });
  }

  try {
    const result = await query(
      `UPDATE catalogue_items
       SET title = $1, category = $2, code = $3, updated_at = now()
       WHERE id = $4
       RETURNING id, title, category, code, is_archived, created_at, updated_at`,
      [title, category, code, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Item not found' });
    }

    return res.json({ item: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'An item with this code already exists' });
    }
    console.error('Update item error:', err);
    return res.status(500).json({ error: 'Something went wrong updating the item' });
  }
});

// PATCH /api/items/:id/archive — librarian archives an item (goal 2: keeps loan history)
router.patch('/:id/archive', requireAuth, requireRole('librarian'), async (req, res) => {
  const { id } = req.params;

  try {
    const result = await query(
      `UPDATE catalogue_items SET is_archived = true, updated_at = now()
       WHERE id = $1
       RETURNING id, title, category, code, is_archived`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Item not found' });
    }

    return res.json({ item: result.rows[0] });
  } catch (err) {
    console.error('Archive item error:', err);
    return res.status(500).json({ error: 'Something went wrong archiving the item' });
  }
});

// PATCH /api/items/:id/restore — librarian restores an archived item
router.patch('/:id/restore', requireAuth, requireRole('librarian'), async (req, res) => {
  const { id } = req.params;

  try {
    const result = await query(
      `UPDATE catalogue_items SET is_archived = false, updated_at = now()
       WHERE id = $1
       RETURNING id, title, category, code, is_archived`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Item not found' });
    }

    return res.json({ item: result.rows[0] });
  } catch (err) {
    console.error('Restore item error:', err);
    return res.status(500).json({ error: 'Something went wrong restoring the item' });
  }
});

module.exports = router;