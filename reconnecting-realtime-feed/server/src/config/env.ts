import "dotenv/config";

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: required(
    "DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5432/incident_feed"
  ),
  clientUrl: process.env.CLIENT_URL ?? "http://localhost:5173",
  // Applied when a replay request omits `limit`, and as a hard ceiling
  // even when a client requests more, to prevent unbounded history replay.
  defaultReplayLimit: Number(process.env.DEFAULT_REPLAY_LIMIT ?? 100),
  maxReplayLimit: Number(process.env.MAX_REPLAY_LIMIT ?? 500),
  maxMessageLength: Number(process.env.MAX_MESSAGE_LENGTH ?? 2000)
};
