import type { Named } from "@langwatch/module";
/**
 * Gateway's facts. Governance (a budget crossing, a virtual key lifecycle change) goes to
 * webhook delivery under main's stored type and field names; a key's first request is read by
 * nurturing; a licence's managed key provisioned is read by licensing.
 */
import { z } from "zod";

import { virtualKeyPurposeSchema } from "./gateway.rows.ts";

export const GATEWAY_BUDGET_CROSSING_EVENT_TYPE = "lw.governance.budget_crossing" as const;
export const GATEWAY_VK_LIFECYCLE_EVENT_TYPE = "lw.governance.vk_lifecycle" as const;

export const vkLifecycleActionSchema = z.enum([
  "created",
  "rotated",
  "disabled",
  "enabled",
  "revoked",
]);
export type VkLifecycleAction = z.infer<typeof vkLifecycleActionSchema>;

const recordVkLifecycleCommandDataSchemaDefinition = z.object({
  tenantId: z.string().min(1),
  organization_id: z.string().min(1),
  virtual_key_id: z.string().min(1),
  action: vkLifecycleActionSchema,
  name: z.string(),
  display_prefix: z.string(),
  reason: z.string().nullable().default(null),
  // The three below are absent on a fact stored before they were recorded, which reads as null.
  /** The person who made the change; null when no person did (a project key, Connect). */
  actor_user_id: z.string().min(1).nullish(),
  /** `VirtualKey.principalUserId`: the person the key acts for. */
  principal_user_id: z.string().min(1).nullish(),
  /** `VirtualKey.purpose`; null reads as USER. */
  purpose: virtualKeyPurposeSchema.nullish(),
  /** Unix ms of the mutation. */
  occurred_at: z.number().int().positive(),
});
export interface RecordVkLifecycleCommandDataSchema extends Named<
  typeof recordVkLifecycleCommandDataSchemaDefinition
> {}
export const recordVkLifecycleCommandDataSchema: RecordVkLifecycleCommandDataSchema =
  recordVkLifecycleCommandDataSchemaDefinition;
export type RecordVkLifecycleCommandData = z.infer<typeof recordVkLifecycleCommandDataSchema>;

export const budgetCrossingKindSchema = z.enum(["threshold_crossed", "breached"]);
export type BudgetCrossingKind = z.infer<typeof budgetCrossingKindSchema>;

const recordBudgetCrossingCommandDataSchemaDefinition = z.object({
  tenantId: z.string().min(1),
  organization_id: z.string().min(1),
  budget_id: z.string().min(1),
  kind: budgetCrossingKindSchema,
  scope_type: z.string().min(1),
  /** The ledger bucket that crossed (a template's is "<anchor>:<endUser>"). */
  bucket_scope_id: z.string().min(1),
  end_user_id: z.string().nullable().default(null),
  virtual_key_id: z.string().nullable().default(null),
  anchor_project_id: z.string().nullable().default(null),
  window: z.string().min(1),
  /** Period identity for once-per-crossing-per-period dedup, unix ms. */
  period_started_at_ms: z.number().int().min(0),
  /**
   * When the period gives way to the next, unix ms, by gateway's own window logic. Null for a
   * window that never rolls (TOTAL, MANUAL); absent on a fact stored before it was recorded.
   */
  period_ends_at_ms: z.number().int().min(0).nullish(),
  limit_usd: z.string(),
  spent_usd: z.string(),
  on_breach: z.enum(["block", "warn"]),
  occurred_at: z.number().int().positive(),
  /**
   * The model the bucket spent most on this period, ties to the first by name. Only a key's own
   * budget carries it; absent when the read failed or on a fact stored before it was recorded.
   */
  top_model: z.string().min(1).nullish(),
  /** That model's share of the bucket's spend this period, 0 to 1; present with `top_model`. */
  top_model_spend_share: z.number().min(0).max(1).nullish(),
});
export interface RecordBudgetCrossingCommandDataSchema extends Named<
  typeof recordBudgetCrossingCommandDataSchemaDefinition
> {}
export const recordBudgetCrossingCommandDataSchema: RecordBudgetCrossingCommandDataSchema =
  recordBudgetCrossingCommandDataSchemaDefinition;
export type RecordBudgetCrossingCommandData = z.infer<typeof recordBudgetCrossingCommandDataSchema>;

/**
 * A key served its first request: gateway admitted a request on it while its `lastUsedAt` was
 * still empty. Nurturing reads it; webhook delivery does not, so it is not in the union below.
 */
export const GATEWAY_VK_FIRST_REQUEST_EVENT_TYPE = "lw.governance.vk_first_request" as const;

const recordVkFirstRequestCommandDataSchemaDefinition = z.object({
  tenantId: z.string().min(1),
  organization_id: z.string().min(1),
  virtual_key_id: z.string().min(1),
  /** Unix ms of the ingest that saw the key unused. */
  occurred_at: z.number().int().positive(),
});
export interface RecordVkFirstRequestCommandDataSchema extends Named<
  typeof recordVkFirstRequestCommandDataSchemaDefinition
> {}
export const recordVkFirstRequestCommandDataSchema: RecordVkFirstRequestCommandDataSchema =
  recordVkFirstRequestCommandDataSchemaDefinition;
export type RecordVkFirstRequestCommandData = z.infer<typeof recordVkFirstRequestCommandDataSchema>;

/** One governance fact as a delivery module takes it, typed by the event that recorded it. */
const gatewayGovernanceEventSchemaDefinition = z.discriminatedUnion("type", [
  z.object({
    type: z.literal(GATEWAY_BUDGET_CROSSING_EVENT_TYPE),
    data: recordBudgetCrossingCommandDataSchema,
  }),
  z.object({
    type: z.literal(GATEWAY_VK_LIFECYCLE_EVENT_TYPE),
    data: recordVkLifecycleCommandDataSchema,
  }),
]);
export interface GatewayGovernanceEventSchema extends Named<
  typeof gatewayGovernanceEventSchemaDefinition
> {}
export const gatewayGovernanceEventSchema: GatewayGovernanceEventSchema =
  gatewayGovernanceEventSchemaDefinition;
export type GatewayGovernanceEvent = z.infer<typeof gatewayGovernanceEventSchema>;

/** Gateway's facts about a self-hosted licence's managed key (C3b); licensing attaches the key. */
export const GATEWAY_CONNECT_MANAGED_KEY_AGGREGATE_TYPE = "gateway_connect_managed_key" as const;
export const GATEWAY_CONNECT_MANAGED_KEY_EVENT_VERSION = "2026-10-09" as const;
export const GATEWAY_MANAGED_KEY_PROVISIONED_EVENT_TYPE =
  "lw.gateway.managed_key_provisioned" as const;

/** Gateway holds this licence's managed key and has written its services and licence on it. */
const gatewayManagedKeyProvisionedEventDataSchemaDefinition = z.object({
  tenantId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
  organizationId: z.string().min(1),
  licenseId: z.string().min(1),
  issuedLicenseId: z.string().min(1),
  virtualKeyId: z.string().min(1),
});
export interface GatewayManagedKeyProvisionedEventDataSchema extends Named<
  typeof gatewayManagedKeyProvisionedEventDataSchemaDefinition
> {}
export const gatewayManagedKeyProvisionedEventDataSchema: GatewayManagedKeyProvisionedEventDataSchema =
  gatewayManagedKeyProvisionedEventDataSchemaDefinition;
export type GatewayManagedKeyProvisionedEventData = z.infer<
  typeof gatewayManagedKeyProvisionedEventDataSchema
>;
