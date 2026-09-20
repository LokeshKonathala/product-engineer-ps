-- Reconnecting Real-Time Incident Feed — database schema
--
-- PostgreSQL is the durable source of truth for the feed. The `sequence`
-- column is a server-generated monotonic ordering key (BIGSERIAL) used for
-- deterministic ordering and cursor-based recovery. The `id` column is a
-- stable logical identity used by clients for deduplication. These two
-- concerns are intentionally separate (see SUBMISSION.md).

CREATE TABLE IF NOT EXISTS incident_updates (
    sequence   BIGSERIAL PRIMARY KEY,
    id         UUID NOT NULL UNIQUE,
    room_id    VARCHAR(100) NOT NULL,
    message    TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Every recovery/history query filters by room_id and orders/paginates by
-- sequence, so a composite index on (room_id, sequence) covers the
-- critical query path for replay.
CREATE INDEX IF NOT EXISTS idx_incident_updates_room_sequence
    ON incident_updates (room_id, sequence);
