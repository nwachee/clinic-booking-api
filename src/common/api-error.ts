import { HttpException } from "@nestjs/common";

// An HTTP error that can also carry response headers (e.g. Retry-After).
export class ApiError extends HttpException {
  constructor(status: number, message: string, public readonly headers: Record<string, string> = {}) {
    super(message, status);
  }
}
