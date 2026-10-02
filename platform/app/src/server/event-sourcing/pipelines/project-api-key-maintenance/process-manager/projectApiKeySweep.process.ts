import { createLogger } from "@langwatch/observability";
import { z } from "zod";

import type {
  IntentSpec,
  WakeHandler,
} from "~/server/event-sourcing/pipeline/processManagerDefinition";

const logger = createLogger("langwatch:project-api-key:sweep");

export const PROJECT_API_KEY_SWEEP_PROCESS_NAME = "projectApiKeySweep";

/**
 * Hourly. Authentication hashes a plaintext key the first time it sees it, so
 * the sweep is not what keeps keys working. It hashes keys that saw no request,
 * corrects a hash left stale by a rotation on the previous release, and
 * clears plaintext once the grace window has passed. A row the sweep finds
 * with nothing to do costs one HMAC.
 */
export const PROJECT_API_KEY_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Outbox rows this process writes are bookkeeping, one per tick, pruned on the
 * same schedule every other recurring process uses.
 */
const SWEEP_ROW_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export const projectApiKeySweepSchema = z.object({
  scheduledFor: z.number().int(),
});

export interface ProjectApiKeySweepState {
  lastSweepAt: number | null;
}

export interface ProjectApiKeySweepDeps {
  /** Hashes plaintext keys and clears plaintext past the grace window. */
  sweep: () => Promise<unknown>;
  deleteDispatchedBefore: (params: {
    processName: string;
    before: number;
  }) => Promise<number>;
  now?: () => number;
}

type ProjectApiKeySweepIntents = {
  sweep: IntentSpec<typeof projectApiKeySweepSchema>;
};

/**
 * Wake handlers must be pure and synchronous, with no I/O and no clock read,
 * because the commit that persists this evolution is what fences racing
 * workers. The sweep itself is an intent, so it runs behind the outbox lease.
 */
export const projectApiKeySweepWake: WakeHandler<
  ProjectApiKeySweepState,
  ProjectApiKeySweepIntents
> = (_state, ctx) => ({
  state: { lastSweepAt: ctx.at },
  intents: [ctx.intents.sweep(`sweep:${ctx.at}`, { scheduledFor: ctx.at })],
});

export function runProjectApiKeySweep({
  sweep,
  deleteDispatchedBefore,
  now,
}: ProjectApiKeySweepDeps) {
  return async (): Promise<void> => {
    const startedAt = (now ?? Date.now)();
    // `sweep` reports its own outcome under `langwatch:api-key:project-api-key`.
    await sweep();

    try {
      await deleteDispatchedBefore({
        processName: PROJECT_API_KEY_SWEEP_PROCESS_NAME,
        before: startedAt - SWEEP_ROW_RETENTION_MS,
      });
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "project API key sweep outbox retention failed",
      );
    }
  };
}
