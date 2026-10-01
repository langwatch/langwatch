import type { TenantMigrationRecord, TenantMigrationStatus } from "@langwatch/system-migrations";
/**
 * The input shapes the operator system-migrations surface parses. The
 * confirmations are typed strings, optional, because only migrations that
 * declare themselves destructive demand one - the transport asks the runner.
 */
import { z } from "zod";

/** One organization, for one registered migration. */
export const opsMigrationTenantInputSchema = z.object({
  organizationId: z.string().min(1).max(200),
  migrationName: z.string().min(1).max(200),
});

export const opsEnrollMigrationTenantInputSchema = z.object({
  ...opsMigrationTenantInputSchema.shape,
  // Typed confirmation for the cutover migration, same reasoning as the
  // rollback's: enrolling an organization for cutover is what lets the next
  // pass flip which tables answer every permission check for it.
  confirm: z.literal("ENROLL").optional(),
});

export const opsEnrollMigrationCohortInputSchema = z.object({
  migrationName: z.string().min(1).max(200),
  sampleSize: z.number().int().min(1).max(1000),
  includeEnterprise: z.boolean().default(false),
  includePrivateDataplane: z.boolean().default(false),
  confirm: z.literal("ENROLL").optional(),
});

export const opsSearchMigrationOrganizationsInputSchema = z.object({
  query: z.string().max(200),
});

export const opsRunSystemMigrationForOrganizationInputSchema = z.object({
  ...opsMigrationTenantInputSchema.shape,
  // Typed confirmation for the cutover migration - a targeted cutover run is
  // exactly the flip the enrollment confirmation guards.
  confirm: z.literal("RUN").optional(),
});

export const opsAssertLegacyWritersDrainedInputSchema = z.object({
  migrationName: z.string().min(1).max(200),
  tenantId: z.string().min(1).max(200),
  minimumWriterGeneration: z.string().min(1).max(200),
  confirm: z.literal("DRAIN LEGACY WRITERS").optional(),
});

export const opsRollBackSystemMigrationTenantInputSchema = z.object({
  migrationName: z.string().min(1).max(200),
  tenantId: z.string().min(1).max(200),
  // Typed confirmation, same reasoning as `deleteBlob`.
  confirm: z.literal("ROLL BACK").optional(),
});

/** What the operator surface reads back; declared here so the port can
 * publish the correct types instead of Promise<unknown>. */

/**
 * The migration status vocabulary, as a schema. Annotated with the runner's
 * own union so the two can never drift - the owning package carries no zod,
 * so a mismatch is a type error here, not a wrong shape on the wire.
 */
const tenantMigrationStatusSchema: z.ZodType<TenantMigrationStatus> = z.enum([
  "migrated",
  "finalized",
  "parked",
  "rolled_back",
]);

/** One tenant's row on the ledger, as the runner writes it. @see above. */
const tenantMigrationRecordSchema = z.object({
  migrationName: z.string(),
  tenantId: z.string(),
  status: tenantMigrationStatusSchema,
  report: z.unknown(),
}) satisfies z.ZodType<TenantMigrationRecord>;

/** One enrollment row as the ops page lists it. */
export const opsMigrationEnrollmentRecordSchema = z.object({
  organizationId: z.string(),
  /** Null when the organization has since been deleted. */
  organizationName: z.string().nullable(),
  /** The stable name of the migration this row enrolls the organization in. */
  migrationName: z.string(),
  enrolledByUserId: z.string(),
  /**
   * The enroller's display name; null when it no longer resolves. Never the
   * email - the name is the one piece of personal data this listing carries,
   * and the read is audited for that reason.
   */
  enrolledByLabel: z.string().nullable(),
  createdAt: z.date(),
});
export type OpsMigrationEnrollmentRecord = z.infer<typeof opsMigrationEnrollmentRecordSchema>;

/**
 * The enrollment listing, with the installation kind alongside it so the page
 * can say honestly that a self-hosted installation has nothing to enroll.
 */
export const opsMigrationEnrollmentListingSchema = z.object({
  isSaaS: z.boolean(),
  enrollments: z.array(opsMigrationEnrollmentRecordSchema),
});
export type OpsMigrationEnrollmentListing = z.infer<typeof opsMigrationEnrollmentListingSchema>;

/** One organization as the operator's pickers show it. */
export const opsMigrationOrganizationMatchSchema = z.object({
  id: z.string(),
  name: z.string(),
});
export type OpsMigrationOrganizationMatch = z.infer<typeof opsMigrationOrganizationMatchSchema>;

/** How many tenants sit in each state, for one migration's gauge. */
export const opsMigrationStatusCountsSchema: z.ZodType<OpsMigrationStatusCounts> = z.object({
  migrated: z.number(),
  finalized: z.number(),
  parked: z.number(),
  rolled_back: z.number(),
});
export type OpsMigrationStatusCounts = Record<TenantMigrationStatus, number>;

/** One migration as the operator dashboard lists it. */
export const opsMigrationOverviewSchema = z.object({
  name: z.string(),
  /** The name operators read; presentation over the stable `name`. */
  title: z.string(),
  description: z.string(),
  /**
   * Whether acting on this migration takes the typed destructive
   * confirmation, so the page asks for it exactly where the server requires
   * it rather than deciding for itself which migration is dangerous.
   */
  requiresOperatorConfirmation: z.boolean(),
  /** False only on self-hosted, for a migration not yet released there. */
  availableOnThisInstallation: z.boolean(),
  /** Whether every organization is in the cohort with no operator action. */
  enrolledAutomatically: z.boolean(),
  counts: opsMigrationStatusCountsSchema,
  /**
   * The rollout gauge. Null when there is nothing to enroll — off cloud, and
   * for a migration that admits every organization automatically.
   */
  enrollment: z.object({ enrolledCount: z.number(), notEnrolledCount: z.number() }).nullable(),
  attention: z.array(z.object({ ...tenantMigrationRecordSchema.shape, updatedAt: z.date() })),
});
export type OpsMigrationOverview = z.infer<typeof opsMigrationOverviewSchema>;

/** What a cohort draw enrolled, and how large the pool it drew from was. */
export const opsMigrationCohortResultSchema = z.object({
  enrolled: z.array(opsMigrationOrganizationMatchSchema),
  eligibleCount: z.number(),
});
export type OpsMigrationCohortResult = z.infer<typeof opsMigrationCohortResultSchema>;

/**
 * Where one organization stands after a targeted pass. `status` is null
 * when the pass wrote no record - out of scope - and `waiting` says the
 * record exists but is held on a prerequisite rather than finished.
 */
export const opsMigrationTargetedRunResultSchema = z.object({
  status: tenantMigrationStatusSchema.nullable(),
  waiting: z.boolean(),
});
export type OpsMigrationTargetedRunResult = z.infer<typeof opsMigrationTargetedRunResultSchema>;
