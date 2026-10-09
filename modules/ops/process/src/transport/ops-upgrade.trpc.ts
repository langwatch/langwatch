/**
 * The server half of the Upgrades pages' six reads and the ten system-migration operator
 * procedures, each asking its permission on the platform at the door.
 * Spec: modules/ops/specs/upgrades.feature
 */
import { defineTrpcRouter, type TrpcRouterDeclaration } from "@langwatch/api/trpc";
import { OpsApi, opsUpgradeTrpc } from "@langwatch/ops-contract";

import { opsOperatorFact } from "#transport/ops-operator.trpc";

export const opsUpgradeTrpcTransport: TrpcRouterDeclaration<OpsApi, typeof opsUpgradeTrpc> =
  defineTrpcRouter(OpsApi, opsUpgradeTrpc)
    .procedure("status")
    .withPermission("ops:view", { at: "platform" })
    .handle(({ app }) => app.getUpgradeStatus())

    .procedure("listReleases")
    .withPermission("ops:view", { at: "platform" })
    .handle(({ app }) => app.listUpgradeReleases())

    .procedure("listSteps")
    .withPermission("ops:view", { at: "platform" })
    .handle(({ app, input }) => app.listUpgradeSteps(input))

    .procedure("getStep")
    .withPermission("ops:view", { at: "platform" })
    .handle(({ app, input }) => app.getUpgradeStep({ id: input.id }))

    .procedure("listRuns")
    .withPermission("ops:view", { at: "platform" })
    .handle(({ app, input }) => app.listUpgradeRuns(input))

    .procedure("getRun")
    .withPermission("ops:view", { at: "platform" })
    .handle(({ app, input }) => app.getUpgradeRun({ id: input.id }))

    .procedure("retryStep")
    .withPermission("ops:manage", { at: "platform" })
    .handle(({ app, input }) => app.retryUpgradeStep({ id: input.id }))

    .procedure("listSystemMigrations")
    .withPermission("ops:view", { at: "platform" })
    .handle(({ app }) => app.listSystemMigrations())

    .procedure("listMigrationEnrollments")
    .withPermission("ops:view", { at: "platform" })
    .handle(({ app, actor }) => app.listMigrationEnrollments({ requestedBy: actor.id }))

    .procedure("searchMigrationOrganizations")
    .withPermission("ops:view", { at: "platform" })
    .handle(({ app, input }) => app.searchMigrationOrganizations({ query: input.query }))

    .procedure("enrollMigrationTenant")
    .withFacts(opsOperatorFact)
    .withPermission("ops:manage", { at: "platform" })
    .handle(async ({ app, input }, operator) => {
      await app.enrollMigrationTenant({
        organizationId: input.organizationId,
        migrationName: input.migrationName,
        operator,
        confirm: input.confirm,
      });

      return { enrolled: true as const };
    })

    .procedure("enrollMigrationCohort")
    .withFacts(opsOperatorFact)
    .withPermission("ops:manage", { at: "platform" })
    .handle(({ app, input }, operator) =>
      app.enrollMigrationCohort({
        migrationName: input.migrationName,
        sampleSize: input.sampleSize,
        includeEnterprise: input.includeEnterprise,
        includePrivateDataplane: input.includePrivateDataplane,
        operator,
        confirm: input.confirm,
      }),
    )

    .procedure("withdrawMigrationTenant")
    .withPermission("ops:manage", { at: "platform" })
    .handle(async ({ app, input, actor }) => {
      await app.withdrawMigrationTenant({
        organizationId: input.organizationId,
        migrationName: input.migrationName,
        actorUserId: actor.id,
      });

      return { withdrawn: true as const };
    })

    .procedure("runSystemMigrationForOrganization")
    .withFacts(opsOperatorFact)
    .withPermission("ops:manage", { at: "platform" })
    .handle(({ app, input }, operator) =>
      app.runSystemMigrationForOrganization({
        organizationId: input.organizationId,
        migrationName: input.migrationName,
        operator,
        confirm: input.confirm,
      }),
    )

    .procedure("runSystemMigrationPass")
    .withFacts(opsOperatorFact)
    .withPermission("ops:manage", { at: "platform" })
    .handle(async ({ app }, operator) => {
      await app.runSystemMigrationPass({ operator });

      return { started: true as const };
    })

    .procedure("assertSystemMigrationLegacyWritersDrained")
    .withFacts(opsOperatorFact)
    .withPermission("ops:manage", { at: "platform" })
    .handle(async ({ app, input }, operator) => {
      await app.assertSystemMigrationLegacyWritersDrained({
        migrationName: input.migrationName,
        tenantId: input.tenantId,
        minimumWriterGeneration: input.minimumWriterGeneration,
        operator,
        confirm: input.confirm,
      });

      return { asserted: true as const };
    })

    .procedure("rollBackSystemMigrationTenant")
    .withFacts(opsOperatorFact)
    .withPermission("ops:manage", { at: "platform" })
    .handle(async ({ app, input }, operator) => {
      await app.rollBackSystemMigrationTenant({
        migrationName: input.migrationName,
        tenantId: input.tenantId,
        operator,
        confirm: input.confirm,
      });

      return { rolledBack: true as const };
    })
    .build();
