import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { ApiError } from "../common/api-error";
import { DbService } from "../db/db.service";

const DateStr = z.string().min(1).refine((v) => !isNaN(Date.parse(v)), "must be an ISO date-time");
const SlotIn = z.object({
  id: z.union([z.string().min(1), z.number()]),
  provider: z.string().min(1),
  start: DateStr,
  end: DateStr,
});
const ResetBody = z.union([z.object({ slots: z.array(SlotIn) }), z.array(SlotIn)]);

// id is optional here; if omitted the database generates one.
const CreateSlotIn = z.object({
  id: z.union([z.string().min(1), z.number()]).optional(),
  provider: z.string().trim().min(1),
  start: DateStr,
  end: DateStr,
}).refine((s) => Date.parse(s.end) > Date.parse(s.start), { message: "end must be after start" });
const CreateBody = z.union([
  z.object({ slots: z.array(CreateSlotIn).min(1).max(200) }),
  z.array(CreateSlotIn).min(1).max(200),
  CreateSlotIn,
]);

@Injectable()
export class SlotsService {
  constructor(private readonly db: DbService) {}

  // LEVEL 1: deletes every booking and replaces all slots (past ones included).
  async reset(body: unknown) {
    const parsed = ResetBody.safeParse(body);
    if (!parsed.success) throw new ApiError(400, 'body must be {"slots": [{id, provider, start, end}]}');
    const slots = Array.isArray(parsed.data) ? parsed.data : parsed.data.slots;

    const client = await this.db.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM booking_attempts");
      await client.query("DELETE FROM idempotency_keys");
      await client.query("DELETE FROM bookings");
      await client.query("DELETE FROM slots");
      for (const s of slots) {
        await client.query(
          `INSERT INTO slots (id, provider, start_time, end_time, start_ts) VALUES ($1,$2,$3,$4,$5)`,
          [String(s.id), s.provider, s.start, s.end, new Date(s.start)]);
      }
      await client.query("COMMIT");
      return { slots: slots.map((s) => ({ id: String(s.id), provider: s.provider, start: s.start, end: s.end })) };
    } catch (e: any) {
      await client.query("ROLLBACK").catch(() => {});
      if (e.code === "23505") throw new ApiError(400, "duplicate slot id");
      throw e;
    } finally {
      client.release();
    }
  }

  async create(body: unknown) {
    const parsed = CreateBody.safeParse(body);
    if (!parsed.success) throw new ApiError(400, 'body must be {"slots": [{provider, start, end}]} with end after start');
    const d = parsed.data as any;
    const slots: z.infer<typeof CreateSlotIn>[] = Array.isArray(d) ? d : d.slots ?? [d];

    const client = await this.db.pool.connect();
    try {
      await client.query("BEGIN");
      const out = [];
      for (const s of slots) {
        const r = s.id !== undefined
          ? await client.query(`INSERT INTO slots (id, provider, start_time, end_time, start_ts) VALUES ($1,$2,$3,$4,$5)
                                RETURNING id, provider, start_time AS start, end_time AS "end"`,
              [String(s.id), s.provider, s.start, s.end, new Date(s.start)])
          : await client.query(`INSERT INTO slots (provider, start_time, end_time, start_ts) VALUES ($1,$2,$3,$4)
                                RETURNING id, provider, start_time AS start, end_time AS "end"`,
              [s.provider, s.start, s.end, new Date(s.start)]);
        out.push({ ...r.rows[0], available: true });
      }
      await client.query("COMMIT");
      return { slots: out };
    } catch (e: any) {
      await client.query("ROLLBACK").catch(() => {});
      if (e.code === "23505") throw new ApiError(409, "a slot with that id already exists");
      throw e;
    } finally {
      client.release();
    }
  }

  // LEVEL 1: every slot, earliest start first, with an `available` flag.
  async list(provider?: string) {
    const { rows } = await this.db.pool.query(
      `SELECT s.id, s.provider, s.start_time AS start, s.end_time AS "end",
              NOT EXISTS (SELECT 1 FROM bookings b WHERE b.slot_id = s.id AND b.status = 'confirmed') AS available
       FROM slots s
       WHERE ($1::text IS NULL OR s.provider = $1)
       ORDER BY s.start_ts, s.id`, [provider || null]);
    return { slots: rows };
  }
}
