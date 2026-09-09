import { z } from "zod";

/** Content-free governance facts delivered by the webhook platform. */
export const GOVERNANCE_EVENTS_PIPELINE_NAME = "governance_events_processing" as const;
export const GOVERNANCE_EVENTS_AGGREGATE_TYPE = "governance_subject" as const;
export const RECORD_VK_LIFECYCLE_COMMAND_TYPE = "lw.governance.record_vk_lifecycle" as const;
export const RECORD_BUDGET_CROSSING_COMMAND_TYPE = "lw.governance.record_budget_crossing" as const;
export const GOVERNANCE_VK_LIFECYCLE_EVENT_TYPE = "lw.governance.vk_lifecycle" as const;
export const GOVERNANCE_BUDGET_CROSSING_EVENT_TYPE = "lw.governance.budget_crossing" as const;
export const GOVERNANCE_EVENTS_EVENT_VERSION_LATEST = "2026-07-31" as const;
export const GOVERNANCE_EVENTS_COMMAND_TYPES = [
  RECORD_VK_LIFECYCLE_COMMAND_TYPE,
  RECORD_BUDGET_CROSSING_COMMAND_TYPE,
] as const;
export const GOVERNANCE_EVENTS_EVENT_TYPES = [
  GOVERNANCE_VK_LIFECYCLE_EVENT_TYPE,
  GOVERNANCE_BUDGET_CROSSING_EVENT_TYPE,
] as const;

export const vkLifecycleActionSchema = z.enum([
  "created",
  "rotated",
  "disabled",
  "enabled",
  "revoked",
]);
export type VkLifecycleAction = z.infer<typeof vkLifecycleActionSchema>;

export const recordVkLifecycleCommandDataSchema = z.object({
  tenantId: z.string().min(1),
  organization_id: z.string().min(1),
  virtual_key_id: z.string().min(1),
  action: vkLifecycleActionSchema,
  name: z.string(),
  display_prefix: z.string(),
  reason: z.string().nullable().default(null),
  occurred_at: z.number().int().positive(),
});
export type RecordVkLifecycleCommandData = z.infer<typeof recordVkLifecycleCommandDataSchema>;

export const budgetCrossingKindSchema = z.enum(["threshold_crossed", "breached"]);
export type BudgetCrossingKind = z.infer<typeof budgetCrossingKindSchema>;

export const recordBudgetCrossingCommandDataSchema = z.object({
  tenantId: z.string().min(1),
  organization_id: z.string().min(1),
  budget_id: z.string().min(1),
  kind: budgetCrossingKindSchema,
  scope_type: z.string().min(1),
  bucket_scope_id: z.string().min(1),
  end_user_id: z.string().nullable().default(null),
  virtual_key_id: z.string().nullable().default(null),
  anchor_project_id: z.string().nullable().default(null),
  window: z.string().min(1),
  period_started_at_ms: z.number().int().min(0),
  limit_usd: z.string(),
  spent_usd: z.string(),
  on_breach: z.enum(["block", "warn"]),
  occurred_at: z.number().int().positive(),
});
export type RecordBudgetCrossingCommandData = z.infer<typeof recordBudgetCrossingCommandDataSchema>;
