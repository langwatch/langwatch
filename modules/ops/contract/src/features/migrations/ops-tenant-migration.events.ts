import type { Named } from "@langwatch/module";
import { z } from "zod";

/**
 * An operator rolled one tenant of a tenant migration back. The step's owner subscribes and turns
 * its own switch off for that tenant (Alex, 2026-10-12, "Separate the switch"; ADR-179).
 */
export const TENANT_MIGRATION_ROLLED_BACK_EVENT_TYPE =
  "lw.ops.tenant_migration.rolled_back" as const;
export const TENANT_MIGRATION_ROLLED_BACK_EVENT_VERSION = "2026-10-12" as const;

/** The event's own tenant is the rolled-back tenant; its `occurredAt` the operator's decision. */
const tenantMigrationRolledBackEventDataSchemaDefinition = z.object({
  stepId: z.string().min(1),
  rolledBackTenantId: z.string().min(1),
  actorUserId: z.string().min(1),
});
export interface TenantMigrationRolledBackEventDataSchema extends Named<
  typeof tenantMigrationRolledBackEventDataSchemaDefinition
> {}
export const tenantMigrationRolledBackEventDataSchema: TenantMigrationRolledBackEventDataSchema =
  tenantMigrationRolledBackEventDataSchemaDefinition;
export type TenantMigrationRolledBackEventData = z.infer<
  typeof tenantMigrationRolledBackEventDataSchema
>;
