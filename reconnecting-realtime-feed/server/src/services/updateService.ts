import { v4 as uuidv4 } from "uuid";
import { updateRepository } from "../repositories/updateRepository.js";
import { roomManager } from "../websocket/roomManager.js";
import type { IncidentUpdate } from "../types/update.js";

/**
 * Business logic for incident updates. This is the only place that ties
 * persistence and live delivery together, and it enforces the core
 * invariant of the system: an update is only broadcast after it has been
 * durably persisted. If the database insert fails, nothing is broadcast
 * and the update is not considered accepted.
 */
export const updateService = {
  async publish(params: { roomId: string; message: string }): Promise<IncidentUpdate> {
    const id = uuidv4();

    // 1. Persist first — this is the moment the update becomes durable
    //    and is assigned its canonical sequence by PostgreSQL.
    const update = await updateRepository.insert({
      id,
      roomId: params.roomId,
      message: params.message
    });

    // 2. Broadcast second — best-effort, transient delivery to whoever is
    //    currently connected. Clients that miss this recover it later via
    //    the cursor-based replay endpoint, since it now lives in Postgres.
    roomManager.broadcast(params.roomId, update);

    return update;
  },

  async listSince(params: { roomId: string; after: number; limit: number }): Promise<{
    updates: IncidentUpdate[];
    nextCursor: number;
  }> {
    const updates = await updateRepository.listAfter(params);
    const lastUpdate = updates[updates.length - 1];
    const nextCursor = lastUpdate ? lastUpdate.sequence : params.after;
    return { updates, nextCursor };
  }
};
