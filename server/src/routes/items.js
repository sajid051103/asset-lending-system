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

// GET /api/items — list catalogue items (default: only non-archived), paginated
// Query params:
//   ?includeArchived=true  — include archived items
//   ?search=...            — text search over title, category, code (server-side,
//                             so it matches across the whole catalogue, not just
//                             whatever page happens to be loaded)
//   ?page=1&limit=20
//
// Each item also carries has_open_loan (true if it currently has a
// requested/issued loan against it) — the frontend uses this to hide the
// Request button on items a member can't actually request right now,
// instead of letting them click Request and get a 409 back.
router.get('/', requireAuth, async (req, res) => {
  const includeArchived = req.query.includeArchived === 'true';
  const search = req.query.search?.trim();
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100); // cap at 100 per page
  const offset = (page - 1) * limit;

  const conditions = [];
  const params = [];
  let paramIndex = 1;

  if (!includeArchived) {
    conditions.push('catalogue_items.is_archived = false');
  }

  if (search) {
    conditions.push(
      `(catalogue_items.title ILIKE $${paramIndex} OR catalogue_items.category ILIKE $${paramIndex} OR catalogue_items.code ILIKE $${paramIndex})`
    );
    params.push(`%${search}%`);
    paramIndex++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const dataQuery = `
      SELECT catalogue_items.*,
             EXISTS (
               SELECT 1 FROM loans
               WHERE loans.item_id = catalogue_items.id
                 AND loans.status IN ('requested', 'issued')
             ) AS has_open_loan
      FROM catalogue_items
      ${whereClause}
      ORDER BY catalogue_items.title ASC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    const dataParams = [...params, limit, offset];

    const countQuery = `SELECT COUNT(*) AS total FROM catalogue_items ${whereClause}`;

    const [dataResult, countResult] = await Promise.all([
      query(dataQuery, dataParams),
      query(countQuery, params),
    ]);

    const total = parseInt(countResult.rows[0].total, 10);

    return res.json({
      items: dataResult.rows,
      total,
      page,
      totalPages: Math.max(Math.ceil(total / limit), 1),
    });
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

    // Borrower emails are librarian-only (same policy as /api/users) — a
    // member opening an item can see who borrowed it (borrower_name), but
    // not their email address.
    const loans = req.user.role === 'librarian'
      ? loansResult.rows
      : loansResult.rows.map(({ borrower_email, ...loan }) => loan);

    return res.json({ item, loans });
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