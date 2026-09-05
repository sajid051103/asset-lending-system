const express = require('express');
const { pool, query } = require('../../db/pool');
const { requireAuth, requireRole } = require('../middleware/auth');
const transporter = require('../utils/mailer');
const { router: feesRouter, chargeLateFeeIfNeeded, chargeReplacementFee } = require('./fees');

const router = express.Router();

// Small helper — logs a row into loan_events (the immutable timeline)
async function logEvent(loan_id, event_type, actor_id, note = null) {
  await query(
    `INSERT INTO loan_events (loan_id, event_type, actor_id, note)
     VALUES ($1, $2, $3, $4)`,
    [loan_id, event_type, actor_id, note]
  );
}

// STRETCH: per-member borrowing limit — a member can have at most this
// many open (requested/issued) loans at once. Fixed and global, since
// the README only asks for the concept, not per-user customisation.
const MAX_ACTIVE_LOANS_PER_MEMBER = 3;

// Counts a borrower's currently-active loans (requested + issued).
// Used by POST / to enforce MAX_ACTIVE_LOANS_PER_MEMBER — always against
// the *target borrower*, never the actor, so it can't be bypassed by
// having a librarian create the loan instead of the member requesting it.
async function getActiveLoanCount(borrowerId) {
  const result = await query(
    `SELECT COUNT(*) AS count FROM loans WHERE borrower_id = $1 AND status IN ('requested', 'issued')`,
    [borrowerId]
  );
  return parseInt(result.rows[0].count, 10);
}

// STRETCH: send-reminder cooldown — a librarian can't re-send a reminder
// for the same loan more than once every 60 minutes. Prevents accidental
// spam from repeated clicks/requests.
const REMINDER_COOLDOWN_MINUTES = 60;

// POST /api/loans — request or directly create a loan
// Members: creates a "requested" loan (no due date yet)
// Librarians: can also directly create+issue in one step if they pass a due_date
router.post('/', requireAuth, async (req, res) => {
  const { item_id, borrower_id, due_date } = req.body;
  const actor = req.user; // { id, email, role }

  if (!item_id) {
    return res.status(400).json({ error: 'item_id is required' });
  }

  // Members can only request for themselves, not on behalf of others
  const finalBorrowerId = actor.role === 'librarian' && borrower_id ? borrower_id : actor.id;
  let client;
  let transactionOpen = false;

  try {
    // Guard: if a librarian is directly issuing with a due_date, it can't
    // be in the past. Checked against the DB's CURRENT_DATE (not Node's
    // new Date().toISOString(), which is UTC and can disagree with the
    // DB's own "today" depending on server timezone) — same definition
    // of "today" used everywhere else in the app (alerts, fees, dashboard).
    if (due_date) {
      const todayResult = await query(`SELECT CURRENT_DATE::text AS today`);
      const today = todayResult.rows[0].today;
      if (due_date < today) {
        return res.status(400).json({ error: 'due_date cannot be in the past' });
      }
    }

    // A librarian creating a loan for someone else may only select a member.
    if (actor.role === 'librarian' && borrower_id) {
      const borrowerResult = await query('SELECT id, role FROM users WHERE id = $1', [finalBorrowerId]);
      const borrower = borrowerResult.rows[0];

      if (!borrower) {
        return res.status(404).json({ error: 'Borrower not found' });
      }
      if (borrower.role !== 'member') {
        return res.status(400).json({ error: 'Loans can only be issued to members' });
      }
    }

    client = await pool.connect();
    await client.query('BEGIN');
    transactionOpen = true;

    // Locking this user row serializes concurrent creations for the borrower.
    const lockedBorrowerResult = await client.query(
      'SELECT id FROM users WHERE id = $1 FOR UPDATE',
      [finalBorrowerId]
    );
    if (lockedBorrowerResult.rows.length === 0) {
      await client.query('ROLLBACK');
      transactionOpen = false;
      return res.status(404).json({ error: 'Borrower not found' });
    }

    // STRETCH: per-member borrowing limit — enforced against the
    // *borrower this loan is for* (finalBorrowerId), no matter who is
    // making the API call. Previously this only ran when
    // actor.role === 'member', which meant a librarian creating a loan
    // directly on a member's behalf could push them past the cap with
    // no check at all. That gate is gone: a librarian issuing a loan
    // for a member who is already at the limit gets blocked exactly
    // like the member would if they'd requested it themselves.
    const activeCountResult = await client.query(
      `SELECT COUNT(*) AS count FROM loans WHERE borrower_id = $1 AND status IN ('requested', 'issued')`,
      [finalBorrowerId]
    );
    const activeCount = parseInt(activeCountResult.rows[0].count, 10);

    if (activeCount >= MAX_ACTIVE_LOANS_PER_MEMBER) {
      const isSelf = finalBorrowerId === actor.id;
      await client.query('ROLLBACK');
      transactionOpen = false;
      return res.status(409).json({
        error: isSelf
          ? `You already have ${activeCount} active loans (limit is ${MAX_ACTIVE_LOANS_PER_MEMBER}). Return an item before requesting another.`
          : `This borrower already has ${activeCount} active loans (limit is ${MAX_ACTIVE_LOANS_PER_MEMBER}). They must return an item before another can be issued to them.`,
      });
    }

    // Check the item exists and isn't archived
    const itemResult = await client.query('SELECT * FROM catalogue_items WHERE id = $1', [item_id]);
    if (itemResult.rows.length === 0) {
      await client.query('ROLLBACK');
      transactionOpen = false;
      return res.status(404).json({ error: 'Item not found' });
    }
    if (itemResult.rows[0].is_archived) {
      await client.query('ROLLBACK');
      transactionOpen = false;
      return res.status(409).json({ error: 'Cannot create a loan for an archived item' });
    }

    // Enforce goal 4: no open loan (requested/issued) already exists for this item
    const openLoanResult = await client.query(
      `SELECT id FROM loans WHERE item_id = $1 AND status IN ('requested', 'issued')`,
      [item_id]
    );
    if (openLoanResult.rows.length > 0) {
      await client.query('ROLLBACK');
      transactionOpen = false;
      return res.status(409).json({ error: 'This item already has an open loan against it' });
    }

    // Librarian directly issuing: needs a due_date, status starts as issued
    const isDirectIssue = actor.role === 'librarian' && due_date;
    const status = isDirectIssue ? 'issued' : 'requested';

    const result = await client.query(
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
    await client.query('COMMIT');
    transactionOpen = false;
    await logEvent(loan.id, isDirectIssue ? 'issued' : 'requested', actor.id);

    return res.status(201).json({ loan });
  } catch (err) {
    if (transactionOpen) {
      await client.query('ROLLBACK');
    }
    // Database backstop: the partial unique index catches races even
    // if our earlier check above missed one (two requests at once)
    if (err.code === '23505' && err.constraint === 'one_open_loan_per_item') {
      return res.status(409).json({ error: 'This item already has an open loan against it' });
    }
    console.error('Create loan error:', err);
    return res.status(500).json({ error: 'Something went wrong creating the loan' });
  } finally {
    if (client) {
      client.release();
    }
  }
});

// PATCH /api/loans/:id/issue — librarian issues a "requested" loan
//
// No separate active-loan-limit check is needed here: a "requested" loan
// already counts toward MAX_ACTIVE_LOANS_PER_MEMBER (see
// getActiveLoanCount), and issuing it only flips requested -> issued —
// it doesn't create a new active loan, so the borrower's active count
// doesn't change. As long as POST / enforced the cap at creation time
// (fixed above), this endpoint can't be used to sneak a borrower past it.
router.patch('/:id/issue', requireAuth, requireRole('librarian'), async (req, res) => {
  const { id } = req.params;
  const { due_date } = req.body;

  if (!due_date) {
    return res.status(400).json({ error: 'due_date is required to issue a loan' });
  }

  try {
    // Guard: due_date cannot be in the past — checked against the DB's
    // CURRENT_DATE, not Node's UTC-converted date. See comment on the
    // same check in POST / above.
    const todayResult = await query(`SELECT CURRENT_DATE::text AS today`);
    const today = todayResult.rows[0].today;
    if (due_date < today) {
      return res.status(400).json({ error: 'due_date cannot be in the past' });
    }

    const loanResult = await query('SELECT * FROM loans WHERE id = $1', [id]);
    const loan = loanResult.rows[0];

    if (!loan) {
      return res.status(404).json({ error: 'Loan not found' });
    }
    const result = await query(
      `UPDATE loans SET status = 'issued', due_date = $1, issued_at = now()
       WHERE id = $2 AND status = 'requested' RETURNING *`,
      [due_date, id]
    );

    if (result.rows.length === 0) {
      return res.status(409).json({
        error: 'Cannot issue this loan — only "requested" loans can be issued',
      });
    }

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
  // req.body || {} — clients that call this without a JSON body (no
  // Content-Type header, e.g. curl/Postman without -d) leave req.body
  // undefined, which used to crash this destructure with a 500 and leak
  // a stack trace to the caller.
  const { note } = req.body || {};

  try {
    const loanResult = await query('SELECT * FROM loans WHERE id = $1', [id]);
    const loan = loanResult.rows[0];

    if (!loan) {
      return res.status(404).json({ error: 'Loan not found' });
    }
    // days_late is computed by Postgres as a calendar-date subtraction
    // (now()::date - due_date), both DATE-typed under the hood — see the
    // comment on chargeLateFeeIfNeeded in fees.js for why this has to
    // happen in SQL rather than by diffing JS Date objects.
    const result = await query(
      `UPDATE loans SET status = 'returned', returned_at = now()
       WHERE id = $1 AND status = 'issued'
       RETURNING *, (now()::date - due_date) AS days_late`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(409).json({
        error: 'Cannot return this loan — only "issued" loans can be returned',
      });
    }

    const { days_late: daysLate, ...returnedLoan } = result.rows[0];
    await logEvent(id, 'returned', req.user.id, note || null);

    // STRETCH: late fee — only if due_date existed and had already passed
    // when the item was returned
    const lateFee = await chargeLateFeeIfNeeded(id, daysLate);

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
  // Same guard as /:id/return — see comment there.
  const { note } = req.body || {};

  try {
    const loanResult = await query('SELECT * FROM loans WHERE id = $1', [id]);
    const loan = loanResult.rows[0];

    if (!loan) {
      return res.status(404).json({ error: 'Loan not found' });
    }
    const result = await query(
      `UPDATE loans SET status = 'lost' WHERE id = $1 AND status = 'issued' RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(409).json({
        error: 'Cannot mark this loan as lost — only "issued" loans can be marked lost',
      });
    }

    await logEvent(id, 'lost', req.user.id, note || null);

    // STRETCH: flat replacement charge, every time an item is lost
    const replacementCharge = await chargeReplacementFee(id);

    return res.json({ loan: result.rows[0], replacementCharge });
  } catch (err) {
    console.error('Mark lost error:', err);
    return res.status(500).json({ error: 'Something went wrong marking the loan lost' });
  }
});

// POST /api/loans/:id/send-reminder — STRETCH: email a reminder to the
// borrower on an issued loan. Librarian-only, matching the pattern used
// by issue/return/lost above (server-enforced role check, not just UI).
//
// STRETCH: 60-minute cooldown — reuses loan_events (event_type = 'note',
// note = 'Reminder email sent to borrower') to find the last time a
// reminder was actually sent for this loan, rather than adding a new
// column just to track this. If a reminder went out inside the cooldown
// window, the request is rejected with 429 before touching the mailer.
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

    // Cooldown check — look up the most recent "reminder sent" event for
    // this loan and compare it against CURRENT_TIMESTAMP in the same
    // query, so we're consistent with the DB's clock (same reasoning as
    // the CURRENT_DATE guards above) rather than mixing in Node's Date.
    const cooldownResult = await query(
      `SELECT created_at,
              EXTRACT(EPOCH FROM (now() - created_at)) / 60 AS minutes_since
       FROM loan_events
       WHERE loan_id = $1
         AND event_type = 'note'
         AND note = 'Reminder email sent to borrower'
       ORDER BY created_at DESC
       LIMIT 1`,
      [id]
    );

    if (cooldownResult.rows.length > 0) {
      const minutesSince = parseFloat(cooldownResult.rows[0].minutes_since);
      if (minutesSince < REMINDER_COOLDOWN_MINUTES) {
        const minutesRemaining = Math.ceil(REMINDER_COOLDOWN_MINUTES - minutesSince);
        return res.status(429).json({
          error: `A reminder was already sent ${Math.floor(minutesSince)} minute(s) ago. Please wait ${minutesRemaining} more minute(s) before resending.`,
        });
      }
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

// GET /api/loans/my-limit — the logged-in user's own active-loan count
// against MAX_ACTIVE_LOANS_PER_MEMBER. Lets the frontend disable/gray out
// a "Request" button before the user tries and hits the backend's 409,
// instead of only reacting after a failed request.
//
// Registered before GET /:id so Express doesn't treat "my-limit" as an :id.
router.get('/my-limit', requireAuth, async (req, res) => {
  try {
    const activeCount = await getActiveLoanCount(req.user.id);
    return res.json({
      activeCount,
      limit: MAX_ACTIVE_LOANS_PER_MEMBER,
      atLimit: activeCount >= MAX_ACTIVE_LOANS_PER_MEMBER,
    });
  } catch (err) {
    console.error('Get my-limit error:', err);
    return res.status(500).json({ error: 'Something went wrong fetching your loan limit' });
  }
});

// GET /api/loans/member-limits — librarian-only, bulk active-loan count for
// every member in one query. Powers the "Create Loan" borrower dropdown in
// ItemDetail.jsx, so a librarian can see (and the UI can disable) a member
// who is already at MAX_ACTIVE_LOANS_PER_MEMBER before submitting a loan
// for them, rather than only finding out from the backend's 409 afterward.
//
// A single LEFT JOIN + FILTER does this for every member in one round
// trip instead of the frontend calling my-limit once per member.
router.get('/member-limits', requireAuth, requireRole('librarian'), async (req, res) => {
  try {
    const result = await query(
      `SELECT users.id, users.name, users.email,
              COUNT(loans.id) FILTER (WHERE loans.status IN ('requested', 'issued')) AS active_count
       FROM users
       LEFT JOIN loans ON loans.borrower_id = users.id
                       AND loans.status IN ('requested', 'issued')
       WHERE users.role = 'member'
       GROUP BY users.id, users.name, users.email
       ORDER BY users.name ASC`
    );

    const members = result.rows.map((row) => {
      const activeCount = parseInt(row.active_count, 10);
      return {
        id: row.id,
        name: row.name,
        email: row.email,
        activeCount,
        limit: MAX_ACTIVE_LOANS_PER_MEMBER,
        atLimit: activeCount >= MAX_ACTIVE_LOANS_PER_MEMBER,
      };
    });

    return res.json({ members, limit: MAX_ACTIVE_LOANS_PER_MEMBER });
  } catch (err) {
    console.error('Get member-limits error:', err);
    return res.status(500).json({ error: 'Something went wrong fetching member loan limits' });
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

// The fees read endpoint (GET /:id/fees) now lives in fees.js — mounted
// on this same router so /api/loans/:id/fees keeps working unchanged.
router.use(feesRouter);

module.exports = router;
