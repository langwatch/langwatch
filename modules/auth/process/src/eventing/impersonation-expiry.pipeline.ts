/**
 * Auth's impersonation expiry sweep (specs/identity/admin-impersonation.feature): a window that
 * ran out without a stop is audited for the subject's organizations and its claims cleared.
 */
import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";

import type { AuthModule } from "../app/auth.app.ts";
import type { AuthRepositories } from "../repositories/auth.repositories.ts";
import {
  IMPERSONATION_EXPIRY_PROCESS_NAME,
  runImpersonationExpiry,
} from "./impersonation-expiry.intent.ts";
import {
  IMPERSONATION_EXPIRY_INITIAL_STATE,
  IMPERSONATION_EXPIRY_INTERVAL_MS,
  impersonationExpirySchema,
  impersonationExpiryStateSchema,
  impersonationExpiryWake,
} from "./impersonation-expiry.process.ts";

export const IMPERSONATION_MAINTENANCE_PIPELINE_NAME = "impersonation_maintenance";

/** The pipeline over only the sweep it runs, so a test can build it without an app. */
export function buildImpersonationMaintenance({
  app,
  processStore,
}: EventingSetup<
  unknown,
  Pick<AuthModule, "expireLapsedImpersonations">
>): StaticPipelineDefinition<never> {
  return definePipeline({
    name: IMPERSONATION_MAINTENANCE_PIPELINE_NAME,
    aggregate: defineAggregate({ type: "global" }),
  })
    .withEvents([])
    .withProcessManager(IMPERSONATION_EXPIRY_PROCESS_NAME, (pm) =>
      pm
        .state(impersonationExpiryStateSchema, IMPERSONATION_EXPIRY_INITIAL_STATE)
        .schedule({ everyMs: IMPERSONATION_EXPIRY_INTERVAL_MS })
        .onWake(impersonationExpiryWake)
        .intent(
          "sweep",
          impersonationExpirySchema,
          runImpersonationExpiry({
            sweep: async () => (await app.expireLapsedImpersonations()).expired,
            deleteDispatchedBefore: (params) => processStore.deleteDispatchedBefore(params),
          }),
        )
        // Audited windows are found already recorded, so a retry writes no second row.
        .outbox({ leaseDurationMs: 5 * 60 * 1000, maxAttempts: 3 }),
    )
    .build();
}

export const impersonationExpiryEventing = defineEventingModule({
  pipeline: IMPERSONATION_MAINTENANCE_PIPELINE_NAME,
  build: (setup: EventingSetup<AuthRepositories, AuthModule>) =>
    buildImpersonationMaintenance(setup),
});
