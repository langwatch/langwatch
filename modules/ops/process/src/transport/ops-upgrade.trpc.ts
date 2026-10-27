/**
 * The Upgrades pages' reads, Retry and the system-migration procedures. Each serves while the
 * installation upgrades (API-UP) and asks its permission on the platform at the door.
 * Spec: modules/ops/specs/upgrades.feature
 */
import { defineTrpcRouter, type TrpcRouterDeclaration } from "@langwatch/api/trpc";
import { OpsApi, opsUpgradeTrpc } from "@langwatch/ops-contract";

import { opsOperatorContext } from "#transport/ops-operator.trpc";

/** Alex, 2026-10-11: on self-hosted every signed-in user is told to contact their operator. */
const EVERY_MEMBER_IS_TOLD =
  "answers one boolean, whether the last upgrade needs attention, so every signed-in user can be told to contact their operator; it names no step, error or organization";

export const opsUpgradeTrpcTransport: TrpcRouterDeclaration<OpsApi, typeof opsUpgradeTrpc> =
  defineTrpcRouter(OpsApi, opsUpgradeTrpc)
    .procedure("status")
    .withPermission("ops:view", { at: "platform" })
    .handle(({ app }) => app.getUpgradeStatus())

    .procedure("attentionNotice")
    .noPermission({ reason: EVERY_MEMBER_IS_TOLD })
    .handle(({ app }) => app.getUpgradeAttentionNotice())

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

    .procedure("listTargets")
    .withPermission("ops:view", { at: "platform" })
    .handle(({ app }) => app.listUpgradeTargets())

    .procedure("retryStep")
    .withPermission("ops:manage", { at: "platform" })
    .handle(({ app, input }) => app.retryUpgradeStep({ id: input.id }))

    .procedure("getDiagnostics")
    .withPermission("ops:view", { at: "platform" })
    .handle(({ app, input }) => app.getUpgradeStepDiagnostics({ id: input.id }))

    .procedure("diagnosticsAvailability")
    .withPermission("ops:view", { at: "platform" })
    .handle(({ app }) => app.getUpgradeDiagnosticsAvailability())

    .procedure("sendDiagnostics")
    .withPermission("ops:manage", { at: "platform" })
    .handle(({ app, input }) => app.sendUpgradeStepDiagnostics({ bundle: input.bundle }))

    .procedure("listSystemMigrations")
    .withPermission("ops:view", { at: "platform" })
    .handle(({ app }) => app.listSystemMigrations())

    .procedure("listTenants")
    .withPermission("ops:view", { at: "platform" })
    .handle(({ app, input }) => app.listUpgradeTenants(input))

    .procedure("listMigrationEnrollments")
    .withPermission("ops:view", { at: "platform" })
    .handle(({ app, actor }) => app.listMigrationEnrollments({ requestedBy: actor.id }))

    .procedure("searchMigrationOrganizations")
    .withPermission("ops:view", { at: "platform" })
    .handle(({ app, input }) => app.searchMigrationOrganizations({ query: input.query }))

    .procedure("enrollMigrationTenant")
    .withMiddlewareContext(opsOperatorContext)
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
    .withMiddlewareContext(opsOperatorContext)
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
    .withMiddlewareContext(opsOperatorContext)
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
    .withMiddlewareContext(opsOperatorContext)
    .withPermission("ops:manage", { at: "platform" })
    .handle(async ({ app }, operator) => {
      await app.runSystemMigrationPass({ operator });

      return { started: true as const };
    })

    .procedure("assertSystemMigrationLegacyWritersDrained")
    .withMiddlewareContext(opsOperatorContext)
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
    .withMiddlewareContext(opsOperatorContext)
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
