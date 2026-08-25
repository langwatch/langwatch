import type { GatewayBudget, GatewayBudgetLedgerStatus } from "@langwatch/prisma-client/generated";

export type BudgetBucketBoundary = {
  bucketScopeId: string;
  periodStartedAt: Date;
};

export type BudgetSpendTarget = {
  budgetId: string;
  scope: GatewayBudget["scopeType"];
  scopeId: string;
  window: GatewayBudget["window"];
  match?: "exact" | "prefix";
  bucketSuffix?: string | null;
  periodFloorMs?: number;
};

export type ScopeSpend = {
  budgetId: string;
  scope: GatewayBudget["scopeType"];
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
  status: GatewayBudgetLedgerStatus;
  occurredAt: Date;
};

export abstract class GatewayBudgetClickHouseRepository {
  abstract getSpendForBudgetsAcrossTenants(
    tenantIds: string[],
    budgets: GatewayBudget[] | BudgetSpendTarget[],
    now?: Date,
  ): Promise<ScopeSpend[]>;

  abstract getBucketSpendBreakdownForBudget(input: {
    budget: GatewayBudget;
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
