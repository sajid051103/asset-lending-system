CREATE TYPE user_role AS ENUM ('librarian', 'member');

CREATE TABLE users (
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
email TEXT NOT NULL UNIQUE,
password_hash TEXT NOT NULL,
name TEXT NOT NULL,
role user_role NOT NULL,
created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_users_name ON users (name);

CREATE TABLE catalogue_items (
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
title TEXT NOT NULL,
category TEXT NOT NULL,
code TEXT NOT NULL UNIQUE,
is_archived BOOLEAN NOT NULL DEFAULT false,
created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_items_title ON catalogue_items (title);
CREATE INDEX idx_items_archived ON catalogue_items (is_archived);

CREATE TABLE custodians (
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
item_id UUID NOT NULL REFERENCES catalogue_items(id) ON DELETE CASCADE,
librarian_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
UNIQUE (item_id, librarian_id)
);
CREATE INDEX idx_custodians_librarian ON custodians (librarian_id);

CREATE TYPE loan_status AS ENUM ('requested', 'issued', 'returned', 'lost');
CREATE TABLE loans (
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
item_id UUID NOT NULL REFERENCES catalogue_items(id),
borrower_id UUID NOT NULL REFERENCES users(id),
status loan_status NOT NULL DEFAULT 'requested',
requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
due_date DATE,
issued_at TIMESTAMPTZ,
returned_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX one_open_loan_per_item ON loans (item_id) WHERE status IN ('requested', 'issued');
CREATE INDEX idx_loans_status ON loans (status);
CREATE INDEX idx_loans_due_date ON loans (due_date);
CREATE INDEX idx_loans_item ON loans (item_id);
CREATE INDEX idx_loans_borrower ON loans (borrower_id);
CREATE INDEX idx_loans_requested_at ON loans (requested_at);

CREATE TYPE loan_event_type AS ENUM ('requested', 'issued', 'returned', 'lost', 'note');
CREATE TABLE loan_events (
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
loan_id UUID NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
event_type loan_event_type NOT NULL,
actor_id UUID NOT NULL REFERENCES users(id),
note TEXT,
created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_loan_events_loan ON loan_events (loan_id);

CREATE TABLE dismissed_alerts (
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
loan_id UUID NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
dismissed_by UUID NOT NULL REFERENCES users(id),
dismissed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
UNIQUE (loan_id)
);
