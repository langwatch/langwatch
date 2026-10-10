import type { Named } from "@langwatch/module";
/**
 * Wire schemas for the public `/api/gateway/v1` surface. Every enum is
 * lower_snake_case in and out — the stored SCREAMING_SNAKE is Prisma's
 * convention, not a contract; `toWireEnum`/`toStoredEnum` translate both ways.
 */
import { fromDate } from "@langwatch/time";
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

const gatewayVirtualKeyDtoSchemaDefinition = z.object({
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
  scopes: z.array(z.object({ scope_type: gatewayVkScopeTypeSchema, scope_id: z.string() })),
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
export interface GatewayVirtualKeyDtoSchema extends Named<
  typeof gatewayVirtualKeyDtoSchemaDefinition
> {}
export const gatewayVirtualKeyDtoSchema: GatewayVirtualKeyDtoSchema =
  gatewayVirtualKeyDtoSchemaDefinition;
export type GatewayVirtualKeyDto = z.infer<typeof gatewayVirtualKeyDtoSchema>;

const gatewayPlatformBudgetDtoSchemaDefinition = z.object({
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
export interface GatewayPlatformBudgetDtoSchema extends Named<
  typeof gatewayPlatformBudgetDtoSchemaDefinition
> {}
export const gatewayPlatformBudgetDtoSchema: GatewayPlatformBudgetDtoSchema =
  gatewayPlatformBudgetDtoSchemaDefinition;
export type GatewayPlatformBudgetDto = z.infer<typeof gatewayPlatformBudgetDtoSchema>;

const gatewaySpendSummaryDtoSchemaDefinition = z.object({
  virtual_key_id: z.string(),
  spent_usd: z.string(),
  requests: z.number().int(),
  window: z.object({ from: z.number().int(), to: z.number().int() }),
});
export interface GatewaySpendSummaryDtoSchema extends Named<
  typeof gatewaySpendSummaryDtoSchemaDefinition
> {}
export const gatewaySpendSummaryDtoSchema: GatewaySpendSummaryDtoSchema =
  gatewaySpendSummaryDtoSchemaDefinition;

const gatewayCacheRuleMatchersWireSchemaDefinition = z
  .object({
    vk_id: z.string().optional(),
    vk_tags: z.array(z.string()).optional(),
    vk_prefix: z.string().optional(),
    principal_id: z.string().optional(),
    model: z.string().optional(),
    request_metadata: z.record(z.string(), z.string()).optional(),
  })
  .strict();
export interface GatewayCacheRuleMatchersWireSchema extends Named<
  typeof gatewayCacheRuleMatchersWireSchemaDefinition
> {}
export const gatewayCacheRuleMatchersWireSchema: GatewayCacheRuleMatchersWireSchema =
  gatewayCacheRuleMatchersWireSchemaDefinition;

const gatewayCacheRuleActionWireSchemaDefinition = z
  .object({
    mode: z.enum(["respect", "force", "disable"]),
    ttl: z.number().int().min(0).max(86_400).optional(),
    salt: z.string().max(64).optional(),
  })
  .strict();
export interface GatewayCacheRuleActionWireSchema extends Named<
  typeof gatewayCacheRuleActionWireSchemaDefinition
> {}
export const gatewayCacheRuleActionWireSchema: GatewayCacheRuleActionWireSchema =
  gatewayCacheRuleActionWireSchemaDefinition;

const gatewayPlatformCacheRuleDtoSchemaDefinition = z.object({
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
export interface GatewayPlatformCacheRuleDtoSchema extends Named<
  typeof gatewayPlatformCacheRuleDtoSchemaDefinition
> {}
export const gatewayPlatformCacheRuleDtoSchema: GatewayPlatformCacheRuleDtoSchema =
  gatewayPlatformCacheRuleDtoSchemaDefinition;

export const gatewayNextCursorSchema = z
  .string()
  .nullable()
  .describe("Pass back as cursor for the next page. Null means the walk is exhausted.");

/** The widest epoch millisecond count a moment can carry. */
export const GATEWAY_MAX_EPOCH_MS = 8_640_000_000_000_000;

const gatewayPageQuerySchemaDefinition = z.object({
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().positive().max(200).optional().default(50),
});
export interface GatewayPageQuerySchema extends Named<typeof gatewayPageQuerySchemaDefinition> {}
export const gatewayPageQuerySchema: GatewayPageQuerySchema = gatewayPageQuerySchemaDefinition;

export const gatewayExternalIdFilterSchema = z
  .string()
  .max(EXTERNAL_ID_MAX_LENGTH)
  .optional()
  .describe("Exact match on the resource's external_id.");

const gatewayVirtualKeyListQuerySchemaDefinition = z.object({
  ...gatewayPageQuerySchema.shape,
  external_id: gatewayExternalIdFilterSchema,
});
export interface GatewayVirtualKeyListQuerySchema extends Named<
  typeof gatewayVirtualKeyListQuerySchemaDefinition
> {}
export const gatewayVirtualKeyListQuerySchema: GatewayVirtualKeyListQuerySchema =
  gatewayVirtualKeyListQuerySchemaDefinition;

const gatewayBudgetListQuerySchemaDefinition = z.object({
  ...gatewayPageQuerySchema.shape,
  scope_type: z
    .string()
    .transform((raw) => raw.split(",").map((part) => part.trim()))
    .pipe(z.array(gatewayBudgetScopeTypeSchema).min(1))
    .optional()
    .describe("Comma-separated subset of the scope types, lowercase."),
  external_id: gatewayExternalIdFilterSchema,
});
export interface GatewayBudgetListQuerySchema extends Named<
  typeof gatewayBudgetListQuerySchemaDefinition
> {}
export const gatewayBudgetListQuerySchema: GatewayBudgetListQuerySchema =
  gatewayBudgetListQuerySchemaDefinition;

const gatewayResetBudgetQuerySchemaDefinition = z.object({
  end_user_id: z.string().min(1).optional(),
});
export interface GatewayResetBudgetQuerySchema extends Named<
  typeof gatewayResetBudgetQuerySchemaDefinition
> {}
export const gatewayResetBudgetQuerySchema: GatewayResetBudgetQuerySchema =
  gatewayResetBudgetQuerySchemaDefinition;

const gatewayVkSpendWindowSchemaDefinition = z.object({
  from: z.coerce.number().int().positive().max(GATEWAY_MAX_EPOCH_MS).optional(),
  to: z.coerce.number().int().positive().max(GATEWAY_MAX_EPOCH_MS).optional(),
});
export interface GatewayVkSpendWindowSchema extends Named<
  typeof gatewayVkSpendWindowSchemaDefinition
> {}
export const gatewayVkSpendWindowSchema: GatewayVkSpendWindowSchema =
  gatewayVkSpendWindowSchemaDefinition;

const gatewayScopeWireSchemaDefinition = z.object({
  scope_type: gatewayVkScopeTypeSchema,
  scope_id: z.string().min(1),
});
export interface GatewayScopeWireSchema extends Named<typeof gatewayScopeWireSchemaDefinition> {}
export const gatewayScopeWireSchema: GatewayScopeWireSchema = gatewayScopeWireSchemaDefinition;

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

const gatewayBudgetWireSchemaDefinition = z.object({
  limit_usd: gatewayUsdAmountSchema,
  window: z.enum(["day", "week", "month"]),
  on_breach: gatewayOnBreachSchema.optional(),
  name: z.string().min(1).max(128).optional(),
});
export interface GatewayBudgetWireSchema extends Named<typeof gatewayBudgetWireSchemaDefinition> {}
export const gatewayBudgetWireSchema: GatewayBudgetWireSchema = gatewayBudgetWireSchemaDefinition;

/** A key's expiry: the same date the wire has always accepted, read as an instant. */
const expiresAtWireSchema = z.coerce.date().transform(fromDate);

const gatewayCreateVirtualKeySchemaDefinition = z.object({
  name: z.string().min(1).max(128),
  description: z.string().optional(),
  principal_user_id: z.string().nullable().optional(),
  /** Withhold the secret from the response and park it under a one-time reveal id instead. */
  reveal_once: z.boolean().optional(),
  scopes: z.array(gatewayScopeWireSchema).min(1).optional(),
  trace_project_id: z.string().nullable().optional(),
  routing_policy_id: z.string().nullable().optional(),
  routing_mode: gatewayRoutingModeWireSchema.optional(),
  expires_at: expiresAtWireSchema.optional(),
  budget: gatewayBudgetWireSchema.nullable().optional(),
  config: virtualKeyConfigSchema.partial().optional(),
  external_id: externalIdSchema.nullable().optional(),
  metadata: resourceMetadataSchema.optional(),
  purpose: z.literal("user").optional(),
});
export interface GatewayCreateVirtualKeySchema extends Named<
  typeof gatewayCreateVirtualKeySchemaDefinition
> {}
export const gatewayCreateVirtualKeySchema: GatewayCreateVirtualKeySchema =
  gatewayCreateVirtualKeySchemaDefinition;

const gatewayUpdateVirtualKeySchemaDefinition = z.object({
  name: z.string().min(1).max(128).optional(),
  description: z.string().nullable().optional(),
  scopes: z.array(gatewayScopeWireSchema).min(1).optional(),
  trace_project_id: z.string().nullable().optional(),
  routing_policy_id: z.string().nullable().optional(),
  routing_mode: gatewayRoutingModeWireSchema.optional(),
  expires_at: expiresAtWireSchema.nullable().optional(),
  budget: gatewayBudgetWireSchema.nullable().optional(),
  config: virtualKeyConfigSchema.partial().optional(),
  external_id: externalIdSchema.nullable().optional(),
  metadata: resourceMetadataSchema.optional(),
});
export interface GatewayUpdateVirtualKeySchema extends Named<
  typeof gatewayUpdateVirtualKeySchemaDefinition
> {}
export const gatewayUpdateVirtualKeySchema: GatewayUpdateVirtualKeySchema =
  gatewayUpdateVirtualKeySchemaDefinition;

const gatewayDisableVkSchemaDefinition = z.object({
  reason: z.string().max(500).optional(),
});
export interface GatewayDisableVkSchema extends Named<typeof gatewayDisableVkSchemaDefinition> {}
export const gatewayDisableVkSchema: GatewayDisableVkSchema = gatewayDisableVkSchemaDefinition;

const gatewayResetBudgetSchemaDefinition = z.object({
  reason: z.string().max(500).optional(),
});
export interface GatewayResetBudgetSchema extends Named<
  typeof gatewayResetBudgetSchemaDefinition
> {}
export const gatewayResetBudgetSchema: GatewayResetBudgetSchema =
  gatewayResetBudgetSchemaDefinition;

const gatewayCreateBudgetSchemaDefinition = z.object({
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
export interface GatewayCreateBudgetSchema extends Named<
  typeof gatewayCreateBudgetSchemaDefinition
> {}
export const gatewayCreateBudgetSchema: GatewayCreateBudgetSchema =
  gatewayCreateBudgetSchemaDefinition;

const gatewayUpdateBudgetSchemaDefinition = z.object({
  name: z.string().min(1).max(128).optional(),
  description: z.string().nullable().optional(),
  limit_usd: gatewayUsdAmountSchema.optional(),
  on_breach: gatewayOnBreachSchema.optional(),
  timezone: z.string().nullable().optional(),
  external_id: externalIdSchema.nullable().optional(),
  metadata: resourceMetadataSchema.optional(),
});
export interface GatewayUpdateBudgetSchema extends Named<
  typeof gatewayUpdateBudgetSchemaDefinition
> {}
export const gatewayUpdateBudgetSchema: GatewayUpdateBudgetSchema =
  gatewayUpdateBudgetSchemaDefinition;

const gatewayCreateCacheRuleSchemaDefinition = z.object({
  name: z.string().min(1).max(128),
  description: z.string().max(512).nullable().optional(),
  priority: z.number().int().min(0).max(1_000).optional(),
  enabled: z.boolean().optional(),
  matchers: gatewayCacheRuleMatchersWireSchema,
  action: gatewayCacheRuleActionWireSchema,
});
export interface GatewayCreateCacheRuleSchema extends Named<
  typeof gatewayCreateCacheRuleSchemaDefinition
> {}
export const gatewayCreateCacheRuleSchema: GatewayCreateCacheRuleSchema =
  gatewayCreateCacheRuleSchemaDefinition;

const gatewayUpdateCacheRuleSchemaDefinition = z.object({
  name: z.string().min(1).max(128).optional(),
  description: z.string().max(512).nullable().optional(),
  priority: z.number().int().min(0).max(1_000).optional(),
  enabled: z.boolean().optional(),
  matchers: gatewayCacheRuleMatchersWireSchema.optional(),
  action: gatewayCacheRuleActionWireSchema.optional(),
});
export interface GatewayUpdateCacheRuleSchema extends Named<
  typeof gatewayUpdateCacheRuleSchemaDefinition
> {}
export const gatewayUpdateCacheRuleSchema: GatewayUpdateCacheRuleSchema =
  gatewayUpdateCacheRuleSchemaDefinition;

const gatewayIdParamsSchemaDefinition = z.object({ id: z.string().min(1) });
export interface GatewayIdParamsSchema extends Named<typeof gatewayIdParamsSchemaDefinition> {}
export const gatewayIdParamsSchema: GatewayIdParamsSchema = gatewayIdParamsSchemaDefinition;

/** A rotate takes no body: the virtual key travels in the path. */
const gatewayRotateVirtualKeyBodySchemaDefinition = z.object({});
export interface GatewayRotateVirtualKeyBodySchema extends Named<
  typeof gatewayRotateVirtualKeyBodySchemaDefinition
> {}
export const gatewayRotateVirtualKeyBodySchema: GatewayRotateVirtualKeyBodySchema =
  gatewayRotateVirtualKeyBodySchemaDefinition;

/** An enable takes no body: the virtual key travels in the path. */
const gatewayEnableVirtualKeyBodySchemaDefinition = z.object({});
export interface GatewayEnableVirtualKeyBodySchema extends Named<
  typeof gatewayEnableVirtualKeyBodySchemaDefinition
> {}
export const gatewayEnableVirtualKeyBodySchema: GatewayEnableVirtualKeyBodySchema =
  gatewayEnableVirtualKeyBodySchemaDefinition;

/** A revoke takes no body: the virtual key travels in the path. */
const gatewayRevokeVirtualKeyBodySchemaDefinition = z.object({});
export interface GatewayRevokeVirtualKeyBodySchema extends Named<
  typeof gatewayRevokeVirtualKeyBodySchemaDefinition
> {}
export const gatewayRevokeVirtualKeyBodySchema: GatewayRevokeVirtualKeyBodySchema =
  gatewayRevokeVirtualKeyBodySchemaDefinition;

/** The retired provider-binding writes read no body; they answer 410 whatever was sent. */
const gatewayRetiredProviderBindingBodySchemaDefinition = z.object({});
export interface GatewayRetiredProviderBindingBodySchema extends Named<
  typeof gatewayRetiredProviderBindingBodySchemaDefinition
> {}
export const gatewayRetiredProviderBindingBodySchema: GatewayRetiredProviderBindingBodySchema =
  gatewayRetiredProviderBindingBodySchemaDefinition;

/**
 * The REST credential a project door presented, by its principal: a scoped API key acts as
 * its owning user, a project-bound access token is its user (no key row), and a legacy project
 * key carries none and acts as a machine principal.
 */
const gatewayRequestCredentialSchemaDefinition = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("user"), userId: z.string(), organizationId: z.string() }),
  z.object({
    kind: z.literal("apiKey"),
    apiKeyId: z.string(),
    userId: z.string().nullable(),
    organizationId: z.string(),
  }),
  z.object({ kind: z.literal("legacyProjectKey") }),
]);
export interface GatewayRequestCredentialSchema extends Named<
  typeof gatewayRequestCredentialSchemaDefinition
> {}
export const gatewayRequestCredentialSchema: GatewayRequestCredentialSchema =
  gatewayRequestCredentialSchemaDefinition;

/**
 * Any API key as the key door resolved it. A legacy project key is its project;
 * any other key reaches its organization and names the project it resolved to,
 * if any, so an organization key manages organization-owned rows.
 */
const gatewayKeyCallerSchemaDefinition = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("project"), projectId: z.string().min(1) }).readonly(),
  z
    .object({
      kind: z.literal("apiKey"),
      apiKeyId: z.string().min(1),
      userId: z.string().min(1).nullable(),
      organizationId: z.string().min(1),
      resolvedProject: z
        .object({ id: z.string().min(1), teamId: z.string().min(1) })
        .readonly()
        .optional(),
    })
    .readonly(),
]);
export interface GatewayKeyCallerSchema extends Named<typeof gatewayKeyCallerSchemaDefinition> {}
export const gatewayKeyCallerSchema: GatewayKeyCallerSchema = gatewayKeyCallerSchemaDefinition;

export type GatewayKeyCaller = z.infer<typeof gatewayKeyCallerSchema>;

/** A key caller the door authorized: its organization and who a write is recorded as. */
const gatewayAuthorizedKeyCallerSchemaDefinition = z
  .object({
    organizationId: z.string().min(1),
    actor: z.unknown(),
    actorUserId: z.string().min(1),
  })
  .readonly();
export interface GatewayAuthorizedKeyCallerSchema extends Named<
  typeof gatewayAuthorizedKeyCallerSchemaDefinition
> {}
export const gatewayAuthorizedKeyCallerSchema: GatewayAuthorizedKeyCallerSchema =
  gatewayAuthorizedKeyCallerSchemaDefinition;

export type GatewayAuthorizedKeyCaller = z.infer<typeof gatewayAuthorizedKeyCallerSchema>;

/**
 * Who a virtual key route was called by: any API key as the key door resolved it, or a
 * project-bound access token, which is its person inside the one project it is bound to.
 */
const gatewayVirtualKeyCallerSchemaDefinition = z.discriminatedUnion("kind", [
  ...gatewayKeyCallerSchema.options,
  z
    .object({
      kind: z.literal("cliAccessToken"),
      userId: z.string().min(1),
      organizationId: z.string().min(1),
      projectId: z.string().min(1),
      teamId: z.string().min(1),
    })
    .readonly(),
]);
export interface GatewayVirtualKeyCallerSchema extends Named<
  typeof gatewayVirtualKeyCallerSchemaDefinition
> {}
export const gatewayVirtualKeyCallerSchema: GatewayVirtualKeyCallerSchema =
  gatewayVirtualKeyCallerSchemaDefinition;

export type GatewayVirtualKeyCaller = z.infer<typeof gatewayVirtualKeyCallerSchema>;

/**
 * A virtual key caller the application resolved. `projectId` is the one project the credential
 * acts in, or null for a key that names none and so reaches whatever its grants reach.
 */
const gatewayAuthorizedVirtualKeyCallerSchemaDefinition = gatewayAuthorizedKeyCallerSchema
  .unwrap()
  .extend({ projectId: z.string().min(1).nullable() })
  .readonly();
export interface GatewayAuthorizedVirtualKeyCallerSchema extends Named<
  typeof gatewayAuthorizedVirtualKeyCallerSchemaDefinition
> {}
export const gatewayAuthorizedVirtualKeyCallerSchema: GatewayAuthorizedVirtualKeyCallerSchema =
  gatewayAuthorizedVirtualKeyCallerSchemaDefinition;

export type GatewayAuthorizedVirtualKeyCaller = z.infer<
  typeof gatewayAuthorizedVirtualKeyCallerSchema
>;
