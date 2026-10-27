import {
  computeBucketPeriodFloorMs,
  computeBudgetPeriodFloorMs,
  currentPeriodStart,
  nanoUsdToDecimalString,
  parseSummedNanoUsd,
  PROVIDER_BUCKET_SEPARATOR,
  type GatewayBudgetLedgerStatus,
  type GatewayBudgetResource,
  type GatewayBudgetWindow,
} from "@langwatch/gateway-contract";
import { nowInstant, Temporal, type Instant } from "@langwatch/time";

import { budgetSpendTargetsFor } from "../../rules/gateway-budget-spend-targets.rules.ts";
import type {
  BucketSpend,
  BudgetBucketBoundary,
  BudgetDebitRow,
  BudgetSpendTarget,
  GatewayBudgetSpendRecord,
  GatewayBudgetSpendRepository,
  LedgerEventRow,
  PulledUsageRow,
  PulledUsageTotals,
  ScopeSpend,
} from "../gateway-budget-spend.repository.ts";

/** The scope pulled usage is filed under, which no budget can be created with. */
const PULLED_SCOPE = "pulled";
const PULLED_BUDGET_ID = "pulled";
const RECENT_EVENTS_LOOKBACK_MS = 90 * 24 * 60 * 60 * 1000;

/** One ledger row, keyed by tenant, budget and request as the table collapses them. */
type LedgerRow = {
  tenantId: string;
  budgetId: string;
  scope: string;
  scopeId: string;
  window: GatewayBudgetWindow;
  virtualKeyId: string;
  gatewayRequestId: string;
  amountNanoUsd: bigint;
  tokensInput: number;
  tokensOutput: number;
  tokensCacheRead: number;
  tokensCacheWrite: number;
  model: string;
  providerSlot: string | null;
  durationMs: number | null;
  status: GatewayBudgetLedgerStatus;
  occurredAtMs: number;
  versionMs: number;
};

/**
 * The budget ledger in memory: replays collapse to the latest version, spend
 * counts successful rows only, and a target is summed over its calendar period
 * or from its moved floor, as the rollup and the raw read answer live.
 */
export class MemoryGatewayBudgetSpendRepository implements GatewayBudgetSpendRepository {
  static create(): MemoryGatewayBudgetSpendRepository {
    return new MemoryGatewayBudgetSpendRepository();
  }

  readonly #rows = new Map<string, LedgerRow>();

  private constructor() {}

  async insertDebit(rows: BudgetDebitRow[]): Promise<void> {
    const [first] = rows;
    if (!first) return;
    assertOneRequest(rows, "insertDebit");
    const seen = [...this.#rows.values()].some(
      (row) => row.tenantId === first.tenantId && row.gatewayRequestId === first.gatewayRequestId,
    );
    if (!seen) this.#insert(rows);
  }

  async insertDebitsForBudgets(rows: BudgetDebitRow[]): Promise<void> {
    if (rows.length === 0) return;
    assertOneRequest(rows, "insertDebitsForBudgets");
    this.#insert(
      rows.filter(
        (row) => !this.#rows.has(ledgerKey(row.tenantId, row.budgetId, row.gatewayRequestId)),
      ),
    );
  }

  async insertPulledUsageRows(rows: PulledUsageRow[]): Promise<void> {
    const tenantId = rows[0]?.tenantId;
    if (rows.some((row) => row.tenantId !== tenantId)) {
      throw new Error("MemoryGatewayBudgetSpendRepository: pulled rows span multiple tenants");
    }
    for (const row of rows) {
      const requestId = `${PULLED_SCOPE}:${row.restatementKey}`;
      const key = ledgerKey(row.tenantId, PULLED_BUDGET_ID, requestId);
      const current = this.#rows.get(key);
      if (current && current.versionMs > row.observedAt.epochMilliseconds) continue;
      this.#rows.set(key, {
        tenantId: row.tenantId,
        budgetId: PULLED_BUDGET_ID,
        scope: PULLED_SCOPE,
        scopeId: row.scopeId,
        window: "TOTAL",
        virtualKeyId: "",
        gatewayRequestId: requestId,
        amountNanoUsd: BigInt(row.amountNanoUsd),
        tokensInput: row.tokensInput,
        tokensOutput: row.tokensOutput,
        tokensCacheRead: row.tokensCacheRead,
        tokensCacheWrite: row.tokensCacheWrite,
        model: row.model || "unknown",
        providerSlot: null,
        durationMs: null,
        status: "SUCCESS",
        occurredAtMs: row.occurredAt.epochMilliseconds,
        versionMs: row.observedAt.epochMilliseconds,
      });
    }
  }

  async readPulledUsageTotals(input: {
    tenantId: string;
    scopeIds: string[];
    from: Instant;
    to: Instant;
  }): Promise<PulledUsageTotals> {
    const scopeIds = new Set(input.scopeIds);
    const items = [...this.#rows.values()].filter(
      (row) =>
        row.tenantId === input.tenantId &&
        row.scope === PULLED_SCOPE &&
        scopeIds.has(row.scopeId) &&
        row.occurredAtMs >= input.from.epochMilliseconds &&
        row.occurredAtMs < input.to.epochMilliseconds,
    );
    const nano = items.reduce((sum, row) => sum + row.amountNanoUsd, 0n);

    return {
      spentNanoUsd: parseSummedNanoUsd(nano),
      spentUsd: nanoUsdToDecimalString(nano),
      items: items.length,
      tokensInput: items.reduce((sum, row) => sum + row.tokensInput, 0),
      tokensOutput: items.reduce((sum, row) => sum + row.tokensOutput, 0),
    };
  }

  async findSpendForBudgets(
    tenantId: string,
    budgets: GatewayBudgetSpendRecord[] | BudgetSpendTarget[],
    now: Instant = nowInstant(),
  ): Promise<ScopeSpend[]> {
    return this.#targetSpend([tenantId], spendTargetsOf(budgets, now), now);
  }

  async findSpendForBudgetsAcrossTenants(
    tenantIds: string[],
    budgets: GatewayBudgetSpendRecord[] | BudgetSpendTarget[],
    now: Instant = nowInstant(),
  ): Promise<ScopeSpend[]> {
    return this.#targetSpend(tenantIds, spendTargetsOf(budgets, now), now);
  }

  async findSpendForBudgetsAcrossTenantsUntil(input: {
    tenantIds: string[];
    budgets: GatewayBudgetSpendRecord[] | BudgetSpendTarget[];
    signal: AbortSignal;
  }): Promise<ScopeSpend[]> {
    input.signal.throwIfAborted();
    const now = nowInstant();
    return this.#targetSpend(input.tenantIds, spendTargetsOf(input.budgets, now), now);
  }

  async findSpendForTargetsAcrossTenants(
    tenantIds: string[],
    targets: BudgetSpendTarget[],
    now: Instant = nowInstant(),
  ): Promise<ScopeSpend[]> {
    return this.#targetSpend(tenantIds, targets, now);
  }

  async findBucketSpendBreakdownForBudget(input: {
    budget: GatewayBudgetSpendRecord;
    tenantIds: string[];
    boundaries: BudgetBucketBoundary[];
    now: Instant;
  }): Promise<BucketSpend[]> {
    const { budget, boundaries, now } = input;
    if (input.tenantIds.length === 0) return [];
    const tenants = new Set(input.tenantIds);
    const prefix = `${budget.scopeId}:`;
    const suffix = budget.providerKey ? `${PROVIDER_BUCKET_SEPARATOR}${budget.providerKey}` : null;
    const bucketRows = this.#successful().filter(
      (row) =>
        tenants.has(row.tenantId) &&
        row.budgetId === budget.id &&
        row.scope === scopeOf(budget.scopeType) &&
        row.window === budget.window &&
        row.scopeId.startsWith(prefix) &&
        (suffix === null
          ? !row.scopeId.includes(PROVIDER_BUCKET_SEPARATOR)
          : row.scopeId.endsWith(suffix)),
    );
    const bucketFloors = new Map(
      boundaries.map((boundary) => [
        boundary.bucketScopeId,
        computeBucketPeriodFloorMs(budget, boundary.periodStartedAt, now) ??
          boundary.periodStartedAt.epochMilliseconds,
      ]),
    );
    const budgetFloorMs = computeBudgetPeriodFloorMs(budget, now);
    const periodStartMs = currentPeriodStart(budget.window, now).epochMilliseconds;
    const counts = (row: LedgerRow): boolean => {
      const bucketFloor = bucketFloors.get(row.scopeId);
      if (bucketFloor !== undefined) return row.occurredAtMs >= bucketFloor;
      if (budgetFloorMs !== undefined) return row.occurredAtMs >= budgetFloorMs;
      return periodStartOf(budget.window, row.occurredAtMs) === periodStartMs;
    };

    const spentByBucket = new Map<string, bigint>();
    for (const row of bucketRows.filter(counts)) {
      spentByBucket.set(row.scopeId, (spentByBucket.get(row.scopeId) ?? 0n) + row.amountNanoUsd);
    }
    return [...spentByBucket.entries()]
      .map(([scopeId, nano]) => ({ scopeId, ...spentFromNano(nano) }))
      .toSorted((left, right) => (left.scopeId < right.scopeId ? -1 : 1));
  }

  async recentEventsForBudget(
    tenantIds: string[],
    budgetId: string,
    limit = 20,
  ): Promise<LedgerEventRow[]> {
    const tenants = new Set(tenantIds);
    const sinceMs = nowInstant().epochMilliseconds - RECENT_EVENTS_LOOKBACK_MS;
    return [...this.#rows.values()]
      .filter(
        (row) =>
          tenants.has(row.tenantId) && row.budgetId === budgetId && row.occurredAtMs >= sinceMs,
      )
      .toSorted((left, right) => right.occurredAtMs - left.occurredAtMs)
      .slice(0, limit)
      .map((row) => ({
        id: row.gatewayRequestId,
        budgetId: row.budgetId,
        virtualKeyId: row.virtualKeyId,
        amountUsd: nanoUsdToDecimalString(row.amountNanoUsd),
        model: row.model,
        providerSlot: row.providerSlot,
        tokensInput: row.tokensInput,
        tokensOutput: row.tokensOutput,
        durationMs: row.durationMs,
        status: row.status,
        occurredAt: Temporal.Instant.fromEpochMilliseconds(row.occurredAtMs),
      }));
  }

  /** Each target's total: from its floor when the boundary moved, else over its calendar period. */
  #targetSpend(tenantIds: string[], targets: BudgetSpendTarget[], now: Instant): ScopeSpend[] {
    if (targets.length === 0 || tenantIds.length === 0) return [];
    const tenants = new Set(tenantIds);
    const rows = this.#successful().filter((row) => tenants.has(row.tenantId));

    return targets.map((target) => {
      const periodStartMs = currentPeriodStart(target.window, now).epochMilliseconds;
      const nano = rows
        .filter(
          (row) =>
            row.window === target.window &&
            matchesTarget(row, target) &&
            (target.periodFloorMs === undefined
              ? periodStartOf(target.window, row.occurredAtMs) === periodStartMs
              : row.occurredAtMs >= target.periodFloorMs),
        )
        .reduce((sum, row) => sum + row.amountNanoUsd, 0n);
      return {
        budgetId: target.budgetId,
        scope: target.scope,
        scopeId: target.scopeId,
        ...spentFromNano(nano),
      };
    });
  }

  #successful(): LedgerRow[] {
    return [...this.#rows.values()].filter((row) => row.status === "SUCCESS");
  }

  #insert(rows: BudgetDebitRow[]): void {
    const versionMs = nowInstant().epochMilliseconds;
    for (const row of rows) {
      this.#rows.set(ledgerKey(row.tenantId, row.budgetId, row.gatewayRequestId), {
        tenantId: row.tenantId,
        budgetId: row.budgetId,
        scope: scopeOf(row.scope),
        scopeId: row.scopeId,
        window: row.window,
        virtualKeyId: row.virtualKeyId,
        gatewayRequestId: row.gatewayRequestId,
        amountNanoUsd: BigInt(row.amountNanoUsd),
        tokensInput: row.tokensInput,
        tokensOutput: row.tokensOutput,
        tokensCacheRead: row.tokensCacheRead,
        tokensCacheWrite: row.tokensCacheWrite,
        model: row.model,
        providerSlot: row.providerSlot || null,
        durationMs: row.durationMs ? row.durationMs : null,
        status: row.status,
        occurredAtMs: row.occurredAt.epochMilliseconds,
        versionMs,
      });
    }
  }
}

function assertOneRequest(rows: BudgetDebitRow[], operation: string): void {
  const [first] = rows;
  if (rows.some((row) => row.tenantId !== first?.tenantId)) {
    throw new Error(`MemoryGatewayBudgetSpendRepository.${operation}: rows span multiple tenants`);
  }
  if (rows.some((row) => row.gatewayRequestId !== first?.gatewayRequestId)) {
    throw new Error(
      `MemoryGatewayBudgetSpendRepository.${operation}: rows span multiple gateway_request_ids`,
    );
  }
}

function ledgerKey(tenantId: string, budgetId: string, gatewayRequestId: string): string {
  return JSON.stringify([tenantId, budgetId, gatewayRequestId]);
}

/** Whether a row is one of the target's buckets: one exactly, or every one under its anchor. */
function matchesTarget(row: LedgerRow, target: BudgetSpendTarget): boolean {
  if (row.budgetId !== target.budgetId || row.scope !== scopeOf(target.scope)) return false;
  if (target.match !== "prefix") return row.scopeId === target.scopeId;
  if (!row.scopeId.startsWith(target.scopeId)) return false;
  return target.bucketSuffix
    ? row.scopeId.endsWith(target.bucketSuffix)
    : !row.scopeId.includes(PROVIDER_BUCKET_SEPARATOR);
}

function periodStartOf(window: GatewayBudgetWindow, occurredAtMs: number): number {
  return currentPeriodStart(window, Temporal.Instant.fromEpochMilliseconds(occurredAtMs))
    .epochMilliseconds;
}

function spendTargetsOf(
  input: GatewayBudgetSpendRecord[] | BudgetSpendTarget[],
  now: Instant,
): BudgetSpendTarget[] {
  return isTargetList(input) ? input : budgetSpendTargetsFor({ budgets: input, now });
}

/** Whether a caller handed explicit bucket targets rather than budget rows; empty is either. */
function isTargetList(
  input: GatewayBudgetSpendRecord[] | BudgetSpendTarget[],
): input is BudgetSpendTarget[] {
  const first = input[0];
  return first === undefined || "budgetId" in first;
}

function spentFromNano(nano: bigint): { spentNanoUsd: number; spentUsd: string } {
  return { spentNanoUsd: parseSummedNanoUsd(nano), spentUsd: nanoUsdToDecimalString(nano) };
}

/** The ledger's spelling of a budget scope. */
function scopeOf(scope: GatewayBudgetResource["scopeType"]): string {
  switch (scope) {
    case "ORGANIZATION":
      return "org";
    case "TEAM":
      return "team";
    case "PROJECT":
      return "project";
    case "VIRTUAL_KEY":
      return "virtual_key";
    case "PRINCIPAL":
      return "principal";
    case "GROUP":
      return "group";
    case "ATTRIBUTED_USER":
      return "attributed_user";
  }
}
