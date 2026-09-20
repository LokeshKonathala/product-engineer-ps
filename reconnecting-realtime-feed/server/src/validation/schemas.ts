import { z } from "zod";
import { env } from "../config/env.js";

// Room IDs are user-facing identifiers (e.g. "INC-001"); keep them
// restricted to a safe, predictable character set.
export const roomIdSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9_-]+$/, "roomId may only contain letters, numbers, hyphens and underscores");

export const createUpdateBodySchema = z.object({
  message: z
    .string()
    .trim()
    .min(1, "message must not be empty")
    .max(env.maxMessageLength, `message must be at most ${env.maxMessageLength} characters`)
});

export const listUpdatesQuerySchema = z.object({
  after: z.coerce.number().int().min(0).optional().default(0),
  limit: z.coerce.number().int().min(1).max(env.maxReplayLimit).optional().default(env.defaultReplayLimit)
});
