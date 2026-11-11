import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from "@nestjs/common";
import { Response } from "express";
import { ApiError } from "./api-error";

// Every error in the contract looks like {"error": "<message>"}.
@Catch()
export class ErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (exception instanceof ApiError) {
      for (const [k, v] of Object.entries(exception.headers)) res.setHeader(k, v);
    }
    if (exception instanceof HttpException) {
      const r = exception.getResponse() as any;
      const msg = typeof r === "string" ? r : Array.isArray(r?.message) ? r.message.join("; ") : r?.message;
      return res.status(exception.getStatus()).json({ error: String(msg ?? exception.message) });
    }
    console.error(exception);
    res.status(500).json({ error: "internal error" });
  }
}
