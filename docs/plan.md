# Plan

I approached the project as a requirement-driven implementation, working through the brief's 10 goals in the order they were listed, then layering stretch features on top once the core was working and tested.

## How did you break the work into sessions?

I broadly divided the work into one session per goal, in the order the brief lists them, followed by a stretch-feature phase and a dedicated testing pass.

### Session 1 — Schema

I designed the core tables before writing any routes, since every later session depends on them existing: `users`, `catalogue_items`, `loans`, `loan_events`, `custodians`, and `dismissed_alerts`.

I also decided on raw SQL with `pg` instead of an ORM at this stage (see decisions.md), so every table was something I wrote and understood directly.

### Session 2 — Authentication

I implemented login/signup and the two required roles:

- Librarian
- Member

This established the identity that every later authorization check (`requireAuth`, `requireRole`) depends on.

### Session 3 — Catalogue items

I built the librarian-only item CRUD (create, edit, archive/restore) and the member-facing catalogue view, since a loan can't exist without an item to point to.

### Session 4 — Loans and the lifecycle rules

This was the core of the assignment and took the most time:

- Request → issue → return/lost transitions
- One open loan per item at a time (application check + a database-level partial unique index as a backstop)
- Overdue computed on read, never stored

I focused on rejecting illegal transitions on the server, not just hiding buttons in the UI.

### Session 5 — Custodians, search/filter/pagination, bulk actions

With loans working, I added the supporting requirements that build on top of them:

- Custodian assignment (librarians to items)
- Server-side search, filter, sort and pagination on the loans list
- CSV bulk import for catalogue items, with row-level success/failure reporting

### Session 6 — Dashboard and alerts

I implemented the dashboard's status/custodian breakdowns and the overdue-alerts system, including alert dismissal keyed on the loan (not the item), so a dismissed alert reappears if the same item is re-issued and goes overdue again.

### Session 7 — Stretch features

Once the 10 core goals were working and tested, I added:

- Late fees and replacement charges (a separate `fees` table)
- Per-member borrowing limit
- Email reminders via Resend's HTTP API
- A reminder cooldown, added after testing surfaced repeated-click spam
- Most-borrowed report

### Session 8 — Testing and verification

The last session was going back through every goal on purpose with Postman and the browser, instead of trusting that it worked because the code looked right. This is where most of the real bugs surfaced — see below.

---

## What order did you build in, and why that order?

**Schema → Auth → Catalogue items → Loans/lifecycle → Custodians → Search/filter/pagination → Bulk actions → Dashboard → Alerts → Stretch features → Testing**

I chose this order because each later piece depends on the ones before it:

- Catalogue items depend on nothing but auth.
- Loans depend on both users and catalogue items existing.
- Custodians, search, bulk actions, the dashboard and alerts all depend on loans already existing, since they either query loan data or operate on the same lifecycle.
- Stretch features were deliberately built last, after the 10 required goals were already working, so a stretch feature could never come at the cost of a core requirement.

Frontend pages were built alongside their matching backend routes as each one was finished, instead of building the whole UI first and wiring it up at the end.

---

## What did you estimate versus what it actually took?

Loans and the lifecycle rules took longer than I expected. Testing kept turning up cases I hadn't thought about — a loan that could get returned or marked lost from the wrong status, and a race-condition duplicate loan that the application-level check missed until the database's partial unique index caught it.

Styling also took longer than planned — the first pass was just the default Vite look, redone properly once the features themselves worked.

Testing itself took longer than planned too. Going through each goal on purpose, rather than just clicking around, kept finding real bugs:

- A borrowing-limit check that only ran on one of the two ways a loan could get created
- A dashboard endpoint that hid data in the UI but not on the server
- A "send reminder" button that could be clicked repeatedly with nothing stopping it, which is what led to the reminder cooldown described in decisions.md

---

## What did you cut when you ran short?

- Email reminders go through Resend's free API instead of a fully set-up service with a verified domain — not worth the setup time for a demo feature.
- Borrowing limit is one fixed number shared by every member, not something configurable per user, since the brief only asks for the concept of a limit.
- No system-wide view for a librarian to see every member's borrowing-limit standing at once — it's enforced correctly wherever a loan gets created, and visible on `my-limit` / `member-limits`, but there's no dashboard-level "N members are at their limit" alert the way overdue items get one.

---

## Final prioritization

My final priority order was:

1. Correct database schema
2. Authentication and authorization
3. Catalogue item CRUD
4. Loan lifecycle and its rules
5. Custodian assignment
6. Search/filter/pagination
7. Bulk import
8. Dashboard
9. Alerts
10. Stretch features (fees, borrowing limit, reminders, most-borrowed report)
11. Full re-test against all 10 goals

This kept the project focused on satisfying the required goals first, and treated stretch features and polish as things to add only once that foundation was solid.
