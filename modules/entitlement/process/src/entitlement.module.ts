import type { EntitlementApi, EntitlementConfig } from "@langwatch/entitlement-contract";
import { defineProcessModule, type PublishedProcessModule } from "@langwatch/process";
import { defineMigrationStep } from "@langwatch/upgrade/step";

import { EntitlementModule } from "./app/entitlement.app.ts";
import { entitlementUsageWarningEventing } from "./eventing/entitlement-usage-warning.pipeline.ts";
import { usageEventing } from "./eventing/usage.pipeline.ts";
import { entitlementRepositories } from "./repositories/entitlement-repositories.registry.ts";
import { absentRequestBound } from "./rules/plan-baseline.rules.ts";
import {
  BillableEventsTtlService,
  ttlProgressSchema,
} from "./services/billable-events-ttl.service.ts";
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
  .withMigrations(({ repositories }) => [
    defineMigrationStep({
      id: "entitlement:materialise-billable-events-ttl",
      kind: "data",
      mode: "background",
      description:
        "Applies the 13-month retention to billable events written before it, deleting older rows.",
      needsOldWritersGone: false,
      run: ({ checkpoint, dryRun, signal }) => {
        const resumed = ttlProgressSchema.safeParse(checkpoint.resumeFrom);
        return BillableEventsTtlService.create({
          mutations: repositories.billableEventsTtl,
        }).materialise({
          dryRun,
          resumed: resumed.success ? resumed.data : null,
          signal,
          onPoll: (progress) => checkpoint.save({ report: progress }),
        });
      },
    }),
  ]);

/**
 * The request-bound seam for a process that composes no entitlement graph at
 * all: every bound answers its free-tier value.
 */
export function createAbsentRequestBound(): Pick<EntitlementApi, "requestBound"> {
  return { requestBound: async ({ key }) => absentRequestBound({ key }) };
}
