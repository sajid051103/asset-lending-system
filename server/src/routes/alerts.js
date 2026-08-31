const express = require('express');
const { query } = require('../../db/pool');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/alerts — every loan that is Issued, past due, and not dismissed
router.get('/alerts', requireAuth, requireRole('librarian'), async (req, res) => {
  try {
    const result = await query(
      `SELECT loans.*, 
              catalogue_items.title AS item_title, 
              catalogue_items.code AS item_code,
              users.name AS borrower_name
       FROM loans
       JOIN catalogue_items ON catalogue_items.id = loans.item_id
       JOIN users ON users.id = loans.borrower_id
       LEFT JOIN dismissed_alerts ON dismissed_alerts.loan_id = loans.id
       WHERE loans.status = 'issued'
         AND loans.due_date < CURRENT_DATE
         AND dismissed_alerts.id IS NULL
       ORDER BY loans.due_date ASC`
    );

    return res.json({ alerts: result.rows, count: result.rows.length });
  } catch (err) {
    console.error('Get alerts error:', err);
    return res.status(500).json({ error: 'Something went wrong fetching alerts' });
  }
});

// POST /api/loans/:id/dismiss-alert — librarian dismisses the alert for one loan
router.post('/loans/:id/dismiss-alert', requireAuth, requireRole('librarian'), async (req, res) => {
  const { id } = req.params;

  try {
    const loanResult = await query('SELECT * FROM loans WHERE id = $1', [id]);
    const loan = loanResult.rows[0];

    if (!loan) {
      return res.status(404).json({ error: 'Loan not found' });
    }
    if (loan.status !== 'issued') {
      return res.status(409).json({ error: 'Can only dismiss alerts for issued loans' });
    }

    const result = await query(
      `INSERT INTO dismissed_alerts (loan_id, dismissed_by)
       VALUES ($1, $2)
       RETURNING *`,
      [id, req.user.id]
    );

    return res.status(201).json({ dismissed: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'This alert is already dismissed' });
    }
    console.error('Dismiss alert error:', err);
    return res.status(500).json({ error: 'Something went wrong dismissing the alert' });
  }
});

module.exports = router;