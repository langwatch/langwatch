// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";
import { nowInstant } from "@langwatch/time";

import type { DemoDataModule } from "../app/demo-data.app.ts";
import {
  DEMO_DATA_INTERVAL_MS,
  DEMO_DATA_PROCESS_NAME,
  runSeedDemo,
  demoDataRunSchema,
  demoDataWake,
  type DemoDataRunDeps,
  demoDataRunStateSchema,
} from "./demo-data.process.ts";

export const DEMO_DATA_PIPELINE_NAME = "seed_demo";

/** Replaces main's `/api/cron/seed_demo`: one run a day across the fleet, with no events of its own. */
export function buildDemoDataPipeline(
  deps: Omit<DemoDataRunDeps, "now">,
): StaticPipelineDefinition<never> {
  return definePipeline({
    name: DEMO_DATA_PIPELINE_NAME,
    aggregate: defineAggregate({ type: "global" }),
  })
    .withEvents([])
    .withProcessManager(DEMO_DATA_PROCESS_NAME, (pm) =>
      pm
        .state(demoDataRunStateSchema, { lastRunAt: null })
        .schedule({ everyMs: DEMO_DATA_INTERVAL_MS })
        .onWake(demoDataWake)
        .intent(
          "run",
          demoDataRunSchema,
          runSeedDemo({ ...deps, now: () => nowInstant().epochMilliseconds }),
        )
        // A run appends rows, so a retry would double them; a failed run dead-letters for an operator.
        .outbox({ maxAttempts: 1, concurrency: 1, batchSize: 1, leaseDurationMs: 30 * 60 * 1000 }),
    )
    .build();
}

export const demoDataEventing = defineEventingModule({
  pipeline: DEMO_DATA_PIPELINE_NAME,
  build: ({ app, processStore }: EventingSetup<undefined, DemoDataModule>) =>
    app.demoDataPipeline({
      deleteDispatchedBefore: (params) => processStore.deleteDispatchedBefore(params),
    }),
});
