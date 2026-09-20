import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";

/**
 * Centralized error handling so route handlers stay free of try/catch
 * boilerplate for validation and unexpected failures. Validation errors
 * become 400s with field-level detail; anything else becomes a 500 and is
 * logged server-side without leaking internals to the client.
 */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: "ValidationError",
      details: err.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }))
    });
    return;
  }

  console.error("Unhandled request error:", err);
  res.status(500).json({ error: "InternalServerError" });
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: "NotFound" });
}
