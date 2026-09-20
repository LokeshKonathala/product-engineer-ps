import express, { type Express } from "express";
import cors from "cors";
import { updatesRouter } from "./routes/updates.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { env } from "./config/env.js";

/** Builds the Express app without starting a listener, so it can be reused by tests (Supertest). */
export function createApp(): Express {
  const app = express();

  app.use(cors({ origin: env.clientUrl }));
  app.use(express.json({ limit: "64kb" }));

  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  app.use("/api", updatesRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
