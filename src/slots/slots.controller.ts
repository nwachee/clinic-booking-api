import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from "@nestjs/common";
import { ApiKeyGuard } from "../common/api-key.guard";
import { SlotsService } from "./slots.service";

@Controller()
@UseGuards(ApiKeyGuard)
export class SlotsController {
  constructor(private readonly slots: SlotsService) {}

  @Post("reset")
  @HttpCode(200)
  reset(@Body() body: unknown) {
    return this.slots.reset(body);
  }

  @Post("slots")
  create(@Body() body: unknown) {
    return this.slots.create(body);
  }

  @Get("slots")
  list(@Query("provider") provider?: string) {
    return this.slots.list(provider);
  }
}
