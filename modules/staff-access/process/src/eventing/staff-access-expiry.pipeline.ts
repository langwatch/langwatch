import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";
import { nowInstant } from "@langwatch/time";

import type { StaffAccessModule } from "../app/staff-access.app.ts";
import type { StaffAccessRepositories } from "../repositories/staff-access.repositories.ts";
import {
  STAFF_ACCESS_EXPIRY_INTERVAL_MS,
  STAFF_ACCESS_EXPIRY_PROCESS_NAME,
  STAFF_ACCESS_EXPIRY_ROW_RETENTION_MS,
  staffAccessExpirySchema,
  staffAccessExpiryStateSchema,
  staffAccessExpiryWake,
} from "./staff-access-expiry.process.ts";

export const STAFF_ACCESS_EXPIRY_PIPELINE_NAME = "staff_access_expiry";

/** Audits each staff session whose hour passed with no revoke as `staffAccess.expired`, once. */
export function buildStaffAccessExpiry({
  app,
  processStore,
}: EventingSetup<
  unknown,
  Pick<StaffAccessModule, "sweepExpiredSessions">
>): StaticPipelineDefinition<never> {
  return definePipeline({
    name: STAFF_ACCESS_EXPIRY_PIPELINE_NAME,
    aggregate: defineAggregate({ type: "global" }),
  })
    .withEvents([])
    .withProcessManager(STAFF_ACCESS_EXPIRY_PROCESS_NAME, (pm) =>
      pm
        .state(staffAccessExpiryStateSchema, { lastSweepAt: null })
        .schedule({ everyMs: STAFF_ACCESS_EXPIRY_INTERVAL_MS })
        .onWake(staffAccessExpiryWake)
        .intent("sweep", staffAccessExpirySchema, async () => {
          const startedAt = nowInstant().epochMilliseconds;
          await app.sweepExpiredSessions({ at: startedAt });
          await processStore
            .deleteDispatchedBefore({
              processName: STAFF_ACCESS_EXPIRY_PROCESS_NAME,
              before: startedAt - STAFF_ACCESS_EXPIRY_ROW_RETENTION_MS,
            })
            .catch(() => 0);
        })
        // Each end is claimed once, so a retried sweep never writes a second row.
        .outbox({ leaseDurationMs: 5 * 60 * 1000, maxAttempts: 3, concurrency: 1, batchSize: 1 }),
    )
    .build();
}

export const staffAccessExpiryEventing = defineEventingModule({
  pipeline: STAFF_ACCESS_EXPIRY_PIPELINE_NAME,
  build: (setup: EventingSetup<StaffAccessRepositories, StaffAccessModule>) =>
    buildStaffAccessExpiry(setup),
});
