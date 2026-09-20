import type { IncidentUpdate, ListUpdatesResponse } from "../types/update";
import { processUpdate, type FeedState } from "./processUpdate";

export interface ReplayOptions {
  /** Called for each update that was newly added (not a duplicate), e.g. to tag its source in the UI. */
  onAdded?: (update: IncidentUpdate) => void;
  /** Checked around each await; return true when the socket/room this replay belongs to is no longer current. */
  isCancelled?: () => boolean;
}

/**
 * Drains everything the client is missing, page by page, from the durable
 * store. Used for the first load (cursor 0) and after every reconnect.
 *
 * Recovery guarantees:
 *  - Pagination: keeps requesting `after=<cursor>` until a page comes back
 *    empty, so a long outage (more missed updates than the server's page
 *    size) is fully recovered instead of silently truncated.
 *  - Cursor safety: `resumeCursor` advances only past pages that were
 *    fully applied. If a later page fails, the cursor stays at the last
 *    good page and the next attempt resumes exactly there.
 *  - Live-message race: the caller subscribes to the live socket BEFORE
 *    replaying, so anything committed after the last page's snapshot is
 *    delivered live and anything committed before it is in a page. Live
 *    updates that arrive meanwhile are deduplicated by `processUpdate` but
 *    cannot advance the cursor (state.synced is false until we finish).
 *
 * Resolves `true` when fully caught up, `false` if cancelled. Rejects if a
 * fetch fails or the server makes no forward progress; state is left
 * consistent (cursor untouched beyond the last applied page) so it can be
 * retried.
 */
export async function replayMissed(
  state: FeedState,
  fetchPage: (after: number) => Promise<ListUpdatesResponse>,
  { onAdded, isCancelled = () => false }: ReplayOptions = {}
): Promise<boolean> {
  state.synced = false;

  for (;;) {
    if (isCancelled()) return false;
    const page = await fetchPage(state.resumeCursor);
    // Discard the page rather than applying it: the state we hold may already
    // belong to a superseded socket or a different room.
    if (isCancelled()) return false;

    for (const update of page.updates) {
      if (processUpdate(state, update)) onAdded?.(update);
    }

    if (page.updates.length === 0) break;

    // Guard against a misbehaving server looping us forever on one page.
    if (page.nextCursor <= state.resumeCursor) {
      throw new Error("Replay made no forward progress");
    }
    state.resumeCursor = page.nextCursor;
  }

  // Fully drained. Anything we already hold from live delivery is now safe to
  // count towards the checkpoint, and from here live updates advance it too.
  state.resumeCursor = Math.max(state.resumeCursor, state.lastSeenSequence);
  state.synced = true;
  return true;
}
