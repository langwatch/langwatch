import { createLogger } from "@langwatch/observability";
import { z } from "zod";

import type {
  IntentSpec,
  WakeHandler,
} from "~/server/event-sourcing/pipeline/processManagerDefinition";
import type { OrphanLinkSweepResult } from "~/server/users/orphan-link-sweep";

const logger = createLogger("langwatch:identity-links:orphan-sweep-process");

export const ORPHAN_LINK_SWEEP_PROCESS_NAME = "orphanLinkSweep";

/**
 * Hourly. Every offboarding path already writes its closing rows inside the
 * membership change's transaction (ADR-094 Decision 4), so this sweep normally
 * finds nothing — it exists for the paths that do not exist yet and the ones
 * that break. An hour is soon enough that a cost report never runs on a stale
 * link for long, and rare enough that a pass finding nothing costs nothing.
 */
export const ORPHAN_LINK_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/** Bookkeeping rows, one per tick, pruned on the usual schedule. */
const SWEEP_ROW_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export const orphanLinkSweepSchema = z.object({
  scheduledFor: z.number().int(),
});

export interface OrphanLinkSweepState {
  lastSweepAt: number | null;
}

export const ORPHAN_LINK_SWEEP_INITIAL_STATE: OrphanLinkSweepState = {
  lastSweepAt: null,
};

export interface OrphanLinkSweepDeps {
  /** One pass over the fleet; returns what it examined and what it closed. */
  sweep: () => Promise<OrphanLinkSweepResult>;
  deleteDispatchedBefore: (params: {
    processName: string;
    before: number;
  }) => Promise<number>;
  now?: () => number;
}

type OrphanLinkSweepIntents = {
  sweep: IntentSpec<typeof orphanLinkSweepSchema>;
};

/**
 * Wake handlers are pure and synchronous — no I/O, no clock reads — because
 * the commit that persists this evolution is what fences racing workers, so
 * exactly one of them proceeds and the losers observe a stale wake and stand
 * down. The scan itself is an intent, run behind the outbox lease.
 */
export const orphanLinkSweepWake: WakeHandler<
  OrphanLinkSweepState,
  OrphanLinkSweepIntents
> = (_state, ctx) => ({
  state: { lastSweepAt: ctx.at },
  intents: [ctx.intents.sweep(`sweep:${ctx.at}`, { scheduledFor: ctx.at })],
});

export function runOrphanLinkSweep(deps: OrphanLinkSweepDeps) {
  return async (): Promise<void> => {
    const startedAt = (deps.now ?? Date.now)();

    // The pass logs its own findings — and only when it finds something,
    // because a healthy fleet ticks hourly forever and a routine "closed 0"
    // line is noise that trains people to skip the stream.
    await deps.sweep();

    try {
      await deps.deleteDispatchedBefore({
        processName: ORPHAN_LINK_SWEEP_PROCESS_NAME,
        before: startedAt - SWEEP_ROW_RETENTION_MS,
      });
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "Orphan link sweep outbox retention failed",
      );
    }
  };
}
