/**
 * Stored-object's scheduled sweep (uploads-through-langwatch.feature): reap the
 * pending uploads nobody confirmed. No events; a global aggregate hosted by the
 * worker, cleaning each project through its own scoped reads.
 */
import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";

import type { StoredObjectModule } from "../app/stored-object.app.ts";
import type { StoredObjectRepositories } from "../repositories/stored-object.repositories.ts";
import { StoredObjectUploadReapService } from "../services/stored-object-upload-reap.service.ts";
import { UPLOAD_REAP_PROCESS_NAME, runUploadReap } from "./upload-reap.intent.ts";
import {
  UPLOAD_REAP_INITIAL_STATE,
  UPLOAD_REAP_INTERVAL_MS,
  uploadReapSchema,
  uploadReapStateSchema,
  uploadReapWake,
} from "./upload-reap.process.ts";

export const STORED_OBJECT_MAINTENANCE_PIPELINE_NAME = "stored_object_maintenance";

/** The pipeline itself, over only what it reads, so a test can build it without an app. */
export function buildStoredObjectMaintenance({
  repositories,
  processStore,
}: EventingSetup<
  Pick<StoredObjectRepositories, "records" | "bytes">,
  unknown
>): StaticPipelineDefinition<never> {
  const uploads = StoredObjectUploadReapService.create({
    records: repositories.records,
    storage: repositories.bytes,
  });

  return definePipeline({
    name: STORED_OBJECT_MAINTENANCE_PIPELINE_NAME,
    aggregate: defineAggregate({ type: "global" }),
  })
    .withEvents([])
    .withProcessManager(UPLOAD_REAP_PROCESS_NAME, (pm) =>
      pm
        .state(uploadReapStateSchema, UPLOAD_REAP_INITIAL_STATE)
        .schedule({ everyMs: UPLOAD_REAP_INTERVAL_MS })
        .onWake(uploadReapWake)
        .intent(
          "reap",
          uploadReapSchema,
          runUploadReap({
            reap: () => uploads.reap(),
            deleteDispatchedBefore: (params) => processStore.deleteDispatchedBefore(params),
          }),
        )
        // Bounded pages of deletes; a retry finds the reaped rows already failed.
        .outbox({ leaseDurationMs: 10 * 60 * 1000, maxAttempts: 3, concurrency: 1 }),
    )
    .build();
}

export const storedObjectEventing = defineEventingModule({
  pipeline: STORED_OBJECT_MAINTENANCE_PIPELINE_NAME,
  build: (setup: EventingSetup<StoredObjectRepositories, StoredObjectModule>) =>
    buildStoredObjectMaintenance(setup),
});
