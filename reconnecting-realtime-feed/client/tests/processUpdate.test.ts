import { describe, it, expect } from "vitest";
import { createEmptyFeedState, processUpdate, processUpdates } from "../src/utils/processUpdate";
import type { IncidentUpdate } from "../src/types/update";

function makeUpdate(overrides: Partial<IncidentUpdate>): IncidentUpdate {
  return {
    id: "id-1",
    roomId: "INC-001",
    message: "message",
    sequence: 1,
    createdAt: "2026-09-18T08:00:00.000Z",
    ...overrides
  };
}

describe("processUpdate — deduplication (AC4)", () => {
  it("ignores a second delivery of the same logical update (same id)", () => {
    const state = createEmptyFeedState();
    const update = makeUpdate({ id: "abc-123", sequence: 5 });

    const firstResult = processUpdate(state, update);
    const secondResult = processUpdate(state, { ...update }); // same id, new object

    expect(firstResult).toBe(true);
    expect(secondResult).toBe(false);
    expect(state.updates).toHaveLength(1);
  });

  it("handles the documented history/live race: 11,12,13 via HTTP then 13 again via WebSocket", () => {
    const state = createEmptyFeedState();
    const history = [
      makeUpdate({ id: "u11", sequence: 11 }),
      makeUpdate({ id: "u12", sequence: 12 }),
      makeUpdate({ id: "u13", sequence: 13 })
    ];

    processUpdates(state, history);
    // The same event 13 arrives again, this time over the WebSocket.
    processUpdate(state, makeUpdate({ id: "u13", sequence: 13 }));

    expect(state.updates.map((u) => u.sequence)).toEqual([11, 12, 13]);
    expect(state.updates).toHaveLength(3);
  });

  it("treats different ids as different logical updates even with identical message text", () => {
    const state = createEmptyFeedState();
    processUpdate(state, makeUpdate({ id: "a", sequence: 1, message: "same text" }));
    processUpdate(state, makeUpdate({ id: "b", sequence: 2, message: "same text" }));

    expect(state.updates).toHaveLength(2);
  });
});

describe("processUpdate — ordering (AC5)", () => {
  it("renders updates in ascending sequence order regardless of arrival order", () => {
    const state = createEmptyFeedState();
    processUpdate(state, makeUpdate({ id: "c", sequence: 3 }));
    processUpdate(state, makeUpdate({ id: "a", sequence: 1 }));
    processUpdate(state, makeUpdate({ id: "b", sequence: 2 }));

    expect(state.updates.map((u) => u.sequence)).toEqual([1, 2, 3]);
  });
});

describe("processUpdate — cursor progression", () => {
  it("advances lastSeenSequence only for newly processed updates", () => {
    const state = createEmptyFeedState();
    processUpdate(state, makeUpdate({ id: "a", sequence: 5 }));
    expect(state.lastSeenSequence).toBe(5);

    // Duplicate delivery of an older sequence must not move the cursor at all,
    // and a duplicate of the current max must not double-advance it either.
    processUpdate(state, makeUpdate({ id: "a", sequence: 5 }));
    expect(state.lastSeenSequence).toBe(5);

    processUpdate(state, makeUpdate({ id: "b", sequence: 6 }));
    expect(state.lastSeenSequence).toBe(6);
  });

  it("advances the resume cursor only while synced, so a live update cannot jump a gap", () => {
    const state = createEmptyFeedState();

    processUpdate(state, makeUpdate({ id: "a", sequence: 15 })); // not synced yet
    expect(state.lastSeenSequence).toBe(15);
    expect(state.resumeCursor).toBe(0);

    state.synced = true;
    processUpdate(state, makeUpdate({ id: "b", sequence: 16 }));
    expect(state.resumeCursor).toBe(16);
  });
});
