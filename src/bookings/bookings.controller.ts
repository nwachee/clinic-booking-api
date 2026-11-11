import { Body, Controller, Delete, Get, Headers, Param, Post, Query, Res, UseGuards } from "@nestjs/common";
import { Response } from "express";
import { ApiKeyGuard } from "../common/api-key.guard";
import { BookingsService } from "./bookings.service";

@Controller("bookings")
@UseGuards(ApiKeyGuard)
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Post()
  async create(
    @Body() body: unknown,
    @Headers("idempotency-key") idemKey: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    // The service decides the status (201, 400, 404, 409 or a replayed one), so we apply it here.
    const out = await this.bookings.create(body, idemKey);
    res.status(out.status);
    if (out.replayed) res.setHeader("Idempotent-Replayed", "true");
    return out.body;
  }

  @Get()
  list(@Query() query: Record<string, unknown>) {
    return this.bookings.list(query);
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.bookings.get(id);
  }

  @Delete(":id")
  cancel(@Param("id") id: string) {
    return this.bookings.cancel(id);
  }
}
