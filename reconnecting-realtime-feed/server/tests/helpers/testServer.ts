import { createServer, type Server } from "node:http";
import { createApp } from "../../src/app.js";
import { attachWebSocketServer } from "../../src/websocket/socketServer.js";

export interface TestServerHandle {
  server: Server;
  baseUrl: string;
  wsBaseUrl: string;
  close: () => Promise<void>;
}

/** Boots a real HTTP+WebSocket server on an ephemeral port for integration tests. */
export async function startTestServer(): Promise<TestServerHandle> {
  const app = createApp();
  const server = createServer(app);
  attachWebSocketServer(server);

  await new Promise<void>((resolve) => server.listen(0, resolve));

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected server to bind to a network port");
  }

  const baseUrl = `http://localhost:${address.port}`;
  const wsBaseUrl = `ws://localhost:${address.port}`;

  return {
    server,
    baseUrl,
    wsBaseUrl,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    })
  };
}

/** Generates a unique room id per test so tests never share, and therefore never contend on, data. */
export function uniqueRoomId(label: string): string {
  return `test-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
