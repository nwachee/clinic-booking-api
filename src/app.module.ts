import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { DbModule } from "./db/db.module";
import { ErrorFilter } from "./common/error.filter";
import { SlotsModule } from "./slots/slots.module";
import { BookingsModule } from "./bookings/bookings.module";
import { HealthController } from "./health/health.controller";

@Module({
  imports: [DbModule, SlotsModule, BookingsModule],
  controllers: [HealthController],
  providers: [{ provide: APP_FILTER, useClass: ErrorFilter }],
})
export class AppModule {}
