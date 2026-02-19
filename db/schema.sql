-- AgencyZoom Sales Dashboard Schema
-- Run once to initialize: psql -d <your_db> -f db/schema.sql

-- ── API Response Cache ────────────────────────────────────────────────────────
-- Stores AgencyZoom API responses keyed by endpoint + params.
-- TTL is enforced in application logic (see db/index.js).
CREATE TABLE IF NOT EXISTS az_cache (
  key         VARCHAR(512)  PRIMARY KEY,
  data        JSONB         NOT NULL,
  fetched_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ   NOT NULL
);

CREATE INDEX IF NOT EXISTS az_cache_expires ON az_cache (expires_at);

-- ── Policies ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS policies (
  id              VARCHAR(64)   PRIMARY KEY,
  policy_number   VARCHAR(64),
  line_of_business VARCHAR(64),   -- auto, home, life, commercial, etc.
  carrier         VARCHAR(128),
  premium         NUMERIC(12,2),
  status          VARCHAR(32),    -- active, cancelled, lapsed, etc.
  type            VARCHAR(16),    -- new_business | renewal
  effective_date  DATE,
  expiration_date DATE,
  insured_name    VARCHAR(256),
  producer_id     VARCHAR(64),
  producer_name   VARCHAR(128),
  synced_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS policies_effective_date ON policies (effective_date);
CREATE INDEX IF NOT EXISTS policies_producer_id    ON policies (producer_id);
CREATE INDEX IF NOT EXISTS policies_status         ON policies (status);
CREATE INDEX IF NOT EXISTS policies_type           ON policies (type);

-- ── Leads ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leads (
  id            VARCHAR(64)   PRIMARY KEY,
  name          VARCHAR(256),
  source        VARCHAR(64),   -- referral, web_form, social, cold_call, etc.
  status        VARCHAR(32),   -- new, contacted, quoted, proposal, won, lost
  line_of_business VARCHAR(64),
  assigned_to   VARCHAR(128),
  created_at    TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ,
  synced_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS leads_status     ON leads (status);
CREATE INDEX IF NOT EXISTS leads_source     ON leads (source);
CREATE INDEX IF NOT EXISTS leads_created_at ON leads (created_at);

-- ── Activity Log ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS activities (
  id            VARCHAR(64)   PRIMARY KEY,
  type          VARCHAR(64),   -- policy_bound, lead_created, renewal_confirmed, etc.
  description   TEXT,
  related_id    VARCHAR(64),
  producer_name VARCHAR(128),
  premium       NUMERIC(12,2),
  occurred_at   TIMESTAMPTZ,
  synced_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS activities_occurred_at ON activities (occurred_at DESC);
