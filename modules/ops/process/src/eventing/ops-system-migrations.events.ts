import { EventSchema } from "@langwatch/eventing";
import { z } from "zod";

export const SYSTEM_MIGRATION_PASS_AGGREGATE_TYPE = "system_migration_pass";
export const SYSTEM_MIGRATION_PASS_REQUESTED_EVENT_TYPE = "lw.ops.system_migration_pass.requested";
export const SYSTEM_MIGRATION_PASS_REQUESTED_EVENT_VERSION = "2026-09-28";

/** An operator asked for a pass now; who asked is the event's tenant. */
export const systemMigrationPassRequestedEventDataSchema = z.object({});

export const systemMigrationPassRequestedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(SYSTEM_MIGRATION_PASS_REQUESTED_EVENT_TYPE),
  version: z.literal(SYSTEM_MIGRATION_PASS_REQUESTED_EVENT_VERSION),
  data: systemMigrationPassRequestedEventDataSchema,
});
export type SystemMigrationPassRequestedEvent = z.infer<
  typeof systemMigrationPassRequestedEventSchema
>;
