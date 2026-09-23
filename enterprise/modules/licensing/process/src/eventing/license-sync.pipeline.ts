/**
 * The daily license sync of a connected install (ADR-156, section 9): a
 * scheduled process with no events of its own. `global`, because one pass
 * walks every organization whose license names a hosted service.
 */
import {
  defineAggregate,
  defineEvents,
  defineEventingModule,
  definePipeline,
  type Event,
  type EventingSetup,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";
import { nowInstant } from "@langwatch/time";

import type { LicensingApp } from "../app/licensing.app.ts";
import { LICENSE_SYNC_PROCESS_NAME, runLicenseSync } from "./license-sync.intent.ts";
import {
  LICENSE_SYNC_FIRST_DELAY_MS,
  LICENSE_SYNC_INITIAL_STATE,
  type LicenseSyncState,
  licenseSyncSchema,
  licenseSyncWake,
} from "./license-sync.process.ts";

export const LICENSE_SYNC_PIPELINE_NAME = "license_sync";

/** The pipeline, over only the one app operation it calls. */
export function buildLicenseSync({
  app,
  processStore,
  bootedAt = nowInstant().epochMilliseconds,
}: EventingSetup<unknown, Pick<LicensingApp, "syncLicenses">> & {
  bootedAt?: number;
}): StaticPipelineDefinition<Event> {
  return definePipeline<Event>({
    name: LICENSE_SYNC_PIPELINE_NAME,
    aggregate: defineAggregate({ type: "global", events: defineEvents([]) }),
  })
    .withProcessManager(LICENSE_SYNC_PROCESS_NAME, (pm) =>
      pm
        .state<LicenseSyncState>(LICENSE_SYNC_INITIAL_STATE)
        .schedule({ everyMs: LICENSE_SYNC_FIRST_DELAY_MS })
        .onWake(licenseSyncWake({ bootedAt }))
        .intent(
          "sync",
          licenseSyncSchema,
          runLicenseSync({
            sync: () => app.syncLicenses(),
            deleteDispatchedBefore: (params) => processStore.deleteDispatchedBefore(params),
            now: () => nowInstant().epochMilliseconds,
          }),
        )
        // One call per licensed organization; a retry repeats a sync the host rate-limits.
        .outbox({ maxAttempts: 3, concurrency: 1, batchSize: 1, leaseDurationMs: 10 * 60 * 1000 }),
    )
    .build();
}

export const licenseSyncEventing = defineEventingModule({
  pipeline: LICENSE_SYNC_PIPELINE_NAME,
  build: (setup: EventingSetup<undefined, LicensingApp>) => buildLicenseSync(setup),
});
