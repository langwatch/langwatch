import {
  bucketScopeIdFor,
  budgetPeriodFloorMs,
  PROVIDER_BUCKET_SEPARATOR,
  type GatewayBudgetLedgerStatus,
  type GatewayBudgetResource,
  type GatewayBudgetScopeType,
  type GatewayBudgetWindow,
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
  /**
   * Read targets for a plain list of budgets, with no request context. A
   * GROUP budget has no single member here, so it sums every member bucket.
   *
   * `now` is the instant the periods are resolved at, and it is the same one
   * the rollup read uses. Passing it here rather than letting each floor read
   * the wall clock is what makes an injected clock mean one thing across both
   * halves of the read; an anchored budget in particular has a floor that
   * moves with the clock, so the two halves would otherwise disagree about
   * which period they are totalling.
   */
  static targetsForBudgets({
    budgets,
    now = new Date(),
  }: {
    budgets: GatewayBudgetResource[];
    now?: Date;
  }): BudgetSpendTarget[] {
    return budgets.map((b) =>
      b.scopeType === "GROUP"
        ? {
            budgetId: b.id,
            scope: b.scopeType,
            // The member id sits between the group prefix and the provider
            // suffix, so a provider-filtered group budget cannot be a plain
            // prefix target: the prefix is the bare group, and the provider
            // filter anchors the suffix instead.
            scopeId: `${b.scopeId}:`,
            window: b.window,
            match: "prefix" as const,
            bucketSuffix: b.providerKey ? `${PROVIDER_BUCKET_SEPARATOR}${b.providerKey}` : null,
            // MANUAL windows, anchored cycles and mid-period resets all move
            // the boundary; the list must total the CURRENT period, same as
            // enforcement does.
            periodFloorMs: budgetPeriodFloorMs(b, now),
          }
        : {
            budgetId: b.id,
            scope: b.scopeType,
            scopeId: bucketScopeIdFor(b, b.scopeId),
            window: b.window,
            match: "exact" as const,
            periodFloorMs: budgetPeriodFloorMs(b, now),
          },
    );
  }

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
