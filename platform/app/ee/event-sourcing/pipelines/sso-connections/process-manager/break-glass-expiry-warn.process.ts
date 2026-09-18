// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { createLogger } from "@langwatch/observability";
import { z } from "zod";

import type {
  IntentSpec,
  WakeHandler,
} from "~/server/event-sourcing/pipeline/processManagerDefinition";

const logger = createLogger("langwatch:identity:break-glass:expiry-warn");

export const BREAK_GLASS_EXPIRY_WARN_PROCESS_NAME = "breakGlassExpiryWarn";

/**
 * Hourly. The marks a binding passes are whole days apart, so an hour is far
 * finer than the thing being measured — which is what makes a restart, a
 * deploy or a slow tick invisible in what anybody actually receives.
 */
export const BREAK_GLASS_EXPIRY_WARN_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Outbox rows this process writes are bookkeeping, one per tick, pruned on the
 * same schedule every other recurring process uses.
 */
const WARN_ROW_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export const breakGlassExpiryWarnSchema = z.object({
  scheduledFor: z.number().int(),
});

export interface BreakGlassExpiryWarnState {
  lastWarnAt: number | null;
}

export interface BreakGlassExpiryWarnDeps {
  /** Sends any warnings newly due; returns how many bindings were warned. */
  warn: () => Promise<{ warned: number }>;
  deleteDispatchedBefore: (params: {
    processName: string;
    before: number;
  }) => Promise<number>;
  now?: () => number;
}

type BreakGlassExpiryWarnIntents = {
  warn: IntentSpec<typeof breakGlassExpiryWarnSchema>;
};

/**
 * Wake handlers must be pure and synchronous, with no I/O and no clock read,
 * because the commit that persists this evolution is what fences racing
 * workers. The sweep itself is an intent, so it runs behind the outbox lease.
 */
export const breakGlassExpiryWarnWake: WakeHandler<
  BreakGlassExpiryWarnState,
  BreakGlassExpiryWarnIntents
> = (_state, ctx) => ({
  state: { lastWarnAt: ctx.at },
  intents: [ctx.intents.warn(`warn:${ctx.at}`, { scheduledFor: ctx.at })],
});

export function runBreakGlassExpiryWarn({
  warn,
  deleteDispatchedBefore,
  now,
}: BreakGlassExpiryWarnDeps) {
  return async (): Promise<void> => {
    const startedAt = (now ?? Date.now)();

    const { warned } = await warn();
    if (warned > 0) {
      logger.info({ warned }, "break-glass expiry warnings sent");
    }

    try {
      await deleteDispatchedBefore({
        processName: BREAK_GLASS_EXPIRY_WARN_PROCESS_NAME,
        before: startedAt - WARN_ROW_RETENTION_MS,
      });
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "break-glass expiry warn outbox retention failed",
      );
    }
  };
}
