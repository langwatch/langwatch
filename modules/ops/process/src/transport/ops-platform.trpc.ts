/**
 * The server half of the feature-flag, blob-store and system-migration
 * procedures. Platform-tier, asked at the door. Anything
 * destructive passes a second gate: a real signed-in operator, not an impersonation.
 */
import { defineTrpcRouter, type TrpcRouterDeclaration } from "@langwatch/api/trpc";
import { OpsApi, opsPlatformTrpc } from "@langwatch/ops-contract";

import { opsOperatorFact } from "#transport/ops-operator.trpc";

/** The one acknowledgement each operator feature-flag write answers with. */
const acknowledged = { ok: true } as const;

export const opsPlatformTrpcTransport: TrpcRouterDeclaration<OpsApi, typeof opsPlatformTrpc> =
  defineTrpcRouter(OpsApi, opsPlatformTrpc)
    .procedure("listFeatureFlags")
    .withPermission("ops:view", { at: "platform" })
    .handle(({ app }) => app.featureFlagCatalogue())

    .procedure("setFeatureFlag")
    .withPermission("ops:manage", { at: "platform" })
    .handle(async ({ app, input, actor }) => {
      await app.setFeatureFlagEnabled({
        key: input.key,
        enabled: input.enabled,
        lastEditedBy: actor.id,
      });

      return acknowledged;
    })

    .procedure("setFeatureFlagRules")
    .withPermission("ops:manage", { at: "platform" })
    .handle(async ({ app, input, actor }) => {
      await app.setFeatureFlagRules({
        key: input.key,
        rules: input.rules,
        lastEditedBy: actor.id,
      });

      return acknowledged;
    })

    .procedure("clearFeatureFlag")
    .withPermission("ops:manage", { at: "platform" })
    .handle(async ({ app, input, actor }) => {
      await app.clearFeatureFlag({ key: input.key, lastEditedBy: actor.id });

      return acknowledged;
    })

    .procedure("listBlobQueues")
    .withPermission("ops:view", { at: "platform" })
    .handle(({ app }) => app.listBlobQueues())

    .procedure("getBlobStoreStats")
    .withPermission("ops:view", { at: "platform" })
    .handle(({ app }) => app.getBlobStoreStats())

    .procedure("listBlobs")
    .withPermission("ops:view", { at: "platform" })
    .handle(({ app, input }) => app.listBlobs(input))

    .procedure("getBlob")
    .withPermission("ops:view", { at: "platform" })
    .handle(({ app, input }) => app.findBlob(input))

    // A dry run destroys nothing, so it does not ask for the confirmation.
    .procedure("runBlobCleanup")
    .withFacts(opsOperatorFact)
    .withPermission("ops:manage", { at: "platform" })
    .handle(({ app, input, actor }, operator) =>
      app.runBlobCleanup({
        operator,
        confirm: input.confirm,
        dryRun: input.dryRun,
        // Opaque id, not email: the audit trail must trace the actor without
        // carrying personal data into the log stream.
        requestedBy: actor.id,
      }),
    )

    .procedure("deleteBlob")
    .withFacts(opsOperatorFact)
    .withPermission("ops:manage", { at: "platform" })
    .handle(({ app, input, actor }, operator) => {
      app.assertDestructiveOperator(operator, input.confirm);

      return app.deleteBlob({
        queueName: input.queueName,
        projectId: input.projectId,
        hash: input.hash,
        requestedBy: actor.id,
      });
    })

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
