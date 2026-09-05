# Submission

## Links

- **GitHub repository:** https://github.com/sajid051103/asset-lending-system
- **Live application:** https://asset-lending-system-o3ef-six.vercel.app/login

## Notes for the reviewer

The backend is hosted on a free tier and may sleep after a period of inactivity. If the first request takes 30-60 seconds to respond, that's the service waking up, not a bug — please retry after a short wait.

The database is seeded with demo catalogue items, loans across different lifecycle states (requested, issued, returned, lost, overdue), custodian assignments, and enough history to exercise the dashboard, alerts, and bulk-action features.

## Demo credentials

| Role      | Email               | Password    |
| --------- | ------------------- | ----------- |
| Librarian | librarian1@test.com | password123 |
| Member    | member1@test.com    | password123 |

## Stack

| Layer    | What you used                                             | Why                                                                             |
| -------- | --------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Frontend | React + Vite                                              | Fast to build with, component-based UI                                          |
| Backend  | Node.js + Express                                         | Lightweight REST API with server-side role and lifecycle enforcement            |
| Database | PostgreSQL                                                | Relational model suited to items, loans, custodians, and immutable loan history |
| Hosting  | Vercel (frontend) + Render (backend) + managed PostgreSQL | Free-tier hosting, clean separation of frontend/backend                         |

## Goal checklist

| #   | Goal                      | Status | Notes                                                                                                                                                                                                                                   |
| --- | ------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Accounts and roles        | Done   | Email/password auth with librarian and member roles. Role checks (issue, return, mark lost) are enforced server-side, not just hidden in the UI.                                                                                        |
| 2   | Catalogue items           | Done   | Librarians create, edit, archive, and restore items. Archiving hides an item from the default catalogue view without deleting its loan history.                                                                                         |
| 3   | Loans                     | Done   | Every loan is tied to one item and one borrower, with requested date and due date. Members can request; librarians can also create loans directly. Item detail shows full loan history.                                                 |
| 4   | Loan lifecycle with rules | Done   | Requested → Issued → Returned, with Lost possible while Issued. Overdue is computed on view, not stored. Server refuses to issue an item with any open loan (requested or issued), and rejects other illegal transitions with a reason. |
| 5   | Custodians                | Done   | Librarians can be assigned as custodians to any number of items; each librarian has a "My Custodianships" view alongside the full catalogue.                                                                                            |
| 6   | Finding loans             | Done   | Server-side text search (item title + borrower), status/item/borrower filters, sorting by due date/requested date/status, and pagination with total match count.                                                                        |
| 7   | Bulk actions              | Done   | CSV bulk-import of catalogue items with a per-row success/failure report; bulk return of selected issued loans with a per-loan result; CSV export of everything currently on loan.                                                      |
| 8   | Dashboard                 | Done   | Headline numbers (items out, overdue, returned this week, total items), status and custodian breakdowns, and an 8-week returned-items chart.                                                                                            |
| 9   | History                   | Done   | Every loan has an immutable timeline (requested/issued/returned/lost) with actor, timestamp, and notes. Nothing can be edited or deleted after the fact.                                                                                |
| 10  | Overdue loan alerts       | Done   | Alerts area with nav badge count for issued+overdue loans. Librarians can dismiss an alert, and it reappears if the item is issued again and becomes overdue on the new loan.                                                           |

## Stretch features built

- **Late fees / replacement charges with waivers** — fees are generated against a loan (late or replacement type) and can be waived by a librarian.
- **Email reminders** — reminder emails sent ahead of a loan's due date.
- **Per-member borrowing limits** — members are capped at a fixed number of concurrent open loans.
- **Most-borrowed items report** — a report ranking catalogue items by loan count.

## How much time did you actually spend?

Approximately 14-16 hours.

## What would you do next, with another 12 hours?

1. Add automated backend tests around the loan lifecycle rules, the one-open-loan-per-item constraint, and bulk actions — these were tested manually and thoroughly, but a regression wouldn't be caught automatically.
2. Move the catalogue list to server-side search/filter/pagination for consistency with the loans list, rather than the current client-side filter.
3. Move outbound email reminders off a personal email account onto a proper transactional email provider.
4. Make the per-member borrowing limit configurable per user instead of a shared constant.
5. Revisit dashboard/report endpoints once more to make sure every role restriction enforced in the UI is also enforced server-side.

## What are you least happy with in this codebase, and why?

I'm least happy with how the per-member borrowing limit is enforced. It's checked correctly at the point a loan is created, but a librarian has no way to see it anywhere else in the system — not on the dashboard, not on a member's profile — so the only time it ever surfaces is as a rejection the moment someone tries to go over it. It works, but it's reactive rather than visible, and a librarian managing the catalogue would probably want to see who's close to their limit before it becomes a blocked request.
