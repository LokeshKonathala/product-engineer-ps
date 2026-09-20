import { createServer } from "node:http";
import { createApp } from "./app.js";
import { attachWebSocketServer } from "./websocket/socketServer.js";
import { checkDatabaseConnection } from "./db/postgres.js";
import { env } from "./config/env.js";

async function main(): Promise<void> {
  await checkDatabaseConnection();

  const app = createApp();
  const httpServer = createServer(app);
  attachWebSocketServer(httpServer);

  httpServer.listen(env.port, () => {
    console.log(`Incident feed server listening on port ${env.port}`);
    console.log(`WebSocket endpoint: ws://localhost:${env.port}/ws/rooms/:roomId`);
  });
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
