import { Pool } from "pg";
import { env } from "../config/env.js";

export const pool = new Pool({
  connectionString: env.databaseUrl
});

pool.on("error", (err) => {
  // A background/idle client error must not crash the process; the pool
  // will create new connections for subsequent queries.
  console.error("Unexpected PostgreSQL pool error", err);
});

export async function checkDatabaseConnection(): Promise<void> {
  await pool.query("SELECT 1");
}
