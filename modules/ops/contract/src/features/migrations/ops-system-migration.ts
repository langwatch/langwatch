import type { Named } from "@langwatch/module";
import type { TenantMigrationRecord, TenantMigrationStatus } from "@langwatch/system-migrations";
/**
 * The input shapes the operator system-migrations surface parses. The
 * confirmations are typed strings, optional, because only migrations that
 * declare themselves destructive demand one - the transport asks the runner.
 */
import { z } from "zod";

/** One organization, for one registered migration. */
const opsMigrationTenantInputSchemaDefinition = z.object({
  organizationId: z.string().min(1).max(200),
  migrationName: z.string().min(1).max(200),
});
export interface OpsMigrationTenantInputSchema extends Named<
  typeof opsMigrationTenantInputSchemaDefinition
> {}
export const opsMigrationTenantInputSchema: OpsMigrationTenantInputSchema =
  opsMigrationTenantInputSchemaDefinition;

const opsEnrollMigrationTenantInputSchemaDefinition = z.object({
  ...opsMigrationTenantInputSchema.shape,
  // Typed confirmation for the cutover migration, same reasoning as the
  // rollback's: enrolling an organization for cutover is what lets the next
  // pass flip which tables answer every permission check for it.
  confirm: z.literal("ENROLL").optional(),
});
export interface OpsEnrollMigrationTenantInputSchema extends Named<
  typeof opsEnrollMigrationTenantInputSchemaDefinition
> {}
export const opsEnrollMigrationTenantInputSchema: OpsEnrollMigrationTenantInputSchema =
  opsEnrollMigrationTenantInputSchemaDefinition;

const opsEnrollMigrationCohortInputSchemaDefinition = z.object({
  migrationName: z.string().min(1).max(200),
  sampleSize: z.number().int().min(1).max(1000),
  includeEnterprise: z.boolean().default(false),
  includePrivateDataplane: z.boolean().default(false),
  confirm: z.literal("ENROLL").optional(),
});
export interface OpsEnrollMigrationCohortInputSchema extends Named<
  typeof opsEnrollMigrationCohortInputSchemaDefinition
> {}
export const opsEnrollMigrationCohortInputSchema: OpsEnrollMigrationCohortInputSchema =
  opsEnrollMigrationCohortInputSchemaDefinition;

const opsSearchMigrationOrganizationsInputSchemaDefinition = z.object({
  query: z.string().max(200),
});
export interface OpsSearchMigrationOrganizationsInputSchema extends Named<
  typeof opsSearchMigrationOrganizationsInputSchemaDefinition
> {}
export const opsSearchMigrationOrganizationsInputSchema: OpsSearchMigrationOrganizationsInputSchema =
  opsSearchMigrationOrganizationsInputSchemaDefinition;

const opsRunSystemMigrationForOrganizationInputSchemaDefinition = z.object({
  ...opsMigrationTenantInputSchema.shape,
  // Typed confirmation for the cutover migration - a targeted cutover run is
  // exactly the flip the enrollment confirmation guards.
  confirm: z.literal("RUN").optional(),
});
export interface OpsRunSystemMigrationForOrganizationInputSchema extends Named<
  typeof opsRunSystemMigrationForOrganizationInputSchemaDefinition
> {}
export const opsRunSystemMigrationForOrganizationInputSchema: OpsRunSystemMigrationForOrganizationInputSchema =
  opsRunSystemMigrationForOrganizationInputSchemaDefinition;

const opsAssertLegacyWritersDrainedInputSchemaDefinition = z.object({
  migrationName: z.string().min(1).max(200),
  tenantId: z.string().min(1).max(200),
  minimumWriterGeneration: z.string().min(1).max(200),
  confirm: z.literal("DRAIN LEGACY WRITERS").optional(),
});
export interface OpsAssertLegacyWritersDrainedInputSchema extends Named<
  typeof opsAssertLegacyWritersDrainedInputSchemaDefinition
> {}
export const opsAssertLegacyWritersDrainedInputSchema: OpsAssertLegacyWritersDrainedInputSchema =
  opsAssertLegacyWritersDrainedInputSchemaDefinition;

const opsRollBackSystemMigrationTenantInputSchemaDefinition = z.object({
  migrationName: z.string().min(1).max(200),
  tenantId: z.string().min(1).max(200),
  // Typed confirmation, same reasoning as `deleteBlob`.
  confirm: z.literal("ROLL BACK").optional(),
});
export interface OpsRollBackSystemMigrationTenantInputSchema extends Named<
  typeof opsRollBackSystemMigrationTenantInputSchemaDefinition
> {}
export const opsRollBackSystemMigrationTenantInputSchema: OpsRollBackSystemMigrationTenantInputSchema =
  opsRollBackSystemMigrationTenantInputSchemaDefinition;

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

/** One tenant's row with when it last moved, as the attention list and `listTenants` read it. */
const opsMigrationTenantRowSchemaDefinition = z.object({
  ...tenantMigrationRecordSchema.shape,
  updatedAt: z.date(),
});
export interface OpsMigrationTenantRowSchema extends Named<
  typeof opsMigrationTenantRowSchemaDefinition
> {}
export const opsMigrationTenantRowSchema: OpsMigrationTenantRowSchema =
  opsMigrationTenantRowSchemaDefinition;

/** One enrollment row as the ops page lists it. */
const opsMigrationEnrollmentRecordSchemaDefinition = z.object({
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
export interface OpsMigrationEnrollmentRecordSchema extends Named<
  typeof opsMigrationEnrollmentRecordSchemaDefinition
> {}
export const opsMigrationEnrollmentRecordSchema: OpsMigrationEnrollmentRecordSchema =
  opsMigrationEnrollmentRecordSchemaDefinition;
export type OpsMigrationEnrollmentRecord = z.infer<typeof opsMigrationEnrollmentRecordSchema>;

/**
 * The enrollment listing, with the installation kind alongside it so the page
 * can say honestly that a self-hosted installation has nothing to enroll.
 */
const opsMigrationEnrollmentListingSchemaDefinition = z.object({
  isSaaS: z.boolean(),
  enrollments: z.array(opsMigrationEnrollmentRecordSchema),
});
export interface OpsMigrationEnrollmentListingSchema extends Named<
  typeof opsMigrationEnrollmentListingSchemaDefinition
> {}
export const opsMigrationEnrollmentListingSchema: OpsMigrationEnrollmentListingSchema =
  opsMigrationEnrollmentListingSchemaDefinition;
export type OpsMigrationEnrollmentListing = z.infer<typeof opsMigrationEnrollmentListingSchema>;

/** One organization as the operator's pickers show it. */
const opsMigrationOrganizationMatchSchemaDefinition = z.object({
  id: z.string(),
  name: z.string(),
});
export interface OpsMigrationOrganizationMatchSchema extends Named<
  typeof opsMigrationOrganizationMatchSchemaDefinition
> {}
export const opsMigrationOrganizationMatchSchema: OpsMigrationOrganizationMatchSchema =
  opsMigrationOrganizationMatchSchemaDefinition;
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
const opsMigrationOverviewSchemaDefinition = z.object({
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
  attention: z.array(opsMigrationTenantRowSchema),
});
export interface OpsMigrationOverviewSchema extends Named<
  typeof opsMigrationOverviewSchemaDefinition
> {}
export const opsMigrationOverviewSchema: OpsMigrationOverviewSchema =
  opsMigrationOverviewSchemaDefinition;
export type OpsMigrationOverview = z.infer<typeof opsMigrationOverviewSchema>;

/** What a cohort draw enrolled, and how large the pool it drew from was. */
const opsMigrationCohortResultSchemaDefinition = z.object({
  enrolled: z.array(opsMigrationOrganizationMatchSchema),
  eligibleCount: z.number(),
});
export interface OpsMigrationCohortResultSchema extends Named<
  typeof opsMigrationCohortResultSchemaDefinition
> {}
export const opsMigrationCohortResultSchema: OpsMigrationCohortResultSchema =
  opsMigrationCohortResultSchemaDefinition;
export type OpsMigrationCohortResult = z.infer<typeof opsMigrationCohortResultSchema>;

/**
 * Where one organization stands after a targeted pass. `status` is null
 * when the pass wrote no record - out of scope - and `waiting` says the
 * record exists but is held on a prerequisite rather than finished.
 */
const opsMigrationTargetedRunResultSchemaDefinition = z.object({
  status: tenantMigrationStatusSchema.nullable(),
  waiting: z.boolean(),
});
export interface OpsMigrationTargetedRunResultSchema extends Named<
  typeof opsMigrationTargetedRunResultSchemaDefinition
> {}
export const opsMigrationTargetedRunResultSchema: OpsMigrationTargetedRunResultSchema =
  opsMigrationTargetedRunResultSchemaDefinition;
export type OpsMigrationTargetedRunResult = z.infer<typeof opsMigrationTargetedRunResultSchema>;
