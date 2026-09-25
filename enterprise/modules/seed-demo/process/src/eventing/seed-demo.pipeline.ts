// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type StaticPipelineDefinition,
  type Event,
} from "@langwatch/eventing";
import { nowInstant } from "@langwatch/time";

import type { SeedDemoApp } from "../app/seed-demo.app.ts";
import {
  SEED_DEMO_INTERVAL_MS,
  SEED_DEMO_PROCESS_NAME,
  runSeedDemo,
  seedDemoRunSchema,
  seedDemoWake,
  type SeedDemoRunDeps,
  type SeedDemoRunState,
} from "./seed-demo.process.ts";

export const SEED_DEMO_PIPELINE_NAME = "seed_demo";

/** Replaces main's `/api/cron/seed_demo`: one run a day across the fleet, with no events of its own. */
export function buildSeedDemoPipeline(
  deps: Omit<SeedDemoRunDeps, "now">,
): StaticPipelineDefinition<Event> {
  return definePipeline({
    name: SEED_DEMO_PIPELINE_NAME,
    aggregate: defineAggregate({ type: "global" }),
  })
    .withEvents([])
    .withProcessManager(SEED_DEMO_PROCESS_NAME, (pm) =>
      pm
        .state<SeedDemoRunState>({ lastRunAt: null })
        .schedule({ everyMs: SEED_DEMO_INTERVAL_MS })
        .onWake(seedDemoWake)
        .intent(
          "run",
          seedDemoRunSchema,
          runSeedDemo({ ...deps, now: () => nowInstant().epochMilliseconds }),
        )
        // A run appends rows, so a retry would double them; a failed run dead-letters for an operator.
        .outbox({ maxAttempts: 1, concurrency: 1, batchSize: 1, leaseDurationMs: 30 * 60 * 1000 }),
    )
    .build();
}

export const seedDemoEventing = defineEventingModule({
  pipeline: SEED_DEMO_PIPELINE_NAME,
  build: ({ app, processStore }: EventingSetup<undefined, SeedDemoApp>) =>
    app.seedDemoPipeline({
      deleteDispatchedBefore: (params) => processStore.deleteDispatchedBefore(params),
    }),
});
