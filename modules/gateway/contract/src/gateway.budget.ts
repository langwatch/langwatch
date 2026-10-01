import { fromDate, type Instant, Temporal } from "@langwatch/time";
import { z } from "zod";

const identifierSchema = z.string().trim().min(1);
const moneySchema = z.union([z.number().finite(), z.string().trim().min(1)]);

/** The request-time preflight check used by the Gateway and compatibility APIs. */
export const gatewayBudgetCheckInputSchema = z
  .object({
    organizationId: identifierSchema,
    teamId: identifierSchema.nullable(),
    projectId: identifierSchema.nullable(),
    virtualKeyId: identifierSchema,
    principalUserId: identifierSchema.nullable().optional(),
    projectedCostUsd: moneySchema,
    providerKey: identifierSchema.nullable().optional(),
  })
  .strict();

export type GatewayBudgetCheckInput = z.infer<typeof gatewayBudgetCheckInputSchema>;

const budgetWarningSchema = z
  .object({
    scope: z.string(),
    pctUsed: z.number().finite(),
    limitUsd: z.string(),
  })
  .strict();

const blockedBudgetSchema = z
  .object({
    budgetId: identifierSchema,
    scope: z.string(),
    scopeId: identifierSchema,
    window: z.string(),
    limitUsd: z.string(),
    spentUsd: z.string(),
  })
  .strict();

const budgetScopeSpendSchema = z
  .object({
    scope: z.string(),
    scopeId: identifierSchema,
    window: z.string(),
    spentUsd: z.string(),
    limitUsd: z.string(),
  })
  .strict();

export const gatewayBudgetCheckResultSchema = z
  .object({
    decision: z.enum(["allow", "soft_warn", "hard_block"]),
    warnings: z.array(budgetWarningSchema),
    blockReason: z.string().nullable(),
    blockedBy: z.array(blockedBudgetSchema),
    scopes: z.array(budgetScopeSpendSchema),
  })
  .strict();

export type GatewayBudgetCheckResult = z.infer<typeof gatewayBudgetCheckResultSchema>;

export type GatewayBudgetScopeType =
  | "ORGANIZATION"
  | "TEAM"
  | "PROJECT"
  | "VIRTUAL_KEY"
  | "PRINCIPAL"
  | "GROUP"
  | "ATTRIBUTED_USER";

export type GatewayBudgetWindow = "MINUTE" | "HOUR" | "DAY" | "WEEK" | "MONTH" | "TOTAL" | "MANUAL";

export type GatewayBudgetLedgerStatus =
  | "SUCCESS"
  | "PROVIDER_ERROR"
  | "BLOCKED_BY_GUARDRAIL"
  | "CANCELLED";

/** One budget-ledger debit row, as main's ClickHouse `insertDebit` takes it. */
export type GatewayBudgetDebitRow = {
  tenantId: string;
  budgetId: string;
  scope: GatewayBudgetScopeType;
  scopeId: string;
  window: GatewayBudgetWindow;
  virtualKeyId: string;
  providerCredentialId?: string | null;
  providerKey?: string | null;
  gatewayRequestId: string;
  amountNanoUsd: number;
  tokensInput: number;
  tokensOutput: number;
  tokensCacheRead: number;
  tokensCacheWrite: number;
  model: string;
  providerSlot?: string | null;
  durationMs?: number | null;
  status: GatewayBudgetLedgerStatus;
  occurredAt: Instant;
};

/** A spend landed outside the gateway pipeline, announced so the data plane re-reads budgets. */
export type GatewayBudgetChangeInput = Readonly<{
  organizationId: string;
  projectId: string;
  payload: Record<string, unknown>;
}>;

/** Decimal values stay portable without leaking a database client type. */
export type GatewayMoney = {
  toString(): string;
  toFixed(fractionDigits?: number): string;
};

/** Persistence-shaped resource type, kept DB-library-free for transports. */
export type GatewayBudgetResource = {
  id: string;
  organizationId: string;
  scopeType: GatewayBudgetScopeType;
  scopeId: string;
  providerKey: string | null;
  name: string;
  description: string | null;
  window: GatewayBudgetWindow;
  limitUsd: GatewayMoney;
  onBreach: "BLOCK" | "WARN";
  timezone: string | null;
  externalId: string | null;
  metadata: unknown;
  spentUsd: GatewayMoney;
  currentPeriodStartedAt: Instant;
  resetsAt: Instant;
  lastResetAt: Instant | null;
  cycleAnchorAt: Instant | null;
  archivedAt: Instant | null;
  createdAt: Instant;
  updatedAt: Instant;
  createdById: string;
  managedByVirtualKeyId: string | null;
};

export type GatewayBudgetWithSeats = GatewayBudgetResource & {
  spentNanoUsd?: number;
  endUsersSeen?: number;
  endUsersOver?: number;
};

/** The target dimensions used by every request, bundle, and draft-key lookup. */
export type GatewayBudgetResolutionTarget = {
  organizationId: string;
  teamId?: string | null;
  scopedTeamIds?: string[] | null;
  projectId?: string | null;
  virtualKeyId?: string | null;
  principalUserId?: string | null;
  endUserId?: string | null;
};

export type GatewayResolvedBudget = {
  budget: GatewayBudgetResource;
  bucketScopeId: string;
  principalUserId: string | null;
  groupId: string | null;
  endUserId: string | null;
};

/**
 * Wire shape for applicable budgets (virtualKeys resolve these);
 * scopeType/window/onBreach are strings to match resolver output.
 */
export type GatewayApplicableBudget = {
  id: string;
  name: string;
  scopeType: string;
  scopeId: string;
  /** Human label for the target, e.g. the team or group name. */
  scopeLabel: string;
  window: string;
  limitUsd: string;
  spentUsd: string;
  onBreach: string;
  /** Null means resets are computed in the default timezone (UTC). */
  timezone: string | null;
  /** Null when the budget counts every provider. */
  providerKey: string | null;
  /** Display name for `providerKey`, so the list can say "OpenAI only". */
  providerLabel: string | null;
  /**
   * True when the budget is per member of a group rather than a shared pot,
   * which changes what its limit means to the person reading.
   */
  isPerMember: boolean;
  /**
   * Set when this row is the budget a key's drawer field manages: the edit
   * drawer seeds from it and hides it from the inherited list. Independently
   * created key-targeted budgets still show as inherited constraints.
   */
  managedByVirtualKeyId: string | null;
};

/**
 * Wire shape for the budget a key carries, with period spend; distinct from
 * calendar-month spend (e.g., daily caps measure against today).
 */
export type GatewayVirtualKeyDirectBudget = {
  budgetId: string;
  window: GatewayBudgetWindow;
  limitUsd: string;
  /** Null when the rollup could not be read: unknown, not zero. */
  periodSpentUsd: string | null;
  /** End of the period the spend is measured over, ISO-8601. */
  resetsAt: string;
};

export type GatewayBudgetScopeTarget = {
  kind: string;
  id: string;
  name: string;
  secondary: string | null;
  projectSlug?: string | null;
  memberCount?: number;
};

/**
 * The key format of the map the budget-decision scope-target read answers,
 * kept beside its value type so every caller builds the same key — a second
 * spelling of `${scopeType}:${scopeId}` anywhere would silently miss lookups.
 */
export function scopeTargetKey(scopeType: string, scopeId: string): string {
  return `${scopeType}:${scopeId}`;
}

export type GatewayBudgetScopeReachInput = {
  organizationId: string;
  scope: {
    scopeType: GatewayBudgetScopeType;
    scopeId: string;
  };
};

export type GatewayBudgetScopeReachResult = {
  reachable: boolean;
  reachableProjectIds: string[];
  activeKeyCount: number;
};

export type GatewayBudgetListWithHealth = {
  budgets: GatewayBudgetWithSeats[];
  spendAvailable: boolean;
  readAt: Instant;
  scopeReach: Map<
    string,
    {
      budgetId: string;
      reachable: boolean;
      reachableProjectIds: string[];
    }
  >;
};

export type GatewayBudgetPageWithHealth = GatewayBudgetListWithHealth & { total: number };

export type GatewayBudgetDetail = {
  budget: GatewayBudgetWithSeats;
  scopeTarget: GatewayBudgetScopeTarget;
  recentLedger: {
    id: string;
    virtualKeyId: string;
    amountUsd: GatewayMoney;
    model: string;
    status: GatewayBudgetLedgerStatus;
    occurredAt: Instant;
    virtualKey: { name: string; displayPrefix: string } | null;
  }[];
  spendAvailable: boolean;
  unreachableByAnyKey: boolean;
};

export type GatewayBudgetScope =
  | { kind: "ORGANIZATION"; organizationId: string }
  | { kind: "TEAM"; teamId: string }
  | { kind: "PROJECT"; projectId: string }
  | { kind: "VIRTUAL_KEY"; virtualKeyId: string }
  | { kind: "PRINCIPAL"; principalUserId: string }
  | { kind: "GROUP"; groupId: string }
  | {
      kind: "ATTRIBUTED_USER";
      anchorVirtualKeyId?: string;
      anchorProjectId?: string;
    };

export type CreateGatewayBudgetInput = {
  organizationId: string;
  scope: GatewayBudgetScope;
  name: string;
  description?: string | null;
  window: GatewayBudgetWindow;
  limitUsd: number | string | { toString(): string };
  onBreach?: "BLOCK" | "WARN";
  timezone?: string | null;
  providerKey?: string | null;
  externalId?: string | null;
  metadata?: Record<string, string>;
  cycleAnchorAt?: Instant | null;
  allowUnreachable?: boolean;
  actorUserId: string;
};

export type UpdateGatewayBudgetInput = {
  id: string;
  organizationId: string;
  name?: string;
  description?: string | null;
  limitUsd?: number | string | { toString(): string };
  onBreach?: "BLOCK" | "WARN";
  timezone?: string | null;
  externalId?: string | null;
  metadata?: Record<string, string>;
  actorUserId: string;
};

export type ArchiveGatewayBudgetInput = {
  id: string;
  organizationId: string;
  actorUserId: string;
};

export type ResetGatewayBudgetInput = {
  id: string;
  organizationId: string;
  actorUserId: string;
  endUserId?: string | null;
  reason?: string | null;
};

const gatewayBudgetScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ORGANIZATION"), organizationId: identifierSchema }),
  z.object({ kind: z.literal("TEAM"), teamId: identifierSchema }),
  z.object({ kind: z.literal("PROJECT"), projectId: identifierSchema }),
  z.object({ kind: z.literal("VIRTUAL_KEY"), virtualKeyId: identifierSchema }),
  z.object({ kind: z.literal("PRINCIPAL"), principalUserId: identifierSchema }),
  z.object({ kind: z.literal("GROUP"), groupId: identifierSchema }),
  z.object({
    kind: z.literal("ATTRIBUTED_USER"),
    anchorVirtualKeyId: identifierSchema.optional(),
    anchorProjectId: identifierSchema.optional(),
  }),
]);

const gatewayBudgetWindowSchema = z.enum([
  "MINUTE",
  "HOUR",
  "DAY",
  "WEEK",
  "MONTH",
  "TOTAL",
  "MANUAL",
]);

// The wire keeps carrying a Date or an offset-bearing ISO string; the instant
// is what every layer above reads, and what a caller already holding one sends.
const dateOrIsoSchema = z.union([
  z.instanceof(Temporal.Instant),
  z.date().transform(fromDate),
  z
    .string()
    .datetime({ offset: true })
    .transform((value) => Temporal.Instant.from(value)),
]);

export const createGatewayBudgetInputSchema = z
  .object({
    organizationId: identifierSchema,
    scope: gatewayBudgetScopeSchema,
    name: z.string().min(1).max(128),
    description: z.string().nullable().optional(),
    window: gatewayBudgetWindowSchema,
    limitUsd: moneySchema,
    onBreach: z.enum(["BLOCK", "WARN"]).optional(),
    timezone: z.string().nullable().optional(),
    providerKey: identifierSchema.nullable().optional(),
    externalId: identifierSchema.nullable().optional(),
    metadata: z.record(z.string(), z.string()).optional(),
    cycleAnchorAt: dateOrIsoSchema.nullable().optional(),
    allowUnreachable: z.boolean().optional(),
    actorUserId: identifierSchema,
  })
  .strict();

export const updateGatewayBudgetInputSchema = z
  .object({
    id: identifierSchema,
    organizationId: identifierSchema,
    name: z.string().min(1).max(128).optional(),
    description: z.string().nullable().optional(),
    limitUsd: moneySchema.optional(),
    onBreach: z.enum(["BLOCK", "WARN"]).optional(),
    timezone: z.string().nullable().optional(),
    externalId: identifierSchema.nullable().optional(),
    metadata: z.record(z.string(), z.string()).optional(),
    actorUserId: identifierSchema,
  })
  .strict();

export const resetGatewayBudgetInputSchema = z
  .object({
    id: identifierSchema,
    organizationId: identifierSchema,
    actorUserId: identifierSchema,
    endUserId: identifierSchema.nullable().optional(),
    reason: z.string().nullable().optional(),
  })
  .strict();

export type GatewayBudgetPageInput = {
  organizationId: string;
  limit: number;
  cursor: { createdAt: Instant; id: string } | null;
  scopeTypes?: GatewayBudgetScopeType[];
  externalId?: string;
};

export type GatewayBudgetHealth = {
  budget: GatewayBudgetWithSeats;
  spendAvailable: boolean;
  readAt: Instant;
  unreachableByAnyKey: boolean;
};

/**
 * Wire inputs for gatewayBudgets.* tRPC surface; separate from service schemas
 * to preserve endpoint contract.
 */
const gatewayBudgetApiScopeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("ORGANIZATION"),
    organizationId: z.string(),
  }),
  z.object({ kind: z.literal("TEAM"), teamId: z.string() }),
  z.object({ kind: z.literal("PROJECT"), projectId: z.string() }),
  z.object({ kind: z.literal("VIRTUAL_KEY"), virtualKeyId: z.string() }),
  z.object({ kind: z.literal("PRINCIPAL"), principalUserId: z.string() }),
  // Per-member group budgets. Creation is service-guarded: it needs
  // the ClickHouse spend path (group_budget_requires_clickhouse otherwise).
  z.object({ kind: z.literal("GROUP"), groupId: z.string() }),
]);

/** One organization, for the reads scoped to a whole tenant. */
export const gatewayBudgetApiOrganizationInputSchema = z.object({ organizationId: z.string() });

/** One project, for the read a project's own screens make. */
export const gatewayBudgetApiProjectInputSchema = z.object({ projectId: z.string() });

/** One budget inside one organization. */
export const gatewayBudgetApiBudgetInputSchema = z.object({
  organizationId: z.string(),
  id: z.string(),
});

export const gatewayBudgetApiCreateInputSchema = z.object({
  organizationId: z.string(),
  scope: gatewayBudgetApiScopeSchema,
  name: z.string().min(1).max(128),
  description: z.string().optional(),
  window: z.enum(["MINUTE", "HOUR", "DAY", "WEEK", "MONTH", "TOTAL", "MANUAL"]),
  limitUsd: z.number().positive().or(z.string()),
  onBreach: z.enum(["BLOCK", "WARN"]).optional(),
  timezone: z.string().nullable().optional(),
  // ModelProvider row id. Null / absent = the budget counts every
  // provider; set = it counts and constrains only that provider.
  providerKey: z.string().nullable().optional(),
  // Phases cyclic window off this instant (rejected on TOTAL/MANUAL).
  // Must be Date or ISO string with offset, not offsetless.
  cycleAnchorAt: z
    .union([
      z.instanceof(Temporal.Instant),
      z.date().transform(fromDate),
      z
        .string()
        .datetime({ offset: true })
        .transform((iso) => Temporal.Instant.from(iso)),
    ])
    .nullable()
    .optional(),
  // Keeps a team / project / group budget no active key can reach,
  // which is otherwise refused. Provisioning ahead of the keys that
  // will use it is legitimate, so the guardrail is not a prohibition.
  allowUnreachable: z.boolean().optional(),
});

export const gatewayBudgetApiUpdateInputSchema = z.object({
  organizationId: z.string(),
  id: z.string(),
  name: z.string().min(1).max(128).optional(),
  description: z.string().nullable().optional(),
  limitUsd: z.number().positive().or(z.string()).optional(),
  onBreach: z.enum(["BLOCK", "WARN"]).optional(),
  timezone: z.string().nullable().optional(),
});

export const gatewayBudgetApiResetInputSchema = z.object({
  organizationId: z.string(),
  id: z.string(),
  endUserId: z.string().optional(),
  reason: z.string().max(500).optional(),
});

export type GatewayBudgetApiOrganizationInput = z.infer<
  typeof gatewayBudgetApiOrganizationInputSchema
>;
export type GatewayBudgetApiProjectInput = z.infer<typeof gatewayBudgetApiProjectInputSchema>;
export type GatewayBudgetApiBudgetInput = z.infer<typeof gatewayBudgetApiBudgetInputSchema>;
export type GatewayBudgetApiCreateInput = z.infer<typeof gatewayBudgetApiCreateInputSchema>;
export type GatewayBudgetApiUpdateInput = z.infer<typeof gatewayBudgetApiUpdateInputSchema>;
export type GatewayBudgetApiResetInput = z.infer<typeof gatewayBudgetApiResetInputSchema>;
