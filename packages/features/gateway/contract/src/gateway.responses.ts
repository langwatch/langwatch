/**
 * What the gateway feature's tRPC transports answer, stated once.
 *
 * The chain declares each procedure's `withOutput` from here, so the shape a
 * client reads is written down in the contract rather than implied by
 * whatever a handler happened to return. The schemas are checked against
 * real answers in development and test; production returns the handler's
 * own value.
 */
import { z } from "zod";
import { gatewayCacheRuleActionSchema, gatewayCacheRuleMatchersSchema } from "./gateway-cache-rule.ts";
import { resourceMetadataSchema } from "./gateway.resource-metadata.ts";

const virtualKeyScopeEntrySchema = z
  .object({ scopeType: z.enum(["ORGANIZATION", "TEAM", "PROJECT"]), scopeId: z.string() })
  .strict();

/** A virtual key, camelCased and secret-free: `displayPrefix`, never the plaintext key. */
export const virtualKeyCamelDtoSchema = z
  .object({
    id: z.string(),
    organizationId: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    status: z.enum(["active", "disabled", "revoked"]),
    purpose: z.enum(["user", "langy"]),
    displayPrefix: z.string(),
    principalUserId: z.string().nullable(),
    traceProjectId: z.string().nullable(),
    traceProjectArchived: z.boolean(),
    principalUser: z
      .object({ name: z.string().nullable(), email: z.string().nullable() })
      .strict()
      .nullable(),
    externalId: z.string().nullable(),
    metadata: resourceMetadataSchema,
    scopes: z.array(virtualKeyScopeEntrySchema),
    routingPolicyId: z.string().nullable(),
    routingMode: z.enum(["NONE", "FALLBACK_ALL", "POLICY"]),
    config: z.unknown(),
    revision: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
    lastUsedAt: z.string().nullable(),
    revokedAt: z.string().nullable(),
    expiresAt: z.string().nullable(),
  })
  .strict();
export type VirtualKeyCamelDtoResponse = z.infer<typeof virtualKeyCamelDtoSchema>;

/** A key was minted or rotated: the DTO, and the plaintext secret this one moment carries. */
export const virtualKeyMintedSchema = z
  .object({ virtualKey: virtualKeyCamelDtoSchema, secret: z.string() })
  .strict();
export type VirtualKeyMinted = z.infer<typeof virtualKeyMintedSchema>;

/** Spend per key this calendar month, and its own direct budget if it carries one. */
export const virtualKeySpendThisMonthSchema = z
  .object({
    virtualKeyId: z.string(),
    spentUsd: z.string(),
    requests: z.number(),
    budget: z
      .object({
        budgetId: z.string(),
        window: z.string(),
        limitUsd: z.string(),
        periodSpentUsd: z.string().nullable(),
        resetsAt: z.string(),
      })
      .strict()
      .nullable(),
  })
  .strict()
  .array();
export type VirtualKeySpendThisMonth = z.infer<typeof virtualKeySpendThisMonthSchema>;

/** Every budget that would constrain a key, existing or a create-drawer draft. */
export const virtualKeyApplicableBudgetsSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    scopeType: z.string(),
    scopeId: z.string(),
    scopeLabel: z.string(),
    window: z.string(),
    limitUsd: z.string(),
    spentUsd: z.string(),
    onBreach: z.string(),
    timezone: z.string().nullable(),
    providerKey: z.string().nullable(),
    providerLabel: z.string().nullable(),
    isPerMember: z.boolean(),
    managedByVirtualKeyId: z.string().nullable(),
  })
  .strict()
  .array();
export type VirtualKeyApplicableBudgets = z.infer<typeof virtualKeyApplicableBudgetsSchema>;

/**
 * The cache-rule wire row. `modeEnum` keeps its historical name — the browser
 * and the CLI read it — even though the canonical resource calls the field
 * `mode`; timestamps travel as ISO strings, matching the DTO this transport
 * has always answered with.
 */
export const gatewayCacheRuleDtoSchema = z
  .object({
    id: z.string(),
    organizationId: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    priority: z.number().int(),
    enabled: z.boolean(),
    matchers: gatewayCacheRuleMatchersSchema,
    action: gatewayCacheRuleActionSchema,
    modeEnum: z.enum(["RESPECT", "FORCE", "DISABLE"]),
    archivedAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();
export type GatewayCacheRuleDto = z.infer<typeof gatewayCacheRuleDtoSchema>;

/** The budget wire row: the stored fields plus the computed current period. */
const gatewayBudgetDtoSchema = z
  .object({
    id: z.string(),
    organizationId: z.string(),
    scopeType: z.string(),
    scopeId: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    window: z.string(),
    onBreach: z.string(),
    limitUsd: z.string(),
    spentUsd: z.string(),
    timezone: z.string().nullable(),
    providerKey: z.string().nullable(),
    currentPeriodStartedAt: z.string(),
    resetsAt: z.string(),
    cycleAnchorAt: z.string().nullable(),
    lastResetAt: z.string().nullable(),
    archivedAt: z.string().nullable(),
    createdAt: z.string(),
    endUsersSeen: z.number().nullable(),
    endUsersOver: z.number().nullable(),
  })
  .strict();

const gatewayBudgetScopeTargetSchema = z
  .object({
    kind: z.string(),
    id: z.string(),
    name: z.string(),
    secondary: z.string().nullable(),
    projectSlug: z.string().nullable().optional(),
    memberCount: z.number().optional(),
  })
  .strict();

/** One budget row, enriched with what the list and detail screens render around it. */
const gatewayBudgetEnrichedSchema = gatewayBudgetDtoSchema.extend({
  spendAvailable: z.boolean(),
  unreachableByAnyKey: z.boolean(),
  scopeTarget: gatewayBudgetScopeTargetSchema.nullable(),
  providerLabel: z.string().nullable(),
});

/** A page of budgets, with whether spend tracking itself is available at all. */
export const gatewayBudgetListSchema = z
  .object({
    spendAvailable: z.boolean(),
    budgets: z.array(gatewayBudgetEnrichedSchema),
  })
  .strict();
export type GatewayBudgetList = z.infer<typeof gatewayBudgetListSchema>;

/** One budget in full, with its recent ledger entries. */
export const gatewayBudgetDetailSchema = gatewayBudgetEnrichedSchema
  .extend({
    recentLedger: z.array(
      z
        .object({
          id: z.string(),
          virtualKeyId: z.string(),
          virtualKeyName: z.string(),
          virtualKeyPrefix: z.string(),
          amountUsd: z.string(),
          model: z.string(),
          status: z.string(),
          occurredAt: z.string(),
        })
        .strict(),
    ),
  })
  .strict();
export type GatewayBudgetDetailResponse = z.infer<typeof gatewayBudgetDetailSchema>;

/** The groups a per-member budget can target, with their sizes. */
export const gatewayBudgetGroupTargetsSchema = z
  .object({ id: z.string(), name: z.string(), memberCount: z.number() })
  .strict()
  .array();

/** A single budget, as `create`/`update`/`archive`/`reset` answer it. */
export const gatewayBudgetDtoResponseSchema = gatewayBudgetDtoSchema;

/** One spend event row, as the ledger stores it. */
export const gatewaySpendEventRowSchema = z
  .object({
    tenantId: z.string(),
    gatewayRequestId: z.string(),
    organizationId: z.string(),
    teamId: z.string(),
    virtualKeyId: z.string(),
    principalUserId: z.string(),
    endUserId: z.string(),
    traceId: z.string(),
    model: z.string(),
    providerKey: z.string(),
    requestType: z.string(),
    tokensInput: z.number(),
    tokensOutput: z.number(),
    tokensCacheRead: z.number(),
    tokensCacheWrite: z.number(),
    tokensReasoning: z.number(),
    costNanoUsd: z.number(),
    costUsd: z.string(),
    rateVersion: z.string(),
    status: z.enum(["admitted", "confirmed", "failed", "settled"]),
    errorClass: z.string(),
    httpStatus: z.number(),
    needsReconciliation: z.boolean(),
    settleReason: z.string(),
    labels: z.array(z.string()),
    metadata: z.string(),
    durationMs: z.number(),
    occurredAt: z.date(),
  })
  .strict();

/** One page of the spend-event ledger, newest first. */
export const gatewaySpendEventPageSchema = z
  .object({
    rows: z.array(gatewaySpendEventRowSchema),
    nextCursor: z
      .object({ occurredAtMs: z.number(), gatewayRequestId: z.string() })
      .strict()
      .nullable(),
    virtualKeyNames: z.record(z.string(), z.string()),
    clickHouseDisabled: z.boolean(),
  })
  .strict();
export type GatewaySpendEventPage = z.infer<typeof gatewaySpendEventPageSchema>;

const gatewayUsageByModelSchema = z
  .object({ model: z.string(), totalUsd: z.string(), requests: z.number() })
  .strict();
const gatewayUsageByDaySchema = z
  .object({ day: z.string(), totalUsd: z.string(), requests: z.number() })
  .strict();

/** The Usage page's org-wide rollup, over the caller's visible keys. */
export const gatewayUsageSummarySchema = z
  .object({
    totalUsd: z.string(),
    totalRequests: z.number(),
    blockedRequests: z.number(),
    avgUsdPerRequest: z.string(),
    byVirtualKey: z.array(
      z
        .object({
          virtualKeyId: z.string(),
          name: z.string(),
          displayPrefix: z.string(),
          totalUsd: z.string(),
          requests: z.number(),
        })
        .strict(),
    ),
    byModel: z.array(gatewayUsageByModelSchema),
    byDay: z.array(gatewayUsageByDaySchema),
  })
  .strict();
export type GatewayUsageSummary = z.infer<typeof gatewayUsageSummarySchema>;

/** One key's usage, with its 20 most recent debits. */
export const gatewayVirtualKeyUsageSummarySchema = z
  .object({
    totalUsd: z.string(),
    totalRequests: z.number(),
    blockedRequests: z.number(),
    avgUsdPerRequest: z.string(),
    byModel: z.array(gatewayUsageByModelSchema),
    byDay: z.array(gatewayUsageByDaySchema),
    recentDebits: z.array(
      z
        .object({
          id: z.string(),
          occurredAt: z.string(),
          model: z.string(),
          providerSlot: z.string().nullable(),
          amountUsd: z.string(),
          tokensInput: z.number(),
          tokensOutput: z.number(),
          durationMs: z.number().nullable(),
          status: z.string(),
        })
        .strict(),
    ),
  })
  .strict();
export type GatewayVirtualKeyUsageSummary = z.infer<typeof gatewayVirtualKeyUsageSummarySchema>;
