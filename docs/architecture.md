# Architecture

## What are the moving pieces, and how do they talk to each other?

Three main parts.

- **Client:** React app (Vite). All API calls go through a single axios instance that attaches the
  JWT from `localStorage` to every request. Dashboard.jsx also polls `/api/dashboard` every 60 seconds
  so the numbers stay roughly current without needing a websocket, and keeps showing the last good
  data if a poll fails instead of wiping the screen.
- **Server:** Node + Express. Each resource has its own route file (`auth.js`, `items.js`,
  `loans.js`, `bulk.js`, `dashboard.js`, `alerts.js`, `custodians.js`, `users.js`). Fees ended up in
  their own file, `fees.js`, exporting both an Express router (mounted inside `loans.js` with
  `router.use(feesRouter)`, so the routes still live under `/api/loans/:id/fees`) and two plain
  functions, `chargeLateFeeIfNeeded` and `chargeReplacementFee`, that `loans.js` calls directly when a
  loan is returned late or marked lost. That split exists because fee logic is used from two different
  places (the fee routes themselves, and the loan lifecycle routes) and duplicating it in both files
  would have been worse than one shared import.
- **Database:** PostgreSQL, accessed through the `pg` library directly — no ORM. A shared `pool` is
  imported wherever a query is needed, plus a `query()` helper wrapping `pool.query()` for anything
  that doesn't need a transaction.

## Where does each piece run?

- **Client:** Vercel, as a static build.
- **Server:** Render, as a web service.
- **Database:** a managed Postgres instance, connected to over `DATABASE_URL`.

## What is the request path for one representative user action, end to end?

Example: a member requests an item, and a librarian later issues it to a member who's close to
their borrowing limit — this is the path that actually needed the most care, since it's where the
borrowing-limit bug lived.

1. Librarian opens the item's detail page and uses the "Create Loan" form, picking a member from a
   dropdown and a due date. `ItemDetail.jsx` gets that dropdown's data from
   `GET /api/loans/member-limits`, which already marks a member as `atLimit` so the UI can grey them
   out before the request is even sent.
2. Frontend calls `POST /api/loans` with `{ item_id, borrower_id, due_date }`.
3. `requireAuth` middleware verifies the JWT and attaches `{ id, email, role }` to `req.user`.
4. The route works out `finalBorrowerId` — if a librarian passed a `borrower_id`, that's who the
   loan is for; otherwise it defaults to the person making the request. This one line is the fix for
   the original bug: the borrowing-limit check further down uses `finalBorrowerId`, not `req.user.id`,
   so it applies the same way whether a member is requesting for themselves or a librarian is creating
   the loan on their behalf.
5. `due_date`, if present, is checked against the database's own `CURRENT_DATE` rather than a date
   computed in Node — Node's `new Date()` is UTC and can disagree with the database's idea of "today"
   depending on server timezone, and this app needed one consistent definition of "today" across loans,
   fees, and alerts.
6. A database client is checked out from the pool and a transaction is opened. The borrower's row in
   `users` is locked with `SELECT ... FOR UPDATE`, which serializes concurrent loan-creation attempts
   for the same borrower — without it, two requests for the same member could both read "2 active
   loans" before either one commits its insert, and both would pass the limit check.
7. Inside that lock: the borrower's active loan count is checked against the limit (409 if at cap),
   the item is checked to exist and not be archived, and the item is checked for any existing open loan
   (409 if one exists).
8. If everything passes, the loan is inserted and the transaction commits. A `loan_events` row is
   logged afterward, outside the transaction, since that table only ever appends and doesn't need to be
   part of the same atomic unit as the loan write.
9. The partial unique index `one_open_loan_per_item` is still there as a backstop — if two requests
   somehow got past the application-level check anyway, the database itself rejects the second insert
   and the route returns a clean 409 instead of a raw constraint error.

The catalogue's own search and pagination follow the same server-side shape as loans:
`GET /api/items` accepts `search`, `page`, and `limit` query params, filters with `ILIKE` directly in
the SQL `WHERE` clause, and paginates with `LIMIT`/`OFFSET` plus a parallel `COUNT(*)` query for the
total — the frontend never filters a full in-memory list itself, and `Catalogue.jsx` debounces the
search box by 300ms before calling the backend so it isn't firing a request on every keystroke.

## What did you decide not to build, and why?

- **No refresh tokens.** A single JWT with a 7-day expiry was enough for a demo app.
- **No real-time updates.** The dashboard and alerts poll on an interval instead of pushing over a
  websocket — simpler to reason about, and the brief doesn't ask for live updates.
- **No per-member configurable borrowing limit.** `MAX_ACTIVE_LOANS_PER_MEMBER` is one fixed
  constant, not a column on `users`, since the brief only asks for the concept of a limit.
- **No proper transactional email provider with a verified domain.** Reminders go out through
  Resend's free-tier API instead, since setting up domain verification wasn't worth it for a demo
  feature (see decisions.md for the full story on why this isn't Nodemailer/Gmail anymore).

## Where does the server double-check what the client already checks?

Every real rule is enforced again on the server, not just hidden in the UI: `requireRole('librarian')`
on every librarian-only route, a member's loan queries restricted to `borrower_id = req.user.id` in
the `WHERE` clause itself rather than filtered afterward, and — the one that actually mattered — the
borrowing limit being checked against `finalBorrowerId` instead of `req.user.id`, so a librarian can't
use the "Create Loan" form to push a member past their cap just because the member themselves didn't
make the request. This was tested directly with a seeded member sitting right at the limit, confirming
both paths (member self-request, and librarian-created loan) get blocked the same way.

## What's still a known gap?

The borrowing limit is visible in two places now (`my-limit` for a member's own dashboard card, and
`member-limits` for the librarian's dropdown), but there's still no system-wide view showing a
librarian every member's standing at once outside that one dropdown — for example, nothing on the
dashboard flags "3 members are at their limit" the way overdue items get their own alert. It's
enforced everywhere it needs to be; it's just not surfaced as proactively as overdue loans are.
