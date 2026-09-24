// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * SCIM's scheduled sweep: drop recorded provisioning requests past their
 * retention window. No events; a global aggregate hosted by the worker.
 */
import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type StaticPipelineDefinition,
  type Event,
} from "@langwatch/eventing";
import { nowInstant } from "@langwatch/time";

import type { ScimApp } from "../app/scim.app.ts";
import type { ScimRepositories } from "../repositories/scim.repositories.ts";
import {
  SCIM_REQUEST_LOG_RETENTION_PROCESS_NAME,
  runScimRequestLogRetention,
} from "./scim-request-log-retention.intent.ts";
import {
  SCIM_REQUEST_LOG_RETENTION_INITIAL_STATE,
  SCIM_REQUEST_LOG_RETENTION_INTERVAL_MS,
  type ScimRequestLogRetentionState,
  scimRequestLogRetentionSchema,
  scimRequestLogRetentionWake,
} from "./scim-request-log-retention.process.ts";

export const SCIM_MAINTENANCE_PIPELINE_NAME = "scim_maintenance";

/** The pipeline itself, over only the one app operation it calls. */
export function buildScimMaintenance({
  app,
  processStore,
}: EventingSetup<unknown, Pick<ScimApp, "sweepExpiredRequests">>): StaticPipelineDefinition<Event> {
  return definePipeline({
    name: SCIM_MAINTENANCE_PIPELINE_NAME,
    aggregate: defineAggregate({ type: "global" }),
  })
    .withEvents([])
    .withProcessManager(SCIM_REQUEST_LOG_RETENTION_PROCESS_NAME, (pm) =>
      pm
        .state<ScimRequestLogRetentionState>(SCIM_REQUEST_LOG_RETENTION_INITIAL_STATE)
        .schedule({ everyMs: SCIM_REQUEST_LOG_RETENTION_INTERVAL_MS })
        .onWake(scimRequestLogRetentionWake)
        .intent(
          "sweep",
          scimRequestLogRetentionSchema,
          runScimRequestLogRetention({
            sweep: () => app.sweepExpiredRequests({ now: nowInstant() }),
            deleteDispatchedBefore: (params) => processStore.deleteDispatchedBefore(params),
          }),
        )
        // One idempotent delete; a retry removes nothing twice.
        .outbox({ leaseDurationMs: 5 * 60 * 1000, maxAttempts: 3 }),
    )
    .build();
}

export const scimEventing = defineEventingModule({
  pipeline: SCIM_MAINTENANCE_PIPELINE_NAME,
  build: (setup: EventingSetup<ScimRepositories, ScimApp>) => buildScimMaintenance(setup),
});
