// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { createLogger } from "@langwatch/observability";
import { z } from "zod";

import type {
  IntentSpec,
  WakeHandler,
} from "~/server/event-sourcing/pipeline/processManagerDefinition";

const logger = createLogger("langwatch:identity:scim-request-log:retention");

export const SCIM_REQUEST_LOG_RETENTION_PROCESS_NAME =
  "scimRequestLogRetention";

/**
 * Every six hours. The window is measured in days, so the interval is far
 * finer than the thing being enforced — a restart, a deploy or a slow tick
 * cannot make a row outlive its window by anything a reader would notice.
 */
export const SCIM_REQUEST_LOG_RETENTION_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * Outbox rows this process writes are bookkeeping, one per tick, pruned on the
 * same schedule every other recurring process uses.
 */
const RETENTION_ROW_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export const scimRequestLogRetentionSchema = z.object({
  scheduledFor: z.number().int(),
});

export interface ScimRequestLogRetentionState {
  lastSweepAt: number | null;
}

export interface ScimRequestLogRetentionDeps {
  /** Drops what has aged out of the retention window; returns how many rows went. */
  sweep: () => Promise<number>;
  deleteDispatchedBefore: (params: {
    processName: string;
    before: number;
  }) => Promise<number>;
  now?: () => number;
}

type ScimRequestLogRetentionIntents = {
  sweep: IntentSpec<typeof scimRequestLogRetentionSchema>;
};

/**
 * Wake handlers must be pure and synchronous, with no I/O and no clock read,
 * because the commit that persists this evolution is what fences racing
 * workers. The delete itself is an intent, so it runs behind the outbox lease.
 */
export const scimRequestLogRetentionWake: WakeHandler<
  ScimRequestLogRetentionState,
  ScimRequestLogRetentionIntents
> = (_state, ctx) => ({
  state: { lastSweepAt: ctx.at },
  intents: [ctx.intents.sweep(`sweep:${ctx.at}`, { scheduledFor: ctx.at })],
});

export function runScimRequestLogRetention({
  sweep,
  deleteDispatchedBefore,
  now,
}: ScimRequestLogRetentionDeps) {
  return async (): Promise<void> => {
    const startedAt = (now ?? Date.now)();
    const dropped = await sweep();
    if (dropped > 0) {
      logger.info(
        { dropped },
        "recorded SCIM requests past their retention were dropped",
      );
    }

    try {
      await deleteDispatchedBefore({
        processName: SCIM_REQUEST_LOG_RETENTION_PROCESS_NAME,
        before: startedAt - RETENTION_ROW_RETENTION_MS,
      });
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "SCIM request log retention outbox retention failed",
      );
    }
  };
}
