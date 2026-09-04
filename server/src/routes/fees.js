const express = require('express');
const { query } = require('../../db/pool');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Fee amounts — kept simple and fixed since the schema doesn't track
// per-item value. Late fee is per day overdue, replacement is flat.
const LATE_FEE_PER_DAY = 10;
const REPLACEMENT_CHARGE = 500;

// Small helper — logs a row into fees
async function addFee(loan_id, fee_type, amount) {
  await query(
    `INSERT INTO fees (loan_id, fee_type, amount) VALUES ($1, $2, $3)`,
    [loan_id, fee_type, amount]
  );
}

// Charges a late fee if the loan came back after its due_date.
//
// daysLate must be computed by Postgres (date - date, both DATE-typed
// under the hood) rather than by diffing JS Date objects. `due_date` is
// a plain DATE column with no timezone attached, so when node-postgres
// turns it into a JS Date it lands on local-server-midnight, not UTC
// midnight — diffing that against a TIMESTAMPTZ like returned_at silently
// drifts by the server's UTC offset. Calendar-date subtraction in SQL
// has no such ambiguity, and it matches the CURRENT_DATE-based "is this
// overdue" rule used everywhere else in the app (alerts.js, dashboard.js).
async function chargeLateFeeIfNeeded(loan_id, daysLate) {
  if (daysLate === null || daysLate === undefined || daysLate <= 0) {
    return null;
  }
  const amount = daysLate * LATE_FEE_PER_DAY;
  await addFee(loan_id, 'late', amount);
  return { days_late: daysLate, amount };
}

// Flat replacement charge, every time an item is marked lost.
async function chargeReplacementFee(loan_id) {
  await addFee(loan_id, 'replacement', REPLACEMENT_CHARGE);
  return REPLACEMENT_CHARGE;
}

// GET /api/loans/:id/fees — view all fees charged against a loan
router.get('/:id/fees', requireAuth, async (req, res) => {
  const { id } = req.params;

  try {
    const loanResult = await query('SELECT * FROM loans WHERE id = $1', [id]);
    const loan = loanResult.rows[0];

    if (!loan) {
      return res.status(404).json({ error: 'Loan not found' });
    }

    // Members can only view fees on their own loans
    if (req.user.role === 'member' && loan.borrower_id !== req.user.id) {
      return res.status(403).json({ error: 'You can only view fees on your own loans' });
    }

    const feesResult = await query(
      `SELECT * FROM fees WHERE loan_id = $1 ORDER BY created_at ASC`,
      [id]
    );

    return res.json({ fees: feesResult.rows });
  } catch (err) {
    console.error('Get fees error:', err);
    return res.status(500).json({ error: 'Something went wrong fetching fees' });
  }
});

module.exports = {
  router,
  chargeLateFeeIfNeeded,
  chargeReplacementFee,
  LATE_FEE_PER_DAY,
  REPLACEMENT_CHARGE,
};
