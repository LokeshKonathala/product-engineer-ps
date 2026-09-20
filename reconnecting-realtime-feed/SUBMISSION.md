# Product Engineering Challenge Submission

## Candidate

- **Name:**
- **Email:**
- **GitHub:**
- **Selected problem:**
- **Demo video:**

## Run the project

Prerequisites: Node.js 18+ and a reachable PostgreSQL server (local, Docker, or hosted).

Required environment variables (values are never committed):

| File | Variable | Example / purpose |
|---|---|---|
| `server/.env` | `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/incident_feed` |
| `server/.env` | `PORT` | `4000` |
| `server/.env` | `CLIENT_URL` | `http://localhost:5173` (CORS origin) |
| `client/.env` | `VITE_API_BASE_URL` | `http://localhost:4000` |

```text
# 1. Create the database and apply the schema (idempotent, safe to re-run)
createdb incident_feed
cd server
npm install
npm run migrate

# 2. Terminal 1 - backend (from server/)
npm run dev

# 3. Terminal 2 - frontend
cd client
npm install
npm run dev
```

Open `http://localhost:5173`. It defaults to room `INC-001`; add `?room=INC-002` (or use the
"Room" box in the header) for a different room.

**Successful scenario (live update).** Open the app in two tabs. Both show Connected. Publish
from Tab A; the update appears in Tab B with no refresh.

**Failure / recovery scenario.**

1. In Tab B click **Simulate disconnect**. It shows Disconnected, then Reconnecting while it
   retries with backoff.
2. While Tab B is down, publish 2-3 updates from Tab A.
3. Tab B reconnects on its own within a few seconds. It replays everything it missed, in
   `sequence` order, exactly once.

The button calls `ws.close()`, and the client's `onclose` handler treats that the same as a real
network drop. Stopping and restarting the backend also works, and the client keeps retrying at
the 30s backoff ceiling until the server is back.

## Run the tests

```text
# Server: HTTP replay, room isolation, validation, live WebSocket delivery,
# persist-before-broadcast. Needs a reachable DATABASE_URL (use a disposable DB).
cd server
npm run migrate
npm test

# Client: dedupe / ordering / cursor / replay-recovery logic. Pure functions, nothing else needs to run.
cd client
npm test
```

Server tests use a random `roomId` per test, so they never collide and need no truncation.

## Acceptance scenarios and verification

| Scenario | Status | How it is covered |
|---|---|---|
| AC1 Live update | Done | `server/tests/liveUpdate.test.ts` (client A publishes, client B receives over a real WebSocket, plus a room-isolation case); manual two-tab demo |
| AC2 Connection state | Done | UI shows Connecting / Connected / Reconnecting / Disconnected, driven by the socket's `open`/`close`/`error` events; manual demo |
| AC3 Missed-update recovery | Done | Cursor replay (`GET /updates?after=`) tested in `server/tests/replay.test.ts` and `client/tests/replay.test.ts` (multi-page drain, failed replay, partial-page failure, cancellation); manual demo |
| AC4 Duplicate prevention | Done | `client/tests/processUpdate.test.ts`, including the exact "11, 12, 13 via HTTP, then 13 again via WebSocket" race |
| AC5 Stable ordering | Done | Order is the database-assigned `sequence` (`BIGSERIAL`). The client sorts by `sequence` only, never by arrival time or its own clock |

Interpretations to be aware of:

- Publishing is disabled in the UI while the socket is not Connected. Offline creation of new
  messages is out of scope, so I did not build a queue. The REST endpoint itself still works
  without a socket; only the UI gates it.
- `sequence` is one global `BIGSERIAL` shared across rooms, not a per-room counter. Room
  isolation and per-room ordering are still exact, but sequence numbers within one room are not
  contiguous.

Verification steps (the problem has no separate benchmark script; verification is the automated
suites plus the manual demo checklist):

```text
cd server && npm run migrate && npm test
cd client && npm test
# then the two-tab demo under "Run the project" -> "Failure / recovery scenario"
```

**Observed result.** I ran both suites while preparing this submission:

- `client`: 2 test files, **18 tests passed**, 0 failed.
- `server`: 3 test files, **12 tests passed**, 0 failed. This ran against the `DATABASE_URL` in
  `server/.env`, a real PostgreSQL instance, not a mock.

Not covered by automation: the React hook itself and a real socket-drop end-to-end run. The
physical disconnect/reconnect is exercised manually and shown in the demo video. I did not
re-run the browser demo when preparing this write-up; the recovery logic underneath it is what
the automated tests cover.

**Recovery scenario in the video.** It is the Tab A / Tab B flow above: live update, Simulate
disconnect on Tab B, publish while it is down, automatic reconnect, missed updates recovered once
each with the connection state visible throughout. A reviewer can reproduce it with those same
steps.

## Architecture and data flow

```
                 PostgreSQL
                      │
                      │
                Durable History
                      │
                      ▼
              ┌───────────────┐
              │   REST Replay │
              └───────┬───────┘
                      │
                      │
                      ▼
              ┌───────────────┐
              │ processUpdate │
              │               │
WebSocket ───►│ Deduplicate   │
  Live        │ Sort          │
  Events      │ Apply         │
              │ Advance Cursor│
              └───────────────┘
                      │
                      ▼
                 React UI
```

Data Flow
1. Client publishes an update
   - The client sends (POST /api/rooms/:roomId/updates).
   - The backend creates a UUID for the update.
   - PostgreSQL inserts the update and assigns its BIGSERIAL sequence.
2. Persist first
   - The database commit completes before the update is broadcast.
   - PostgreSQL therefore remains the durable source of truth.
3. Broadcast second
   - After the database insert succeeds, the backend broadcasts the update to connected WebSocket clients in that room.
   - WebSocket delivery is transient and best-effort.
4. Client receives updates
   - Live updates arrive through WebSocket.
   - Missed updates are retrieved through the REST API using the client's resumeCursor.
5. Both paths use the same processing logic
   - HTTP replay and WebSocket events both go through processUpdate().
   - Updates are deduplicated using their UUID.
   - Updates are ordered using the database sequence.
6. Recovery after disconnect
   - When the WebSocket reconnects, the client requests:
    ( GET /api/rooms/:roomId/updates?after=<resumeCursor>)
   - The server returns missed updates in sequence order.
   - The client processes them and advances the cursor only after the replay is safely applied.

## Decisions you must document

- **Transport.** WebSocket. SSE was the closest alternative, but the required
  Connecting/Connected/Reconnecting/Disconnected states, a controllable disconnect and client-side
  backoff map directly onto the WebSocket API's `open`/`close`/`error` events. SSE reconnects
  automatically and opaquely, which would have made the state machine and the demo harder. Long
  polling was rejected as higher latency and overhead for no benefit.
- **Resume point.** The client keeps a `resumeCursor` (`client/src/utils/processUpdate.ts`), which
  is not simply the highest sequence seen. `lastSeenSequence` is display-only, because live #15
  can arrive while #11-#14 are still unfetched, and resuming from 15 would skip them permanently.
  `resumeCursor` means "I provably hold everything up to here". It advances as `replayMissed`
  fully applies each page, and via live or own updates only while `synced` (a replay has drained
  since the socket opened; cleared again on close). A failed replay leaves the cursor at the last
  applied page, surfaces the error and retries with backoff. There is no separate "initial load"
  path: the first connection's cursor is `0`, so its replay is the full history load.
- **Ordering.** PostgreSQL only. `sequence` is a `BIGSERIAL` assigned at `INSERT`
  (`updateRepository.insert`); the server never accepts a client-supplied ordering value.
- **Deduplication.** Client-side, in `processUpdate`, keyed on the server-generated UUID `id`
  via a `Set<string>`. Both the WebSocket handler and the HTTP replay handler use this one
  function.
- **Reconnect bounds.** Exponential backoff with a ceiling and jitter:
  `delay = min(1000 * 2^attempt, 30000) + random(0, 500)`. The counter resets to 0 on every
  successful `open`. There is no maximum attempt count; the client keeps trying at the 30s
  ceiling so the tab recovers without a manual reload.

## Questions to address in SUBMISSION.md

### What happens if a client disconnects immediately after sending an update?

The server is the arbiter of acceptance, not the connection. `updateService.publish()`
(`server/src/services/updateService.ts`) first `INSERT`s the update and only broadcasts over
WebSocket after that insert has committed and PostgreSQL has returned the row with its
server-assigned `sequence`. If the client's connection drops the instant after it sent the HTTP
POST, that has no bearing on whether the insert already reached the database:

- **Insert committed before the disconnect:** the update is durable. The client, or any other
  client, recovers it later via `GET /updates?after=<cursor>`, and its `sequence` places it
  correctly in the ordered feed.
- **Insert never committed** (the request never reached the server, or the database write
  failed): the update is not part of the durable feed and is never broadcast. There is nothing to
  recover, which is correct: an update the server never accepted was never "sent" from the
  system's point of view.

The WebSocket is never treated as a commit signal. The publisher's own optimistic UI update
(`useIncidentSocket.publish`) is applied from the HTTP response body, not from a WebSocket
acknowledgment. A client that loses its socket right after publishing therefore still shows its
own update, and does not duplicate it when the broadcast or a later replay arrives, because
`processUpdate` dedupes by `id`.

### How would multiple backend instances share and order events?

*Today:* a single Node process owns both the REST API and the in-memory `roomManager`
(`server/src/websocket/roomManager.ts`), so "who is connected to which room" and "broadcast to
them" are in-process operations.

*Proposed (not implemented):* with N instances behind a load balancer, a client's WebSocket lands
on one instance, but an update can be published against any instance. The instance that accepts
the update must tell the others so each can push it to its own local sockets, which needs a
shared broker:

```
Backend instance -> PostgreSQL (persist, get sequence) -> broker (Redis Pub/Sub or Streams)
  -> every instance subscribed to that channel/room -> its own connected clients
```

Ordering stays anchored to PostgreSQL's `BIGSERIAL`, not to the broker or instance-local state.
The broker only fans out already-sequenced events and never assigns order. That keeps the
invariant the design is built on: persist first, distribute second. A client that reconnects to a
different instance is unaffected, because recovery reads `GET /updates?after=cursor` from the
shared database rather than from any instance's memory. Redis Streams (rather than plain Pub/Sub)
would also give each instance a replay buffer for the short gap while it is disconnected from the
broker, with the database as the ultimate fallback.

### How would you prevent an unbounded history replay?

Three mechanisms, all implemented:

1. **Cursor pagination.** `GET /updates?after=<sequence>` only returns events strictly after the
   caller's checkpoint, so a client never re-fetches what it already has.
2. **A hard page-size cap.** `listUpdatesQuerySchema` (`server/src/validation/schemas.ts`)
   defaults `limit` to 100 and rejects anything above `MAX_REPLAY_LIMIT` (500) with a 400, rather
   than silently clamping or streaming unbounded rows. A client recovering from a long outage
   advances its cursor page by page (`after=<nextCursor>`).
3. **An index that makes each page cheap.** `idx_incident_updates_room_sequence` on
   `(room_id, sequence)` makes every replay query an indexed range scan, however much history
   exists.

*Not implemented:* retention (archive or delete updates older than N days) and snapshotting
(collapse old history into a compacted summary row), so a long-lived room's history does not
grow forever. Out of scope for a prototype whose rooms live for the length of a demo.

### What would you monitor in production?

- **Connections:** active WebSockets (overall and per room), reconnect attempts, reconnect
  success rate, time-to-reconnect.
- **Recovery:** replay request rate, replay size distribution (P50/P95/max events per replay),
  replay latency, and how often a client needed a multi-page replay (a proxy for how long clients
  stay disconnected).
- **Delivery:** publish-to-broadcast latency, broadcast failures (send to a closed or
  backpressured socket), and duplicate-delivery rate. Duplicates are handled client-side by
  design, so this should stay near 0; a spike would point to something upstream misbehaving.
- **Database:** query latency (especially the replay query), connection pool saturation, insert
  latency, error rate.
- **Errors:** 400 rate (malformed requests, which can indicate a client bug), 500 rate, and
  WebSocket error events.

## Technology choices

| Layer | Choice |
|---|---|
| Client | React + TypeScript + Vite, native `WebSocket` / `fetch` |
| Server | Node.js + TypeScript + Express + `ws` + Zod |
| Database | PostgreSQL (`BIGSERIAL` sequence, `UUID` id) |
| Tests | Vitest (+ Supertest for HTTP, a raw `ws` client for live delivery) |

- **PostgreSQL** gives durable history and a database-assigned monotonic ordering value for free,
  which is the core of the design. In-memory or file storage would not survive restarts.
- **`ws` over Socket.IO.** I wanted the plain WebSocket lifecycle visible and under my control
  rather than hidden behind a library's own reconnection logic, since reconnection and resume are
  what this problem is about.
- **Native `WebSocket` / `fetch` on the client** for the same reason, and to avoid extra
  dependencies.
- **Alternatives considered:** SSE and long polling (see transport decision above).
- **Trade-offs accepted:** a single backend process; no broker; tests run against real
  PostgreSQL, so they need a reachable database instead of being self-contained.

## Important decisions

1. **Fetch-on-every-open instead of "load history, then open socket".** The suggested flow loads
   history first and then connects. I unified them: every WebSocket `open` triggers the same
   cursor-based replay. That removes a class of "did history finish before the socket
   connected" ordering questions, and reconnection reuses the same tested recovery path as
   initial load.
2. **`resumeCursor` separate from `lastSeenSequence`.** A live message can arrive ahead of a gap,
   so "highest sequence seen" is unsafe as a resume point. The cursor advances only when the
   client provably holds everything up to it. This is the decision that makes recovery correct
   under races.
3. **Publish disabled in the UI while not connected.** Offline creation is out of scope, so I did
   not build a queue. The UI states plainly what the prototype guarantees, with no extra
   complexity.
4. **Dev-only "Simulate disconnect" button.** It goes through the same `onclose` path as a real
   outage, so the recovery scenario is reproducible for review without pulling a network cable.

## Assumptions and limitations

- No authentication or authorization; anyone who can reach the API can read and post to any room
  (explicitly out of scope).
- Single backend process; no broker is wired up.
- `roomManager` is in-memory. A server restart drops live connections, and clients then reconnect
  and replay normally. No data is lost, because it never held any.
- No rate limiting. The 2000-character message cap and 500-row page cap bound a single request.
- No retention or compaction of old history.
- Sequence numbers are global across rooms, so they are not contiguous within one room.
- Server tests require a reachable PostgreSQL `DATABASE_URL`. The React hook and a real
  socket-drop end-to-end run are not covered by automated tests.

## Production and scale

*What the submission does now:* one Node process, in-memory connection registry, PostgreSQL for
durability and ordering, cursor replay with a page cap and index.

*What I would change first (proposed, not implemented):*

1. **Broker for multi-instance fan-out** (Redis Pub/Sub or Streams). Without it, horizontal
   scaling silently drops live delivery between instances. Ordering stays with PostgreSQL.
2. **Auth and per-room authorization**, then rate limiting on publish and replay, since the
   endpoints are currently open.
3. **Retention / compaction** of old updates so a long-lived room's history and replay cost don't
   grow forever.
4. **Metrics and alerting** for the signals listed above, especially replay size and
   reconnect success rate.
5. **A browser-level end-to-end test** for a real socket drop, so the React hook is covered too.

## AI usage

This implementation (server, client, tests and this document) was built with Claude Code
(Anthropic), working from the problem statement as the specification. Claude generated the code and
drafted the documentation. I reviewed the generated code and ran the test suites (server tests
against a real PostgreSQL instance, client tests standalone). The most recent run passed: 18
client tests and 12 server tests. I can explain every part of this submission.

## Credibility note

Describe one product or system you previously helped ship:

- The problem it solved:
- Your personal contribution:
- The scale or operational complexity involved:
- One difficult engineering or product decision:
- A public link or other evidence:
