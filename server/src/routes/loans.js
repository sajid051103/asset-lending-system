const express = require('express');
const { query } = require('../../db/pool');
const { requireAuth, requireRole } = require('../middleware/auth');
const transporter = require('../utils/mailer');

const router = express.Router();

// Small helper — logs a row into loan_events (the immutable timeline)
async function logEvent(loan_id, event_type, actor_id, note = null) {
  await query(
    `INSERT INTO loan_events (loan_id, event_type, actor_id, note)
     VALUES ($1, $2, $3, $4)`,
    [loan_id, event_type, actor_id, note]
  );
}

// Fee amounts — kept simple and fixed since the schema doesn't track
// per-item value. Late fee is per day overdue, replacement is flat.
const LATE_FEE_PER_DAY = 10;
const REPLACEMENT_CHARGE = 500;

// STRETCH: per-member borrowing limit — a member can have at most this
// many open (requested/issued) loans at once. Fixed and global, since
// the README only asks for the concept, not per-user customisation.
const MAX_ACTIVE_LOANS_PER_MEMBER = 3;

// Small helper — logs a row into fees (stretch feature: late fees / replacement charges)
async function addFee(loan_id, fee_type, amount) {
  await query(
    `INSERT INTO fees (loan_id, fee_type, amount) VALUES ($1, $2, $3)`,
    [loan_id, fee_type, amount]
  );
}

// POST /api/loans — request or directly create a loan
// Members: creates a "requested" loan (no due date yet)
// Librarians: can also directly create+issue in one step if they pass a due_date
router.post('/', requireAuth, async (req, res) => {
  const { item_id, borrower_id, due_date } = req.body;
  const actor = req.user; // { id, email, role }

  if (!item_id) {
    return res.status(400).json({ error: 'item_id is required' });
  }

  // Guard: if a librarian is directly issuing with a due_date, it can't be in the past
  if (due_date) {
    const today = new Date().toISOString().slice(0, 10);
    if (due_date < today) {
      return res.status(400).json({ error: 'due_date cannot be in the past' });
    }
  }

  // Members can only request for themselves, not on behalf of others
  const finalBorrowerId = actor.role === 'librarian' && borrower_id ? borrower_id : actor.id;

  try {
    // STRETCH: per-member borrowing limit — only enforced when a member
    // is requesting for themselves, not when a librarian creates a loan
    // directly (librarians managing loans on someone's behalf aren't
    // capped by this).
    if (actor.role === 'member') {
      const activeLoanCountResult = await query(
        `SELECT COUNT(*) AS count FROM loans WHERE borrower_id = $1 AND status IN ('requested', 'issued')`,
        [actor.id]
      );
      const activeCount = parseInt(activeLoanCountResult.rows[0].count, 10);

      if (activeCount >= MAX_ACTIVE_LOANS_PER_MEMBER) {
        return res.status(409).json({
          error: `You already have ${activeCount} active loans (limit is ${MAX_ACTIVE_LOANS_PER_MEMBER}). Return an item before requesting another.`,
        });
      }
    }

    // Check the item exists and isn't archived
    const itemResult = await query('SELECT * FROM catalogue_items WHERE id = $1', [item_id]);
    if (itemResult.rows.length === 0) {
      return res.status(404).json({ error: 'Item not found' });
    }

    // Enforce goal 4: no open loan (requested/issued) already exists for this item
    const openLoanResult = await query(
      `SELECT id FROM loans WHERE item_id = $1 AND status IN ('requested', 'issued')`,
      [item_id]
    );
    if (openLoanResult.rows.length > 0) {
      return res.status(409).json({ error: 'This item already has an open loan against it' });
    }

    // Librarian directly issuing: needs a due_date, status starts as issued
    const isDirectIssue = actor.role === 'librarian' && due_date;
    const status = isDirectIssue ? 'issued' : 'requested';

    const result = await query(
      `INSERT INTO loans (item_id, borrower_id, status, due_date, issued_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        item_id,
        finalBorrowerId,
        status,
        isDirectIssue ? due_date : null,
        isDirectIssue ? new Date() : null,
      ]
    );

    const loan = result.rows[0];
    await logEvent(loan.id, isDirectIssue ? 'issued' : 'requested', actor.id);

    return res.status(201).json({ loan });
  } catch (err) {
    // Database backstop: the partial unique index catches races even
    // if our earlier check above missed one (two requests at once)
    if (err.code === '23505' && err.constraint === 'one_open_loan_per_item') {
      return res.status(409).json({ error: 'This item already has an open loan against it' });
    }
    console.error('Create loan error:', err);
    return res.status(500).json({ error: 'Something went wrong creating the loan' });
  }
});

// PATCH /api/loans/:id/issue — librarian issues a "requested" loan
router.patch('/:id/issue', requireAuth, requireRole('librarian'), async (req, res) => {
  const { id } = req.params;
  const { due_date } = req.body;

  if (!due_date) {
    return res.status(400).json({ error: 'due_date is required to issue a loan' });
  }

  // Guard: due_date cannot be in the past
  const today = new Date().toISOString().slice(0, 10);
  if (due_date < today) {
    return res.status(400).json({ error: 'due_date cannot be in the past' });
  }

  try {
    const loanResult = await query('SELECT * FROM loans WHERE id = $1', [id]);
    const loan = loanResult.rows[0];

    if (!loan) {
      return res.status(404).json({ error: 'Loan not found' });
    }
    if (loan.status !== 'requested') {
      return res.status(409).json({
        error: `Cannot issue a loan with status "${loan.status}" — only "requested" loans can be issued`,
      });
    }

    const result = await query(
      `UPDATE loans SET status = 'issued', due_date = $1, issued_at = now()
       WHERE id = $2 RETURNING *`,
      [due_date, id]
    );

    await logEvent(id, 'issued', req.user.id);
    return res.json({ loan: result.rows[0] });
  } catch (err) {
    if (err.code === '23505' && err.constraint === 'one_open_loan_per_item') {
      return res.status(409).json({ error: 'This item already has an open loan against it' });
    }
    console.error('Issue loan error:', err);
    return res.status(500).json({ error: 'Something went wrong issuing the loan' });
  }
});

// PATCH /api/loans/:id/return — librarian processes a return
// STRETCH: if the loan was overdue at return time, automatically add a late fee
router.patch('/:id/return', requireAuth, requireRole('librarian'), async (req, res) => {
  const { id } = req.params;
  const { note } = req.body;

  try {
    const loanResult = await query('SELECT * FROM loans WHERE id = $1', [id]);
    const loan = loanResult.rows[0];

    if (!loan) {
      return res.status(404).json({ error: 'Loan not found' });
    }
    if (loan.status !== 'issued') {
      return res.status(409).json({
        error: `Cannot return a loan with status "${loan.status}" — only "issued" loans can be returned`,
      });
    }

    const result = await query(
      `UPDATE loans SET status = 'returned', returned_at = now()
       WHERE id = $1 RETURNING *`,
      [id]
    );

    const returnedLoan = result.rows[0];
    await logEvent(id, 'returned', req.user.id, note || null);

    // STRETCH: late fee — only if due_date existed and had already passed
    // when the item was returned
    let lateFee = null;
    if (returnedLoan.due_date) {
      const dueDate = new Date(returnedLoan.due_date);
      const returnedAt = new Date(returnedLoan.returned_at);
      const daysLate = Math.floor((returnedAt - dueDate) / (1000 * 60 * 60 * 24));

      if (daysLate > 0) {
        const amount = daysLate * LATE_FEE_PER_DAY;
        await addFee(id, 'late', amount);
        lateFee = { days_late: daysLate, amount };
      }
    }

    return res.json({ loan: returnedLoan, lateFee });
  } catch (err) {
    console.error('Return loan error:', err);
    return res.status(500).json({ error: 'Something went wrong processing the return' });
  }
});

// PATCH /api/loans/:id/lost — librarian marks a loan as lost
// STRETCH: automatically adds a flat replacement charge
router.patch('/:id/lost', requireAuth, requireRole('librarian'), async (req, res) => {
  const { id } = req.params;
  const { note } = req.body;

  try {
    const loanResult = await query('SELECT * FROM loans WHERE id = $1', [id]);
    const loan = loanResult.rows[0];

    if (!loan) {
      return res.status(404).json({ error: 'Loan not found' });
    }
    // Goal 4: lost is only valid while a loan is "issued" (overdue or not)
    if (loan.status !== 'issued') {
      return res.status(409).json({
        error: `Cannot mark a loan with status "${loan.status}" as lost — only "issued" loans can be marked lost`,
      });
    }

    const result = await query(
      `UPDATE loans SET status = 'lost' WHERE id = $1 RETURNING *`,
      [id]
    );

    await logEvent(id, 'lost', req.user.id, note || null);

    // STRETCH: flat replacement charge, every time an item is lost
    await addFee(id, 'replacement', REPLACEMENT_CHARGE);

    return res.json({ loan: result.rows[0], replacementCharge: REPLACEMENT_CHARGE });
  } catch (err) {
    console.error('Mark lost error:', err);
    return res.status(500).json({ error: 'Something went wrong marking the loan lost' });
  }
});

// POST /api/loans/:id/send-reminder — STRETCH: email a reminder to the
// borrower on an issued loan. Librarian-only, matching the pattern used
// by issue/return/lost above (server-enforced role check, not just UI).
router.post('/:id/send-reminder', requireAuth, requireRole('librarian'), async (req, res) => {
  const { id } = req.params;

  try {
    const result = await query(
      `SELECT loans.due_date, catalogue_items.title AS item_title,
              users.email AS borrower_email, users.name AS borrower_name
       FROM loans
       JOIN catalogue_items ON catalogue_items.id = loans.item_id
       JOIN users ON users.id = loans.borrower_id
       WHERE loans.id = $1 AND loans.status = 'issued'`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No issued loan found with this id' });
    }

    const loan = result.rows[0];

    await transporter.sendMail({
      from: `"Library" <${process.env.GMAIL_USER}>`,
      to: loan.borrower_email,
      subject: `Reminder: Return "${loan.item_title}"`,
      text: `Hi ${loan.borrower_name}, this is a reminder that "${loan.item_title}" is due on ${loan.due_date}. Please return it soon.`,
    });

    await logEvent(id, 'note', req.user.id, 'Reminder email sent to borrower');

    return res.json({ success: true, message: 'Reminder sent' });
  } catch (err) {
    console.error('Send reminder error:', err);
    return res.status(500).json({ error: 'Failed to send reminder email' });
  }
});

// GET /api/loans/:id/fees — STRETCH: view all fees charged against a loan
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

// GET /api/loans — search, filter, sort, paginate across all loans
router.get('/', requireAuth, async (req, res) => {
  const {
    search,       // text search over item title + borrower name
    status,       // 'requested' | 'issued' | 'returned' | 'lost'
    item_id,
    borrower_id,
    sortBy = 'requested_at',   // 'due_date' | 'requested_at' | 'status'
    sortOrder = 'desc',        // 'asc' | 'desc'
    page = 1,
    limit = 20,
  } = req.query;

  // Whitelist sortBy/sortOrder so we never interpolate raw user input
  // directly into SQL (prevents SQL injection via these fields).
  const allowedSortColumns = {
    due_date: 'loans.due_date',
    requested_at: 'loans.requested_at',
    status: 'loans.status',
  };
  const sortColumn = allowedSortColumns[sortBy] || 'loans.requested_at';
  const order = sortOrder === 'asc' ? 'ASC' : 'DESC';

  // Members can only ever see their own loans, regardless of filters
  // they pass — this enforces goal 1's "members see their own loans"
  // rule even on this shared search/filter endpoint.
  const restrictToOwn = req.user.role === 'member';

  const conditions = [];
  const params = [];
  let paramIndex = 1;

  if (restrictToOwn) {
    conditions.push(`loans.borrower_id = $${paramIndex++}`);
    params.push(req.user.id);
  }

  if (search) {
    conditions.push(
      `(catalogue_items.title ILIKE $${paramIndex} OR users.name ILIKE $${paramIndex})`
    );
    params.push(`%${search}%`);
    paramIndex++;
  }

  if (status) {
    conditions.push(`loans.status = $${paramIndex++}`);
    params.push(status);
  }

  if (item_id) {
    conditions.push(`loans.item_id = $${paramIndex++}`);
    params.push(item_id);
  }

  if (borrower_id && !restrictToOwn) {
    conditions.push(`loans.borrower_id = $${paramIndex++}`);
    params.push(borrower_id);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.min(parseInt(limit, 10) || 20, 100); // cap at 100 per page
  const offset = (pageNum - 1) * limitNum;

  try {
    // Main data query
    const dataQuery = `
      SELECT loans.*, 
             catalogue_items.title AS item_title, 
             catalogue_items.code AS item_code,
             users.name AS borrower_name, 
             users.email AS borrower_email
      FROM loans
      JOIN catalogue_items ON catalogue_items.id = loans.item_id
      JOIN users ON users.id = loans.borrower_id
      ${whereClause}
      ORDER BY ${sortColumn} ${order}
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    const dataParams = [...params, limitNum, offset];

    // Count query (same filters, no limit/offset) — for pagination total
    const countQuery = `
      SELECT COUNT(*) AS total
      FROM loans
      JOIN catalogue_items ON catalogue_items.id = loans.item_id
      JOIN users ON users.id = loans.borrower_id
      ${whereClause}
    `;

    const [dataResult, countResult] = await Promise.all([
      query(dataQuery, dataParams),
      query(countQuery, params),
    ]);

    const total = parseInt(countResult.rows[0].total, 10);

    return res.json({
      loans: dataResult.rows,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
    });
  } catch (err) {
    console.error('List loans error:', err);
    return res.status(500).json({ error: 'Something went wrong fetching loans' });
  }
});

// GET /api/loans/:id — a single loan with its full timeline (used later for goal 9)
router.get('/:id', requireAuth, async (req, res) => {
  const { id } = req.params;

  try {
    const loanResult = await query(
      `SELECT loans.*, catalogue_items.title AS item_title, catalogue_items.code AS item_code,
              users.name AS borrower_name, users.email AS borrower_email
       FROM loans
       JOIN catalogue_items ON catalogue_items.id = loans.item_id
       JOIN users ON users.id = loans.borrower_id
       WHERE loans.id = $1`,
      [id]
    );
    const loan = loanResult.rows[0];

    if (!loan) {
      return res.status(404).json({ error: 'Loan not found' });
    }

    // Members can only view their own loans
    if (req.user.role === 'member' && loan.borrower_id !== req.user.id) {
      return res.status(403).json({ error: 'You can only view your own loans' });
    }

    const eventsResult = await query(
      `SELECT loan_events.*, users.name AS actor_name
       FROM loan_events
       JOIN users ON users.id = loan_events.actor_id
       WHERE loan_id = $1
       ORDER BY created_at ASC`,
      [id]
    );

    return res.json({ loan, events: eventsResult.rows });
  } catch (err) {
    console.error('Get loan error:', err);
    return res.status(500).json({ error: 'Something went wrong fetching the loan' });
  }
});

module.exports = router;