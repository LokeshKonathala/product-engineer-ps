/** Mirrors server/src/types/update.ts — kept in sync manually since this is a small prototype. */
export interface IncidentUpdate {
  id: string;
  roomId: string;
  message: string;
  sequence: number;
  createdAt: string;
}

export interface ListUpdatesResponse {
  updates: IncidentUpdate[];
  nextCursor: number;
}

export interface IncidentUpdateBroadcast {
  type: "incident.update";
  data: IncidentUpdate;
}

export type ConnectionState = "connecting" | "connected" | "reconnecting" | "disconnected";

/** How this update reached this particular client — for the UI badge only, not part of the server model. */
export type UpdateSource = "self" | "live" | "history";

export interface DisplayUpdate extends IncidentUpdate {
  source: UpdateSource;
}
