import { useCallback, useEffect, useRef, useState } from "react";
import { fetchUpdates, publishUpdate, wsUrlForRoom } from "../services/api";
import { createEmptyFeedState, processUpdate, type FeedState } from "../utils/processUpdate";
import { replayMissed } from "../utils/replay";
import { backoffDelay } from "../utils/backoff";
import type { ConnectionState, DisplayUpdate, IncidentUpdateBroadcast, UpdateSource } from "../types/update";

export interface UseIncidentSocketResult {
  updates: DisplayUpdate[];
  connectionState: ConnectionState;
  lastError: string | null;
  /** The resume checkpoint this client would send as `?after=` on its next replay (not merely the highest sequence seen). */
  resumeCursor: number;
  publish: (message: string) => Promise<void>;
  /** Dev-only: closes the live socket and holds it closed (no auto-reconnect) until `reconnect` is called. */
  simulateDisconnect: () => void;
  /** Dev-only: resumes normal connection behavior after `simulateDisconnect`. */
  reconnect: () => void;
}

/**
 * Owns the full client-side lifecycle for one room's feed:
 *  - loads/replays updates via REST (same request shape for initial load
 *    and post-reconnect recovery — just a different `after` cursor),
 *  - maintains the live WebSocket connection with backoff reconnection,
 *  - funnels every update (history, replay, live) through the single
 *    `processUpdate` function so deduplication and ordering are uniform
 *    regardless of delivery path (the history/live race).
 */
export function useIncidentSocket(roomId: string): UseIncidentSocketResult {
  const [updates, setUpdates] = useState<DisplayUpdate[]>([]);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [lastError, setLastError] = useState<string | null>(null);
  const [resumeCursor, setResumeCursor] = useState(0);

  const feedStateRef = useRef<FeedState>(createEmptyFeedState());
  // Tracks how each update first reached this client — display-only, never affects dedup/ordering.
  const sourceByIdRef = useRef<Map<string, UpdateSource>>(new Map());
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Separate backoff/timer for retrying a failed replay while the socket itself is still healthy.
  const replayAttemptRef = useRef(0);
  const replayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountedRef = useRef(false);
  // Set by simulateDisconnect; while true, onclose skips auto-reconnect scheduling
  // so the socket stays down until the user explicitly calls reconnect().
  const manualDisconnectRef = useRef(false);

  const syncUpdatesFromFeedState = useCallback(() => {
    setUpdates(
      feedStateRef.current.updates.map((update) => ({
        ...update,
        source: sourceByIdRef.current.get(update.id) ?? "history"
      }))
    );
    setResumeCursor(feedStateRef.current.resumeCursor);
  }, []);

  const clearReplayTimer = useCallback(() => {
    if (replayTimerRef.current) {
      clearTimeout(replayTimerRef.current);
      replayTimerRef.current = null;
    }
  }, []);

  /**
   * Drains every update after the resume cursor, page by page. Used for the
   * very first load (cursor 0) and after every reconnect. `ws` ties the
   * replay to the socket that started it, so it is abandoned if that socket
   * is superseded, closed, or unmounted. On failure the cursor stays at the
   * last fully-applied page, the error is surfaced, and the replay is retried
   * with backoff — the feed is never silently left half-recovered.
   */
  const replay = useCallback(async (roomIdToReplay: string, ws: WebSocket): Promise<void> => {
    const isCancelled = () => unmountedRef.current || wsRef.current !== ws;
    try {
      const finished = await replayMissed(
        feedStateRef.current,
        (after) => fetchUpdates(roomIdToReplay, after),
        { isCancelled, onAdded: (update) => sourceByIdRef.current.set(update.id, "history") }
      );
      if (!finished) return;
      replayAttemptRef.current = 0;
      syncUpdatesFromFeedState();
      setLastError(null);
    } catch (err) {
      if (isCancelled()) return;
      // Pages applied before the failure are kept (and the cursor sits right after them).
      syncUpdatesFromFeedState();
      setLastError(err instanceof Error ? err.message : "Failed to load updates");
      const delay = backoffDelay(replayAttemptRef.current);
      replayAttemptRef.current += 1;
      replayTimerRef.current = setTimeout(() => {
        replayTimerRef.current = null;
        if (isCancelled()) return;
        void replay(roomIdToReplay, ws);
      }, delay);
    }
  }, [syncUpdatesFromFeedState]);

  const scheduleReconnect = useCallback((roomIdToRetry: string) => {
    if (unmountedRef.current) return;
    const attempt = reconnectAttemptRef.current;
    reconnectAttemptRef.current += 1;
    const delay = backoffDelay(attempt);

    reconnectTimerRef.current = setTimeout(() => {
      if (unmountedRef.current) return;
      setConnectionState("reconnecting");
      connect(roomIdToRetry);
      // eslint-disable-next-line @typescript-eslint/no-use-before-define
    }, delay);
  }, []);

  const connect = useCallback((roomIdToConnect: string) => {
    // A fresh connection has not yet proven it is caught up; only a completed
    // replay flips this back to true (see replayMissed).
    feedStateRef.current.synced = false;
    replayAttemptRef.current = 0;
    clearReplayTimer();

    const ws = new WebSocket(wsUrlForRoom(roomIdToConnect));
    wsRef.current = ws;

    // Every handler below checks `wsRef.current === ws` before acting. Without
    // it, a stale socket superseded by a newer one (e.g. React StrictMode's
    // dev-only double-invoke of this effect) can still fire a delayed close/
    // message event, stomp on the ref that now points at the live socket, and
    // leave that live socket orphaned — open, subscribed server-side, and
    // silently feeding messages into the feed even while the UI shows
    // Disconnected (only the *tracked* socket gets closed by simulateDisconnect).
    ws.onopen = () => {
      if (unmountedRef.current || wsRef.current !== ws) return;
      reconnectAttemptRef.current = 0;
      setConnectionState("connected");
      // The server subscribes this socket to the room before `open` fires, so
      // replaying now closes the gap: rows committed before the replay query
      // are in its pages, rows committed after are delivered live.
      void replay(roomIdToConnect, ws);
    };

    ws.onmessage = (event) => {
      if (wsRef.current !== ws) return;
      try {
        const message: IncidentUpdateBroadcast = JSON.parse(event.data);
        if (message.type === "incident.update") {
          const added = processUpdate(feedStateRef.current, message.data);
          if (added) sourceByIdRef.current.set(message.data.id, "live");
          syncUpdatesFromFeedState();
        }
      } catch {
        // Malformed frame from the server — ignore rather than crash the client.
      }
    };

    ws.onclose = () => {
      if (unmountedRef.current || wsRef.current !== ws) return;
      wsRef.current = null;
      // While down we may miss updates (even our own REST publish can land
      // beside missed ones), so nothing may advance the cursor until re-synced.
      feedStateRef.current.synced = false;
      clearReplayTimer();
      setConnectionState("disconnected");
      if (manualDisconnectRef.current) return;
      scheduleReconnect(roomIdToConnect);
    };

    ws.onerror = () => {
      if (wsRef.current !== ws) return;
      // A socket-level error is always followed by a close event, which
      // owns the actual reconnect scheduling — this only surfaces the message.
      setLastError("WebSocket connection error");
    };
  }, [replay, scheduleReconnect, syncUpdatesFromFeedState, clearReplayTimer]);

  useEffect(() => {
    unmountedRef.current = false;
    feedStateRef.current = createEmptyFeedState();
    sourceByIdRef.current = new Map();
    reconnectAttemptRef.current = 0;
    setUpdates([]);
    setConnectionState("connecting");
    setLastError(null);
    setResumeCursor(0);

    connect(roomId);

    return () => {
      unmountedRef.current = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      clearReplayTimer();
      wsRef.current?.close();
      wsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  const publish = useCallback(async (message: string) => {
    const created = await publishUpdate(roomId, message);
    // Apply immediately for responsiveness; the WebSocket broadcast of the
    // same id will arrive shortly after and be ignored by processUpdate.
    const added = processUpdate(feedStateRef.current, created);
    if (added) sourceByIdRef.current.set(created.id, "self");
    syncUpdatesFromFeedState();
  }, [roomId, syncUpdatesFromFeedState]);

  const simulateDisconnect = useCallback(() => {
    manualDisconnectRef.current = true;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    wsRef.current?.close();
  }, []);

  const reconnect = useCallback(() => {
    manualDisconnectRef.current = false;
    reconnectAttemptRef.current = 0;
    setConnectionState("connecting");
    connect(roomId);
  }, [connect, roomId]);

  return { updates, connectionState, lastError, resumeCursor, publish, simulateDisconnect, reconnect };
}
