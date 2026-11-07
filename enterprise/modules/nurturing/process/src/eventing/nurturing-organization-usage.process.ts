// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { IntentSpec, ProcessManagerApplier, WakeHandler } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import { z } from "zod";

import { isUsageSyncDue } from "../rules/nurturing-organization-usage.rules.ts";

const logger = createLogger("langwatch:nurturing");

export const ORGANIZATION_USAGE_PROCESS_NAME = "organizationUsageSync" as const;

/** Hourly, so the sync goes on the first wake after 05:00 UTC and a restart never skips a day. */
const ORGANIZATION_USAGE_WAKE_INTERVAL_MS = 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

/** One outbox row per day of bookkeeping, pruned like every other recurring process's. */
const SYNC_ROW_RETENTION_MS = 7 * DAY_MS;

const organizationUsageScheduleStateSchema = z.object({
  /** Epoch ms of the last sync this process asked for, or of its first wake. */
  lastSyncAt: z.number().nullable(),
});
export type OrganizationUsageScheduleState = z.infer<typeof organizationUsageScheduleStateSchema>;

const syncSchema = z.object({ scheduledFor: z.number().int() });

type OrganizationUsageIntents = {
  sync: IntentSpec<typeof syncSchema>;
};

export interface OrganizationUsageRunDeps {
  /** Syncs every recently active organization for the day of `now`; throws when one was not. */
  readonly sync: (input: { now: number }) => Promise<void>;
  readonly deleteDispatchedBefore: (params: {
    processName: string;
    before: number;
  }) => Promise<number>;
  readonly now: () => number;
}

/**
 * The first wake only takes a baseline, so the first sync goes at the next 05:00 UTC. The intent
 * is keyed by the UTC day, so a redelivered wake asks for that day's sync once.
 */
export const organizationUsageWake: WakeHandler<
  OrganizationUsageScheduleState,
  OrganizationUsageIntents
> = (state, ctx) => {
  const at = Math.max(ctx.at, ctx.now);
  if (state.lastSyncAt === null) return { state: { lastSyncAt: at } };
  if (!isUsageSyncDue({ at, lastSyncAt: state.lastSyncAt })) return { state };
  return {
    state: { lastSyncAt: at },
    intents: [ctx.intent("sync", `sync:${Math.floor(at / DAY_MS)}`, { scheduledFor: at })],
  };
};

/** Syncs for the day the intent was scheduled, so a retry keeps that day's claims. */
export function runOrganizationUsageSync(
  deps: OrganizationUsageRunDeps,
): (payload: z.output<typeof syncSchema>) => Promise<void> {
  return async ({ scheduledFor }) => {
    const startedAt = deps.now();
    try {
      await deps.sync({ now: scheduledFor });
    } finally {
      await deps
        .deleteDispatchedBefore({
          processName: ORGANIZATION_USAGE_PROCESS_NAME,
          before: startedAt - SYNC_ROW_RETENTION_MS,
        })
        .catch((error: unknown) => {
          logger.warn(
            { error: error instanceof Error ? error.message : String(error) },
            "organization usage outbox retention failed",
          );
        });
    }
  };
}

/** One instance for the whole deployment: the sync walks every organization. */
export function organizationUsagePM(deps: OrganizationUsageRunDeps): ProcessManagerApplier<never> {
  return (pm) =>
    pm
      .state(organizationUsageScheduleStateSchema, { lastSyncAt: null })
      .schedule({ everyMs: ORGANIZATION_USAGE_WAKE_INTERVAL_MS })
      .onWake(organizationUsageWake)
      .intent("sync", syncSchema, runOrganizationUsageSync(deps))
      // A failed attempt has given its organizations' claims back, so a retry sends only those.
      .outbox({ maxAttempts: 3, concurrency: 1, batchSize: 1, leaseDurationMs: 10 * 60 * 1000 });
}
