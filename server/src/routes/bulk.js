const express = require('express');
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');
const { query } = require('../../db/pool');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// Small helper — same as in loans.js, logs a timeline event
async function logEvent(loan_id, event_type, actor_id, note = null) {
  await query(
    `INSERT INTO loan_events (loan_id, event_type, actor_id, note)
     VALUES ($1, $2, $3, $4)`,
    [loan_id, event_type, actor_id, note]
  );
}

// POST /api/bulk/items-import — librarian uploads a CSV of items
// Expected CSV columns: title,category,code
router.post(
  '/items-import',
  requireAuth,
  requireRole('librarian'),
  upload.single('file'),
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({
        error: 'No CSV file uploaded (expected field name "file")',
      });
    }

    let records;

    try {
      records = parse(req.file.buffer, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });
    } catch (err) {
      return res.status(400).json({
        error: 'Could not parse CSV file: ' + err.message,
      });
    }

    // Validate required CSV headers
    const requiredColumns = ['title', 'category', 'code'];
    const actualColumns = Object.keys(records[0] || {});

    const missingColumns = requiredColumns.filter(
      (column) => !actualColumns.includes(column)
    );

    if (missingColumns.length > 0) {
      return res.status(400).json({
        error: `CSV must contain these columns: title, category, code. Missing: ${missingColumns.join(
          ', '
        )}`,
      });
    }

    const results = [];

    // Process rows one at a time so one bad row doesn't stop the rest
    for (let i = 0; i < records.length; i++) {
      const rowNum = i + 2; // +2: header row is row 1, data starts at row 2
      const { title, category, code } = records[i];

      if (!title || !category || !code) {
        results.push({
          row: rowNum,
          success: false,
          error: 'Missing title, category, or code',
        });
        continue;
      }

      try {
        await query(
          `INSERT INTO catalogue_items (title, category, code)
           VALUES ($1, $2, $3)`,
          [title, category, code]
        );

        results.push({
          row: rowNum,
          success: true,
          code,
        });
      } catch (err) {
        if (err.code === '23505') {
          results.push({
            row: rowNum,
            success: false,
            error: `Code "${code}" already exists`,
          });
        } else {
          results.push({
            row: rowNum,
            success: false,
            error: 'Database error',
          });
        }
      }
    }

    const successCount = results.filter((r) => r.success).length;

    return res.json({
      total: results.length,
      succeeded: successCount,
      failed: results.length - successCount,
      results,
    });
  }
);

// POST /api/bulk/loans-return — librarian selects several issued loans, returns them all
// Body: { loan_ids: ["id1", "id2", ...] }
router.post(
  '/loans-return',
  requireAuth,
  requireRole('librarian'),
  async (req, res) => {
    const { loan_ids } = req.body;

    if (!Array.isArray(loan_ids) || loan_ids.length === 0) {
      return res.status(400).json({
        error: 'loan_ids must be a non-empty array',
      });
    }

    const results = [];

    for (const loanId of loan_ids) {
      try {
        const loanResult = await query(
          'SELECT * FROM loans WHERE id = $1',
          [loanId]
        );

        const loan = loanResult.rows[0];

        if (!loan) {
          results.push({
            loan_id: loanId,
            success: false,
            error: 'Loan not found',
          });
          continue;
        }

        if (loan.status !== 'issued') {
          results.push({
            loan_id: loanId,
            success: false,
            error: `Cannot return a loan with status "${loan.status}"`,
          });
          continue;
        }

        await query(
          `UPDATE loans
           SET status = 'returned', returned_at = now()
           WHERE id = $1`,
          [loanId]
        );

        await logEvent(
          loanId,
          'returned',
          req.user.id,
          'Returned via bulk action'
        );

        results.push({
          loan_id: loanId,
          success: true,
        });
      } catch (err) {
        results.push({
          loan_id: loanId,
          success: false,
          error: 'Database error',
        });
      }
    }

    const successCount = results.filter((r) => r.success).length;

    return res.json({
      total: results.length,
      succeeded: successCount,
      failed: results.length - successCount,
      results,
    });
  }
);

// GET /api/bulk/loans-export — export every item currently out on loan as CSV
router.get(
  '/loans-export',
  requireAuth,
  requireRole('librarian'),
  async (req, res) => {
    try {
      const result = await query(
        `SELECT catalogue_items.title AS item_title,
                catalogue_items.code AS item_code,
                users.name AS borrower_name,
                users.email AS borrower_email,
                loans.due_date
         FROM loans
         JOIN catalogue_items
           ON catalogue_items.id = loans.item_id
         JOIN users
           ON users.id = loans.borrower_id
         WHERE loans.status = 'issued'
         ORDER BY loans.due_date ASC`
      );

      const csv = stringify(result.rows, {
        header: true,
        columns: [
          'item_title',
          'item_code',
          'borrower_name',
          'borrower_email',
          'due_date',
        ],
      });

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="items-on-loan.csv"'
      );

      return res.send(csv);
    } catch (err) {
      console.error('Export loans error:', err);

      return res.status(500).json({
        error: 'Something went wrong exporting loans',
      });
    }
  }
);

module.exports = router;