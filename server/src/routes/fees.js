const express = require('express');
const { query } = require('../../db/pool');
const { requireAuth, requireRole } = require('../middleware/auth');

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

// GET /:id/fees — view all fees charged against a loan
router.get('/:id/fees', requireAuth, async (req, res) => {
  const { id } = req.params;

  try {
    const loanResult = await query('SELECT * FROM loans WHERE id = $1', [id]);
    const loan = loanResult.rows[0];

    if (!loan) {
      return res.status(404).json({ error: 'Loan not found' });
    }

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

// PATCH /:id/fees/:feeId/waive — librarian waives a fee
// Fills a gap where the schema tracks `waived` but nothing could ever set it.
router.patch('/:id/fees/:feeId/waive', requireAuth, requireRole('librarian'), async (req, res) => {
  const { id, feeId } = req.params;

  try {
    const feeResult = await query(
      'SELECT * FROM fees WHERE id = $1 AND loan_id = $2',
      [feeId, id]
    );
    const fee = feeResult.rows[0];

    if (!fee) {
      return res.status(404).json({ error: 'Fee not found on this loan' });
    }
    if (fee.waived) {
      return res.status(409).json({ error: 'This fee is already waived' });
    }

    const result = await query(
      'UPDATE fees SET waived = true WHERE id = $1 RETURNING *',
      [feeId]
    );

    return res.json({ fee: result.rows[0] });
  } catch (err) {
    console.error('Waive fee error:', err);
    return res.status(500).json({ error: 'Something went wrong waiving this fee' });
  }
});

module.exports = {
  router,
  chargeLateFeeIfNeeded,
  chargeReplacementFee,
  LATE_FEE_PER_DAY,
  REPLACEMENT_CHARGE,
};