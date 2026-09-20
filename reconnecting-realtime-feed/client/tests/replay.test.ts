import { describe, it, expect } from "vitest";
import { createEmptyFeedState, processUpdate } from "../src/utils/processUpdate";
import { replayMissed } from "../src/utils/replay";
import { backoffDelay, BASE_DELAY_MS, MAX_DELAY_MS, JITTER_MS } from "../src/utils/backoff";
import type { IncidentUpdate, ListUpdatesResponse } from "../src/types/update";

function makeUpdate(sequence: number): IncidentUpdate {
  return {
    id: `u${sequence}`,
    roomId: "INC-001",
    message: `update ${sequence}`,
    sequence,
    createdAt: "2026-09-18T08:00:00.000Z"
  };
}

/** A fake durable store with the same contract as GET /updates: `sequence > after`, ascending, capped at pageSize. */
function fakeServer(sequences: number[], pageSize: number) {
  const calls: number[] = [];
  const fetchPage = async (after: number): Promise<ListUpdatesResponse> => {
    calls.push(after);
    const updates = sequences.filter((s) => s > after).slice(0, pageSize).map(makeUpdate);
    const last = updates[updates.length - 1];
    return { updates, nextCursor: last ? last.sequence : after };
  };
  return { fetchPage, calls };
}

/** A state that was fully caught up through `cursor`, as it would be just before a disconnect. */
function syncedStateThrough(cursor: number) {
  const state = createEmptyFeedState();
  state.synced = true;
  for (let s = 1; s <= cursor; s++) processUpdate(state, makeUpdate(s));
  return state;
}

describe("replayMissed — pagination", () => {
  it("drains every page, not just the first, when more was missed than one page holds", async () => {
    const state = createEmptyFeedState();
    const { fetchPage, calls } = fakeServer([1, 2, 3, 4, 5], 2);

    const finished = await replayMissed(state, fetchPage);

    expect(finished).toBe(true);
    expect(state.updates.map((u) => u.sequence)).toEqual([1, 2, 3, 4, 5]);
    expect(state.resumeCursor).toBe(5);
    expect(state.synced).toBe(true);
    // Each request resumes from the previous page's cursor, ending on an empty page.
    expect(calls).toEqual([0, 2, 4, 5]);
  });

  it("makes a single empty request when there is nothing new", async () => {
    const state = syncedStateThrough(3);
    const { fetchPage, calls } = fakeServer([1, 2, 3], 100);

    await replayMissed(state, fetchPage);

    expect(calls).toEqual([3]);
    expect(state.resumeCursor).toBe(3);
  });

  it("fails loudly instead of looping forever if the server never advances the cursor", async () => {
    const state = createEmptyFeedState();
    const stuck = async (): Promise<ListUpdatesResponse> => ({ updates: [makeUpdate(1)], nextCursor: 0 });

    await expect(replayMissed(state, stuck)).rejects.toThrow("no forward progress");
    expect(state.synced).toBe(false);
  });
});

describe("replayMissed — recovery after an outage", () => {
  it("does not let a live update jump the cursor over a gap when the replay fails, then recovers the gap on retry", async () => {
    // Was caught up through #10, then the connection dropped.
    const state = syncedStateThrough(10);
    state.synced = false; // what the hook does on close

    // Reconnect: the replay request fails...
    const failing = async (): Promise<ListUpdatesResponse> => {
      throw new Error("Failed to fetch");
    };
    await expect(replayMissed(state, failing)).rejects.toThrow("Failed to fetch");

    // ...and meanwhile live #15 arrives ahead of the still-missing #11–#14.
    processUpdate(state, makeUpdate(15));
    expect(state.lastSeenSequence).toBe(15);
    expect(state.resumeCursor).toBe(10); // must NOT have jumped to 15

    // Retry succeeds and resumes from #10, not #15.
    const { fetchPage, calls } = fakeServer([11, 12, 13, 14, 15], 100);
    await replayMissed(state, fetchPage);

    expect(calls[0]).toBe(10);
    expect(state.updates.map((u) => u.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    expect(state.resumeCursor).toBe(15);
    expect(state.synced).toBe(true);
  });

  it("keeps the cursor at the last fully applied page when a later page fails, and resumes exactly there", async () => {
    const state = createEmptyFeedState();
    let requestCount = 0;
    const server = fakeServer([1, 2, 3, 4, 5, 6], 2);
    const flaky = async (after: number) => {
      requestCount += 1;
      if (requestCount === 2) throw new Error("connection reset");
      return server.fetchPage(after);
    };

    await expect(replayMissed(state, flaky)).rejects.toThrow("connection reset");
    expect(state.updates.map((u) => u.sequence)).toEqual([1, 2]);
    expect(state.resumeCursor).toBe(2);
    expect(state.synced).toBe(false);

    await replayMissed(state, server.fetchPage);
    expect(state.updates.map((u) => u.sequence)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(state.resumeCursor).toBe(6);
    expect(state.synced).toBe(true);
  });

  it("does not advance the cursor for our own publish while offline (it could sit beside missed updates)", () => {
    const state = syncedStateThrough(10);
    state.synced = false; // disconnected

    processUpdate(state, makeUpdate(20)); // published via REST while the socket is down

    expect(state.updates.map((u) => u.sequence)).toContain(20);
    expect(state.resumeCursor).toBe(10);
  });

  it("counts a live update received during replay toward the checkpoint once the replay finishes, without duplicating it", async () => {
    const state = syncedStateThrough(10);
    state.synced = false;
    processUpdate(state, makeUpdate(12)); // live, arrives while replay is in flight
    const { fetchPage } = fakeServer([11, 12], 100);

    await replayMissed(state, fetchPage);

    expect(state.updates.map((u) => u.sequence).filter((s) => s === 12)).toHaveLength(1);
    expect(state.updates.map((u) => u.sequence).slice(-2)).toEqual([11, 12]);
    expect(state.resumeCursor).toBe(12);
  });

  it("after a completed replay, later live updates advance the cursor normally", async () => {
    const state = createEmptyFeedState();
    await replayMissed(state, fakeServer([1, 2], 100).fetchPage);

    processUpdate(state, makeUpdate(3));

    expect(state.resumeCursor).toBe(3);
  });
});

describe("replayMissed — cancellation", () => {
  it("discards the page and leaves state untouched if the socket was superseded mid-request", async () => {
    const state = createEmptyFeedState();
    let cancelled = false;
    const fetchPage = async (): Promise<ListUpdatesResponse> => {
      cancelled = true; // e.g. unmount / new socket while the request is in flight
      return { updates: [makeUpdate(1)], nextCursor: 1 };
    };

    const finished = await replayMissed(state, fetchPage, { isCancelled: () => cancelled });

    expect(finished).toBe(false);
    expect(state.updates).toHaveLength(0);
    expect(state.resumeCursor).toBe(0);
    expect(state.synced).toBe(false);
  });
});

describe("backoffDelay — no tight retry loop", () => {
  it("grows exponentially from the base delay", () => {
    const noJitter = () => 0;
    expect(backoffDelay(0, noJitter)).toBe(BASE_DELAY_MS);
    expect(backoffDelay(1, noJitter)).toBe(BASE_DELAY_MS * 2);
    expect(backoffDelay(2, noJitter)).toBe(BASE_DELAY_MS * 4);
  });

  it("never exceeds the ceiling plus jitter, however many attempts have failed", () => {
    const maxJitter = () => 1;
    for (const attempt of [5, 10, 50, 1000]) {
      expect(backoffDelay(attempt, maxJitter)).toBeLessThanOrEqual(MAX_DELAY_MS + JITTER_MS);
    }
  });

  it("always waits at least the base delay, so a failing server is never hammered", () => {
    for (let attempt = 0; attempt < 20; attempt++) {
      expect(backoffDelay(attempt, () => 0)).toBeGreaterThanOrEqual(BASE_DELAY_MS);
    }
  });
});
