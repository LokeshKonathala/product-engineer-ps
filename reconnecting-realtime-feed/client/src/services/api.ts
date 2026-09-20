import type { IncidentUpdate, ListUpdatesResponse } from "../types/update";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

async function handleJsonResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.error ?? `Request failed with status ${res.status}`, res.status);
  }
  return res.json() as Promise<T>;
}

/**
 * Fetches updates for a room after the given cursor (0 = full history).
 * Serves both "initial load" and "reconnect replay" — they are the same
 * request shape, just with a different `after` value.
 */
export async function fetchUpdates(roomId: string, after = 0): Promise<ListUpdatesResponse> {
  const res = await fetch(`${API_BASE_URL}/api/rooms/${encodeURIComponent(roomId)}/updates?after=${after}`);
  return handleJsonResponse<ListUpdatesResponse>(res);
}

export async function publishUpdate(roomId: string, message: string): Promise<IncidentUpdate> {
  const res = await fetch(`${API_BASE_URL}/api/rooms/${encodeURIComponent(roomId)}/updates`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message })
  });
  return handleJsonResponse<IncidentUpdate>(res);
}

export function wsUrlForRoom(roomId: string): string {
  const wsBase = API_BASE_URL.replace(/^http/, "ws");
  return `${wsBase}/ws/rooms/${encodeURIComponent(roomId)}`;
}
