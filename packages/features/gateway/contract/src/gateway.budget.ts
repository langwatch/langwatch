import { z } from "zod";

const identifierSchema = z.string().trim().min(1);
const moneySchema = z.union([
  z.number().finite(),
  z.string().trim().min(1),
]);

/** The request-time preflight check used by the Gateway and compatibility APIs. */
export const gatewayBudgetCheckInputSchema = z.object({
  organizationId: identifierSchema,
  teamId: identifierSchema.nullable(),
  projectId: identifierSchema.nullable(),
  virtualKeyId: identifierSchema,
  principalUserId: identifierSchema.nullable().optional(),
  projectedCostUsd: moneySchema,
  providerKey: identifierSchema.nullable().optional(),
}).strict();

export type GatewayBudgetCheckInput = z.infer<
  typeof gatewayBudgetCheckInputSchema
>;

const budgetWarningSchema = z.object({
  scope: z.string(),
  pctUsed: z.number().finite(),
  limitUsd: z.string(),
}).strict();

const blockedBudgetSchema = z.object({
  budgetId: identifierSchema,
  scope: z.string(),
  scopeId: identifierSchema,
  window: z.string(),
  limitUsd: z.string(),
  spentUsd: z.string(),
}).strict();

const budgetScopeSpendSchema = z.object({
  scope: z.string(),
  scopeId: identifierSchema,
  window: z.string(),
  spentUsd: z.string(),
  limitUsd: z.string(),
}).strict();

export const gatewayBudgetCheckResultSchema = z.object({
  decision: z.enum(["allow", "soft_warn", "hard_block"]),
  warnings: z.array(budgetWarningSchema),
  blockReason: z.string().nullable(),
  blockedBy: z.array(blockedBudgetSchema),
  scopes: z.array(budgetScopeSpendSchema),
}).strict();

export type GatewayBudgetCheckResult = z.infer<
  typeof gatewayBudgetCheckResultSchema
>;

export type GatewayBudgetScopeType =
  | "ORGANIZATION"
  | "TEAM"
  | "PROJECT"
  | "VIRTUAL_KEY"
  | "PRINCIPAL"
  | "GROUP"
  | "ATTRIBUTED_USER";

export type GatewayBudgetWindow =
  | "MINUTE"
  | "HOUR"
  | "DAY"
  | "WEEK"
  | "MONTH"
  | "TOTAL"
  | "MANUAL";

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
  limitUsd: { toString(): string };
  onBreach: "BLOCK" | "WARN";
  timezone: string | null;
  externalId: string | null;
  metadata: unknown;
  spentUsd: { toString(): string };
  currentPeriodStartedAt: Date;
  resetsAt: Date;
  lastResetAt: Date | null;
  cycleAnchorAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  createdById: string;
  managedByVirtualKeyId: string | null;
};

export type GatewayBudgetWithSeats = GatewayBudgetResource & {
  spentNanoUsd?: number;
  endUsersSeen?: number;
  endUsersOver?: number;
};

export type GatewayBudgetListWithHealth = {
  budgets: GatewayBudgetWithSeats[];
  spendAvailable: boolean;
  readAt: Date;
  scopeReach: Map<string, {
    budgetId: string;
    reachable: boolean;
    reachableProjectIds: string[];
  }>;
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
  cycleAnchorAt?: Date | null;
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

const dateOrIsoSchema = z.union([
  z.date(),
  z.string().datetime({ offset: true }).transform((value) => new Date(value)),
]);

export const createGatewayBudgetInputSchema = z.object({
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
}).strict();

export const updateGatewayBudgetInputSchema = z.object({
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
}).strict();

export const resetGatewayBudgetInputSchema = z.object({
  id: identifierSchema,
  organizationId: identifierSchema,
  actorUserId: identifierSchema,
  endUserId: identifierSchema.nullable().optional(),
  reason: z.string().nullable().optional(),
}).strict();

export type GatewayBudgetPageInput = {
  organizationId: string;
  limit: number;
  cursor: { createdAt: Date; id: string } | null;
  scopeTypes?: GatewayBudgetScopeType[];
  externalId?: string;
};

export type GatewayBudgetHealth = {
  budget: GatewayBudgetWithSeats;
  spendAvailable: boolean;
  readAt: Date;
  unreachableByAnyKey: boolean;
};

/**
 * Gateway's first extracted capability is the budget preflight. Keeping this
 * as the service boundary means tRPC, REST, RPC, the CLI route, and the Go
 * gateway all use the same decision and response shape while the remaining
 * key, routing, usage, and guardrail surfaces migrate behind this service.
 */
export abstract class GatewayService {
  abstract checkBudget(
    input: GatewayBudgetCheckInput,
  ): Promise<GatewayBudgetCheckResult>;

  abstract list(organizationId: string): Promise<GatewayBudgetWithSeats[]>;
  abstract listForProject(projectId: string): Promise<GatewayBudgetWithSeats[]>;
  abstract listWithHealth(
    organizationId: string,
  ): Promise<GatewayBudgetListWithHealth>;
  abstract listForProjectWithHealth(
    projectId: string,
  ): Promise<GatewayBudgetListWithHealth>;
  abstract listPageWithHealth(
    input: GatewayBudgetPageInput,
  ): Promise<GatewayBudgetListWithHealth>;
  abstract get(
    id: string,
    organizationId: string,
  ): Promise<GatewayBudgetWithSeats | null>;
  abstract getWithHealth(
    id: string,
    organizationId: string,
  ): Promise<GatewayBudgetHealth | null>;
  abstract getDetail(
    id: string,
    organizationId: string,
  ): Promise<unknown>;
  abstract scopeReach(input: unknown): Promise<unknown>;
  abstract create(
    input: CreateGatewayBudgetInput,
  ): Promise<GatewayBudgetResource>;
  abstract update(
    input: UpdateGatewayBudgetInput,
  ): Promise<GatewayBudgetResource>;
  abstract archive(
    input: ArchiveGatewayBudgetInput,
  ): Promise<GatewayBudgetResource>;
  abstract reset(input: ResetGatewayBudgetInput): Promise<GatewayBudgetResource>;
}
