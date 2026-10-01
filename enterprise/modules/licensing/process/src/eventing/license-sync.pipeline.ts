/**
 * The daily license sync of a connected install (ADR-156, section 9): a
 * scheduled process with no events of its own. `global`, because one pass
 * walks every organization whose license names a hosted service.
 */
import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type PeerSubscriberDefinition,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";
import {
  ORGANIZATION_SIGNED_UP_EVENT_TYPE,
  organizationSignedUpEventDataSchema,
} from "@langwatch/organization-contract";
import { nowInstant } from "@langwatch/time";

import type { LicensingApp } from "../app/licensing.app.ts";
import { LICENSE_SYNC_PROCESS_NAME, runLicenseSync } from "./license-sync.intent.ts";
import {
  LICENSE_SYNC_FIRST_DELAY_MS,
  LICENSE_SYNC_INITIAL_STATE,
  licenseSyncStateSchema,
  licenseSyncSchema,
  licenseSyncWake,
} from "./license-sync.process.ts";

export const LICENSE_SYNC_PIPELINE_NAME = "license_sync";
export const CONFIGURED_LICENSE_ON_SIGN_UP = "configuredLicenseOnSignUp";

/**
 * An activation code in LANGWATCH_LICENSE_KEY on a fresh install waits for the
 * first organization to store its license on; a no-op once one holds a license.
 */
export function configuredLicenseOnSignUp(
  app: Pick<LicensingApp, "activateConfiguredLicense">,
): PeerSubscriberDefinition<typeof organizationSignedUpEventDataSchema> {
  return {
    eventType: ORGANIZATION_SIGNED_UP_EVENT_TYPE,
    data: organizationSignedUpEventDataSchema,
    handle: async () => {
      await app.activateConfiguredLicense();
    },
  };
}

/** The pipeline, over only the one app operation it calls. */
export function buildLicenseSync({
  app,
  processStore,
  bootedAt = nowInstant().epochMilliseconds,
}: EventingSetup<unknown, Pick<LicensingApp, "syncLicenses" | "activateConfiguredLicense">> & {
  bootedAt?: number;
}): StaticPipelineDefinition<never> {
  return definePipeline({
    name: LICENSE_SYNC_PIPELINE_NAME,
    aggregate: defineAggregate({ type: "global" }),
  })
    .withEvents([])
    .withPeerSubscriber(CONFIGURED_LICENSE_ON_SIGN_UP, configuredLicenseOnSignUp(app))
    .withProcessManager(LICENSE_SYNC_PROCESS_NAME, (pm) =>
      pm
        .state(licenseSyncStateSchema, LICENSE_SYNC_INITIAL_STATE)
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
