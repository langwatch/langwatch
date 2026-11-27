import type { Named } from "@langwatch/module";
import { z } from "zod";

/** The most tenant ids one count reads; a project id and its organization id are two. */
export const TENANT_QUEUE_COUNT_MAX_TENANTS = 100;

/**
 * The tenants to count, as the first segment of a group key holds them: the eventing tenant id,
 * a project id for project pipelines and an organization id for organization pipelines.
 */
const tenantQueueCountInputSchemaDefinition = z
  .object({
    tenantIds: z.array(z.string().min(1)).min(1).max(TENANT_QUEUE_COUNT_MAX_TENANTS),
  })
  .strict();
export interface TenantQueueCountInputSchema extends Named<
  typeof tenantQueueCountInputSchemaDefinition
> {}
export const tenantQueueCountInputSchema: TenantQueueCountInputSchema =
  tenantQueueCountInputSchemaDefinition;
export type TenantQueueCountInput = z.infer<typeof tenantQueueCountInputSchema>;

/** One queue's groups of the given tenants: counts and one time only, never a key or payload. */
const tenantQueueCountSchemaDefinition = z
  .object({
    queueName: z.string(),
    pendingGroups: z.number().int().nonnegative(),
    blockedGroups: z.number().int().nonnegative(),
    activeGroups: z.number().int().nonnegative(),
    parkedGroups: z.number().int().nonnegative(),
    dlqGroups: z.number().int().nonnegative(),
    pendingJobs: z.number().int().nonnegative(),
    /** Epoch milliseconds of the oldest waiting job; null when none waits. */
    oldestPendingAt: z.number().nullable(),
  })
  .strict();
export interface TenantQueueCountSchema extends Named<typeof tenantQueueCountSchemaDefinition> {}
export const tenantQueueCountSchema: TenantQueueCountSchema = tenantQueueCountSchemaDefinition;
export type TenantQueueCount = z.infer<typeof tenantQueueCountSchema>;
