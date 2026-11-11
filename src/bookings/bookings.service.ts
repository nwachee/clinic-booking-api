import { Injectable } from "@nestjs/common";
import crypto from "crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { ApiError } from "../common/api-error";
import { DbService } from "../db/db.service";

const COLS = "id, slot_id, name, email, status, created_at";
const EMAIL = z.string().email().max(254);

// LEVEL 2: validation (trim, lower-case the email, reject empty fields)
const NewBooking = z.object({
  slot_id: z.string().trim().min(1),
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().toLowerCase().pipe(EMAIL),
});

// LEVEL 5: at most 5 attempts per email per minute, failed attempts included
const MAX_ATTEMPTS = 5;
const WINDOW_SECONDS = 60;

type Outcome = { status: number; body: any; replayed?: boolean };

const encodeCursor = (seq: string) => Buffer.from(seq).toString("base64url");
const decodeCursor = (c: string): string | null => {
  const s = Buffer.from(c, "base64url").toString();
  return /^\d+$/.test(s) ? s : null;
};

@Injectable()
export class BookingsService {
  constructor(private readonly db: DbService) {}

  // ---------- LEVEL 5: stored in Postgres so it survives restarts and multiple instances ----------
  private async checkRateLimit(email: string): Promise<void> {
    const c = await this.db.pool.connect();
    try {
      await c.query("BEGIN");
      // serialise attempts per email so parallel requests can't slip past the limit
      await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [email]);
      await c.query(`DELETE FROM booking_attempts WHERE email = $1 AND at <= now() - make_interval(secs => $2)`, [email, WINDOW_SECONDS]);
      const { rows } = await c.query(
        `SELECT count(*)::int AS n,
                CEIL(EXTRACT(EPOCH FROM (min(at) + make_interval(secs => $2) - clock_timestamp())))::int AS wait
         FROM booking_attempts WHERE email = $1`, [email, WINDOW_SECONDS]);
      if (rows[0].n >= MAX_ATTEMPTS) {
        await c.query("COMMIT");
        throw new ApiError(429, "too many booking attempts for this email, try again later",
          { "Retry-After": String(Math.max(1, rows[0].wait ?? WINDOW_SECONDS)) });
      }
      await c.query("INSERT INTO booking_attempts (email, at) VALUES ($1, clock_timestamp())", [email]);
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }

  // ---------- LEVEL 3: insert and let the partial unique index pick the winner ----------
  private async attemptBooking(client: PoolClient, b: { slot_id: string; name: string; email: string }): Promise<Outcome> {
    const slot = await client.query(`SELECT start_ts FROM slots WHERE id = $1`, [b.slot_id]);
    if (!slot.rows[0]) return { status: 404, body: { error: "slot not found" } };
    if (new Date(slot.rows[0].start_ts) <= new Date()) return { status: 400, body: { error: "slot has already started" } };

    await client.query("SAVEPOINT sp");
    try {
      const r = await client.query(
        `INSERT INTO bookings (slot_id, name, email) VALUES ($1,$2,$3) RETURNING ${COLS}`, [b.slot_id, b.name, b.email]);
      await client.query("RELEASE SAVEPOINT sp");
      return { status: 201, body: r.rows[0] };
    } catch (err: any) {
      if (err.code === "23505") {
        await client.query("ROLLBACK TO SAVEPOINT sp");
        return { status: 409, body: { error: "slot already booked" } };
      }
      throw err;
    }
  }

  // ---------- LEVELS 1-5: POST /bookings ----------
  async create(rawBody: unknown, idemKeyHeader?: string): Promise<Outcome> {
    const raw: any = rawBody && typeof rawBody === "object" && !Array.isArray(rawBody) ? rawBody : {};

    // Level 5 first: every attempt with a usable email counts, even ones that fail validation.
    const emailForLimit = typeof raw.email === "string" ? raw.email.trim().toLowerCase() : "";
    if (EMAIL.safeParse(emailForLimit).success) await this.checkRateLimit(emailForLimit);

    const parsed = NewBooking.safeParse(raw);
    if (!parsed.success) {
      const f = parsed.error.issues[0];
      throw new ApiError(400, `invalid ${f.path.join(".") || "body"}: ${f.message}`);
    }

    const idemKey = idemKeyHeader?.trim() || null;
    const hash = crypto.createHash("sha256").update(JSON.stringify(parsed.data)).digest("hex");

    const client = await this.db.pool.connect();
    try {
      await client.query("BEGIN");

      // LEVEL 4: concurrent requests with the same key wait here for the first one to finish.
      if (idemKey) {
        const ins = await client.query(
          `INSERT INTO idempotency_keys (key, request_hash) VALUES ($1,$2) ON CONFLICT (key) DO NOTHING RETURNING key`,
          [idemKey, hash]);
        if (ins.rowCount === 0) {
          const { rows } = await client.query(
            `SELECT request_hash, response_status, response_body FROM idempotency_keys WHERE key = $1`, [idemKey]);
          await client.query("ROLLBACK");
          if (rows[0].request_hash !== hash)
            throw new ApiError(422, "Idempotency-Key was already used with a different request body");
          return { status: rows[0].response_status, body: rows[0].response_body, replayed: true };
        }
      }

      const outcome = await this.attemptBooking(client, parsed.data);

      if (idemKey) {
        await client.query(`UPDATE idempotency_keys SET response_status = $2, response_body = $3 WHERE key = $1`,
          [idemKey, outcome.status, JSON.stringify(outcome.body)]);
      }
      await client.query("COMMIT");
      return outcome;
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  // ---------- LEVEL 4: oldest first, cursor pagination ----------
  async list(q: Record<string, unknown>) {
    const email = typeof q.email === "string" ? q.email.trim().toLowerCase() : "";
    if (!email) throw new ApiError(400, "email is required");

    let limit = 10;
    if (q.limit !== undefined) {
      const l = String(q.limit);
      if (!/^\d+$/.test(l) || Number(l) < 1 || Number(l) > 50) throw new ApiError(400, "limit must be between 1 and 50");
      limit = Number(l);
    }

    let after = "0";
    if (q.cursor !== undefined && q.cursor !== "") {
      const d = decodeCursor(String(q.cursor));
      if (d === null) throw new ApiError(400, "invalid cursor");
      after = d;
    }

    // fetch one extra row: if it exists there is another page
    const { rows } = await this.db.pool.query(
      `SELECT seq::text AS seq, ${COLS} FROM bookings
       WHERE lower(email) = $1 AND seq > $2::bigint ORDER BY seq ASC LIMIT $3`,
      [email, after, limit + 1]);
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    return {
      bookings: page.map(({ seq, ...b }) => b),
      next_cursor: hasMore ? encodeCursor(page[page.length - 1].seq) : null,
    };
  }

  // ---------- LEVEL 1 ----------
  async get(id: string) {
    const { rows } = await this.db.pool.query(`SELECT ${COLS} FROM bookings WHERE id = $1`, [id]);
    if (!rows[0]) throw new ApiError(404, "booking not found");
    return rows[0];
  }

  // ---------- LEVEL 3: cancel; a second cancel is 409 ----------
  async cancel(id: string) {
    const upd = await this.db.pool.query(
      `UPDATE bookings SET status = 'cancelled' WHERE id = $1 AND status = 'confirmed' RETURNING ${COLS}`, [id]);
    if (upd.rows[0]) return upd.rows[0];
    const ex = await this.db.pool.query(`SELECT id FROM bookings WHERE id = $1`, [id]);
    if (!ex.rows[0]) throw new ApiError(404, "booking not found");
    throw new ApiError(409, "booking already cancelled");
  }
}
