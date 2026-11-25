import { z } from "zod";

/**
 * What a plan grants, as opposed to how much of it. A gate is a boolean a
 * refusal reads; the sentence the customer sees stays with the refusing
 * feature, never here.
 */
export const planGatesSchema = z.object({
  canPublish: z.boolean(),
  webhookEndpoints: z.boolean(),
  rbac: z.boolean(),
  auditLogs: z.boolean(),
  scim: z.boolean(),
  anomalyRules: z.boolean(),
  activityMonitor: z.boolean(),
  ingestionSources: z.boolean(),
  ocsfExport: z.boolean(),
  managementApi: z.boolean(),
  groups: z.boolean(),
});

export type PlanGates = z.infer<typeof planGatesSchema>;
export type PlanCapability = keyof PlanGates;

export const PLAN_CAPABILITIES = Object.keys(planGatesSchema.shape) as readonly PlanCapability[];

/** Everything an Enterprise contract sells, off for every other plan. */
export const ENTERPRISE_CAPABILITIES = [
  "webhookEndpoints",
  "rbac",
  "auditLogs",
  "scim",
  "anomalyRules",
  "activityMonitor",
  "ingestionSources",
  "ocsfExport",
  "managementApi",
  "groups",
] as const satisfies readonly PlanCapability[];
