import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/postgres.js";
import { uniqueRoomId } from "./helpers/testServer.js";

const app = createApp();

afterAll(async () => {
  await pool.end();
});

describe("POST /api/rooms/:roomId/updates", () => {
  it("persists an update and assigns id, sequence, createdAt", async () => {
    const roomId = uniqueRoomId("create");

    const res = await request(app)
      .post(`/api/rooms/${roomId}/updates`)
      .send({ message: "Database latency has increased" });

    expect(res.status).toBe(201);
    expect(res.body.roomId).toBe(roomId);
    expect(res.body.message).toBe("Database latency has increased");
    expect(typeof res.body.id).toBe("string");
    expect(typeof res.body.sequence).toBe("number");
    expect(typeof res.body.createdAt).toBe("string");
  });

  it("rejects an empty message with 400", async () => {
    const roomId = uniqueRoomId("empty");

    const res = await request(app).post(`/api/rooms/${roomId}/updates`).send({ message: "   " });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("ValidationError");
  });

  it("rejects an oversized message with 400", async () => {
    const roomId = uniqueRoomId("oversized");

    const res = await request(app)
      .post(`/api/rooms/${roomId}/updates`)
      .send({ message: "x".repeat(5000) });

    expect(res.status).toBe(400);
  });

  it("rejects an invalid room id with 400", async () => {
    const res = await request(app)
      .post("/api/rooms/has spaces/updates")
      .send({ message: "hello" });

    expect(res.status).toBe(400);
  });
});

describe("GET /api/rooms/:roomId/updates (cursor replay)", () => {
  it("returns updates strictly after the given cursor, in ascending sequence order", async () => {
    const roomId = uniqueRoomId("replay");

    const created: number[] = [];
    for (let i = 1; i <= 5; i++) {
      const res = await request(app)
        .post(`/api/rooms/${roomId}/updates`)
        .send({ message: `update ${i}` });
      created.push(res.body.sequence);
    }

    const cursor = created[2]; // sequence of update 3
    const res = await request(app).get(`/api/rooms/${roomId}/updates?after=${cursor}`);

    expect(res.status).toBe(200);
    expect(res.body.updates).toHaveLength(2);
    expect(res.body.updates[0].message).toBe("update 4");
    expect(res.body.updates[1].message).toBe("update 5");

    const sequences: number[] = res.body.updates.map((u: { sequence: number }) => u.sequence);
    expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
    expect(res.body.nextCursor).toBe(created[4]);
  });

  it("returns full history when after is omitted", async () => {
    const roomId = uniqueRoomId("full-history");
    await request(app).post(`/api/rooms/${roomId}/updates`).send({ message: "first" });
    await request(app).post(`/api/rooms/${roomId}/updates`).send({ message: "second" });

    const res = await request(app).get(`/api/rooms/${roomId}/updates`);

    expect(res.status).toBe(200);
    expect(res.body.updates).toHaveLength(2);
  });

  it("never returns updates from another room (room isolation)", async () => {
    const roomA = uniqueRoomId("iso-a");
    const roomB = uniqueRoomId("iso-b");

    await request(app).post(`/api/rooms/${roomA}/updates`).send({ message: "only in A" });
    await request(app).post(`/api/rooms/${roomB}/updates`).send({ message: "only in B" });

    const resA = await request(app).get(`/api/rooms/${roomA}/updates`);
    const resB = await request(app).get(`/api/rooms/${roomB}/updates`);

    expect(resA.body.updates.map((u: { message: string }) => u.message)).toEqual(["only in A"]);
    expect(resB.body.updates.map((u: { message: string }) => u.message)).toEqual(["only in B"]);
  });

  it("caps the returned page size at the configured maximum", async () => {
    const roomId = uniqueRoomId("limit");
    await request(app).post(`/api/rooms/${roomId}/updates`).send({ message: "one" });

    const res = await request(app).get(`/api/rooms/${roomId}/updates?limit=2000`);

    expect(res.status).toBe(400); // limit exceeds MAX_REPLAY_LIMIT, rejected rather than silently clamped
  });
});
