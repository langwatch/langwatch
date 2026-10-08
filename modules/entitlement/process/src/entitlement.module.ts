import {
  type EntitlementApi,
  USAGE_PIPELINE_NAME,
  type EntitlementConfig,
} from "@langwatch/entitlement-contract";
import { defineProcessModule, type PublishedProcessModule } from "@langwatch/process";
import { nowInstant } from "@langwatch/time";
import { defineProjectionReplayStep } from "@langwatch/upgrade/step";

import { EntitlementModule } from "./app/entitlement.app.ts";
import { entitlementUsageWarningEventing } from "./eventing/entitlement-usage-warning.pipeline.ts";
import { TRACE_METER_PROJECTION_NAME } from "./eventing/trace-meter.projection.ts";
import { usageEventing } from "./eventing/usage.pipeline.ts";
import { entitlementRepositories } from "./repositories/entitlement-repositories.registry.ts";
import { absentRequestBound } from "./rules/plan-baseline.rules.ts";
import { organizationSpendTrpcTransport } from "./transport/organization-spend.trpc.ts";
import { planTrpcTransport } from "./transport/plan.trpc.ts";
import { usageLimitsTrpcTransport } from "./transport/usage-limits.trpc.ts";

export const entitlementProcessModule: PublishedProcessModule<
  "entitlement",
  EntitlementApi,
  EntitlementConfig
> = defineProcessModule("entitlement")
  .withRepositories(entitlementRepositories)
  .withApi(EntitlementModule)
  .withTransports(planTrpcTransport, usageLimitsTrpcTransport, organizationSpendTrpcTransport)
  .withEventing(entitlementUsageWarningEventing)
  .withEventing(usageEventing)
  .withMigrations(({ replayer }) => [
    defineProjectionReplayStep({
      id: "entitlement:seed-trace-meter",
      description: "Seeds entitlement's trace meter from trace's span log at deploy.",
      lane: `${USAGE_PIPELINE_NAME}.${TRACE_METER_PROJECTION_NAME}`,
      // E3 (round 47): the month to date at the worker's boot; earlier months stay as counted.
      since: nowInstant()
        .toZonedDateTimeISO("UTC")
        .with({ day: 1 })
        .startOfDay()
        .toInstant()
        .toString(),
      needsOldWritersGone: true,
      replayer,
    }),
  ]);

/**
 * The request-bound seam for a process that composes no entitlement graph at
 * all: every bound answers its free-tier value.
 */
export function createAbsentRequestBound(): Pick<EntitlementApi, "requestBound"> {
  return { requestBound: async ({ key }) => absentRequestBound({ key }) };
}
