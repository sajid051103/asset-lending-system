const express = require('express');
const { query } = require('../../db/pool');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  try {
    // 1. Headline numbers — run these in parallel for speed
    const [
      itemsOutResult,
      itemsOverdueResult,
      returnedThisWeekResult,
      totalItemsResult,
    ] = await Promise.all([
      // items currently out = loans still 'issued'
      query(`SELECT COUNT(*) AS count FROM loans WHERE status = 'issued'`),

      // overdue = issued AND due_date in the past (computed, never stored — goal 4's rule)
      query(
        `SELECT COUNT(*) AS count FROM loans 
         WHERE status = 'issued' AND due_date < CURRENT_DATE`
      ),

      // returned this week = returned_at falls within the current week (Mon–Sun)
      query(
        `SELECT COUNT(*) AS count FROM loans 
         WHERE status = 'returned' 
         AND returned_at >= date_trunc('week', CURRENT_DATE)`
      ),

      // total catalogue items (including archived, since it's a system-wide count)
      query(`SELECT COUNT(*) AS count FROM catalogue_items`),
    ]);

    // 2. Breakdown by status
    const statusBreakdownResult = await query(
      `SELECT status, COUNT(*) AS count FROM loans GROUP BY status`
    );

    // 3. Breakdown by custodian — how many items each librarian looks after
    const custodianBreakdownResult = await query(
      `SELECT users.id, users.name, COUNT(custodians.item_id) AS item_count
       FROM users
       LEFT JOIN custodians ON custodians.librarian_id = users.id
       WHERE users.role = 'librarian'
       GROUP BY users.id, users.name
       ORDER BY item_count DESC`
    );

    // 4. Items returned per week, last 8 weeks
    const weeklyReturnsResult = await query(
      `SELECT date_trunc('week', returned_at)::date AS week_start, COUNT(*) AS count
       FROM loans
       WHERE status = 'returned'
       AND returned_at >= CURRENT_DATE - INTERVAL '8 weeks'
       GROUP BY week_start
       ORDER BY week_start ASC`
    );

    return res.json({
      headline: {
        itemsOut: parseInt(itemsOutResult.rows[0].count, 10),
        itemsOverdue: parseInt(itemsOverdueResult.rows[0].count, 10),
        returnedThisWeek: parseInt(returnedThisWeekResult.rows[0].count, 10),
        totalItems: parseInt(totalItemsResult.rows[0].count, 10),
      },
      statusBreakdown: statusBreakdownResult.rows.map((r) => ({
        status: r.status,
        count: parseInt(r.count, 10),
      })),
      custodianBreakdown: custodianBreakdownResult.rows.map((r) => ({
        librarian_id: r.id,
        librarian_name: r.name,
        itemCount: parseInt(r.item_count, 10),
      })),
      weeklyReturns: weeklyReturnsResult.rows.map((r) => ({
        weekStart: r.week_start,
        count: parseInt(r.count, 10),
      })),
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    return res.status(500).json({ error: 'Something went wrong loading the dashboard' });
  }
});

module.exports = router;