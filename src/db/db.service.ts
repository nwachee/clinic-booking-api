import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Pool } from "pg";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS slots (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  provider    TEXT NOT NULL,
  start_time  TEXT NOT NULL,          -- echoed back exactly as the client sent it
  end_time    TEXT NOT NULL,
  start_ts    TIMESTAMPTZ NOT NULL    -- parsed copy, used for sorting and "already started"
);

CREATE TABLE IF NOT EXISTS bookings (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  seq         BIGSERIAL NOT NULL,     -- insertion order, powers the pagination cursor
  slot_id     TEXT NOT NULL REFERENCES slots(id),
  name        TEXT NOT NULL,
  email       TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','cancelled')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- LEVEL 3: the database guarantees one ACTIVE booking per slot.
CREATE UNIQUE INDEX IF NOT EXISTS one_active_booking_per_slot
  ON bookings (slot_id) WHERE status = 'confirmed';
CREATE INDEX IF NOT EXISTS bookings_email_seq_idx ON bookings (lower(email), seq);

-- LEVEL 4: remembers the response for each Idempotency-Key.
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key              TEXT PRIMARY KEY,
  request_hash     TEXT NOT NULL,
  response_status  INT,
  response_body    JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- LEVEL 5: one row per booking attempt, per email.
CREATE TABLE IF NOT EXISTS booking_attempts (
  email  TEXT NOT NULL,
  at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS booking_attempts_email_at_idx ON booking_attempts (email, at);
`;

// ONE shared pool for the whole app (Nest creates this provider once).
@Injectable()
export class DbService implements OnModuleInit, OnModuleDestroy {
  readonly pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: false } : false,
    max: 10,
  });

  // Runs automatically when the module starts: create tables, and (only if
  // SEED_DEMO_DATA=true) fill an empty database with demo slots.
  async onModuleInit() {
    await this.pool.query(SCHEMA);
    if (process.env.SEED_DEMO_DATA !== "true") return;
    await this.pool.query(`
      INSERT INTO slots (provider, start_time, end_time, start_ts)
      SELECT p.name,
             to_char(x.t AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
             to_char((x.t + interval '30 minutes') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
             x.t
      FROM (VALUES ('Dr Ade'), ('Dr Okafor')) AS p(name),
           generate_series(date_trunc('day', now()) + interval '1 day',
                           date_trunc('day', now()) + interval '7 days',
                           interval '1 day') AS d,
           generate_series(9, 16) AS h,
           LATERAL (SELECT d + make_interval(hours => h) AS t) AS x
      WHERE NOT EXISTS (SELECT 1 FROM slots);
    `);
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
