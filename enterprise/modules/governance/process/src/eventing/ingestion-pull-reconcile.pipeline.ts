// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type Event,
  type EventingSetup,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";
import { nowInstant } from "@langwatch/time";

import type { GovernanceApp } from "../app/governance.app.ts";
import type { GovernanceRepositories } from "../repositories/governance.repositories.ts";
import {
  INGESTION_PULL_RECONCILE_PROCESS_NAME,
  runIngestionPullReconcile,
} from "./ingestion-pull-reconcile.intent.ts";
import {
  INGESTION_PULL_RECONCILE_CHECK_MS,
  INGESTION_PULL_RECONCILE_INITIAL_STATE,
  type IngestionPullReconcileState,
  ingestionPullReconcileSchema,
  ingestionPullReconcileWake,
} from "./ingestion-pull-reconcile.process.ts";

export const INGESTION_PULL_RECONCILE_PIPELINE_NAME = "ingestion_pull_reconcile";

/** `global`: one pass walks every source and sends configure/disable to ingestion_pull_processing. */
export function buildIngestionPullReconcile({
  app,
  processStore,
  bootedAt = nowInstant().epochMilliseconds,
}: EventingSetup<unknown, Pick<GovernanceApp, "reconcileIngestionPulls">> & {
  bootedAt?: number;
}): StaticPipelineDefinition<Event> {
  return definePipeline({
    name: INGESTION_PULL_RECONCILE_PIPELINE_NAME,
    aggregate: defineAggregate({ type: "global" }),
  })
    .withEvents([])
    .withProcessManager(INGESTION_PULL_RECONCILE_PROCESS_NAME, (pm) =>
      pm
        .state<IngestionPullReconcileState>(INGESTION_PULL_RECONCILE_INITIAL_STATE)
        .schedule({ everyMs: INGESTION_PULL_RECONCILE_CHECK_MS })
        .onWake(ingestionPullReconcileWake({ bootedAt }))
        .intent(
          "reconcile",
          ingestionPullReconcileSchema,
          runIngestionPullReconcile({
            reconcile: () => app.reconcileIngestionPulls(),
            deleteDispatchedBefore: (params) => processStore.deleteDispatchedBefore(params),
            now: () => nowInstant().epochMilliseconds,
          }),
        )
        .outbox({ maxAttempts: 3, concurrency: 1, batchSize: 1, leaseDurationMs: 10 * 60 * 1000 }),
    )
    .build();
}

export const ingestionPullReconcileEventing = defineEventingModule({
  pipeline: INGESTION_PULL_RECONCILE_PIPELINE_NAME,
  build: (setup: EventingSetup<GovernanceRepositories, GovernanceApp>) =>
    buildIngestionPullReconcile(setup),
});
