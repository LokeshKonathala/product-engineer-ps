# Reconnecting Real-Time Incident Feed

A minimal shared incident-room application. Multiple clients can view and publish incident
updates in real time, and — the core requirement — a client that temporarily loses its
WebSocket connection can reconnect and recover every update it missed, with no duplicates and
deterministic ordering.

## Architecture

```
PostgreSQL (durable source of truth)
   sequence  BIGSERIAL  — canonical ordering, assigned by the database
   id        UUID       — stable logical identity, assigned by the server
        │
        │ persist first
        ▼
Backend (Express + ws, single Node process)
   REST   : POST/GET /api/rooms/:roomId/updates
   WS     : /ws/rooms/:roomId  (room → connections, in-memory only)
        │
        │ broadcast second (best-effort, transient)
        ▼
React client
   fetch history/replay ─┐
   WebSocket live events ┴─► single processUpdate(state, update)
                              → dedupe by id, sort by sequence, advance cursor
```

**The database is the source of truth; the WebSocket is a transient delivery channel.** An
update is only ever broadcast after its INSERT has committed and PostgreSQL has assigned it a
sequence (`server/src/services/updateService.ts`). If a client's socket is down when an update
is published, the update still exists durably and is recovered on the client's next reconnect
via `GET /updates?after=<lastSeenSequence>`.

## Features

- Real-time feed shared by any number of clients per room (`roomId`)
- Durable persistence in PostgreSQL — every accepted update survives connection loss
- Cursor-based recovery (`?after=`) — reconnecting clients replay only what they missed
- Client-side deduplication by stable `id` — safe even if history and live delivery overlap
- Deterministic ordering by server-assigned `sequence` (a `BIGSERIAL`), never client clocks
- Room isolation — every query and every WebSocket subscription is scoped to one `room_id`
- Visible connection state: Connecting / Connected / Reconnecting / Disconnected
- Automatic reconnection with exponential backoff (1s → 30s cap, jittered)
- A dev-only "Simulate disconnect" button to reliably demo recovery without pulling your cable

## Tech stack

| Layer | Choice |
|---|---|
| Client | React + TypeScript + Vite, native `WebSocket`/`fetch` |
| Server | Node.js + TypeScript + Express + `ws` + Zod |
| Database | PostgreSQL (`BIGSERIAL` sequence, `UUID` id) |
| Tests | Vitest (+ Supertest for HTTP, raw `ws` client for live delivery) |

## Prerequisites

- Node.js 18+
- A PostgreSQL server reachable from your machine (local install, Docker, or a hosted instance)

## Setup

### 1. Create the database and apply the schema

```bash
# create an empty database named incident_feed (adjust to taste)
createdb incident_feed

# from server/, with DATABASE_URL set (see below), apply database/schema.sql:
cd server
npm install
npm run migrate
```

`npm run migrate` just runs `database/schema.sql` against `DATABASE_URL` — it's idempotent
(`CREATE TABLE/INDEX IF NOT EXISTS`), so it's safe to re-run.

### 2. Environment variables

Copy `.env.example` and create `server/.env` and `client/.env`:

**server/.env**
```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/incident_feed
PORT=4000
CLIENT_URL=http://localhost:5173
```

**client/.env**
```env
VITE_API_BASE_URL=http://localhost:4000
```

No auth secrets are needed — authentication is explicitly out of scope.

### 3. Install and run

```bash
# Terminal 1 — backend
cd server
npm install
npm run dev

# Terminal 2 — frontend
cd client
npm install
npm run dev
```

Open `http://localhost:5173` (defaults to room `INC-001`; append `?room=INC-002` to use a
different room, or type one into the "Room" box in the header).

## Running the tests

```bash
# Server: HTTP replay, room isolation, validation, live WebSocket delivery,
# and the persist-before-broadcast invariant.
cd server
npm run migrate            # ensure DATABASE_URL schema exists
npm test

# Client: pure deduplication/ordering/cursor logic (no DOM, no server needed).
cd client
npm test
```

The server tests need a reachable `DATABASE_URL` (point it at a disposable database — every
test uses a randomly generated `roomId`, so tests never collide or require truncation between
runs). The client tests are pure-function unit tests and need nothing running.

## Demo walkthrough (two browser tabs)

1. Start the backend and frontend as above.
2. Open `http://localhost:5173` in two tabs — both default to `INC-001`. Both should show
   🟢 Connected.
3. Publish an update from Tab A. It should appear in Tab B immediately, no refresh.
4. In Tab B, click **Simulate disconnect**. Tab B shows 🔴 Disconnected, then 🟡 Reconnecting...
   as it retries with backoff.
5. While Tab B is down, publish 2–3 updates from Tab A.
6. Wait for Tab B's automatic reconnect (a few seconds). It recovers every missed update, in
   order, exactly once — check the sequence numbers are contiguous and nothing repeats.
7. Try `?room=INC-002` in a third tab and publish there — Tabs A/B never see it.

## API

```
POST /api/rooms/:roomId/updates
  body: { "message": string }               (1–2000 chars after trim)
  → 201 { id, roomId, message, sequence, createdAt }

GET /api/rooms/:roomId/updates?after=<sequence>&limit=<n>
  after: default 0 (full history), limit: default 100, max 500
  → 200 { updates: [...], nextCursor }
```

`roomId` must match `[A-Za-z0-9_-]+`. Invalid input on either endpoint returns
`400 { error: "ValidationError", details: [...] }`.

## WebSocket

```
ws://<host>/ws/rooms/:roomId
```

On every accepted update in that room:

```json
{ "type": "incident.update", "data": { "id", "roomId", "message", "sequence", "createdAt" } }
```

## Known limitations

- Single backend process — no cross-instance fan-out (see `SUBMISSION.md` for how that would
  evolve).
- Publishing is disabled in the UI while the socket is not `connected` (no offline queue — this
  is explicitly out of scope per the brief). The REST endpoint itself does not require an open
  socket; only the UI gates it.
- No authentication/authorization, by design.
- Sequence numbers are global across all rooms (one shared `BIGSERIAL`), not per-room counters —
  this doesn't affect correctness (recovery/ordering/isolation are all still exact), it just
  means sequence gaps between consecutive updates in one room are expected.
