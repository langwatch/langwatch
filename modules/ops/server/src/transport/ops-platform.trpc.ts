/**
 * The server half of the feature-flag, blob-store and system-migration
 * procedures. Platform-tier throughout - see `ops-operator.trpc.ts`. Anything
 * that can destroy a payload passes a SECOND gate the application owns: a real
 * signed-in operator, not an impersonation, with a typed confirmation.
 */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import { OpsApi, opsPlatformTrpc } from "@langwatch/ops-contract";

import { OPS_MANAGE, OPS_VIEW, opsOperatorFact } from "#transport/ops-operator.trpc";

/** The one acknowledgement each operator feature-flag write answers with. */
const acknowledged = { ok: true } as const;

export const opsPlatformTrpcTransport = defineTrpcRouter(OpsApi, opsPlatformTrpc)
  .procedure("listFeatureFlags")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_VIEW)
  .handle(({ app }, operator) => {
    app.admitOperator(operator, "ops:view");

    return app.featureFlagCatalogue();
  })

  .procedure("setFeatureFlag")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_MANAGE)
  .handle(async ({ app, input, actor }, operator) => {
    app.admitOperator(operator, "ops:manage");

    await app.setFeatureFlagEnabled({
      key: input.key,
      enabled: input.enabled,
      lastEditedBy: actor.id,
    });

    return acknowledged;
  })

  .procedure("setFeatureFlagRules")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_MANAGE)
  .handle(async ({ app, input, actor }, operator) => {
    app.admitOperator(operator, "ops:manage");

    await app.setFeatureFlagRules({
      key: input.key,
      rules: input.rules,
      lastEditedBy: actor.id,
    });

    return acknowledged;
  })

  .procedure("clearFeatureFlag")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_MANAGE)
  .handle(async ({ app, input, actor }, operator) => {
    app.admitOperator(operator, "ops:manage");

    await app.clearFeatureFlag({ key: input.key, lastEditedBy: actor.id });

    return acknowledged;
  })

  .procedure("listBlobQueues")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_VIEW)
  .handle(({ app }, operator) => {
    app.admitOperator(operator, "ops:view");

    return app.listBlobQueues();
  })

  .procedure("getBlobStoreStats")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_VIEW)
  .handle(({ app }, operator) => {
    app.admitOperator(operator, "ops:view");

    return app.getBlobStoreStats();
  })

  .procedure("listBlobs")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_VIEW)
  .handle(({ app, input }, operator) => {
    app.admitOperator(operator, "ops:view");

    return app.listBlobs(input);
  })

  .procedure("getBlob")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_VIEW)
  .handle(({ app, input }, operator) => {
    app.admitOperator(operator, "ops:view");

    return app.findBlob(input);
  })

  // A dry run destroys nothing, so it does not ask for the confirmation.
  .procedure("runBlobCleanup")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_MANAGE)
  .handle(({ app, input, actor }, operator) => {
    app.admitOperator(operator, "ops:manage");

    if (!input.dryRun) app.requireDestructiveOperator(operator, input.confirm);

    return app.runBlobCleanup({
      dryRun: input.dryRun,
      // Opaque id, not email: the audit trail must trace the actor without
      // carrying personal data into the log stream.
      requestedBy: actor.id,
    });
  })

  .procedure("deleteBlob")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_MANAGE)
  .handle(({ app, input, actor }, operator) => {
    app.admitOperator(operator, "ops:manage");
    app.requireDestructiveOperator(operator, input.confirm);

    return app.deleteBlob({
      queueName: input.queueName,
      projectId: input.projectId,
      hash: input.hash,
      requestedBy: actor.id,
    });
  })

  .procedure("listSystemMigrations")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_VIEW)
  .handle(({ app }, operator) => {
    app.admitOperator(operator, "ops:view");

    return app.listSystemMigrations();
  })

  .procedure("listMigrationEnrollments")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_VIEW)
  .handle(({ app, actor }, operator) => {
    app.admitOperator(operator, "ops:view");

    return app.listMigrationEnrollments({ requestedBy: actor.id });
  })

  .procedure("searchMigrationOrganizations")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_VIEW)
  .handle(({ app, input }, operator) => {
    app.admitOperator(operator, "ops:view");

    return app.searchMigrationOrganizations({ query: input.query });
  })

  .procedure("enrollMigrationTenant")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_MANAGE)
  .handle(async ({ app, input }, operator) => {
    app.admitOperator(operator, "ops:manage");

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
  .serviceAuthorized(OPS_MANAGE)
  .handle(({ app, input }, operator) => {
    app.admitOperator(operator, "ops:manage");

    return app.enrollMigrationCohort({
      migrationName: input.migrationName,
      sampleSize: input.sampleSize,
      includeEnterprise: input.includeEnterprise,
      includePrivateDataplane: input.includePrivateDataplane,
      operator,
      confirm: input.confirm,
    });
  })

  .procedure("withdrawMigrationTenant")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_MANAGE)
  .handle(async ({ app, input, actor }, operator) => {
    app.admitOperator(operator, "ops:manage");

    await app.withdrawMigrationTenant({
      organizationId: input.organizationId,
      migrationName: input.migrationName,
      actorUserId: actor.id,
    });

    return { withdrawn: true as const };
  })

  .procedure("runSystemMigrationForOrganization")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_MANAGE)
  .handle(({ app, input }, operator) => {
    app.admitOperator(operator, "ops:manage");

    return app.runSystemMigrationForOrganization({
      organizationId: input.organizationId,
      migrationName: input.migrationName,
      operator,
      confirm: input.confirm,
    });
  })

  .procedure("runSystemMigrationPass")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_MANAGE)
  .handle(({ app }, operator) => {
    app.admitOperator(operator, "ops:manage");
    app.runSystemMigrationPass();

    return { started: true as const };
  })

  .procedure("assertSystemMigrationLegacyWritersDrained")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_MANAGE)
  .handle(async ({ app, input }, operator) => {
    app.admitOperator(operator, "ops:manage");

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
  .serviceAuthorized(OPS_MANAGE)
  .handle(async ({ app, input }, operator) => {
    app.admitOperator(operator, "ops:manage");

    await app.rollBackSystemMigrationTenant({
      migrationName: input.migrationName,
      tenantId: input.tenantId,
      operator,
      confirm: input.confirm,
    });

    return { rolledBack: true as const };
  })
  .build();
