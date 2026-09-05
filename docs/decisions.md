# Decisions

These are the main engineering decisions that shaped the implementation — places where there was a
genuine alternative and I had to pick one approach over another based on the brief, the time budget,
or something I found while testing. Grouped by whether the decision was about one of the 10 required
goals, or about a stretch feature I added on top.

## Core goal decisions

## Decision 1 — Raw SQL with `pg` instead of an ORM

- **Chose:** Raw SQL with the `pg` library for all database access.
- **Rejected:** Prisma as an ORM.
- **Why:** I started with Prisma, but its schema syntax and migration workflow were adding a learning
  curve on top of everything else I was already learning for this assignment, and that didn't fit the
  time I had. Switching to raw SQL meant every query was something I wrote and could actually explain,
  and I could paste the same SQL directly into Supabase's SQL editor to create tables — no separate
  migration tool to pick up at the same time. Given the amount of new ground already being covered
  (auth, the lifecycle rules, server-side search), keeping the database layer as plain SQL was the
  right trade-off for actually understanding what I shipped.

## Decision 2 — Overdue is computed, never stored (Goal 4)

- **Chose:** Treat "overdue" as a computed value (`status = 'issued' AND due_date < today`), never
  stored as its own status in the database.
- **Rejected:** Adding an `overdue` value to the loan status enum, updated by a background job.
- **Why:** The brief is explicit about this ("computed whenever it's viewed rather than stored as a
  state of its own"), so this one was a direct requirement rather than something I weighed myself.

## Decision 3 — A database-level constraint against duplicate open loans (Goal 4)

- **Chose:** A partial unique index (`one_open_loan_per_item`) restricted to rows where status is
  `requested` or `issued`, so an item can never end up with two open loans.
- **Rejected:** Relying only on an application-level check before inserting a new loan.
- **Why:** I had the application check written first and it worked in normal testing, but it occurred
  to me that two requests arriving at almost the same instant could both pass that check before either
  insert finished — a genuine race condition. Adding the constraint at the database level closes that
  gap regardless of timing, so the rule holds even if my own application code has a bug in it later.

## Decision 4 — An append-only `loan_events` table (Goal 9)

- **Chose:** An append-only `loan_events` table, with no update or delete route ever written against
  it.
- **Rejected:** Storing the latest note/state directly on the `loans` row and overwriting it as things
  change.
- **Why:** The brief requires history that can't be rewritten, including by librarians. I decided the
  simplest way to actually guarantee that was to never write the capability in the first place — there's
  no route in the codebase that could modify a past event even if someone wanted one, rather than
  relying on a permissions check that could have a bug.

## Decision 5 — Key alert dismissals on the loan, not the item (Goal 10)

- **Chose:** Key the `dismissed_alerts` table on `loan_id`, not `item_id`.
- **Rejected:** Keying dismissals on the item itself.
- **Why:** The brief requires a dismissed alert to reappear once the same item is issued again and
  goes overdue on the new loan. I worked backwards from that requirement: if dismissals were keyed on
  the item, I'd have needed extra code to actively clear the dismissal every time the item was
  re-issued. Keying on the loan instead meant the new loan simply has no dismissal row of its own — the
  reappearing behavior falls out of the schema for free, no extra logic needed.

## Decision 6 — Dashboard breakdown restricted to librarians (Goal 8)

- **Chose:** Restrict the dashboard's status/custodian breakdown panels to librarians only, showing
  members just their own headline numbers.
- **Rejected:** Showing the identical full breakdown to every logged-in user.
- **Why (Later reversed):** The brief doesn't say anything about who should see the dashboard
  breakdown, so this was my own call either way. I first removed the role restriction entirely,
  reasoning "if it's not forbidden, show everyone the same thing." I reversed that almost immediately
  after looking at it again — the breakdown is operational data (who's responsible for what,
  system-wide counts) that's genuinely more useful to someone managing the catalogue than to a member
  checking on their own items, so I put the restriction back.

## Stretch feature decisions

## Decision 7 — A separate `fees` table instead of columns on `loans`

- **Chose:** A separate `fees` table (`loan_id`, `fee_type`, `amount`, `waived`) instead of extra
  columns on `loans`.
- **Rejected:** Adding `late_fee_amount` and `replacement_charge` columns directly to the loans table.
- **Why:** This is a stretch feature, not required by the brief. I chose a separate table because a
  loan could end up with more than one charge over time, and keeping fees out of the loans table meant
  the loan model stayed focused on the lifecycle (requested/issued/returned/lost), not billing. It also
  meant I could add a "waive" action later without ever touching the loans table.

## Decision 8 — Email reminders through Resend's HTTP API, not SMTP

- **Chose:** Send reminder emails through Resend's HTTP API, using a personal domain-less sender
  address, triggered manually by a librarian clicking a button.
- **Rejected:** Nodemailer over SMTP with a personal Gmail account and app password (what I actually
  built first), and separately, a scheduled job that auto-sends reminders every day without a person
  triggering them.
- **Why (Later reversed):** I originally built this with Nodemailer against Gmail's SMTP server,
  since an app password was quick to set up and it worked fine locally. After deploying the backend to
  Render, the same code stopped sending — Render's free tier blocks outbound SMTP ports, so the
  Gmail-based version only ever worked on my machine, not in production. Rather than pay for a tier
  that allows SMTP, I switched to Resend's plain HTTPS API, which isn't blocked by the same restriction
  and needed almost no code change on the call site — `loans.js` still calls the same
  `transporter.sendMail({ to, subject, text })` shape, just backed by a `fetch()` call instead of
  Nodemailer. I also considered a daily cron job instead of a manual button, but the same free-tier
  sleep behavior that would silently skip a scheduled run made a manual trigger the more honest way to
  demonstrate the feature actually working end to end.

## Decision 9 — A reminder cooldown reusing `loan_events`, not a new column

- **Chose:** A 60-minute cooldown per loan on the reminder route, checked by looking at the most
  recent matching row in the existing `loan_events` table.
- **Rejected:** No rate limit at all, and separately, adding a new `last_reminder_sent_at` column
  just for this.
- **Why:** While testing the reminder button I noticed clicking it repeatedly just fired an email
  every single time with nothing stopping it — a real gap I found by trying to break my own feature.
  Rather than add a new column purely to track this, I reused the event log that already records
  exactly when a reminder was last sent, since that data already existed.

## Decision 10 — Borrowing limit follows the borrower, not the requester

- **Chose:** Check the per-member borrowing limit against the loan's actual borrower, regardless of
  who is creating the loan.
- **Rejected:** Only checking the limit when a member requests an item for themselves.
- **Why (Later reversed):** This is a stretch feature I added myself, and I originally only ran the
  check when the person making the request was a member — assuming a librarian creating a loan directly
  for someone should be able to override the cap. While testing I found this let a librarian push a
  member past their limit through the "create loan" form on an item's page, since that path never
  triggered the check at all. I reversed it so the limit follows whoever the loan is actually for, not
  who happens to submit the request.
