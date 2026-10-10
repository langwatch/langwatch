import type {
  GatewayBudgetDebitRow,
  GatewayBudgetScopeType,
  GatewayBudgetWindow,
} from "@langwatch/gateway-contract";
import type { Instant } from "@langwatch/time";

export type GatewayBudgetSpendRecord = {
  id: string;
  scopeType: GatewayBudgetScopeType;
  scopeId: string;
  window: GatewayBudgetWindow;
  providerKey: string | null;
  currentPeriodStartedAt: Instant;
  lastResetAt: Instant | null;
  cycleAnchorAt: Instant | null;
};

export type BudgetBucketBoundary = {
  bucketScopeId: string;
  periodStartedAt: Instant;
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
  occurredAt: Instant;
};

export type BudgetDebitRow = GatewayBudgetDebitRow;

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
  occurredAt: Instant;
  observedAt: Instant;
};

export type PulledUsageTotals = {
  spentNanoUsd: number;
  spentUsd: string;
  items: number;
  tokensInput: number;
  tokensOutput: number;
};

export interface GatewayBudgetSpendRepository {
  insertDebit(rows: BudgetDebitRow[]): Promise<void>;
  insertPulledUsageRows(rows: PulledUsageRow[]): Promise<void>;
  readPulledUsageTotals(input: {
    tenantId: string;
    scopeIds: string[];
    from: Instant;
    to: Instant;
  }): Promise<PulledUsageTotals>;
  insertDebitsForBudgets(rows: BudgetDebitRow[]): Promise<void>;
  findSpendForBudgets(
    tenantId: string,
    budgets: GatewayBudgetSpendRecord[] | BudgetSpendTarget[],
    now?: Instant,
  ): Promise<ScopeSpend[]>;
  findSpendForBudgetsAcrossTenants(
    tenantIds: string[],
    budgets: GatewayBudgetSpendRecord[] | BudgetSpendTarget[],
    now?: Instant,
  ): Promise<ScopeSpend[]>;
  /** The same read, abandoned (retries included) when `signal` aborts. */
  findSpendForBudgetsAcrossTenantsUntil(input: {
    tenantIds: string[];
    budgets: GatewayBudgetSpendRecord[] | BudgetSpendTarget[];
    signal: AbortSignal;
  }): Promise<ScopeSpend[]>;

  findSpendForTargetsAcrossTenants(
    tenantIds: string[],
    targets: BudgetSpendTarget[],
    now?: Instant,
  ): Promise<ScopeSpend[]>;

  findBucketSpendBreakdownForBudget(input: {
    budget: GatewayBudgetSpendRecord;
    tenantIds: string[];
    boundaries: BudgetBucketBoundary[];
    now: Instant;
  }): Promise<BucketSpend[]>;

  recentEventsForBudget(
    tenantIds: string[],
    budgetId: string,
    limit: number,
  ): Promise<LedgerEventRow[]>;
}
