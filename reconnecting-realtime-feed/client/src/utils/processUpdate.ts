import type { IncidentUpdate } from "../types/update";

/**
 * Holds the client's view of a room's feed: the deduplicated, ordered set
 * of updates, which IDs have already been seen (for dedup), and two
 * distinct cursors.
 *
 * This state is intentionally framework-agnostic and pure so it can be
 * unit tested without React, and reused identically whether an update
 * arrives via initial history, cursor replay, or live WebSocket delivery.
 */
export interface FeedState {
  updates: IncidentUpdate[];
  seenIds: Set<string>;
  /** Highest sequence seen through ANY path (history, replay, live). Display/diagnostics only — never used to resume. */
  lastSeenSequence: number;
  /**
   * The resume checkpoint: the client can prove it holds every update in
   * this room with sequence <= resumeCursor. This is what gets sent as
   * `?after=` on replay. It is deliberately NOT just the max sequence seen,
   * because a live message can arrive ahead of a gap (e.g. live #15 while
   * #11–#14 are still unfetched); resuming from 15 would skip them forever.
   */
  resumeCursor: number;
  /**
   * True only while the connection is open AND a replay has drained since
   * it opened. Live/own updates advance `resumeCursor` only in this state;
   * otherwise they could jump the cursor over updates we have not fetched.
   */
  synced: boolean;
}

export function createEmptyFeedState(): FeedState {
  return { updates: [], seenIds: new Set(), lastSeenSequence: 0, resumeCursor: 0, synced: false };
}

/**
 * Applies a single incoming update to feed state, in place, and returns
 * whether it was newly added (false means it was a duplicate and ignored).
 *
 * Dedup key: `update.id` (stable logical identity) — never message text,
 * timestamp, or array position. Ordering key: `update.sequence`, assigned
 * by the server.
 *
 * The resume cursor only advances here when the feed is `synced`. While a
 * replay is pending the cursor is owned by the replay loop (see replay.ts),
 * so a live or self-published update can never move it past a gap.
 */
export function processUpdate(state: FeedState, update: IncidentUpdate): boolean {
  if (state.seenIds.has(update.id)) {
    return false;
  }

  state.seenIds.add(update.id);
  state.updates.push(update);
  state.updates.sort((a, b) => a.sequence - b.sequence);
  state.lastSeenSequence = Math.max(state.lastSeenSequence, update.sequence);
  if (state.synced) {
    state.resumeCursor = Math.max(state.resumeCursor, update.sequence);
  }

  return true;
}

export function processUpdates(state: FeedState, updates: IncidentUpdate[]): void {
  for (const update of updates) {
    processUpdate(state, update);
  }
}
