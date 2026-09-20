import { describe, it, expect, afterAll, afterEach } from "vitest";
import WebSocket from "ws";
import { pool } from "../src/db/postgres.js";
import { startTestServer, uniqueRoomId, type TestServerHandle } from "./helpers/testServer.js";

let handle: TestServerHandle | undefined;

afterEach(async () => {
  await handle?.close();
  handle = undefined;
});

afterAll(async () => {
  await pool.end();
});

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
}

function waitForMessage(ws: WebSocket): Promise<any> {
  return new Promise((resolve, reject) => {
    ws.once("message", (data) => resolve(JSON.parse(data.toString())));
    ws.once("error", reject);
  });
}

describe("Live update delivery (AC1)", () => {
  it("delivers an update published by client A to client B without a refresh", async () => {
    handle = await startTestServer();
    const roomId = uniqueRoomId("live");

    const clientA = new WebSocket(`${handle.wsBaseUrl}/ws/rooms/${roomId}`);
    const clientB = new WebSocket(`${handle.wsBaseUrl}/ws/rooms/${roomId}`);
    await Promise.all([waitForOpen(clientA), waitForOpen(clientB)]);

    const bReceived = waitForMessage(clientB);

    const publishRes = await fetch(`${handle.baseUrl}/api/rooms/${roomId}/updates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Database latency has increased" })
    });
    const published = (await publishRes.json()) as { id: string; sequence: number };

    const message = await bReceived;

    expect(message.type).toBe("incident.update");
    expect(message.data.id).toBe(published.id);
    expect(message.data.message).toBe("Database latency has increased");
    expect(message.data.sequence).toBe(published.sequence);

    clientA.close();
    clientB.close();
  });

  it("does not deliver updates from one room to a client subscribed to a different room", async () => {
    handle = await startTestServer();
    const roomA = uniqueRoomId("cross-a");
    const roomB = uniqueRoomId("cross-b");

    const clientB = new WebSocket(`${handle.wsBaseUrl}/ws/rooms/${roomB}`);
    await waitForOpen(clientB);

    let receivedAnything = false;
    clientB.on("message", () => {
      receivedAnything = true;
    });

    await fetch(`${handle.baseUrl}/api/rooms/${roomA}/updates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "should not reach room B" })
    });

    // Give the (absent) broadcast a moment to arrive if the isolation were broken.
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(receivedAnything).toBe(false);
    clientB.close();
  });
});
