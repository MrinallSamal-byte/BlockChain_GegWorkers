-- VGDP Validator PostgreSQL Schema
-- Apply with: psql $DATABASE_URL -f schema.sql

CREATE TABLE IF NOT EXISTS orders (
  id                BIGSERIAL PRIMARY KEY,
  company_id        TEXT NOT NULL,
  order_id          TEXT NOT NULL,
  order_id_hash     CHAR(66) NOT NULL UNIQUE,
  rider_id          TEXT NOT NULL,
  rider_did         TEXT NOT NULL,
  rider_did_hash    CHAR(66) NOT NULL,
  target_lat_e7     INTEGER NOT NULL,
  target_lon_e7     INTEGER NOT NULL,
  radius_meters     INTEGER NOT NULL CHECK (radius_meters > 0 AND radius_meters <= 1000),
  webhook_url       TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status            TEXT NOT NULL DEFAULT 'registered'
                      CHECK (status IN ('registered','proof_submitted','disputed','resolved')),
  proof_id          CHAR(66),
  tx_hash           TEXT,
  UNIQUE (company_id, order_id)
);

CREATE INDEX IF NOT EXISTS idx_orders_order_id_hash ON orders (order_id_hash);
CREATE INDEX IF NOT EXISTS idx_orders_company_order ON orders (company_id, order_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status);

CREATE TABLE IF NOT EXISTS proof_bundles (
  id                    BIGSERIAL PRIMARY KEY,
  order_id_hash         CHAR(66) NOT NULL REFERENCES orders (order_id_hash),
  zk_proof_hash         CHAR(66) NOT NULL,
  photo_hash_commitment CHAR(66) NOT NULL,
  timestamp_hash        CHAR(66) NOT NULL,
  rider_did_hash        CHAR(66) NOT NULL,
  merkle_root           CHAR(66) NOT NULL,
  delivered_at_epoch    BIGINT NOT NULL,
  bundle_nonce          CHAR(66) NOT NULL,
  submitted_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_proof_bundles_order ON proof_bundles (order_id_hash);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id                BIGSERIAL PRIMARY KEY,
  order_id          TEXT NOT NULL,
  event_type        TEXT NOT NULL,
  payload_json      JSONB NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','delivered','failed')),
  attempts          INTEGER NOT NULL DEFAULT 0,
  last_attempted_at TIMESTAMPTZ,
  delivered_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_webhooks_status ON webhook_deliveries (status);
CREATE INDEX IF NOT EXISTS idx_webhooks_order ON webhook_deliveries (order_id);

CREATE TABLE IF NOT EXISTS dispute_records (
  id                BIGSERIAL PRIMARY KEY,
  proof_id          CHAR(66) NOT NULL UNIQUE,
  order_id_hash     CHAR(66) NOT NULL,
  rider_did_hash    CHAR(66) NOT NULL,
  outcome           TEXT NOT NULL
                      CHECK (outcome IN ('unknown','rider_vindicated','customer_refund')),
  resolved_at_epoch BIGINT NOT NULL,
  tx_hash           TEXT NOT NULL,
  resolver_address  TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_disputes_order ON dispute_records (order_id_hash);
CREATE INDEX IF NOT EXISTS idx_disputes_rider ON dispute_records (rider_did_hash);
