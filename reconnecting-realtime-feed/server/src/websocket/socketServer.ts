import type { Server as HttpServer, IncomingMessage } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { roomManager } from "./roomManager.js";
import { roomIdSchema } from "../validation/schemas.js";

const ROOM_PATH_PATTERN = /^\/ws\/rooms\/([^/]+)\/?$/;

function extractRoomId(request: IncomingMessage): string | null {
  const url = new URL(request.url ?? "", "http://localhost");
  const match = ROOM_PATH_PATTERN.exec(url.pathname);
  if (!match) return null;

  const raw = decodeURIComponent(match[1] ?? "");
  const result = roomIdSchema.safeParse(raw);
  return result.success ? result.data : null;
}

/**
 * Wires a `ws` WebSocketServer onto an existing HTTP server, routing each
 * connection to /ws/rooms/:roomId into the in-memory room registry.
 * Connections for an unrecognized or invalid room path are rejected
 * during the HTTP upgrade rather than accepted and closed after the fact.
 */
export function attachWebSocketServer(httpServer: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (request, socket, head) => {
    const roomId = extractRoomId(request);
    if (!roomId) {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request, roomId);
    });
  });

  wss.on("connection", (ws: WebSocket, _request: IncomingMessage, roomId: string) => {
    roomManager.subscribe(roomId, ws);

    ws.on("close", () => {
      roomManager.unsubscribe(roomId, ws);
    });

    ws.on("error", () => {
      roomManager.unsubscribe(roomId, ws);
    });
  });

  return wss;
}
