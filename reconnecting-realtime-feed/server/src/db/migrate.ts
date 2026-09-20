import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { pool } from "./postgres.js";

/** Applies database/schema.sql against DATABASE_URL. Idempotent (uses IF NOT EXISTS). */
async function migrate(): Promise<void> {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const schemaPath = path.resolve(__dirname, "../../../database/schema.sql");
  const schema = readFileSync(schemaPath, "utf-8");

  await pool.query(schema);
  console.log(`Schema applied from ${schemaPath}`);
  await pool.end();
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
