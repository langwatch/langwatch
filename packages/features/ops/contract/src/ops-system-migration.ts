/**
 * The input shapes the operator system-migrations surface parses.
 *
 * The confirmations are typed strings rather than booleans, and optional
 * rather than required, because only the migrations that declare themselves
 * destructive demand one — the transport asks the runner which those are.
 */
import { z } from "zod";

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
