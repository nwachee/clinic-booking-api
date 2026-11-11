import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import crypto from "crypto";
import { Request } from "express";
import { ApiError } from "./api-error";

// LEVEL 2: every API request needs the X-API-Key header.
@Injectable()
export class ApiKeyGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    const given = Buffer.from(String(req.header("x-api-key") ?? ""));
    const expected = Buffer.from(process.env.API_KEY ?? "");
    // constant-time comparison so response timing can't leak the key
    const ok = given.length === expected.length && crypto.timingSafeEqual(given, expected);
    if (!ok) throw new ApiError(401, "missing or invalid API key");
    return true;
  }
}
