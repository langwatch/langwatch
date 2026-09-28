import { defineCommand } from "@langwatch/eventing";

import {
  SYSTEM_MIGRATION_PASS_AGGREGATE_TYPE,
  SYSTEM_MIGRATION_PASS_REQUESTED_EVENT_TYPE,
  SYSTEM_MIGRATION_PASS_REQUESTED_EVENT_VERSION,
  systemMigrationPassRequestedEventDataSchema,
} from "./ops-system-migrations.events.ts";

/** One aggregate for every kick: the scheduled singleton keeps its own instance and its wake. */
const PASS_REQUESTS_AGGREGATE_ID = "system_migration_pass_requests";

/**
 * The operator's "run a pass now". Its tenant is the operator's user id, which the event store
 * places on the shared cluster; each click is its own ask, keyed by when it was made.
 */
export const RequestSystemMigrationPassCommand = defineCommand({
  commandType: "lw.ops.system_migration_pass.request",
  eventType: SYSTEM_MIGRATION_PASS_REQUESTED_EVENT_TYPE,
  eventVersion: SYSTEM_MIGRATION_PASS_REQUESTED_EVENT_VERSION,
  aggregateType: SYSTEM_MIGRATION_PASS_AGGREGATE_TYPE,
  schema: systemMigrationPassRequestedEventDataSchema,
  aggregateId: () => PASS_REQUESTS_AGGREGATE_ID,
  idempotencyKey: (d) => `${d.tenantId}:system_migration_pass:${d.occurredAt}`,
  makeJobId: (d) => `${d.tenantId}:system_migration_pass:${d.occurredAt}`,
});
