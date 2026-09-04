/**
 * seed.js
 *
 * Resets the dev database and inserts a large, hand-picked set of rows
 * covering every required goal (1-10) AND every implemented stretch
 * feature (fees, borrowing limits, reminders, most-borrowed), at roughly
 * 5x the volume of the previous seed — enough that filters, pagination,
 * sorting, and the dashboard charts all have something real to show in
 * a live demo instead of 2-3 rows.
 *
 * Run with:  node seed.js
 * Needs:     DATABASE_URL env var, and `pg` + `bcryptjs` installed:
 *            npm install pg bcryptjs
 *
 * Safe to run again and again — it wipes the relevant tables first.
 */

require('dotenv').config();

const bcrypt = require('bcryptjs');
const { pool } = require('./db/pool'); // reuse the same pool the app already uses

// Reuse the app's own fee constants instead of hardcoding ₹10/day and ₹500
// a second time here — if those ever change in fees.js, this seed script
// stays correct without anyone remembering to update it in two places.
const { LATE_FEE_PER_DAY, REPLACEMENT_CHARGE } = require('./src/routes/fees');

// ---- small date helpers so scenarios are readable ----
const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);
const daysFromNow = (n) => new Date(Date.now() + n * 24 * 60 * 60 * 1000);
const dateOnly = (d) => d.toISOString().slice(0, 10); // for DATE columns

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    console.log('Clearing existing data...');
    await client.query('DELETE FROM fees');
    await client.query('DELETE FROM dismissed_alerts');
    await client.query('DELETE FROM loan_events');
    await client.query('DELETE FROM loans');
    await client.query('DELETE FROM custodians');
    await client.query('DELETE FROM catalogue_items');
    await client.query('DELETE FROM users');

    // ---------------------------------------------------------------
    // 1. USERS — 3 librarians, 18 members (5x the old 2/4 split), all
    //    with fixed, memorable credentials for demo/testing.
    // ---------------------------------------------------------------
    console.log('Inserting users...');
    const password = await bcrypt.hash('password123', 10);

    const insertUser = async (email, name, role) => {
      const res = await client.query(
        `INSERT INTO users (email, password_hash, name, role)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [email, password, name, role]
      );
      return res.rows[0].id;
    };

    const librarian1 = await insertUser('librarian1@test.com', 'Lina Librarian', 'librarian');
    const librarian2 = await insertUser('librarian2@test.com', 'Leo Librarian', 'librarian');
    const librarian3 = await insertUser('librarian3@test.com', 'Nadia Librarian', 'librarian');
    const librarians = [librarian1, librarian2, librarian3];

    const memberNames = [
      'Maya Member', 'Mo Member', 'Mira Member', 'Milo Member',
      'Sara Chen', 'Raj Patel', 'Emma Wilson', 'Diego Santos',
      'Aisha Khan', 'Tom Baker', 'Yuki Tanaka', 'Olivia Brooks',
      'Kwame Asante', 'Ines Fischer', 'Noah Kim', 'Priya Nair',
      'Liam O\'Connor', 'Zara Ahmed',
    ];
    const members = [];
    for (let i = 0; i < memberNames.length; i++) {
      const id = await insertUser(`member${i + 1}@test.com`, memberNames[i], 'member');
      members.push(id);
    }
    // Dedicated member for the borrowing-limit demo (goal: stretch B) —
    // kept separate from the general pool so the "already at 3 active
    // loans" scenario below is never accidentally touched by other loops.
    const capMember = await insertUser('capmember@test.com', 'Cap Member', 'member');

    // ---------------------------------------------------------------
    // 2. CATALOGUE ITEMS — ~20 items (was 7), several categories, a
    //    handful archived, one item deliberately over-borrowed for the
    //    "most borrowed" dashboard panel (stretch D).
    // ---------------------------------------------------------------
    console.log('Inserting catalogue items...');
    const insertItem = async (title, category, code, isArchived = false) => {
      const res = await client.query(
        `INSERT INTO catalogue_items (title, category, code, is_archived)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [title, category, code, isArchived]
      );
      return res.rows[0].id;
    };

    const camera = await insertItem('Canon 90D Camera', 'Cameras', 'CAM-001');
    const tripod = await insertItem('Manfrotto Tripod', 'Cameras', 'CAM-002');
    const lensKit = await insertItem('Sigma Lens Kit', 'Cameras', 'CAM-003');
    const gimbal = await insertItem('DJI Ronin Gimbal', 'Cameras', 'CAM-004');
    const projector = await insertItem('Epson Projector', 'AV Equipment', 'AV-001');
    const mic = await insertItem('Shure Wireless Mic', 'AV Equipment', 'AV-002');
    const speaker = await insertItem('Bluetooth PA Speaker', 'AV Equipment', 'AV-003');
    const mixer = await insertItem('Yamaha Audio Mixer', 'AV Equipment', 'AV-004');
    const drill = await insertItem('Cordless Drill', 'Tools', 'TL-001');
    const ladder = await insertItem('Aluminium Ladder', 'Tools', 'TL-002');
    const sawKit = await insertItem('Circular Saw Kit', 'Tools', 'TL-003');
    const toolbox = await insertItem('Mechanic Toolbox', 'Tools', 'TL-004');
    const laptop1 = await insertItem('Loaner Laptop A', 'Electronics', 'EL-001');
    const laptop2 = await insertItem('Loaner Laptop B', 'Electronics', 'EL-002');
    const tablet = await insertItem('iPad Pro', 'Electronics', 'EL-003');
    const monitor = await insertItem('27in Monitor', 'Electronics', 'EL-004');
    const tent = await insertItem('4-Person Tent', 'Outdoor', 'OD-001');
    const coolerBox = await insertItem('Camping Cooler', 'Outdoor', 'OD-002');
    // Popular item — this one gets far more loans than anything else
    // below, so it visibly tops the "Most Borrowed" panel (stretch D).
    const popularSpeaker = await insertItem('Portable Bluetooth Speaker', 'AV Equipment', 'AV-005');

    // Archived items — kept out of the default catalogue view, but their
    // loan history stays intact (goal 2).
    const oldLaptop = await insertItem('Old Loaner Laptop', 'Electronics', 'EL-000', true);
    const brokenProjector = await insertItem('Broken Projector (retired)', 'AV Equipment', 'AV-000', true);
    const retiredCamera = await insertItem('Retired DSLR', 'Cameras', 'CAM-000', true);

    const allActiveItems = [
      camera, tripod, lensKit, gimbal, projector, mic, speaker, mixer,
      drill, ladder, sawKit, toolbox, laptop1, laptop2, tablet, monitor,
      tent, coolerBox, popularSpeaker,
    ];

    // ---------------------------------------------------------------
    // 3. CUSTODIANS — any number of librarians per item, any number of
    //    items per librarian (goal 5). Some items with 0, some with 1,
    //    some with all 3 librarians.
    // ---------------------------------------------------------------
    console.log('Inserting custodians...');
    const insertCustodian = async (itemId, librarianId) => {
      await client.query(
        `INSERT INTO custodians (item_id, librarian_id) VALUES ($1, $2)`,
        [itemId, librarianId]
      );
    };
    // camera: all 3 librarians are custodians — demonstrates "any number"
    await insertCustodian(camera, librarian1);
    await insertCustodian(camera, librarian2);
    await insertCustodian(camera, librarian3);
    await insertCustodian(tripod, librarian1);
    await insertCustodian(projector, librarian2);
    await insertCustodian(mixer, librarian2);
    await insertCustodian(gimbal, librarian3);
    await insertCustodian(sawKit, librarian1);
    await insertCustodian(toolbox, librarian1);
    await insertCustodian(toolbox, librarian3); // 2 custodians on one item
    await insertCustodian(laptop1, librarian2);
    await insertCustodian(tent, librarian3);
    await insertCustodian(popularSpeaker, librarian2);
    // drill, ladder, mic, speaker, laptop2, tablet, monitor, coolerBox,
    // lensKit deliberately left with no custodian — edge case still covered

    // ---------------------------------------------------------------
    // 4. LOANS + LOAN EVENTS — named scenarios first (one per goal /
    //    stretch feature so a demo can point straight at each), then
    //    bulk volume for search/filter/sort/pagination and the charts.
    // ---------------------------------------------------------------
    console.log('Inserting named scenario loans...');

    const insertLoan = async ({
      itemId, borrowerId, status, requestedAt, dueDate, issuedAt, returnedAt,
    }) => {
      const res = await client.query(
        `INSERT INTO loans (item_id, borrower_id, status, requested_at, due_date, issued_at, returned_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [itemId, borrowerId, status, requestedAt, dueDate, issuedAt, returnedAt]
      );
      return res.rows[0].id;
    };

    const insertEvent = async (loanId, eventType, actorId, note, createdAt) => {
      await client.query(
        `INSERT INTO loan_events (loan_id, event_type, actor_id, note, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [loanId, eventType, actorId, note, createdAt || new Date()]
      );
    };

    const insertFee = async (loanId, feeType, amount, waived, createdAt) => {
      await client.query(
        `INSERT INTO fees (loan_id, fee_type, amount, waived, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [loanId, feeType, amount, waived, createdAt || new Date()]
      );
    };

    // Tracks every item that currently has an open (requested/issued) loan,
    // so every later loop — chart loans, bulk noise, everything — can check
    // this before creating a new open loan and never violate the DB's
    // one_open_loan_per_item constraint.
    const itemsWithOpenLoan = new Set();

    // --- Scenario A: currently OVERDUE loan (due yesterday, still issued) ---
    // goal 4 (overdue computed, not stored) + goal 10 (alerts) + goal 4's
    // conflict rule (re-issuing `camera` should be rejected).
    const loanOverdue = await insertLoan({
      itemId: camera, borrowerId: members[0], status: 'issued',
      requestedAt: daysAgo(10), dueDate: dateOnly(daysAgo(1)),
      issuedAt: daysAgo(9), returnedAt: null,
    });
    await insertEvent(loanOverdue, 'requested', members[0], null, daysAgo(10));
    await insertEvent(loanOverdue, 'issued', librarian1, 'Handed over at front desk', daysAgo(9));
    itemsWithOpenLoan.add(camera);

    // --- Scenario B: overdue loan that ALREADY has a dismissed alert ---
    // confirms dismissed alerts don't show up again for the SAME loan.
    const loanOverdueDismissed = await insertLoan({
      itemId: tripod, borrowerId: members[1], status: 'issued',
      requestedAt: daysAgo(15), dueDate: dateOnly(daysAgo(3)),
      issuedAt: daysAgo(14), returnedAt: null,
    });
    await insertEvent(loanOverdueDismissed, 'requested', members[1], null, daysAgo(15));
    await insertEvent(loanOverdueDismissed, 'issued', librarian1, null, daysAgo(14));
    await client.query(
      `INSERT INTO dismissed_alerts (loan_id, dismissed_by) VALUES ($1, $2)`,
      [loanOverdueDismissed, librarian1]
    );
    await insertEvent(loanOverdueDismissed, 'note', librarian1, 'Overdue alert dismissed', daysAgo(2));
    itemsWithOpenLoan.add(tripod);

    // --- Scenario C: item returned, then re-issued and NOW overdue again ---
    // confirms the alert REAPPEARS on the new loan, even though the old
    // (returned) loan for the same item had its alert dismissed.
    const projectorOldLoan = await insertLoan({
      itemId: projector, borrowerId: members[2], status: 'returned',
      requestedAt: daysAgo(30), dueDate: dateOnly(daysAgo(23)),
      issuedAt: daysAgo(29), returnedAt: daysAgo(25),
    });
    await insertEvent(projectorOldLoan, 'requested', members[2], null, daysAgo(30));
    await insertEvent(projectorOldLoan, 'issued', librarian2, null, daysAgo(29));
    await insertEvent(projectorOldLoan, 'returned', librarian2, 'Returned late, minor scuff on case', daysAgo(25));
    await client.query(
      `INSERT INTO dismissed_alerts (loan_id, dismissed_by) VALUES ($1, $2)`,
      [projectorOldLoan, librarian2]
    );
    // Late fee for this one — 2 days late, at the app's real per-day rate.
    await insertFee(projectorOldLoan, 'late', 2 * LATE_FEE_PER_DAY, false, daysAgo(25));

    const projectorNewLoan = await insertLoan({
      itemId: projector, borrowerId: members[3], status: 'issued',
      requestedAt: daysAgo(6), dueDate: dateOnly(daysAgo(2)),
      issuedAt: daysAgo(5), returnedAt: null,
    });
    await insertEvent(projectorNewLoan, 'requested', members[3], null, daysAgo(6));
    await insertEvent(projectorNewLoan, 'issued', librarian2, null, daysAgo(5));
    itemsWithOpenLoan.add(projector);

    // --- Scenario D: currently REQUESTED, not yet issued ---
    // tests: librarian issuing a pending request, and a requested (not
    // issued) loan still blocking a second loan on the same item.
    const loanRequested = await insertLoan({
      itemId: drill, borrowerId: members[0], status: 'requested',
      requestedAt: daysAgo(1), dueDate: null, issuedAt: null, returnedAt: null,
    });
    await insertEvent(loanRequested, 'requested', members[0], null, daysAgo(1));
    itemsWithOpenLoan.add(drill);

    // --- Scenario E: issued, due in the future (NOT overdue) — control case ---
    const loanNotOverdue = await insertLoan({
      itemId: mic, borrowerId: members[1], status: 'issued',
      requestedAt: daysAgo(2), dueDate: dateOnly(daysFromNow(5)),
      issuedAt: daysAgo(1), returnedAt: null,
    });
    await insertEvent(loanNotOverdue, 'requested', members[1], null, daysAgo(2));
    await insertEvent(loanNotOverdue, 'issued', librarian1, null, daysAgo(1));
    itemsWithOpenLoan.add(mic);

    // --- Scenario F: LOST item — replacement charge (stretch A) ---
    const loanLost = await insertLoan({
      itemId: ladder, borrowerId: members[2], status: 'lost',
      requestedAt: daysAgo(20), dueDate: dateOnly(daysAgo(10)),
      issuedAt: daysAgo(19), returnedAt: null,
    });
    await insertEvent(loanLost, 'requested', members[2], null, daysAgo(20));
    await insertEvent(loanLost, 'issued', librarian2, null, daysAgo(19));
    await insertEvent(loanLost, 'lost', librarian2, 'Member reports it was left on a train', daysAgo(8));
    await insertFee(loanLost, 'replacement', REPLACEMENT_CHARGE, false, daysAgo(8));
    // Left unwaived on purpose — this is the fee to click "Waive" on live
    // during a demo, to show PATCH /:id/fees/:feeId/waive actually working.

    // --- Scenario F2: a SECOND lost item, with its fee pre-waived ---
    // Seeded directly with waived=true so the "Waived" badge is visible
    // immediately on page load without needing to click anything. Between
    // this row and Scenario F above, a demo can show both states: a fee
    // that's still outstanding (and can be waived live) and one that's
    // already been waived (via PATCH /:id/fees/:feeId/waive, added after
    // the schema originally shipped with an unused `waived` column).
    const loanLostWaived = await insertLoan({
      itemId: sawKit, borrowerId: members[4], status: 'lost',
      requestedAt: daysAgo(25), dueDate: dateOnly(daysAgo(15)),
      issuedAt: daysAgo(24), returnedAt: null,
    });
    await insertEvent(loanLostWaived, 'requested', members[4], null, daysAgo(25));
    await insertEvent(loanLostWaived, 'issued', librarian1, null, daysAgo(24));
    await insertEvent(loanLostWaived, 'lost', librarian1, 'Blade missing, reported by member', daysAgo(12));
    await insertFee(loanLostWaived, 'replacement', REPLACEMENT_CHARGE, true, daysAgo(12));
    await insertEvent(loanLostWaived, 'note', librarian1, 'Replacement charge waived — member is a long-time volunteer', daysAgo(11));

    // --- Scenario G: archived item WITH loan history (goal 2 check) ---
    const archivedLoan = await insertLoan({
      itemId: oldLaptop, borrowerId: members[5], status: 'returned',
      requestedAt: daysAgo(60), dueDate: dateOnly(daysAgo(53)),
      issuedAt: daysAgo(59), returnedAt: daysAgo(50),
    });
    await insertEvent(archivedLoan, 'requested', members[5], null, daysAgo(60));
    await insertEvent(archivedLoan, 'issued', librarian1, null, daysAgo(59));
    await insertEvent(archivedLoan, 'returned', librarian1, null, daysAgo(50));

    const brokenProjectorLoan = await insertLoan({
      itemId: brokenProjector, borrowerId: members[6], status: 'lost',
      requestedAt: daysAgo(90), dueDate: dateOnly(daysAgo(83)),
      issuedAt: daysAgo(89), returnedAt: null,
    });
    await insertEvent(brokenProjectorLoan, 'requested', members[6], null, daysAgo(90));
    await insertEvent(brokenProjectorLoan, 'issued', librarian2, null, daysAgo(89));
    await insertEvent(brokenProjectorLoan, 'lost', librarian2, 'Bulb shattered beyond repair, item retired', daysAgo(80));
    await insertFee(brokenProjectorLoan, 'replacement', REPLACEMENT_CHARGE, false, daysAgo(80));

    // --- Scenario H: multiple LATE fees at different day-counts ---
    // Shows the per-day math ($10 x days_late) actually varying, not just
    // one fixed example.
    const lateFeeExamples = [
      { item: laptop2, borrower: members[7], daysLate: 1 },
      { item: tablet, borrower: members[8], daysLate: 3 },
      { item: monitor, borrower: members[9], daysLate: 7 },
      { item: tent, borrower: members[10], daysLate: 14 },
    ];
    for (const ex of lateFeeExamples) {
      const returnedAt = daysAgo(5);
      const dueDate = dateOnly(daysAgo(5 + ex.daysLate));
      const loanId = await insertLoan({
        itemId: ex.item, borrowerId: ex.borrower, status: 'returned',
        requestedAt: daysAgo(20), dueDate,
        issuedAt: daysAgo(19), returnedAt,
      });
      await insertEvent(loanId, 'requested', ex.borrower, null, daysAgo(20));
      await insertEvent(loanId, 'issued', librarians[0], null, daysAgo(19));
      await insertEvent(loanId, 'returned', librarians[0], null, returnedAt);
      await insertFee(loanId, 'late', ex.daysLate * LATE_FEE_PER_DAY, false, returnedAt);
    }

    // --- Scenario I: borrowing-limit demo (stretch B) — capMember already
    // has exactly MAX_ACTIVE_LOANS_PER_MEMBER (3) open loans. Requesting a
    // 4th item as this member in the live demo should get a 409 with the
    // "already have 3 active loans" message.
    const capItems = [coolerBox, laptop1, monitor];
    for (let i = 0; i < capItems.length; i++) {
      const item = capItems[i];
      const status = i === 0 ? 'requested' : 'issued'; // mix of both open statuses
      const loanId = await insertLoan({
        itemId: item, borrowerId: capMember, status,
        requestedAt: daysAgo(3 - i),
        dueDate: status === 'issued' ? dateOnly(daysFromNow(4)) : null,
        issuedAt: status === 'issued' ? daysAgo(2 - i) : null,
        returnedAt: null,
      });
      await insertEvent(loanId, 'requested', capMember, null, daysAgo(3 - i));
      if (status === 'issued') {
        await insertEvent(loanId, 'issued', librarians[i % 3], null, daysAgo(2 - i));
      }
      itemsWithOpenLoan.add(item);
    }

    // --- Scenario J: reminder-email history (stretch C) — an overdue loan
    // with a "reminder sent" note already logged. The app now enforces a
    // 60-minute cooldown per loan (see REMINDER_COOLDOWN_MINUTES in
    // loans.js), checked against the most recent matching loan_events row
    // — so clicking Send Reminder again on this loan immediately in a live
    // demo should be rejected with a 429, which is a good thing to show:
    // it proves the earlier duplicate-send gap is actually fixed now.
    const loanReminded = await insertLoan({
      itemId: gimbal, borrowerId: members[11], status: 'issued',
      requestedAt: daysAgo(12), dueDate: dateOnly(daysAgo(4)),
      issuedAt: daysAgo(11), returnedAt: null,
    });
    await insertEvent(loanReminded, 'requested', members[11], null, daysAgo(12));
    await insertEvent(loanReminded, 'issued', librarian2, null, daysAgo(11));
    await insertEvent(loanReminded, 'note', librarian2, 'Reminder email sent to borrower', daysAgo(3));
    itemsWithOpenLoan.add(gimbal);

    // --- Scenario K: "most borrowed" item (stretch D) — popularSpeaker
    // gets far more historical loans than anything else, so it visibly
    // tops the dashboard's Most Borrowed panel instead of tying with
    // everything else at 1-2 loans each.
    console.log('Inserting extra history for the "most borrowed" item...');
    for (let i = 0; i < 18; i++) {
      const borrower = members[i % members.length];
      const librarian = librarians[i % librarians.length];
      const requestedAt = daysAgo(100 + i * 4);
      const issuedAt = daysAgo(99 + i * 4);
      const dueAt = dateOnly(daysAgo(92 + i * 4));
      const returnedAt = daysAgo(90 + i * 4);
      const loanId = await insertLoan({
        itemId: popularSpeaker, borrowerId: borrower, status: 'returned',
        requestedAt, dueDate: dueAt, issuedAt, returnedAt,
      });
      await insertEvent(loanId, 'requested', borrower, null, requestedAt);
      await insertEvent(loanId, 'issued', librarian, null, issuedAt);
      await insertEvent(loanId, 'returned', librarian, null, returnedAt);
    }

    // ---------------------------------------------------------------
    // 5. RETURNED-LOAN HISTORY across the past 8 weeks — bigger and more
    //    varied per week than before, for a dashboard chart that actually
    //    looks like real usage instead of a flat 1-2-3 staircase.
    // ---------------------------------------------------------------
    console.log('Inserting returned-loan history for the dashboard chart...');
    const chartItems = [camera, tripod, drill, mic, speaker, laptop2, tablet, coolerBox];
    const weeklyReturnCounts = [4, 7, 3, 8, 5, 2, 6, 4]; // varies week to week
    let n = 0;
    for (let week = 0; week < 8; week++) {
      for (let i = 0; i < weeklyReturnCounts[week]; i++) {
        const item = chartItems[n % chartItems.length];
        const borrower = members[n % members.length];
        const librarian = librarians[n % librarians.length];
        const returnedAt = daysAgo(week * 7 + i);
        const issuedAt = daysAgo(week * 7 + i + 10);
        const requestedAt = daysAgo(week * 7 + i + 11);
        const due = dateOnly(daysAgo(week * 7 + i + 3));

        const loanId = await insertLoan({
          itemId: item, borrowerId: borrower, status: 'returned',
          requestedAt, dueDate: due, issuedAt, returnedAt,
        });
        await insertEvent(loanId, 'requested', borrower, null, requestedAt);
        await insertEvent(loanId, 'issued', librarian, null, issuedAt);
        await insertEvent(loanId, 'returned', librarian, null, returnedAt);
        n++;
      }
    }

    // ---------------------------------------------------------------
    // 6. BULK RANDOM LOANS — pure volume (~350, vs 60 before) so
    //    pagination/search/sort/filter (goal 6) has enough rows to be
    //    worth testing, and the catalogue feels like a real, busy system
    //    in a live demo rather than a handful of curated rows.
    // ---------------------------------------------------------------
    console.log('Inserting bulk random loans for pagination/search/sort testing...');
    const allMembers = [...members, capMember];
    const statusPool = ['requested', 'issued', 'returned', 'returned', 'returned', 'returned']; // weighted toward returned

    const BULK_COUNT = 350;
    for (let i = 0; i < BULK_COUNT; i++) {
      const item = allActiveItems[i % allActiveItems.length];
      const borrower = allMembers[i % allMembers.length];
      const librarian = librarians[i % librarians.length];
      let status = statusPool[i % statusPool.length];

      // force 'returned' for any item that currently has an open loan,
      // so we never violate the one-open-loan-per-item DB constraint
      if (itemsWithOpenLoan.has(item) && status !== 'returned') {
        status = 'returned';
      }
      if (status === 'requested' || status === 'issued') {
        itemsWithOpenLoan.add(item);
      }

      const requestedAt = daysAgo(20 + i);
      let issuedAt = null, dueDate = null, returnedAt = null;

      if (status === 'issued' || status === 'returned') {
        issuedAt = daysAgo(19 + i);
        dueDate = dateOnly(daysAgo(12 + i));
      }
      if (status === 'returned') {
        returnedAt = daysAgo(10 + i);
      }

      const loanId = await insertLoan({
        itemId: item, borrowerId: borrower, status, requestedAt, dueDate, issuedAt, returnedAt,
      });
      await insertEvent(loanId, 'requested', borrower, null, requestedAt);
      if (issuedAt) await insertEvent(loanId, 'issued', librarian, null, issuedAt);
      if (returnedAt) await insertEvent(loanId, 'returned', librarian, null, returnedAt);
    }

    await client.query('COMMIT');

    // ---------------------------------------------------------------
    // Summary
    // ---------------------------------------------------------------
    const counts = await client.query(`
      SELECT
        (SELECT COUNT(*) FROM users) AS users,
        (SELECT COUNT(*) FROM catalogue_items) AS items,
        (SELECT COUNT(*) FROM custodians) AS custodians,
        (SELECT COUNT(*) FROM loans) AS loans,
        (SELECT COUNT(*) FROM loan_events) AS events,
        (SELECT COUNT(*) FROM fees) AS fees,
        (SELECT COUNT(*) FROM dismissed_alerts) AS dismissed
    `);

    console.log('\nSeed complete.');
    console.log('----------------------------------------');
    console.log('Row counts:', counts.rows[0]);
    console.log('----------------------------------------');
    console.log('Login credentials (all passwords: password123)');
    console.log('  Librarian: librarian1@test.com / librarian2@test.com / librarian3@test.com');
    console.log('  Member:    member1@test.com .. member18@test.com');
    console.log('  Member (at borrowing limit): capmember@test.com');
    console.log('----------------------------------------');
    console.log('Key scenarios (goals 1-10):');
    console.log('  - Camera: issued, overdue since yesterday -> re-issuing it should be rejected (goal 4)');
    console.log('  - Tripod: overdue AND already has a dismissed alert -> should NOT show in alerts (goal 10)');
    console.log('  - Projector: old returned+dismissed loan, then re-issued and overdue again -> alert REAPPEARS (goal 10)');
    console.log('  - Drill: currently just "requested", nothing issued yet (goal 4)');
    console.log('  - Mic: issued, due in 5 days -> control case, should never alert (goal 4)');
    console.log('  - Old Loaner Laptop / Broken Projector / Retired DSLR: archived, but loan history intact (goal 2)');
    console.log('  - Canon 90D Camera: 3 custodians at once (goal 5)');
    console.log('----------------------------------------');
    console.log('Stretch feature scenarios:');
    console.log('  A. Fees: Ladder (replacement, still outstanding — waive it live in the demo),');
    console.log('     Circular Saw Kit (replacement, already WAIVED), Broken Projector (replacement),');
    console.log('     + 4 late-fee examples at 1/3/7/14 days late');
    console.log('  B. Borrowing limit: capmember@test.com already has 3 active loans ->');
    console.log('     requesting a 4th item as this user should 409');
    console.log('  C. Reminders: "DJI Ronin Gimbal" loan already has one reminder-sent note —');
    console.log('     clicking Send Reminder again immediately should now be rejected (429),');
    console.log('     since a 60-minute per-loan cooldown was added after this scenario was written');
    console.log('  D. Most borrowed: "Portable Bluetooth Speaker" has 18 loans, far ahead of anything else');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed failed, rolled back:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();