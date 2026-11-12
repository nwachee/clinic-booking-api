import "dotenv/config";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { json, NextFunction, Request, Response } from "express";
import { join } from "path";
import { AppModule } from "./app.module";

async function bootstrap() {
  if (!process.env.API_KEY) throw new Error("API_KEY env var is required");

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  app.set("trust proxy", 1);
  app.use(json({ limit: "5mb" }));
  app.use((err: any, _req: Request, res: Response, next: NextFunction) =>
    err?.type === "entity.parse.failed" ? res.status(400).json({ error: "body is not valid JSON" }) : next(err));

  // Web page proxy: /api/* -> /* with the server-side API key attached
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (req.url.startsWith("/api/")) {
      req.url = req.url.slice(4); // /api/slots -> /slots
      req.headers["x-api-key"] = process.env.API_KEY as string;
    }
    next();
  });

  app.useStaticAssets(join(__dirname, "..", "public"));
  await app.listen(Number(process.env.PORT ?? 3000));
  console.log("API listening");
}
bootstrap().catch((e) => { console.error("Startup failed", e); process.exit(1); });