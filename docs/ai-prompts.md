# AI Prompts

The prompts below are listed in the order I used them during development, grouped by
the problem or decision they helped me address. For significant issues, I have included
the prompt, the guidance I received, and the changes or verification I performed before
using the result.

## Deciding Between Prisma and Raw SQL Before Writing the Schema

### Prompt

I'm a beginner and Prisma's schema syntax is confusing me more than helping. Would raw SQL with the
`pg` library be simpler for a project this size?

### What I got

Raw SQL was suggested as a simpler approach for this project because it avoided introducing an
additional ORM-specific schema syntax. It also allowed the same SQL to be used directly in
Supabase's SQL editor.

### What I corrected or verified

I removed Prisma and its generated client, installed `pg`, and rewrote the database connection
layer around a `pool.query()` wrapper.

---

## Handling Database Connections Dropped After Being Idle

### Prompt

I pasted a crash log showing `Connection terminated unexpectedly` from the `pg` pool, with the
server exiting after the database connection had been idle for some time.

### What I got

The guidance identified that `idleTimeoutMillis: 0` kept connections open indefinitely on the
application side, while the database/pooler could still close idle connections. Without a pool
error handler, such an event could result in an unhandled error.

### What I corrected or verified

I configured an appropriate idle timeout and added a `pool.on('error', ...)` handler so unexpected
connection termination would be handled without bringing down the entire server.

---

## Preventing Due Dates From Shifting by One Day

### Prompt

I issued a loan with due_date `2026-09-15` but the response shows
`2026-09-14T18:30:00.000Z`. Why is it off by a day?

### What I got

The issue was related to PostgreSQL `DATE` values being parsed by `pg` into JavaScript `Date`
objects, which can introduce timezone conversions when the value is serialized or displayed.

### What I corrected or verified

I added:

`types.setTypeParser(1082, value => value)`

to the database setup so PostgreSQL `DATE` values are returned as plain date strings instead of
being converted into JavaScript `Date` objects.

---

## Debugging a Route That Returned 404

### Prompt

GET `/api/alerts` gives a 404 even though the router is mounted and the server starts without
errors. Here's my `index.js` and `alerts.js`.

### What I got

The route definition and router mounting path were inconsistent. The effective URL depended on
how the router was mounted, which made the route difficult to reason about and caused the requested
endpoint not to resolve as intended.

### What I corrected or verified

I aligned the route definition with the router's mount path and verified that
`GET /api/alerts` resolved to the intended handler.

---

## Verifying Borrowing-Limit Enforcement

### Prompt

If a librarian creates a loan directly for a member through the item detail page, does my
per-member borrowing limit check still apply?

### What I got

The validation was based on the authenticated actor's role rather than the borrower associated
with the loan. As a result, a librarian-created loan could bypass a validation intended to apply
to the member receiving the loan.

### What I corrected or verified

I moved the validation to use `finalBorrowerId`, ensuring that the borrowing limit is checked
against the actual borrower regardless of who initiates the loan.

---

## Enforcing Dashboard Authorization on the Backend

### Prompt

My frontend only shows the dashboard breakdown to librarians, but does the backend actually
enforce that, or could a member call the API directly?

### What I got

The frontend restriction alone was not sufficient for authorization. The dashboard endpoint was
checking authentication but was not enforcing the librarian role at the API level.

### What I corrected or verified

I added a role check to the backend route so that only librarians could access the dashboard
breakdown. The response structure remained compatible with the existing frontend.

---

## Debugging a Blank White Screen

### Prompt

The whole app renders a blank page after adding new pages. Both backend and frontend are running
without terminal errors.

### What I got

The guidance suggested checking for a frontend runtime exception, particularly around imports,
exports, or newly added components. The browser console was the appropriate place to verify the
actual cause.

### What I corrected or verified

I checked the browser console and found an import mismatch involving `MyCustodianships.jsx`.
I corrected the import path and verified that the application rendered normally again.

---

## Implementing the Fee Waive Endpoint

### Prompt

The frontend calls `PATCH /api/loans/:id/fees/:feeId/waive` when I click Waive, but nothing
happens and no error shows. Here's `loans.js`.

### What I got

The frontend was calling an API endpoint that was not implemented in the backend, resulting in a
404 response that the UI was not displaying clearly.

### What I corrected or verified

I implemented the missing `PATCH /:id/fees/:feeId/waive` route and verified its placement relative
to the other loan routes so that it would resolve correctly.

Later, as fee-related functionality expanded, the fee logic was moved into a dedicated `fees.js`
module so it could be shared by the loan return and lost-item flows.

---

## Preventing Repeated Reminder Emails

### Prompt

I noticed that if I click "Send Reminder" multiple times on the same loan, another email is sent
every time. Is that a problem, and how could I prevent it?

### What I got

The existing system did not track recent reminder activity, so repeated requests could result in
multiple reminder emails. A cooldown based on the existing `loan_events` table was suggested
instead of introducing another database column.

### What I corrected or verified

I added a cooldown check against `loan_events` before sending a reminder. If a matching reminder
had been sent within the previous 60 minutes, the API returns `429` instead of sending another
email.

---

## Testing Duplicate Loans for Overdue Items

### Prompt

How can I verify, without waiting several days, that an already-overdue loan still prevents a
new loan from being created for the same item?

### What I got

The suggested approach was to create the loan normally through the API and then temporarily update
its `due_date` directly in the database to a past date. This allows the overdue behavior to be
tested without waiting for real time to pass.

### What I corrected or verified

I followed this test sequence and verified that:

1. The existing loan became overdue.
2. The alerts endpoint reflected the overdue state.
3. A new loan request for the same item returned `409`.
4. The duplicate-loan protection therefore remained active even after the original loan became
   overdue.

---

## Handling a Deleted User Referenced by an Existing JWT

### Prompt

I pasted a stack trace showing:

`insert or update on table "loan_events" violates foreign key constraint "loan_events_actor_id_fkey"`

The error occurred immediately after issuing a loan.

### What I got

The JWT contained a user ID that no longer existed in the `users` table. The token could still be
accepted because JWT validation did not automatically verify that the referenced user still
existed in the database.

### What I corrected or verified

I created a fresh librarian account and used a new token rather than continuing to use the token
associated with the deleted database record.

---

## Deciding How CSV Import Should Handle Invalid Rows

### Prompt

Should a bad row in the bulk item CSV import stop the entire file from being processed?

### What I got

The assignment required individual row-level results, meaning valid rows should still be imported
even when other rows contain validation errors.

### What I corrected or verified

I processed each row independently and collected a result for each one in the form:

`{ row, success, error }`

This allows successful rows to be imported while invalid rows are reported separately.

---

## Organizing Git Commits

### Prompt

I have a large set of frontend and backend changes. How should I split them into logically
separate commits instead of creating one large commit?

### What I got

The suggested approach was to group commits by feature or concern and use descriptive conventional
commit prefixes such as `feat:` and `fix:`.

### What I corrected or verified

I separated the changes into logical backend and frontend commits. Before each commit, I also
checked `git status` to make sure sensitive files such as `.env` were not accidentally staged.

---

## Reviewing the Seed Data for Database Constraint Conflicts

### Prompt

I need a large seed script covering the required goals and stretch features with realistic data.
Can you also review it for conflicts before I run it?

### What I got

The initial review identified that the same item, `laptop1`, was being used in two scenarios that
would result in simultaneously open loans. This would conflict with the database rule requiring
one open loan per item.

### What I corrected or verified

I changed one scenario to use a different item and reviewed the rest of the seed data for similar
conflicts before executing it.

This verification was important because the generated seed data needed to satisfy the application's
actual database constraints, not just look realistic.
