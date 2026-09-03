import type {
  GatewayBudgetScopeType,
  GatewayBudgetLedgerStatus,
  GatewayBudgetWindow,
} from "@langwatch/gateway-contract";

export type GatewayBudgetSpendRecord = {
  id: string;
  scopeType: GatewayBudgetScopeType;
  scopeId: string;
  window: GatewayBudgetWindow;
  providerKey: string | null;
  currentPeriodStartedAt: Date;
  lastResetAt: Date | null;
  cycleAnchorAt: Date | null;
};

export type BudgetBucketBoundary = {
  bucketScopeId: string;
  periodStartedAt: Date;
};

export type BudgetSpendTarget = {
  budgetId: string;
  scope: GatewayBudgetScopeType;
  scopeId: string;
  window: GatewayBudgetWindow;
  match?: "exact" | "prefix";
  bucketSuffix?: string | null;
  periodFloorMs?: number;
};

export type ScopeSpend = {
  budgetId: string;
  scope: GatewayBudgetScopeType;
  scopeId: string;
  spentNanoUsd: number;
  spentUsd: string;
};

export type BucketSpend = {
  scopeId: string;
  spentNanoUsd: number;
  spentUsd: string;
};

export type LedgerEventRow = {
  id: string;
  budgetId: string;
  virtualKeyId: string;
  amountUsd: string;
  model: string;
  providerSlot: string | null;
  tokensInput: number;
  tokensOutput: number;
  durationMs: number | null;
  status: "SUCCESS" | "PROVIDER_ERROR" | "BLOCKED_BY_GUARDRAIL" | "CANCELLED";
  occurredAt: Date;
};

export type BudgetDebitRow = {
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
  occurredAt: Date;
};

export type PulledUsageRow = {
  tenantId: string;
  scopeId: string;
  restatementKey: string;
  amountNanoUsd: number;
  tokensInput: number;
  tokensOutput: number;
  tokensCacheRead: number;
  tokensCacheWrite: number;
  model: string;
  providerKey?: string | null;
  occurredAt: Date;
  observedAt: Date;
};

export type PulledUsageTotals = {
  spentNanoUsd: number;
  spentUsd: string;
  items: number;
  tokensInput: number;
  tokensOutput: number;
};

export abstract class GatewayBudgetSpendPort {
  abstract insertDebit(rows: BudgetDebitRow[]): Promise<void>;
  abstract insertPulledUsageRows(rows: PulledUsageRow[]): Promise<void>;
  abstract readPulledUsageTotals(input: {
    tenantId: string;
    scopeIds: string[];
    from: Date;
    to: Date;
  }): Promise<PulledUsageTotals>;
  abstract insertDebitsForBudgets(rows: BudgetDebitRow[]): Promise<void>;
  abstract getSpendForBudgets(
    tenantId: string,
    budgets: GatewayBudgetSpendRecord[] | BudgetSpendTarget[],
    now?: Date,
  ): Promise<ScopeSpend[]>;
  abstract getSpendForBudgetsAcrossTenants(
    tenantIds: string[],
    budgets: GatewayBudgetSpendRecord[] | BudgetSpendTarget[],
    now?: Date,
  ): Promise<ScopeSpend[]>;

  abstract getSpendForTargetsAcrossTenants(
    tenantIds: string[],
    targets: BudgetSpendTarget[],
    now?: Date,
  ): Promise<ScopeSpend[]>;

  abstract getBucketSpendBreakdownForBudget(input: {
    budget: GatewayBudgetSpendRecord;
    tenantIds: string[];
    boundaries: BudgetBucketBoundary[];
    now: Date;
  }): Promise<BucketSpend[]>;

  abstract recentEventsForBudget(
    tenantIds: string[],
    budgetId: string,
    limit: number,
  ): Promise<LedgerEventRow[]>;
}
