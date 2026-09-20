/**
 * Canonical shape of a persisted incident update, as returned by the API
 * and broadcast over WebSocket. `id` is the stable logical identity used
 * by clients for deduplication; `sequence` is the server-assigned
 * monotonic ordering key used for sorting and cursor-based recovery.
 */
export interface IncidentUpdate {
  id: string;
  roomId: string;
  message: string;
  sequence: number;
  createdAt: string;
}

/** Row shape as stored/returned by PostgreSQL (snake_case, sequence as string via BIGINT). */
export interface IncidentUpdateRow {
  sequence: string;
  id: string;
  room_id: string;
  message: string;
  created_at: Date;
}

export function rowToUpdate(row: IncidentUpdateRow): IncidentUpdate {
  return {
    id: row.id,
    roomId: row.room_id,
    message: row.message,
    sequence: Number(row.sequence),
    createdAt: row.created_at.toISOString()
  };
}

export interface WebSocketBroadcastMessage {
  type: "incident.update";
  data: IncidentUpdate;
}
