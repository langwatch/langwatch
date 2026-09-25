// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { IntentSpec, WakeHandler } from "@langwatch/eventing";
import { z } from "zod";

export const SEED_DEMO_PROCESS_NAME = "seedDemoRun";

/** Daily, main's "daily reset of the canonical demo org"; its CronJob schedule lived in the SaaS chart. */
export const SEED_DEMO_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Outbox rows are bookkeeping, one per run, pruned like every recurring process's. */
const RUN_ROW_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export const seedDemoRunSchema = z.object({ scheduledFor: z.number().int() });

export interface SeedDemoRunState {
  lastRunAt: number | null;
}

type SeedDemoIntents = {
  run: IntentSpec<typeof seedDemoRunSchema>;
};

/** Pure and synchronous: the seeding itself is an intent, run behind the outbox lease. */
export const seedDemoWake: WakeHandler<SeedDemoRunState, SeedDemoIntents> = (_state, ctx) => ({
  state: { lastRunAt: ctx.at },
  intents: [ctx.intents.run(`run:${ctx.at}`, { scheduledFor: ctx.at })],
});

export interface SeedDemoRunDeps {
  readonly run: () => Promise<void>;
  readonly deleteDispatchedBefore: (params: {
    processName: string;
    before: number;
  }) => Promise<number>;
  readonly now: () => number;
}

/** The prune is bookkeeping, and a failed one waits for the next day's. */
export function runSeedDemo(deps: SeedDemoRunDeps): () => Promise<void> {
  return async (): Promise<void> => {
    const startedAt = deps.now();
    await deps.run();
    await deps
      .deleteDispatchedBefore({
        processName: SEED_DEMO_PROCESS_NAME,
        before: startedAt - RUN_ROW_RETENTION_MS,
      })
      .catch(() => 0);
  };
}
