import type { WebSocket } from "ws";
import type { IncidentUpdate, WebSocketBroadcastMessage } from "../types/update.js";

/**
 * Tracks live WebSocket connections per room and broadcasts to them.
 * This is purely transient, in-memory state — it holds no history and is
 * never consulted for ordering or recovery. PostgreSQL remains the only
 * durable source of truth; this class only fans out events that have
 * already been persisted.
 */
class RoomManager {
  private readonly roomsToConnections = new Map<string, Set<WebSocket>>();

  subscribe(roomId: string, socket: WebSocket): void {
    let connections = this.roomsToConnections.get(roomId);
    if (!connections) {
      connections = new Set();
      this.roomsToConnections.set(roomId, connections);
    }
    connections.add(socket);
  }

  unsubscribe(roomId: string, socket: WebSocket): void {
    const connections = this.roomsToConnections.get(roomId);
    if (!connections) return;
    connections.delete(socket);
    if (connections.size === 0) {
      this.roomsToConnections.delete(roomId);
    }
  }

  /** Broadcasts an already-persisted update to every connection subscribed to its room. */
  broadcast(roomId: string, update: IncidentUpdate): void {
    const connections = this.roomsToConnections.get(roomId);
    if (!connections || connections.size === 0) return;

    const payload: WebSocketBroadcastMessage = { type: "incident.update", data: update };
    const serialized = JSON.stringify(payload);

    for (const socket of connections) {
      if (socket.readyState === socket.OPEN) {
        socket.send(serialized);
      }
    }
  }

  connectionCount(roomId: string): number {
    return this.roomsToConnections.get(roomId)?.size ?? 0;
  }
}

export const roomManager = new RoomManager();
