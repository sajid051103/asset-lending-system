const express = require('express');
const { query } = require('../../db/pool');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// Small helper — logs a row into loan_events (the immutable timeline).
// Same pattern as loans.js — kept local here since alerts.js doesn't
// import from loans.js (no cross-router coupling).
async function logEvent(loan_id, event_type, actor_id, note = null) {
  await query(
    `INSERT INTO loan_events (loan_id, event_type, actor_id, note)
     VALUES ($1, $2, $3, $4)`,
    [loan_id, event_type, actor_id, note]
  );
}

// GET /api/alerts — every loan that is Issued, past due, and not dismissed
router.get('/alerts', requireAuth, requireRole('librarian'), async (req, res) => {
  try {
    const result = await query(
      `SELECT loans.*, 
              catalogue_items.title AS item_title, 
              catalogue_items.code AS item_code,
              users.name AS borrower_name,
              (CURRENT_DATE - loans.due_date) AS days_overdue
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
    // Only actually-overdue loans generate an alert in the first place
    // (see the due_date < CURRENT_DATE filter above) — without this check,
    // a not-yet-due loan could be pre-emptively dismissed, and since
    // dismissed_alerts has a UNIQUE(loan_id) constraint, that dismissal
    // would silently suppress the real alert forever once the loan
    // actually became overdue. Checked via SQL (not a JS Date comparison)
    // to stay consistent with CURRENT_DATE everywhere else in the app.
    const overdueCheck = await query(
      `SELECT id FROM loans WHERE id = $1 AND due_date < CURRENT_DATE`,
      [id]
    );
    if (overdueCheck.rows.length === 0) {
      return res.status(409).json({ error: 'Can only dismiss alerts for overdue loans' });
    }

    const result = await query(
      `INSERT INTO dismissed_alerts (loan_id, dismissed_by)
       VALUES ($1, $2)
       RETURNING *`,
      [id, req.user.id]
    );

    // Audit trail — without this, dismissing an alert leaves no trace on
    // the loan's timeline (LoanDetail.jsx's Timeline only reads loan_events,
    // it never joins dismissed_alerts), so who dismissed it and when was
    // otherwise invisible outside directly querying the DB.
    await logEvent(id, 'note', req.user.id, 'Overdue alert dismissed');

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