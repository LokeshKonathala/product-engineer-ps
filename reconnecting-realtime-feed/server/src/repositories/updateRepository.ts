import { pool } from "../db/postgres.js";
import { IncidentUpdateRow, IncidentUpdate, rowToUpdate } from "../types/update.js";

/**
 * All data access for incident updates. Every query is parameterized and
 * scoped by room_id so that rooms can never leak into one another, and no
 * caller can influence ordering — `sequence` is always assigned by
 * PostgreSQL's BIGSERIAL, never supplied by a client.
 */
export const updateRepository = {
  async insert(params: { id: string; roomId: string; message: string }): Promise<IncidentUpdate> {
    const result = await pool.query<IncidentUpdateRow>(
      `INSERT INTO incident_updates (id, room_id, message)
       VALUES ($1, $2, $3)
       RETURNING sequence, id, room_id, message, created_at`,
      [params.id, params.roomId, params.message]
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error("Insert did not return a row");
    }
    return rowToUpdate(row);
  },

  /**
   * Returns updates for a room with sequence > `after`, ordered ascending,
   * capped at `limit`. This single query serves both "initial history"
   * (after = 0) and "cursor replay" (after = lastSeenSequence).
   */
  async listAfter(params: { roomId: string; after: number; limit: number }): Promise<IncidentUpdate[]> {
    const result = await pool.query<IncidentUpdateRow>(
      `SELECT sequence, id, room_id, message, created_at
       FROM incident_updates
       WHERE room_id = $1 AND sequence > $2
       ORDER BY sequence ASC
       LIMIT $3`,
      [params.roomId, params.after, params.limit]
    );
    return result.rows.map(rowToUpdate);
  }
};
