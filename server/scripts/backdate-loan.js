// Usage: node backdate-loan.js <loan_id> <days_offset>
//   days_offset: integer, can be negative (e.g. -5 = 5 days in the past)
//
// Sets due_date = CURRENT_DATE + days_offset, directly in the DB.
// Used by test-fees.sh to simulate an overdue loan, since the API itself
// refuses to accept a past due_date on creation/issue.
//
// Reads the connection string from the DATABASE_URL environment variable
// (same one you pass to test-fees.sh) — uses the 'pg' package already
// installed in server/node_modules, so no separate psql install is needed.

const { Pool } = require('pg');

const [, , loanId, daysOffsetRaw] = process.argv;

if (!loanId || daysOffsetRaw === undefined) {
  console.error('Usage: node backdate-loan.js <loan_id> <days_offset>');
  process.exit(1);
}

const daysOffset = parseInt(daysOffsetRaw, 10);
if (Number.isNaN(daysOffset)) {
  console.error('days_offset must be an integer, got:', daysOffsetRaw);
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL environment variable is not set.');
  process.exit(1);
}

// rejectUnauthorized: false — Supabase's pooler needs SSL but the test
// environment usually doesn't have its CA chain configured locally.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

(async () => {
  try {
    const result = await pool.query(
      `UPDATE loans SET due_date = (CURRENT_DATE + ($2 || ' days')::interval)::date
       WHERE id = $1
       RETURNING id, due_date`,
      [loanId, daysOffset]
    );

    if (result.rows.length === 0) {
      console.error(`No loan found with id ${loanId}`);
      process.exit(1);
    }

    console.log(`OK — loan ${result.rows[0].id} due_date set to ${result.rows[0].due_date}`);
    process.exit(0);
  } catch (err) {
    console.error('Backdate failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();