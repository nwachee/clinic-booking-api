import "dotenv/config";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { json, NextFunction, Request, Response } from "express";
import { join } from "path";
import { AppModule } from "./app.module";

async function bootstrap() {
  if (!process.env.API_KEY) throw new Error("API_KEY env var is required");

  // bodyParser:false so we can raise the JSON limit (/reset can carry many slots)
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  app.set("trust proxy", 1); // Render sits behind a proxy
  app.use(json({ limit: "5mb" }));
  // Malformed JSON is raised by Express middleware, before Nest sees the request,
  // so we keep the contract's {"error": "..."} shape here.
  app.use((err: any, _req: Request, res: Response, next: NextFunction) =>
    err?.type === "entity.parse.failed" ? res.status(400).json({ error: "body is not valid JSON" }) : next(err));

  app.useStaticAssets(join(__dirname, "..", "public")); // the web page at "/"
  await app.listen(Number(process.env.PORT ?? 3000));
  console.log("API listening");
}
bootstrap().catch((e) => { console.error("Startup failed", e); process.exit(1); });
