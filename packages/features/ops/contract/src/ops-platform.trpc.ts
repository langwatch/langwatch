/**
 * The deployment-wide levers an operator pulls: the feature-flag registry, the
 * group-queue blob store and the in-place system migrations. Everything here
 * that can destroy a payload also asks for a non-impersonated session and a
 * typed `confirm`. One of five declarations under `ops` - see
 * `ops-dashboard.trpc.ts` for why there are five.
 */
import { defineTrpcContract } from "@langwatch/api/contract";
import { operatorFeatureFlagCatalogueSchema } from "@langwatch/feature-flag-contract";
import { z } from "zod";

import {
  blobSweepReportSchema,
  deleteBlobOperatorInputSchema,
  deleteBlobResultSchema,
  getBlobInputSchema,
  listBlobsInputSchema,
  opsBlobPageSchema,
  opsBlobStoreStatsSchema,
  opsBlobSummarySchema,
  runBlobCleanupOperatorInputSchema,
} from "./blob-store.ts";
import {
  opsFeatureFlagKeyInputSchema,
  opsOkOutputSchema,
  opsSetFeatureFlagInputSchema,
  opsSetFeatureFlagRulesInputSchema,
} from "./ops-feature-flag.ts";
import {
  opsAssertLegacyWritersDrainedInputSchema,
  opsEnrollMigrationCohortInputSchema,
  opsEnrollMigrationTenantInputSchema,
  opsMigrationCohortResultSchema,
  opsMigrationEnrollmentListingSchema,
  opsMigrationOrganizationMatchSchema,
  opsMigrationOverviewSchema,
  opsMigrationTargetedRunResultSchema,
  opsMigrationTenantInputSchema,
  opsRollBackSystemMigrationTenantInputSchema,
  opsRunSystemMigrationForOrganizationInputSchema,
  opsSearchMigrationOrganizationsInputSchema,
} from "./ops-system-migration.ts";
import {
  opsMigrationDrainAssertedSchema,
  opsMigrationEnrolledSchema,
  opsMigrationPassStartedSchema,
  opsMigrationRolledBackSchema,
  opsMigrationWithdrawnSchema,
  opsQueueNameListSchema,
} from "./ops.responses.ts";

export const opsPlatformTrpc = defineTrpcContract("ops")
  /**
   * Every registered feature flag plus any orphaned stored rows, so an
   * operator can see the source of truth for each flag before flipping
   * anything. Read-only, and it costs no flag call.
   */
  .query("listFeatureFlags")
  .withInput(z.void())
  .withOutput(operatorFeatureFlagCatalogueSchema)

  .mutation("setFeatureFlag")
  .withInput(opsSetFeatureFlagInputSchema)
  .withOutput(opsOkOutputSchema)

  .mutation("setFeatureFlagRules")
  .withInput(opsSetFeatureFlagRulesInputSchema)
  .withOutput(opsOkOutputSchema)

  .mutation("clearFeatureFlag")
  .withInput(opsFeatureFlagKeyInputSchema)
  .withOutput(opsOkOutputSchema)

  .query("listBlobQueues")
  .withInput(z.void())
  .withOutput(opsQueueNameListSchema)

  .query("getBlobStoreStats")
  .withInput(z.void())
  .withOutput(opsBlobStoreStatsSchema)

  .query("listBlobs")
  .withInput(listBlobsInputSchema)
  .withOutput(opsBlobPageSchema)

  .query("getBlob")
  .withInput(getBlobInputSchema)
  .withOutput(opsBlobSummarySchema.nullable())

  .mutation("runBlobCleanup")
  .withInput(runBlobCleanupOperatorInputSchema)
  .withOutput(blobSweepReportSchema)

  .mutation("deleteBlob")
  .withInput(deleteBlobOperatorInputSchema)
  .withOutput(deleteBlobResultSchema)

  /**
   * The in-place system migrations, per migration: the status rollup plus the
   * tenants needing attention - held and parked. Finalized tenants are a
   * count, not a listing.
   */
  .query("listSystemMigrations")
  .withInput(z.void())
  .withOutput(opsMigrationOverviewSchema.array())

  /**
   * Which organizations are enrolled for which migrations, with the names an
   * operator recognizes. Carries `isSaaS`, so the page can say honestly that a
   * self-hosted installation has nothing to enroll.
   */
  .query("listMigrationEnrollments")
  .withInput(z.void())
  .withOutput(opsMigrationEnrollmentListingSchema)

  /**
   * The organization lookup behind the page's pickers: enroll, targeted run
   * and rollback all act on an organization found by name or exact id.
   */
  .query("searchMigrationOrganizations")
  .withInput(opsSearchMigrationOrganizationsInputSchema)
  .withOutput(opsMigrationOrganizationMatchSchema.array())

  /**
   * Enroll one organization for one registered migration, effective on the
   * next pass. Duplicates, unknown migrations, unknown organizations,
   * migrations that admit every organization already and any enrollment on a
   * self-hosted installation are each refused by name.
   */
  .mutation("enrollMigrationTenant")
  .withInput(opsEnrollMigrationTenantInputSchema)
  .withOutput(opsMigrationEnrolledSchema)

  /**
   * Enroll a sampled cohort in one action. The sample is drawn from
   * organizations not yet enrolled, excluding enterprise plans and
   * private-dataplane routes by data rather than by any list in code; either
   * exclusion can be lifted for one draw.
   */
  .mutation("enrollMigrationCohort")
  .withInput(opsEnrollMigrationCohortInputSchema)
  .withOutput(opsMigrationCohortResultSchema)

  /**
   * Withdraw an enrollment: later passes stop processing the organization for
   * that migration, and state already recorded stays exactly as it is. Undoing
   * it is the rollback's job.
   */
  .mutation("withdrawMigrationTenant")
  .withInput(opsMigrationTenantInputSchema)
  .withOutput(opsMigrationWithdrawnSchema)

  /**
   * Run one migration for one organization now, awaited: the operator asked
   * about one organization and gets the status it ended the run in.
   */
  .mutation("runSystemMigrationForOrganization")
  .withInput(opsRunSystemMigrationForOrganizationInputSchema)
  .withOutput(opsMigrationTargetedRunResultSchema)

  /**
   * Kick a pass now instead of waiting for the next worker boot.
   * Fire-and-forget: per-organization claims already keep two passes off the
   * same organization.
   */
  .mutation("runSystemMigrationPass")
  .withInput(z.void())
  .withOutput(opsMigrationPassStartedSchema)

  .mutation("assertSystemMigrationLegacyWritersDrained")
  .withInput(opsAssertLegacyWritersDrainedInputSchema)
  .withOutput(opsMigrationDrainAssertedSchema)

  /**
   * The operator rollback: pin a migrated or finalized organization back onto
   * its legacy path. An already rolled-back organization RETRIES, which is how
   * a rollback whose effect died halfway is finished.
   */
  .mutation("rollBackSystemMigrationTenant")
  .withInput(opsRollBackSystemMigrationTenantInputSchema)
  .withOutput(opsMigrationRolledBackSchema)
  .build();
