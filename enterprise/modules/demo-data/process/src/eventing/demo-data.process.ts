// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { IntentSpec, WakeHandler } from "@langwatch/eventing";
import { z } from "zod";

export const DEMO_DATA_PROCESS_NAME = "seedDemoRun";

/** Daily, main's "daily reset of the canonical demo org"; its CronJob schedule lived in the SaaS chart. */
export const DEMO_DATA_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Outbox rows are bookkeeping, one per run, pruned like every recurring process's. */
const RUN_ROW_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export const demoDataRunSchema = z.object({ scheduledFor: z.number().int() });

export const demoDataRunStateSchema = z.object({
  lastRunAt: z.number().nullable(),
});
export type DemoDataRunState = z.infer<typeof demoDataRunStateSchema>;

type DemoDataIntents = {
  run: IntentSpec<typeof demoDataRunSchema>;
};

/** Pure and synchronous: the seeding itself is an intent, run behind the outbox lease. */
export const demoDataWake: WakeHandler<DemoDataRunState, DemoDataIntents> = (_state, ctx) => ({
  state: { lastRunAt: ctx.at },
  intents: [ctx.intent("run", `run:${ctx.at}`, { scheduledFor: ctx.at })],
});

export interface DemoDataRunDeps {
  readonly run: () => Promise<void>;
  readonly deleteDispatchedBefore: (params: {
    processName: string;
    before: number;
  }) => Promise<number>;
  readonly now: () => number;
}

/** The prune is bookkeeping, and a failed one waits for the next day's. */
export function runSeedDemo(deps: DemoDataRunDeps): () => Promise<void> {
  return async (): Promise<void> => {
    const startedAt = deps.now();
    await deps.run();
    await deps
      .deleteDispatchedBefore({
        processName: DEMO_DATA_PROCESS_NAME,
        before: startedAt - RUN_ROW_RETENTION_MS,
      })
      .catch(() => 0);
  };
}
