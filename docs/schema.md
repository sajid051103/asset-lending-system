# Schema Design

## Tables and Columns

### users

| Column        | Type                     | Notes                                  |
| ------------- | ------------------------ | -------------------------------------- |
| id            | UUID                     | Primary key, default gen_random_uuid() |
| email         | TEXT                     | Unique, required                       |
| password_hash | TEXT                     | Required                               |
| name          | TEXT                     | Required                               |
| role          | Enum (librarian, member) | Required                               |
| created_at    | TIMESTAMPTZ              | Default now                            |

### catalogue_items

| Column      | Type        | Notes            |
| ----------- | ----------- | ---------------- |
| id          | UUID        | Primary key      |
| title       | TEXT        | Required         |
| category    | TEXT        | Required         |
| code        | TEXT        | Unique, required |
| is_archived | BOOLEAN     | Default false    |
| created_at  | TIMESTAMPTZ | Default now      |
| updated_at  | TIMESTAMPTZ | Default now      |

### custodians (join table between items and librarians)

| Column       | Type | Notes                                              |
| ------------ | ---- | -------------------------------------------------- |
| id           | UUID | Primary key                                        |
| item_id      | UUID | Foreign key to catalogue_items, cascades on delete |
| librarian_id | UUID | Foreign key to users, cascades on delete           |

Unique on (item_id, librarian_id) so the same pair can't be added twice.

### loans

| Column       | Type                                     | Notes                          |
| ------------ | ---------------------------------------- | ------------------------------ |
| id           | UUID                                     | Primary key                    |
| item_id      | UUID                                     | Foreign key to catalogue_items |
| borrower_id  | UUID                                     | Foreign key to users           |
| status       | Enum (requested, issued, returned, lost) | Default requested              |
| requested_at | TIMESTAMPTZ                              | Default now                    |
| due_date     | DATE                                     | Set once issued                |
| issued_at    | TIMESTAMPTZ                              | Set once issued                |
| returned_at  | TIMESTAMPTZ                              | Set once returned              |

Partial unique index on item_id, only for rows where status is requested or issued — this is what
stops an item having two open loans at the same time.

### loan_events (audit log, never updated or deleted)

| Column     | Type                                           | Notes                                       |
| ---------- | ---------------------------------------------- | ------------------------------------------- |
| id         | UUID                                           | Primary key                                 |
| loan_id    | UUID                                           | Foreign key to loans, cascades on delete    |
| event_type | Enum (requested, issued, returned, lost, note) | Required                                    |
| actor_id   | UUID                                           | Foreign key to the user who made the change |
| note       | TEXT, optional                                 | Librarian's note, if any                    |
| created_at | TIMESTAMPTZ                                    | Default now                                 |

### dismissed_alerts

| Column       | Type        | Notes                                    |
| ------------ | ----------- | ---------------------------------------- |
| id           | UUID        | Primary key                              |
| loan_id      | UUID        | Foreign key to loans, cascades on delete |
| dismissed_by | UUID        | Foreign key to users                     |
| dismissed_at | TIMESTAMPTZ | Default now                              |

Unique on loan_id — one dismissal per loan. Keyed on the loan, not the item, so a new loan on the
same item starts with no dismissal of its own.

### fees (stretch feature: late fees + replacement charges)

| Column     | Type                     | Notes                                    |
| ---------- | ------------------------ | ---------------------------------------- |
| id         | UUID                     | Primary key                              |
| loan_id    | UUID                     | Foreign key to loans, cascades on delete |
| fee_type   | Enum (late, replacement) | Required                                 |
| amount     | NUMERIC(10,2)            | Required                                 |
| waived     | BOOLEAN                  | Default false                            |
| created_at | TIMESTAMPTZ              | Default now                              |

## Relationships

| Relationship                                   | Type                                        |
| ---------------------------------------------- | ------------------------------------------- |
| users to loans (as borrower)                   | One to many                                 |
| catalogue_items to loans                       | One to many                                 |
| loans to loan_events                           | One to many                                 |
| loans to fees                                  | One to many                                 |
| loans to dismissed_alerts                      | One to one, in practice (unique on loan_id) |
| users and catalogue_items (through custodians) | Many to many                                |

## What's enforced by the database vs by the code

### Database handles

- Foreign keys on every table
- Unique email, unique item code
- Unique (item_id, librarian_id) on custodians, unique loan_id on dismissed_alerts
- Valid enum values for role, loan status, event type, fee type
- The partial unique index that blocks two open loans on the same item

### Code handles, and why

- Which role can do what — issue, return, mark lost, dismiss an alert. Role isn't something a column
  constraint can express, so this lives in middleware.
- Legal status transitions — a loan can only move to returned from issued, not from requested. Lives
  in the route handler, checked before the update runs, so a rejected move gets a plain-language reason
  back to the frontend instead of a raw database error.
- The one-open-loan-per-item rule was originally only an application check. Testing showed two
  requests landing at nearly the same time could both pass it before either insert finished — a real
  race condition. That's why the partial unique index above exists now too: the application check
  still runs first for a clean error message, but the database backs it up in case the application
  check is ever wrong or skipped.
- Per-member borrowing limit (stretch feature) — checked live against the member's current open loans,
  not a stored counter.

## Choices that trade off pure normalization for simplicity

- `due_date`, `issued_at`, and `returned_at` live directly on `loans`, even though the same
  information also exists as timestamped rows in `loan_events`. Kept both because checking "is this
  loan overdue" or sorting by due date only needs one indexed column this way, instead of joining out
  to `loan_events` and picking the latest matching timestamp every time. `loan_events` stays the full
  history; the columns on `loans` are a working copy of the couple of dates that get queried the most.

## What would break first at a much bigger scale

1. `loan_events` never gets pruned, so it's the biggest table by a wide margin. It's fine as long as
   it's only queried per loan (which is all it's used for now, and the index covers that), but a
   system-wide report across every event would need a different index.
2. The text search on the loans list (item title + borrower) uses ILIKE, not a full-text
   index. Fine at the current size, but the first query that would need something like `pg_trgm` at real
   scale.
3. The dashboard's status/custodian breakdowns and the 8-week chart run GROUP BY over the whole loans
   and events tables on every page load, with nothing cached. That'd be the first thing to visibly slow
   down.
