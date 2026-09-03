/**
 * The input shapes the operator system-migrations surface parses.
 *
 * The confirmations are typed strings rather than booleans, and optional
 * rather than required, because only the migrations that declare themselves
 * destructive demand one — the transport asks the runner which those are.
 */
import { z } from "zod";
import type { TenantMigrationRecord, TenantMigrationStatus } from "@langwatch/system-migrations";

/** One organization, for one registered migration. */
export const opsMigrationTenantInputSchema = z.object({
  organizationId: z.string().min(1).max(200),
  migrationName: z.string().min(1).max(200),
});

export const opsEnrollMigrationTenantInputSchema = opsMigrationTenantInputSchema.extend({
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

export const opsRunSystemMigrationForOrganizationInputSchema = opsMigrationTenantInputSchema.extend(
  {
    // Typed confirmation for the cutover migration - a targeted cutover run is
    // exactly the flip the enrollment confirmation guards.
    confirm: z.literal("RUN").optional(),
  },
);

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

/**
 * What the operator surface READS back.
 *
 * These sat only on the process's `SystemMigrationsService`, so the transport
 * port could name none of them and declared `Promise<unknown>` for all three.
 * A tRPC procedure publishes what its handler returns, so `unknown` is what
 * reached the browser — the migrations page read `data?.isSaaS` off `{}` and
 * every row field off `unknown`. Declared here so the port can say what it
 * answers and the page gets its types back.
 */

/** One enrollment row as the ops page lists it. */
export type OpsMigrationEnrollmentRecord = {
  organizationId: string;
  /** Null when the organization has since been deleted. */
  organizationName: string | null;
  /** The stable name of the migration this row enrolls the organization in. */
  migrationName: string;
  enrolledByUserId: string;
  /**
   * The enroller's display name; null when it no longer resolves (the user id
   * above still identifies them). Never the email — the name is the one piece
   * of personal data the listing carries, and the read is audited for exactly
   * that reason.
   */
  enrolledByLabel: string | null;
  createdAt: Date;
};

/**
 * The enrollment listing, with the installation kind alongside it so the page
 * can say honestly that a self-hosted installation has nothing to enroll.
 */
export type OpsMigrationEnrollmentListing = {
  isSaaS: boolean;
  enrollments: OpsMigrationEnrollmentRecord[];
};

/** One organization as the operator's pickers show it. */
export type OpsMigrationOrganizationMatch = { id: string; name: string };

/** How many tenants sit in each state, for one migration's gauge. */
export type OpsMigrationStatusCounts = Record<TenantMigrationStatus, number>;

/** One migration as the operator dashboard lists it. */
export type OpsMigrationOverview = {
  name: string;
  /** The name operators read; presentation over the stable `name`. */
  title: string;
  description: string;
  /**
   * Whether acting on this migration takes the typed destructive
   * confirmation, so the page asks for it exactly where the server requires
   * it rather than deciding for itself which migration is dangerous.
   */
  requiresOperatorConfirmation: boolean;
  /** False only on self-hosted, for a migration not yet released there. */
  availableOnThisInstallation: boolean;
  /** Whether every organization is in the cohort with no operator action. */
  enrolledAutomatically: boolean;
  counts: OpsMigrationStatusCounts;
  /**
   * The rollout gauge. Null when there is nothing to enroll — off cloud, and
   * for a migration that admits every organization automatically.
   */
  enrollment: { enrolledCount: number; notEnrolledCount: number } | null;
  attention: Array<TenantMigrationRecord & { updatedAt: Date }>;
};

/** What a cohort draw enrolled, and how large the pool it drew from was. */
export type OpsMigrationCohortResult = {
  enrolled: OpsMigrationOrganizationMatch[];
  eligibleCount: number;
};

/**
 * Where one organization stands after a targeted pass.
 *
 * `status` is null when the pass wrote no record — the migration decided the
 * organization was out of scope — and `waiting` says the record exists but the
 * migration is holding it on a prerequisite rather than having finished.
 */
export type OpsMigrationTargetedRunResult = {
  status: TenantMigrationStatus | null;
  waiting: boolean;
};
