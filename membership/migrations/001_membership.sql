CREATE TABLE IF NOT EXISTS union_schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE union_assignments (
  central_user_id text NOT NULL, experiment_version text NOT NULL, variant text NOT NULL CHECK (variant IN ('A','B')),
  first_product text NOT NULL, baseline_status text NOT NULL, is_test boolean NOT NULL DEFAULT false, enrolled_at bigint NOT NULL,
  PRIMARY KEY (central_user_id, experiment_version)
);
CREATE TABLE union_sessions (
  token_hash text PRIMARY KEY, central_user_id text NOT NULL, session_epoch integer NOT NULL, expires_at bigint NOT NULL
);
CREATE TABLE union_quotes (
  id text PRIMARY KEY, central_user_id text NOT NULL, plan_id text NOT NULL, snapshot jsonb NOT NULL, created_at bigint NOT NULL, expires_at bigint NOT NULL
);
CREATE TABLE union_orders (
  id text PRIMARY KEY, central_user_id text NOT NULL, idempotency_key text NOT NULL, plan_id text NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents > 0), currency text NOT NULL CHECK (currency = 'CNY'),
  status text NOT NULL CHECK (status IN ('pending','paid','refunding','refunded','closed')),
  snapshot jsonb NOT NULL, attribution jsonb NOT NULL, experiment_version text NOT NULL, variant text NOT NULL CHECK (variant = 'B'),
  is_test boolean NOT NULL DEFAULT false, provider_ref text UNIQUE, code_url text, created_at bigint NOT NULL, expires_at bigint NOT NULL, paid_at bigint,
  UNIQUE (central_user_id, idempotency_key)
);
CREATE UNIQUE INDEX union_one_pending_order ON union_orders(central_user_id) WHERE status = 'pending';
CREATE TABLE union_memberships (
  id text PRIMARY KEY, central_user_id text NOT NULL UNIQUE, status text NOT NULL CHECK (status IN ('activating','active','restoring','expired')),
  starts_at bigint NOT NULL, expires_at bigint NOT NULL, contracts jsonb NOT NULL, revision integer NOT NULL DEFAULT 1
);
CREATE TABLE union_tasks (
  id text PRIMARY KEY, membership_id text NOT NULL REFERENCES union_memberships(id), order_id text REFERENCES union_orders(id),
  product_id text NOT NULL, action text NOT NULL CHECK (action IN ('activate','extend','grant','restore','revoke')),
  payload jsonb NOT NULL, due_at bigint NOT NULL, status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','done')),
  attempts integer NOT NULL DEFAULT 0, lease_until bigint, last_error text, completed_at bigint
);
CREATE INDEX union_tasks_due ON union_tasks(due_at) WHERE status <> 'done';
CREATE TABLE union_events (
  id text PRIMARY KEY, central_user_id text NOT NULL, experiment_version text NOT NULL, variant text NOT NULL,
  product_id text NOT NULL, name text NOT NULL, context jsonb NOT NULL, occurred_at bigint NOT NULL, is_test boolean NOT NULL DEFAULT false
);
CREATE INDEX union_events_user ON union_events(central_user_id, occurred_at);
CREATE TABLE union_receipts (
  id text PRIMARY KEY, central_user_id text NOT NULL, product_id text NOT NULL, order_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('payment','refund','cost')), amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  occurred_at bigint NOT NULL, is_test boolean NOT NULL DEFAULT false, UNIQUE(product_id, order_id, kind, id)
);
CREATE TABLE union_refunds (
  id text PRIMARY KEY, order_id text NOT NULL UNIQUE REFERENCES union_orders(id), status text NOT NULL CHECK (status IN ('requested','processing','succeeded','failed')),
  actor text NOT NULL, created_at bigint NOT NULL, completed_at bigint
);
CREATE TABLE union_audit (
  id bigserial PRIMARY KEY, actor text NOT NULL, action text NOT NULL, target text NOT NULL, occurred_at bigint NOT NULL
);
