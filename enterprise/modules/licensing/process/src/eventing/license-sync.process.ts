import type { IntentSpec, WakeHandler } from "@langwatch/eventing";
import { z } from "zod";

/** A connected install syncs once a day. */
export const LICENSE_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * The first sync waits this long for the install to finish coming up, and no
 * longer: an install restarted to fix a failing sync should not wait a day.
 */
export const LICENSE_SYNC_FIRST_DELAY_MS = 2 * 60 * 1000;

export const licenseSyncSchema = z.object({ scheduledFor: z.number().int() });

export interface LicenseSyncState {
  /** Epoch ms of the last sync this process asked for. */
  lastSyncAt: number | null;
}

export const LICENSE_SYNC_INITIAL_STATE: LicenseSyncState = { lastSyncAt: null };

export type LicenseSyncIntents = {
  sync: IntentSpec<typeof licenseSyncSchema>;
};

/**
 * Due once the process has been up for the first delay and has not synced
 * since it came up, and then a day after each sync. Pure; the sync itself
 * runs behind the outbox lease.
 */
export function licenseSyncWake({
  bootedAt,
}: {
  bootedAt: number;
}): WakeHandler<LicenseSyncState, LicenseSyncIntents> {
  return (state, ctx) => {
    const at = Math.max(ctx.at, ctx.now);
    const settled = at >= bootedAt + LICENSE_SYNC_FIRST_DELAY_MS;
    const syncedSinceBoot = state.lastSyncAt !== null && state.lastSyncAt >= bootedAt;
    const dayElapsed =
      state.lastSyncAt !== null && at - state.lastSyncAt >= LICENSE_SYNC_INTERVAL_MS;
    if (!settled || (syncedSinceBoot && !dayElapsed)) return { state };
    return {
      state: { lastSyncAt: at },
      intents: [ctx.intents.sync(`sync:${at}`, { scheduledFor: at })],
    };
  };
}
