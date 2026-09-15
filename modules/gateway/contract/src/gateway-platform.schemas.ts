/**
 * Wire schemas for the public `/api/gateway/v1` virtual-key, budget and
 * cache-rule surface. Every enum here is lower_snake_case, input and output:
 * the stored SCREAMING_SNAKE is Prisma's convention, not a contract, and
 * `toWireEnum` / `toStoredEnum` translate at the transport in both directions.
 */
import { z } from "zod";

import { USD_DISPLAY_STRING_FORMAT } from "./gateway.money.ts";
import {
  EXTERNAL_ID_MAX_LENGTH,
  externalIdSchema,
  resourceMetadataSchema,
} from "./gateway.resource-metadata.ts";
import { virtualKeyConfigSchema } from "./virtual-key-config.ts";

export const gatewayVkScopeTypeSchema = z.enum(["organization", "team", "project"]);

export const gatewayBudgetScopeTypeSchema = z.enum([
  "organization",
  "team",
  "project",
  "virtual_key",
  "principal",
  "group",
  "attributed_user",
]);

export const gatewayBudgetWindowSchema = z.enum([
  "minute",
  "hour",
  "day",
  "week",
  "month",
  "total",
  "manual",
]);

export const gatewayOnBreachSchema = z.enum(["block", "warn"]);

export const gatewayRoutingModeWireSchema = z.enum(["none", "fallback_all", "policy"]);

export const gatewayVirtualKeyDtoSchema = z.object({
  id: z.string(),
  organization_id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  status: z.enum(["active", "disabled", "revoked"]),
  purpose: z.enum(["user", "langy"]),
  display_prefix: z.string(),
  principal_user_id: z.string().nullable(),
  trace_project_id: z
    .string()
    .nullable()
    .describe(
      "The project this key's traces and costs land in. Not a scope: it grants no access to the key. Null only on a key created before this was stored.",
    ),
  trace_project_archived: z
    .boolean()
    .describe(
      "True when the project in trace_project_id has been deleted. The key goes on sending its traces there.",
    ),
  external_id: z.string().nullable(),
  metadata: z.record(z.string(), z.string()),
  scopes: z.array(
    z.object({ scope_type: gatewayVkScopeTypeSchema, scope_id: z.string() }),
  ),
  routing_policy_id: z.string().nullable(),
  routing_mode: gatewayRoutingModeWireSchema,
  config: z.unknown(),
  revision: z.string(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  last_used_at: z.string().datetime().nullable(),
  revoked_at: z.string().datetime().nullable(),
  expires_at: z
    .string()
    .datetime()
    .nullable()
    .describe(
      "When the key stops serving, or null for a key that never expires. status stays active past the date on purpose.",
    ),
});
export type GatewayVirtualKeyDto = z.infer<typeof gatewayVirtualKeyDtoSchema>;

export const gatewayPlatformBudgetDtoSchema = z.object({
  id: z.string(),
  organization_id: z.string(),
  scope_type: gatewayBudgetScopeTypeSchema,
  scope_id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  window: gatewayBudgetWindowSchema,
  on_breach: gatewayOnBreachSchema,
  limit_usd: z
    .string()
    .describe(`Display value. ${USD_DISPLAY_STRING_FORMAT} Use limit_nano_usd for arithmetic.`),
  limit_nano_usd: z.number().int().nullable(),
  spent_usd: z.string().nullable(),
  spent_nano_usd: z.number().int().nullable(),
  timezone: z.string().nullable(),
  provider_key: z.string().nullable(),
  external_id: z.string().nullable(),
  metadata: z.record(z.string(), z.string()),
  current_period_started_at: z.string(),
  resets_at: z.string(),
  cycle_anchor_at: z.string().nullable(),
  last_reset_at: z.string().nullable(),
  archived_at: z.string().nullable(),
  created_at: z.string(),
  member_count: z.number().int().optional(),
  end_users_seen: z.number().int().optional(),
  end_users_over: z.number().int().optional(),
  scope_reach: z.enum(["reachable", "unreachable"]).optional(),
});
export type GatewayPlatformBudgetDto = z.infer<typeof gatewayPlatformBudgetDtoSchema>;

export const gatewaySpendSummaryDtoSchema = z.object({
  virtual_key_id: z.string(),
  spent_usd: z.string(),
  requests: z.number().int(),
  window: z.object({ from: z.number().int(), to: z.number().int() }),
});

export const gatewayCacheRuleMatchersWireSchema = z
  .object({
    vk_id: z.string().optional(),
    vk_tags: z.array(z.string()).optional(),
    vk_prefix: z.string().optional(),
    principal_id: z.string().optional(),
    model: z.string().optional(),
    request_metadata: z.record(z.string(), z.string()).optional(),
  })
  .strict();

export const gatewayCacheRuleActionWireSchema = z
  .object({
    mode: z.enum(["respect", "force", "disable"]),
    ttl: z.number().int().min(0).max(86_400).optional(),
    salt: z.string().max(64).optional(),
  })
  .strict();

export const gatewayPlatformCacheRuleDtoSchema = z.object({
  id: z.string(),
  organization_id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  priority: z.number().int(),
  enabled: z.boolean(),
  matchers: z.record(z.string(), z.unknown()),
  action: z.object({
    mode: z.enum(["respect", "force", "disable"]),
    ttl: z.number().int().optional(),
    salt: z.string().optional(),
  }),
  mode_enum: z.enum(["respect", "force", "disable"]),
  archived_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const gatewayNextCursorSchema = z
  .string()
  .nullable()
  .describe("Pass back as cursor for the next page. Null means the walk is exhausted.");

/** The widest epoch millisecond count a moment can carry. */
export const GATEWAY_MAX_EPOCH_MS = 8_640_000_000_000_000;

export const gatewayPageQuerySchema = z.object({
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().positive().max(200).optional().default(50),
});

export const gatewayExternalIdFilterSchema = z
  .string()
  .max(EXTERNAL_ID_MAX_LENGTH)
  .optional()
  .describe("Exact match on the resource's external_id.");

export const gatewayVirtualKeyListQuerySchema = gatewayPageQuerySchema.extend({
  external_id: gatewayExternalIdFilterSchema,
});

export const gatewayBudgetListQuerySchema = gatewayPageQuerySchema.extend({
  scope_type: z
    .string()
    .optional()
    .describe("Comma-separated subset of the scope types, lowercase."),
  external_id: gatewayExternalIdFilterSchema,
});

export const gatewayResetBudgetQuerySchema = z.object({
  end_user_id: z.string().min(1).optional(),
});

export const gatewayVkSpendWindowSchema = z.object({
  from: z.coerce.number().int().positive().max(GATEWAY_MAX_EPOCH_MS).optional(),
  to: z.coerce.number().int().positive().max(GATEWAY_MAX_EPOCH_MS).optional(),
});

export const gatewayScopeWireSchema = z.object({
  scope_type: gatewayVkScopeTypeSchema,
  scope_id: z.string().min(1),
});

export const gatewayUsdAmountSchema = z
  .number()
  .positive()
  .or(
    z
      .string()
      .trim()
      .regex(/^\d+(\.\d+)?$/, "must be a decimal number of dollars")
      .refine((v) => Number.parseFloat(v) > 0, { message: "must be greater than zero" }),
  );

export const gatewayBudgetWireSchema = z.object({
  limit_usd: gatewayUsdAmountSchema,
  window: z.enum(["day", "week", "month"]),
  on_breach: gatewayOnBreachSchema.optional(),
  name: z.string().min(1).max(128).optional(),
});

export const gatewayCreateVirtualKeySchema = z.object({
  name: z.string().min(1).max(128),
  description: z.string().optional(),
  principal_user_id: z.string().nullable().optional(),
  scopes: z.array(gatewayScopeWireSchema).min(1).optional(),
  trace_project_id: z.string().nullable().optional(),
  routing_policy_id: z.string().nullable().optional(),
  routing_mode: gatewayRoutingModeWireSchema.optional(),
  expires_at: z.coerce.date().optional(),
  budget: gatewayBudgetWireSchema.nullable().optional(),
  config: virtualKeyConfigSchema.partial().optional(),
  external_id: externalIdSchema.nullable().optional(),
  metadata: resourceMetadataSchema.optional(),
  purpose: z.literal("user").optional(),
});

export const gatewayUpdateVirtualKeySchema = z.object({
  name: z.string().min(1).max(128).optional(),
  description: z.string().nullable().optional(),
  scopes: z.array(gatewayScopeWireSchema).min(1).optional(),
  trace_project_id: z.string().nullable().optional(),
  routing_policy_id: z.string().nullable().optional(),
  routing_mode: gatewayRoutingModeWireSchema.optional(),
  expires_at: z.coerce.date().nullable().optional(),
  budget: gatewayBudgetWireSchema.nullable().optional(),
  config: virtualKeyConfigSchema.partial().optional(),
  external_id: externalIdSchema.nullable().optional(),
  metadata: resourceMetadataSchema.optional(),
});

export const gatewayDisableVkSchema = z.object({
  reason: z.string().max(500).optional(),
});

export const gatewayResetBudgetSchema = z.object({
  reason: z.string().max(500).optional(),
});

export const gatewayCreateBudgetSchema = z.object({
  scope: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("organization"), organization_id: z.string() }),
    z.object({ kind: z.literal("team"), team_id: z.string() }),
    z.object({ kind: z.literal("project"), project_id: z.string() }),
    z.object({ kind: z.literal("virtual_key"), virtual_key_id: z.string() }),
    z.object({ kind: z.literal("principal"), principal_user_id: z.string() }),
    z.object({ kind: z.literal("group"), group_id: z.string() }),
    z.object({
      kind: z.literal("attributed_user"),
      anchor_virtual_key_id: z.string().optional(),
      anchor_project_id: z.string().optional(),
    }),
  ]),
  name: z.string().min(1).max(128),
  description: z.string().optional(),
  window: gatewayBudgetWindowSchema,
  limit_usd: gatewayUsdAmountSchema,
  on_breach: gatewayOnBreachSchema.optional(),
  timezone: z.string().nullable().optional(),
  provider_key: z.string().nullable().optional(),
  external_id: externalIdSchema.nullable().optional(),
  metadata: resourceMetadataSchema.optional(),
  cycle_anchor_at: z.string().datetime({ offset: true }).optional(),
  allow_unreachable: z.boolean().optional(),
});

export const gatewayUpdateBudgetSchema = z.object({
  name: z.string().min(1).max(128).optional(),
  description: z.string().nullable().optional(),
  limit_usd: gatewayUsdAmountSchema.optional(),
  on_breach: gatewayOnBreachSchema.optional(),
  timezone: z.string().nullable().optional(),
  external_id: externalIdSchema.nullable().optional(),
  metadata: resourceMetadataSchema.optional(),
});

export const gatewayCreateCacheRuleSchema = z.object({
  name: z.string().min(1).max(128),
  description: z.string().max(512).nullable().optional(),
  priority: z.number().int().min(0).max(1_000).optional(),
  enabled: z.boolean().optional(),
  matchers: gatewayCacheRuleMatchersWireSchema,
  action: gatewayCacheRuleActionWireSchema,
});

export const gatewayUpdateCacheRuleSchema = z.object({
  name: z.string().min(1).max(128).optional(),
  description: z.string().max(512).nullable().optional(),
  priority: z.number().int().min(0).max(1_000).optional(),
  enabled: z.boolean().optional(),
  matchers: gatewayCacheRuleMatchersWireSchema.optional(),
  action: gatewayCacheRuleActionWireSchema.optional(),
});

export const gatewayIdParamsSchema = z.object({ id: z.string().min(1) });
