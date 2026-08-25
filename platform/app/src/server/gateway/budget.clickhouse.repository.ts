/**
 * The gateway budget ledger in ClickHouse.
 *
 * Replaces the old PG `GatewayBudgetLedger.create` + `GatewayBudget.spentUsd`
 * counter path. The gateway does not POST debits: it emits spend commands
 * for every request, and the debits process manager on the gateway-spend
 * pipeline calls `insertDebitsForBudgets` here once per applicable budget.
 * It is the only writer of these tables.
 *
 * Tables:
 *   - gateway_budget_ledger_events      — ReplacingMergeTree, idempotent by
 *                                         (TenantId, BudgetId, GatewayRequestId)
 *     That key means "one debit per budget per request" and carries no
 *     bucket: a budget can own many buckets (GROUP one per member,
 *     ATTRIBUTED_USER one per end user), a request resolves exactly one of
 *     them, and two writers disagreeing about which would not produce two
 *     rows but collapse to one, filing the spend under whichever bucket
 *     won. Single-writer ownership is what keeps bucket filing correct.
 *   - gateway_budget_scope_totals       — AggregatingMergeTree rollup per
 *                                         (scope, scope_id, window,
 *                                          period_start, budget_id)
 *   - gateway_budget_scope_totals_mv    — MV feeding the rollup from events
 *
 * The rollup carries the budget because the ledger does. One request that
 * resolves a hard cap and a soft cap on the same virtual key writes two
 * rows under the same scope, scope id and window, each the request's true
 * cost. An aggregate that dropped the budget from its key would fold both
 * into one bucket and report every budget sharing that bucket at N times
 * what it actually spent. Every read here names its budget for the same
 * reason; see `bucketMatchSql`.
 *
 * Money is the integer nano-USD the request was priced in, carried on
 * `AmountNanoUSD` and summed there. `AmountUSD` is a `Decimal(18, 6)` that
 * cannot hold a nano figure, so it renders a single debit for the audit read
 * and is never summed: rounding each debit to a micro-USD and then adding
 * them is not the amount anybody spent, and the gap grows with request count.
 *
 * See: migration 00017_create_gateway_budget_ledger.sql
 * See: migration 00069_gateway_budget_scope_totals_budget_grain.sql
 * See: migration 00070_gateway_budget_ledger_nano_usd.sql
 * See: specs/ai-gateway/_shared/contract.md §4.5
 */

import { createLogger } from "@langwatch/observability";
import type {
  GatewayBudget,
  GatewayBudgetLedgerStatus,
  GatewayBudgetScopeType,
  GatewayBudgetWindow,
} from "~/generated/prisma/client";
import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import {
  bucketPeriodFloorMs,
  budgetPeriodFloorMs,
  currentPeriodStart,
} from "./budgetPeriod";
import { bucketScopeIdFor, PROVIDER_BUCKET_SEPARATOR } from "./budgetResolution.service";
import { parseSummedNanoUsd } from "./spendEvents.clickhouse.repository";
import { nanoUsdToDecimalString } from "./wireMoney";

const EVENTS_TABLE = "gateway_budget_ledger_events" as const;
const TOTALS_TABLE = "gateway_budget_scope_totals" as const;

/**
 * How far back the budget detail page's recent-activity panel looks. Wide
 * enough to cover several periods of the longest recurring window the
 * product offers, a month, and narrow enough that the read prunes to a
 * handful of `toYYYYMM(OccurredAt)` partitions.
 *
 * A TOTAL-window budget never resets, so its history can run past this
 * bound. The panel still shows only the last 90 days for it: it answers
 * "what has been happening lately", not "everything this budget ever
 * spent", which is what the totals on the same page are for.
 */
const RECENT_EVENTS_LOOKBACK_DAYS = 90;

const logger = createLogger("langwatch:gateway:budget-clickhouse-repository");

export type BudgetDebitRow = {
  tenantId: string;
  budgetId: string;
  scope: GatewayBudgetScopeType;
  scopeId: string;
  window: GatewayBudgetWindow;
  virtualKeyId: string;
  providerCredentialId?: string | null;
  /** ModelProvider the request was dispatched to, when the gateway said. */
  providerKey?: string | null;
  gatewayRequestId: string;
  /**
   * What the request cost, as the integer nano-USD it was priced in. The only
   * amount a caller states: the `AmountUSD` column is written from this one,
   * so the two cannot drift apart, and it is a `Decimal(18, 6)` that a nano
   * figure does not fit in, which is why it is not the one that gets summed.
   */
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

/**
 * The ledger scope pulled provider cost is written under (ADR-088).
 *
 * Non-enforcement is structural, not a flag: this string is deliberately NOT
 * a `GatewayBudgetScopeType`, so a budget under it cannot be created, and
 * every enforcement read resolves real budgets first. There is nothing to
 * remember to check.
 */
export const PULLED_USAGE_SCOPE = "pulled" as const;

/**
 * The synthetic budget id every pulled row carries. The ledger's storage key
 * is `(TenantId, BudgetId, GatewayRequestId)` and demands one; this is not a
 * cuid, so it can never equal a real `GatewayBudget.id`. Sharing one value
 * across all pulled rows also keeps them contiguous under the sorting key, so
 * the read below stays an index seek.
 */
export const PULLED_USAGE_BUDGET_ID = "pulled" as const;

/**
 * Namespaces a restatement key inside the `GatewayRequestId` column.
 *
 * `insertDebit` treats the existence of ANY row for a `(TenantId,
 * GatewayRequestId)` as proof that request was already debited, and skips.
 * Without this prefix, a restatement key that collided with a gateway ULID
 * would suppress a customer's real debit — money silently missing from
 * enforcement. The two id spaces are kept disjoint by construction instead.
 */
export function pulledRequestId(restatementKey: string): string {
  return `${PULLED_USAGE_SCOPE}:${restatementKey}`;
}

/**
 * One pulled usage item, priced. Deliberately not a `BudgetDebitRow`: there is
 * no budget, no scope type and no gateway request behind any of this.
 */
export type PulledUsageRow = {
  /** The org's hidden governance project — a storage partition, not the
   *  attribution. Who the money belongs to is `scopeId`. */
  tenantId: string;
  /** The source's team when it has one, else its organization. */
  scopeId: string;
  /** Dimension-only; cost and quantities excluded, so a correction matches. */
  restatementKey: string;
  amountNanoUsd: number;
  tokensInput: number;
  tokensOutput: number;
  tokensCacheRead: number;
  tokensCacheWrite: number;
  model: string;
  providerKey?: string | null;
  /** The provider's business bucket time. Stable under restatement. */
  occurredAt: Date;
  /** Monotonic pull time — the ReplacingMergeTree version column. */
  observedAt: Date;
};

/** What a scope spent outside the gateway, over a window. */
export type PulledUsageTotals = {
  /** The exact total, in the nano-USD integer the items were priced in. */
  spentNanoUsd: number;
  /** The same total as its display string, derived from `spentNanoUsd`. */
  spentUsd: string;
  /** How many distinct usage items, after restatements collapse. */
  items: number;
  tokensInput: number;
  tokensOutput: number;
};

export type ScopeSpend = {
  budgetId: string;
  scope: GatewayBudgetScopeType;
  scopeId: string;
  /** The exact total, in the nano-USD integer the debits were priced in. */
  spentNanoUsd: number;
  /** The same total as its display string, derived from `spentNanoUsd`. */
  spentUsd: string;
};

/** One bucket of a fanned-out budget and what it has spent this period. */
export type BucketSpend = {
  scopeId: string;
  /** The exact total, in the nano-USD integer the debits were priced in. */
  spentNanoUsd: number;
  /** The same total as its display string, derived from `spentNanoUsd`. */
  spentUsd: string;
};

/**
 * A per-bucket period boundary, as stored on `GatewayBudgetBucketBoundary`.
 * Callers batch-load these so the read stays one round-trip per budget.
 */
export type BudgetBucketBoundary = {
  bucketScopeId: string;
  periodStartedAt: Date;
};

/**
 * One budget's read target. `scopeId` is the ledger bucket, not the
 * budget's target: a provider-filtered budget and a per-member GROUP
 * allowance each accrue under their own key (see `bucketScopeIdFor` /
 * `groupBucketScopeId`). `match: "prefix"` sums every bucket under the
 * key, which is how a GROUP budget reports what a whole group has
 * spent when no single member is in context.
 */
export type BudgetSpendTarget = {
  budgetId: string;
  scope: GatewayBudgetScopeType;
  scopeId: string;
  window: GatewayBudgetWindow;
  match?: "exact" | "prefix";
  /**
   * Only meaningful with `match: "prefix"`. A string anchors the bucket's
   * provider suffix (`|provider:<key>`) so a provider-filtered group
   * budget matches its own buckets; null/undefined requires the bucket to
   * carry NO provider suffix, so an unfiltered group budget does not
   * absorb a filtered sibling's buckets on the same group.
   */
  bucketSuffix?: string | null;
  /**
   * Lower bound (unix ms) for the spend read when the budget's period
   * boundary is NOT the calendar one: always set for MANUAL windows
   * (currentPeriodStartedAt) and set on calendar windows after a
   * mid-period reset (until the next calendar boundary passes). Targets
   * with a floor read the raw ledger events bounded by OccurredAt instead
   * of the rollup's PeriodStart-equality fast path, which cannot see a
   * moved boundary.
   */
  periodFloorMs?: number;
};

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
export function spendTargetsForBudgets({
  budgets,
  now = new Date(),
}: {
  budgets: GatewayBudget[];
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
          bucketSuffix: b.providerKey
            ? `${PROVIDER_BUCKET_SEPARATOR}${b.providerKey}`
            : null,
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

/**
 * Read-shape for ledger events. Mirrors the columns previously read off
 * the PG `GatewayBudgetLedger` table, scoped to whatever the caller needs
 * (one VK, one budget, or all VKs in a project). All fields use the same
 * names as the equivalent Prisma row so call sites can be migrated with
 * minimal shape juggling.
 */
export type LedgerEventRow = {
  id: string; // GatewayRequestId — unique within (tenant, budget)
  budgetId: string;
  virtualKeyId: string;
  amountUsd: string; // Decimal-as-string
  model: string;
  providerSlot: string | null;
  tokensInput: number;
  tokensOutput: number;
  durationMs: number | null;
  status: GatewayBudgetLedgerStatus;
  occurredAt: Date;
};

/**
 * Raw shape of a per-bucket spend row, in the ledger's column casing.
 *
 * ClickHouse serializes an `Int64` sum as a string, which is what keeps a
 * money total past 2^53 from arriving already rounded.
 */
type BucketSpendRow = { ScopeId: string; SpentNanoUSD: string };

/** Raw shape of a rollup total row, in the rollup's column casing. */
type RollupScopeRow = {
  BudgetId: string;
  Scope: string;
  ScopeId: string;
  SpentNanoUSD: string;
};

type ClickHouseClientFor = Awaited<ReturnType<ClickHouseClientResolver>>;

/** The `TenantId IN (...)` placeholder list a read across tenants binds. */
function tenantPlaceholders(tenantIds: string[]): string {
  return tenantIds.map((_, i) => `{tenant${i}:String}`).join(",");
}

/** The parameters `tenantPlaceholders` refers to. */
function tenantParams(tenantIds: string[]): Record<string, string> {
  const params: Record<string, string> = {};
  for (let i = 0; i < tenantIds.length; i++) {
    params[`tenant${i}`] = tenantIds[i]!;
  }
  return params;
}

/**
 * Everything the two per-bucket reads share: the bound parameters, the
 * predicate that selects one budget's buckets, and the per-bucket floors
 * for buckets whose own boundary has moved. Built once so the rollup path
 * and the raw-ledger path cannot drift apart on which buckets they mean.
 */
type BucketQueryShape = {
  params: Record<string, string | number | string[]>;
  tenantIds: string[];
  tenantPlaceholders: string;
  bucketFilter: string;
  /** One `ScopeId = x AND OccurredAt >= floor` term per moved boundary. */
  movedBoundaryPredicates: string[];
  movedBoundaryBuckets: string[];
  /** The template's own floor, or undefined while it sits on the calendar. */
  budgetFloorMs: number | undefined;
};

function bucketQueryShape(args: {
  budget: GatewayBudget;
  tenantIds: string[];
  boundaries: BudgetBucketBoundary[];
  now: Date;
}): BucketQueryShape {
  const { budget, tenantIds, boundaries, now } = args;
  const params: Record<string, string | number | string[]> = {
    budgetId: budget.id,
    scope: scopeToClickHouse(budget.scopeType),
    window: windowToClickHouse(budget.window),
    prefix: `${budget.scopeId}:`,
    sep: PROVIDER_BUCKET_SEPARATOR,
    ...tenantParams(tenantIds),
  };

  // A provider-filtered template writes only buckets carrying its own
  // suffix and an unfiltered one only buckets carrying none, so neither
  // ever reports the other's spend as its own.
  let providerGuard: string;
  if (budget.providerKey) {
    params.providerSuffix = `${PROVIDER_BUCKET_SEPARATOR}${budget.providerKey}`;
    providerGuard = "endsWith(ScopeId, {providerSuffix:String})";
  } else {
    providerGuard = "position(ScopeId, {sep:String}) = 0";
  }

  // A bucket whose boundary moved reads from that boundary, or from the
  // template's own floor when the template was reset more recently.
  const movedBoundaryPredicates = boundaries.map((b, i) => {
    params[`fbucket${i}`] = b.bucketScopeId;
    params[`ffloor${i}`] =
      bucketPeriodFloorMs(budget, b.periodStartedAt, now) ?? b.periodStartedAt.getTime();
    return `(ScopeId = {fbucket${i}:String} AND OccurredAt >= fromUnixTimestamp64Milli({ffloor${i}:Int64}))`;
  });
  params.flooredBuckets = boundaries.map((b) => b.bucketScopeId);

  const budgetFloorMs = budgetPeriodFloorMs(budget, now);
  if (budgetFloorMs !== undefined) params.budgetFloor = budgetFloorMs;

  return {
    params,
    tenantIds,
    tenantPlaceholders: tenantPlaceholders(tenantIds),
    // BudgetId first: a bucket is identified by its scope key, but a scope
    // key does not identify a budget. Two templates anchored on the same
    // key write into the same bucket ids, and without this the read would
    // sum both templates' rows into each one's breakdown.
    bucketFilter: `BudgetId = {budgetId:String} AND startsWith(ScopeId, {prefix:String}) AND ${providerGuard}`,
    movedBoundaryPredicates,
    movedBoundaryBuckets: boundaries.map((b) => b.bucketScopeId),
    budgetFloorMs,
  };
}

/**
 * The SQL that says a row belongs to one target: the target's own budget,
 * in a single bucket or in every bucket under the anchor carrying the
 * target's provider suffix. An unfiltered target matches only buckets
 * carrying no suffix at all, so it never absorbs a provider-filtered
 * sibling's spend.
 *
 * `BudgetId` is not redundant with the bucket. The ledger writes one row
 * per (budget, request), so a request that resolves a hard cap and a soft
 * cap on the same virtual key writes two rows carrying the same cost under
 * the same scope, scope id and window. Matching on the bucket alone sums
 * both of them into each budget, reporting every budget at N times its
 * true spend for N budgets sharing the bucket.
 */
function bucketMatchSql(
  target: BudgetSpendTarget,
  budgetIdParam: string,
  scopeIdParam: string,
  suffixParam: string,
): string {
  const budget = `BudgetId = {${budgetIdParam}:String}`;
  if (target.match !== "prefix") {
    return `${budget} AND ScopeId = {${scopeIdParam}:String}`;
  }
  const anchored = `${budget} AND startsWith(ScopeId, {${scopeIdParam}:String})`;
  return target.bucketSuffix
    ? `${anchored} AND endsWith(ScopeId, {${suffixParam}:String})`
    : `${anchored} AND position(ScopeId, {sep:String}) = 0`;
}

/**
 * One conditional sum per floored target, aliased `T<i>`, with the
 * parameters it binds. Conditioned per target rather than per bucket so two
 * budgets sharing a bucket with different boundaries each get their own
 * total.
 */
function flooredTargetSums(targets: BudgetSpendTarget[]): {
  sql: string;
  params: Record<string, string | number>;
} {
  const params: Record<string, string | number> = {
    sep: PROVIDER_BUCKET_SEPARATOR,
  };
  const sums = targets.map((t, i) => {
    params[`fbudgetId${i}`] = t.budgetId;
    params[`fscope${i}`] = scopeToClickHouse(t.scope);
    params[`fscopeId${i}`] = t.scopeId;
    params[`fwindow${i}`] = windowToClickHouse(t.window);
    params[`ffloor${i}`] = t.periodFloorMs!;
    if (t.match === "prefix" && t.bucketSuffix) {
      params[`fsuffix${i}`] = t.bucketSuffix;
    }
    const bucket = bucketMatchSql(t, `fbudgetId${i}`, `fscopeId${i}`, `fsuffix${i}`);
    return `toString(sumIf(AmountNanoUSD, Scope = {fscope${i}:String} AND ${bucket} AND Window = {fwindow${i}:String} AND OccurredAt >= fromUnixTimestamp64Milli({ffloor${i}:Int64}))) AS T${i}`;
  });
  return { sql: sums.join(",\n              "), params };
}

/**
 * The `WHERE` term selecting every target's buckets in one rollup read, with
 * the parameters it binds. Targets are OR-ed together so a single round-trip
 * answers a whole window.
 */
function rollupScopeFilter(targets: BudgetSpendTarget[]): {
  sql: string;
  params: Record<string, string | number>;
} {
  const params: Record<string, string | number> = {
    sep: PROVIDER_BUCKET_SEPARATOR,
  };
  const terms = targets.map((t, i) => {
    params[`budgetId${i}`] = t.budgetId;
    params[`scope${i}`] = scopeToClickHouse(t.scope);
    params[`scopeId${i}`] = t.scopeId;
    if (t.bucketSuffix) params[`suffix${i}`] = t.bucketSuffix;
    const bucket = bucketMatchSql(t, `budgetId${i}`, `scopeId${i}`, `suffix${i}`);
    return `(Scope = {scope${i}:String} AND ${bucket})`;
  });
  return { sql: terms.join(" OR "), params };
}

/**
 * The targets still sitting on their calendar boundary, grouped by window.
 * The rollup is keyed by period, so one round-trip answers every target that
 * shares a window.
 */
function targetsByWindow(
  targets: BudgetSpendTarget[],
): Map<GatewayBudgetWindow, BudgetSpendTarget[]> {
  const byWindow = new Map<GatewayBudgetWindow, BudgetSpendTarget[]>();
  for (const t of targets) {
    if (t.periodFloorMs !== undefined) continue;
    const list = byWindow.get(t.window) ?? [];
    list.push(t);
    byWindow.set(t.window, list);
  }
  return byWindow;
}

/** Whether a rollup row is one of this target's buckets. Mirrors `bucketMatchSql`. */
function rollupRowMatchesTarget(
  row: RollupScopeRow,
  target: BudgetSpendTarget,
  scope: string,
): boolean {
  if (row.BudgetId !== target.budgetId) return false;
  if (row.Scope !== scope) return false;
  if (target.match !== "prefix") return row.ScopeId === target.scopeId;
  if (!row.ScopeId.startsWith(target.scopeId)) return false;
  return target.bucketSuffix
    ? row.ScopeId.endsWith(target.bucketSuffix)
    : !row.ScopeId.includes(PROVIDER_BUCKET_SEPARATOR);
}

/**
 * What one target's buckets total in a rollup result. The query asks for
 * every target in the window at once, so the rows come back mixed and each
 * target picks out its own.
 *
 * The sum stays in integers. A group budget totals one row per member here,
 * and adding those as floats would put drift back into a figure the ledger
 * holds exactly.
 */
function sumRollupRowsForTarget(
  rows: RollupScopeRow[],
  target: BudgetSpendTarget,
): bigint {
  const scope = scopeToClickHouse(target.scope);
  return rows
    .filter((r) => rollupRowMatchesTarget(r, target, scope))
    .reduce((sum, r) => sum + BigInt(r.SpentNanoUSD || "0"), 0n);
}

/** One exact total, in both units the surface publishes. */
function spentFromNano(nano: bigint | string): {
  spentNanoUsd: number;
  spentUsd: string;
} {
  const exact = typeof nano === "bigint" ? nano : BigInt(nano || "0");
  return {
    spentNanoUsd: parseSummedNanoUsd(exact),
    spentUsd: nanoUsdToDecimalString(exact),
  };
}

export class GatewayBudgetClickHouseRepository {
  constructor(private readonly resolveClient: ClickHouseClientResolver) {}

  /**
   * Insert one debit row per applicable budget. Idempotency is structural at
   * the ledger table level (ReplacingMergeTree on (TenantId, BudgetId,
   * GatewayRequestId) collapses replays on merge), but the
   * gateway_budget_scope_totals materialised view aggregates at INSERT time
   * and does NOT dedup. Without a pre-insert guard, replaying the same
   * gateway_request_id multiplies the rollup totals (3 fires of $0.0125 →
   * $0.0375 enforced against the budget until the merge eventually fires,
   * which can be hours later or never if the ledger sees no further
   * activity).
   *
   * App-side dedup: skip the insert entirely if any row for this
   * (TenantId, GatewayRequestId) already exists in the ledger. The ledger
   * ORDER BY is `(TenantId, BudgetId, GatewayRequestId)` so this query
   * hits the index and is sub-millisecond. All rows in a single insertDebit
   * call share the same gateway_request_id (one debit = one request = one
   * batch covering every applicable budget) so a single existence probe
   * covers the whole batch.
   *
   * Probe-then-insert is not atomic, and that is survivable here for
   * structural reasons, not luck. The rollup MV aggregates at INSERT time
   * (a duplicate row double-counts it forever; the ReplacingMergeTree only
   * collapses the raw rows), so what actually prevents doubles:
   *
   *   1. One writer, full stop: the debits process manager on the
   *      gateway-spend pipeline is the only thing that writes this ledger,
   *      so no two writers can claim the same (budget, request) pair.
   *   2. Within that writer, execution is serialized per aggregate
   *      (process-manager streams are per-aggregate FIFO), so two fires for
   *      the same request never run concurrently; retries run after the
   *      failed attempt.
   *   3. Inserts wait for durability (wait_for_async_insert: 1), so a
   *      retry's probe sees the rows a crashed-after-insert attempt wrote.
   *
   * Residual window, accepted and named: replaying the same aggregate
   * concurrently from TWO operator sessions can land between another
   * session's probe and insert. Replay is an ops action; run one at a
   * time per aggregate.
   */
  async insertDebit(rows: BudgetDebitRow[]): Promise<void> {
    if (rows.length === 0) return;
    const tenantId = rows[0]!.tenantId;
    const gatewayRequestId = rows[0]!.gatewayRequestId;
    if (rows.some((r) => r.tenantId !== tenantId)) {
      throw new Error(
        "GatewayBudgetClickHouseRepository.insertDebit: rows span multiple tenants",
      );
    }
    if (rows.some((r) => r.gatewayRequestId !== gatewayRequestId)) {
      throw new Error(
        "GatewayBudgetClickHouseRepository.insertDebit: rows span multiple gateway_request_ids",
      );
    }

    const client = await this.resolveClient(tenantId);
    const probe = await client.query({
      query: `SELECT 1 FROM ${EVENTS_TABLE} WHERE TenantId = {tenantId:String} AND GatewayRequestId = {gatewayRequestId:String} LIMIT 1`,
      query_params: { tenantId, gatewayRequestId },
      format: "JSONEachRow",
    });
    const probeRows = (await probe.json()) as unknown[];
    if (probeRows.length > 0) {
      logger.debug(
        { tenantId, gatewayRequestId, batchSize: rows.length },
        "skipping replay — gateway_request_id already in ledger",
      );
      return;
    }

    await this.insertRows(rows);
  }

  /** Map + insert debit rows; shared by every probing insert path. */
  private async insertRows(rows: BudgetDebitRow[]): Promise<void> {
    const tenantId = rows[0]!.tenantId;
    const client = await this.resolveClient(tenantId);
    const records = rows.map((r) => ({
      TenantId: r.tenantId,
      BudgetId: r.budgetId,
      Scope: scopeToClickHouse(r.scope),
      ScopeId: r.scopeId,
      Window: windowToClickHouse(r.window),
      VirtualKeyId: r.virtualKeyId,
      ProviderCredentialId: r.providerCredentialId ?? "",
      ProviderKey: r.providerKey ?? "",
      GatewayRequestId: r.gatewayRequestId,
      AmountNanoUSD: r.amountNanoUsd,
      AmountUSD: nanoUsdToDecimalString(BigInt(r.amountNanoUsd)),
      TokensInput: r.tokensInput,
      TokensOutput: r.tokensOutput,
      TokensCacheRead: r.tokensCacheRead,
      TokensCacheWrite: r.tokensCacheWrite,
      Model: r.model,
      ProviderSlot: r.providerSlot ?? "",
      DurationMS: r.durationMs ?? 0,
      Status: r.status.toLowerCase(),
      OccurredAt: r.occurredAt.getTime(),
      EventTimestamp: Date.now(),
    }));

    try {
      await client.insert({
        table: EVENTS_TABLE,
        values: records,
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
      });
    } catch (error) {
      logger.warn(
        { tenantId, count: rows.length, error },
        "failed to insert gateway budget ledger events",
      );
      throw error;
    }
  }

  /**
   * The pulled-usage write (ADR-088). Cost the customer already spent
   * DIRECTLY with a provider, pulled from that provider's own record.
   *
   * It is a separate method from `insertDebit` / `insertDebitsForBudgets` on
   * purpose, and the separation is the non-enforcement guarantee. Those two
   * take a `GatewayBudgetScopeType` and a real `GatewayBudget.id`; this one
   * takes neither. It writes the constant `Scope = "pulled"` — which is not a
   * `GatewayBudgetScopeType` and so cannot be the scope of any budget that
   * could ever exist — under the constant `BudgetId = "pulled"`, which is not
   * a cuid and so cannot be any budget's id. Enforcement resolves real budget
   * rows and sums ledger rows matching them; there is no budget these rows
   * match, so no resolver reaches them. Nothing here is a flag anything has
   * to remember to check.
   *
   * Restatement rides the table's own machinery. `GatewayRequestId` is the
   * dimension-only restatement key, so every version of one bucket collapses
   * to one row, and `EventTimestamp` is `observedAt` — the monotonic pull
   * instant — so the ReplacingMergeTree keeps the newest observation. The
   * `pulled:` prefix on the request id is load-bearing rather than cosmetic:
   * `insertDebit` skips a real gateway debit when ANY row already exists for
   * its `(TenantId, GatewayRequestId)`, so a restatement key that happened to
   * equal a gateway ULID would silently suppress a customer's real debit. The
   * prefix makes that collision impossible by construction.
   *
   * Reads must NOT trust the merge to have happened — see
   * `readPulledUsageTotals`, which collapses with `argMax` over
   * `EventTimestamp`. A bare read of an unmerged table would show a superseded
   * figure, and on money that is not a staleness bug, it is a wrong number.
   *
   * `Status` is always `'success'`: these rows are spend that already
   * happened, not attempts. That is also exactly why the rollup materialised
   * view has to exclude them explicitly — its filter is `Status = 'success'`,
   * which these rows satisfy — see migration 00073.
   */
  async insertPulledUsageRows(rows: PulledUsageRow[]): Promise<void> {
    if (rows.length === 0) return;
    const tenantId = rows[0]!.tenantId;
    if (rows.some((r) => r.tenantId !== tenantId)) {
      throw new Error(
        "GatewayBudgetClickHouseRepository.insertPulledUsageRows: rows span multiple tenants",
      );
    }

    const fresh = await this.pulledRowsThatChanged({ tenantId, rows });
    if (fresh.length === 0) return;

    const client = await this.resolveClient(tenantId);
    const records = fresh.map((r) => ({
      TenantId: r.tenantId,
      BudgetId: PULLED_USAGE_BUDGET_ID,
      Scope: PULLED_USAGE_SCOPE,
      ScopeId: r.scopeId,
      // One lifetime bucket. These rows carry no budget and so no period; the
      // read bounds by OccurredAt, never by a budget's window.
      Window: "TOTAL",
      VirtualKeyId: "",
      ProviderCredentialId: "",
      ProviderKey: r.providerKey ?? "",
      GatewayRequestId: pulledRequestId(r.restatementKey),
      AmountNanoUSD: r.amountNanoUsd,
      AmountUSD: nanoUsdToDecimalString(BigInt(r.amountNanoUsd)),
      TokensInput: r.tokensInput,
      TokensOutput: r.tokensOutput,
      TokensCacheRead: r.tokensCacheRead,
      TokensCacheWrite: r.tokensCacheWrite,
      Model: r.model || "unknown",
      ProviderSlot: "",
      DurationMS: 0,
      Status: "success",
      OccurredAt: r.occurredAt.getTime(),
      // The ReplacingMergeTree version. Pull time, not bucket time: a
      // restatement of period P keeps P's OccurredAt, so ordering versions by
      // it would compare the period against itself.
      EventTimestamp: r.observedAt.getTime(),
    }));

    try {
      await client.insert({
        table: EVENTS_TABLE,
        values: records,
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
      });
    } catch (error) {
      logger.error(
        { tenantId, count: fresh.length, error },
        "failed to insert pulled usage ledger rows",
      );
      throw error;
    }
  }

  /**
   * The subset of a pulled batch that actually says something new.
   *
   * "An unchanged re-pull records nothing new", enforced where the money is.
   * The command boundary keeps a corrected bucket distinct from an unchanged
   * one, but an identical observation still arrives here on every pull of a
   * window that has not drained, and writing it would churn the ledger for no
   * change in what anybody is owed.
   *
   * The comparison is against the LATEST version per key (`argMax` over
   * `EventTimestamp`), not against whatever row a merge happens to have left
   * behind. Comparing against a superseded row would resurrect it: a bucket
   * corrected $10 → $12 and then re-pulled at $12 would look "changed"
   * relative to the stale $10 and write a third row saying $12 again.
   */
  private async pulledRowsThatChanged({
    tenantId,
    rows,
  }: {
    tenantId: string;
    rows: PulledUsageRow[];
  }): Promise<PulledUsageRow[]> {
    const client = await this.resolveClient(tenantId);
    // The batch's own bucket span, which is what makes this a partition-pruned
    // read instead of a full-history scan. `OccurredAt` is the partition key,
    // and a probe without it touches every partition the tenant has ever
    // written — including whatever has aged onto S3 — on every single pull.
    // A restatement always carries its ORIGINAL bucket time (that is what
    // makes it a restatement), so any prior version of these rows is inside
    // this span by construction; the day of slack on each side is for a
    // provider that nudges a bucket boundary, not for correctness.
    const occurredAtMs = rows.map((r) => r.occurredAt.getTime());
    const SPAN_SLACK_MS = 24 * 60 * 60 * 1000;
    const probe = await client.query({
      query: `
        SELECT GatewayRequestId,
               argMax(AmountNanoUSD, EventTimestamp)    AS AmountNanoUSD,
               argMax(TokensInput, EventTimestamp)      AS TokensInput,
               argMax(TokensOutput, EventTimestamp)     AS TokensOutput,
               argMax(TokensCacheRead, EventTimestamp)  AS TokensCacheRead,
               argMax(TokensCacheWrite, EventTimestamp) AS TokensCacheWrite
        FROM ${EVENTS_TABLE}
        WHERE TenantId = {tenantId:String}
          AND BudgetId = {budgetId:String}
          AND OccurredAt >= fromUnixTimestamp64Milli({fromMs:Int64})
          AND OccurredAt <= fromUnixTimestamp64Milli({toMs:Int64})
          AND GatewayRequestId IN {requestIds:Array(String)}
        GROUP BY GatewayRequestId`,
      query_params: {
        tenantId,
        budgetId: PULLED_USAGE_BUDGET_ID,
        fromMs: Math.min(...occurredAtMs) - SPAN_SLACK_MS,
        toMs: Math.max(...occurredAtMs) + SPAN_SLACK_MS,
        requestIds: rows.map((r) => pulledRequestId(r.restatementKey)),
      },
      format: "JSONEachRow",
    });
    const existing = new Map(
      (
        (await probe.json()) as Array<
          { GatewayRequestId: string } & Record<string, string | number>
        >
      ).map((r) => [r.GatewayRequestId, r]),
    );

    return rows.filter((row) => {
      const seen = existing.get(pulledRequestId(row.restatementKey));
      if (!seen) return true;
      return !(
        BigInt(seen.AmountNanoUSD ?? 0) === BigInt(row.amountNanoUsd) &&
        Number(seen.TokensInput) === row.tokensInput &&
        Number(seen.TokensOutput) === row.tokensOutput &&
        Number(seen.TokensCacheRead) === row.tokensCacheRead &&
        Number(seen.TokensCacheWrite) === row.tokensCacheWrite
      );
    });
  }

  /**
   * Pulled cost for one org/team scope, collapsed to one row per usage item.
   *
   * The shape mirrors the READ that already surfaces ingestion cost
   * (`personalUsage.clickhouse.repository.ts`'s principal query): filter by tenant, scope
   * and scope id, never by budget. It does not mirror that query's WRITE —
   * principal rows carry real budgets and do enforce; these carry none.
   *
   * `argMax` over `EventTimestamp` rather than a bare `sum`, and rather than
   * `FINAL`: a restatement is a second row until the merge collapses it, and
   * the merge can be hours away or never. Summing raw rows would add a
   * corrected figure to the one it corrects; trusting the merge would report
   * whichever version happened to survive. Neither is acceptable on money.
   */
  async readPulledUsageTotals({
    tenantId,
    scopeIds,
    from,
    to,
  }: {
    tenantId: string;
    /** The org id, the team id, or both — whichever the caller can see. */
    scopeIds: string[];
    from: Date;
    to: Date;
  }): Promise<PulledUsageTotals> {
    const empty: PulledUsageTotals = {
      spentNanoUsd: 0,
      spentUsd: "0",
      items: 0,
      tokensInput: 0,
      tokensOutput: 0,
    };
    if (scopeIds.length === 0) return empty;

    const client = await this.resolveClient(tenantId);
    const result = await client.query({
      query: `
        SELECT
          toString(sum(Amount))  AS SpentNanoUSD,
          count()                AS Items,
          toString(sum(TokensIn))  AS TokensInput,
          toString(sum(TokensOut)) AS TokensOutput
        FROM (
          SELECT
            GatewayRequestId,
            argMax(AmountNanoUSD, EventTimestamp) AS Amount,
            argMax(TokensInput, EventTimestamp)   AS TokensIn,
            argMax(TokensOutput, EventTimestamp)  AS TokensOut
          FROM ${EVENTS_TABLE}
          WHERE TenantId = {tenantId:String}
            AND Scope = {scope:String}
            AND ScopeId IN {scopeIds:Array(String)}
            AND OccurredAt >= fromUnixTimestamp64Milli({fromMs:Int64})
            AND OccurredAt <  fromUnixTimestamp64Milli({toMs:Int64})
          GROUP BY GatewayRequestId
        )`,
      query_params: {
        tenantId,
        scope: PULLED_USAGE_SCOPE,
        scopeIds,
        fromMs: from.getTime(),
        toMs: to.getTime(),
      },
      format: "JSONEachRow",
    });
    const [row] = (await result.json()) as Array<{
      SpentNanoUSD: string;
      Items: string | number;
      TokensInput: string;
      TokensOutput: string;
    }>;
    if (!row) return empty;

    const nano = BigInt(row.SpentNanoUSD || "0");
    return {
      spentNanoUsd: parseSummedNanoUsd(nano),
      spentUsd: nanoUsdToDecimalString(nano),
      items: Number(row.Items ?? 0),
      tokensInput: Number(row.TokensInput ?? 0),
      tokensOutput: Number(row.TokensOutput ?? 0),
    };
  }

  /**
   * The debit insert the writer uses. One request resolves several budgets
   * and each lands its own row, so the probe is per (BudgetId,
   * GatewayRequestId) rather than the whole-request one insertDebit takes:
   * a whole-request probe would see the first budget's row and silently
   * skip every other budget the same request owes. Per budget, a replay
   * still dedups. The probe-then-insert race analysis on insertDebit
   * applies verbatim.
   */
  async insertDebitsForBudgets(rows: BudgetDebitRow[]): Promise<void> {
    if (rows.length === 0) return;
    const tenantId = rows[0]!.tenantId;
    const gatewayRequestId = rows[0]!.gatewayRequestId;
    if (rows.some((r) => r.tenantId !== tenantId)) {
      throw new Error(
        "GatewayBudgetClickHouseRepository.insertDebitsForBudgets: rows span multiple tenants",
      );
    }
    if (rows.some((r) => r.gatewayRequestId !== gatewayRequestId)) {
      throw new Error(
        "GatewayBudgetClickHouseRepository.insertDebitsForBudgets: rows span multiple gateway_request_ids",
      );
    }
    const budgetIds = [...new Set(rows.map((r) => r.budgetId))];
    const client = await this.resolveClient(tenantId);
    const probe = await client.query({
      query: `SELECT DISTINCT BudgetId, ScopeId FROM ${EVENTS_TABLE} WHERE TenantId = {tenantId:String} AND GatewayRequestId = {requestId:String} AND BudgetId IN {budgetIds:Array(String)}`,
      query_params: { tenantId, requestId: gatewayRequestId, budgetIds },
      format: "JSONEachRow",
    });
    const existing = new Map(
      ((await probe.json()) as Array<{ BudgetId: string; ScopeId: string }>).map((r) => [
        r.BudgetId,
        r.ScopeId,
      ]),
    );
    // A budget already on this request suppresses the row, which is how a
    // replay stays idempotent. When the row that already sits there names
    // a DIFFERENT bucket, the suppression is not a replay: the ledger keys
    // rows by (TenantId, BudgetId, GatewayRequestId) with no bucket in the
    // key, so a disagreement about the bucket silently drops one side's
    // spend from whichever bucket enforcement reads. Never quiet.
    for (const row of rows) {
      const seenScopeId = existing.get(row.budgetId);
      if (seenScopeId === undefined || seenScopeId === row.scopeId) continue;
      logger.error(
        {
          tenantId,
          gatewayRequestId,
          budgetId: row.budgetId,
          scope: row.scope,
          droppedScopeId: row.scopeId,
          existingScopeId: seenScopeId,
          reason: "this budget was already claimed on the request",
        },
        "dropping a budget debit that would land in a different bucket",
      );
    }
    const fresh = rows.filter((r) => !existing.has(r.budgetId));
    if (fresh.length === 0) return;
    await this.insertRows(fresh);
  }

  /**
   * Read current-period spend for a set of budgets from the materialised
   * view. Returns one ScopeSpend per budget requested; missing budgets
   * are reported with spentUsd = "0".
   */
  async getSpendForBudgets(
    tenantId: string,
    budgets: GatewayBudget[] | BudgetSpendTarget[],
    // The instant the read is anchored to. Injectable so a test that wrote
    // a debit at a known time can read the same period deterministically
    // instead of racing the wall clock across a MINUTE or HOUR boundary.
    now: Date = new Date(),
  ): Promise<ScopeSpend[]> {
    return this.getSpendForTargetsAcrossTenants(
      [tenantId],
      toSpendTargets(budgets, now),
      now,
    );
  }

  /**
   * Same as `getSpendForBudgets` but sums spend across multiple tenants
   * (projects). Used by `GatewayBudgetService.list()` /
   * `listForProject()` to render the org-level budget table — those
   * paths span every project in the org/team, and ORG/TEAM/PRINCIPAL-
   * scoped budgets accumulate ledger rows under whichever project
   * actually emitted the trace (TenantId on the ledger row = the
   * project the trace landed in, not the budget's scope).
   *
   * Without this, list() reads `GatewayBudget.spentUsd` from PG which
   * is the legacy column that's no longer updated post-cutover — every
   * budget in the list view shows $0.00 / 0% even when CH has real
   * ledger rows.
   */
  async getSpendForBudgetsAcrossTenants(
    tenantIds: string[],
    budgets: GatewayBudget[] | BudgetSpendTarget[],
    now: Date = new Date(),
  ): Promise<ScopeSpend[]> {
    return this.getSpendForTargetsAcrossTenants(
      tenantIds,
      toSpendTargets(budgets, now),
      now,
    );
  }

  /**
   * The one spend read. Sums the rollup for each target's bucket in its
   * own current period, across every tenant given.
   *
   * A target's `scopeId` is the ledger bucket, so a provider-filtered
   * budget reads only its provider's spend and a per-member group
   * allowance reads only that member's, the same keys the fold writes.
   * `match: "prefix"` is how a group budget totals all its members
   * when no single member is in context.
   */
  async getSpendForTargetsAcrossTenants(
    tenantIds: string[],
    targets: BudgetSpendTarget[],
    now: Date = new Date(),
  ): Promise<ScopeSpend[]> {
    if (targets.length === 0 || tenantIds.length === 0) return [];

    // Two reads, because a target whose boundary has moved cannot be
    // answered from the rollup: the rollup's buckets are keyed by calendar
    // PeriodStart and pre-aggregate the whole bucket, so a floor sitting
    // inside one is unanswerable there.
    const spends = await this.readFlooredTargetSpend(tenantIds, targets);
    for (const [window, targetsForWindow] of targetsByWindow(targets)) {
      spends.push(
        ...(await this.readRollupTargetSpend({
          tenantIds,
          window,
          targets: targetsForWindow,
          now,
        })),
      );
    }

    const byBudget = new Map<string, ScopeSpend>();
    for (const spend of spends) byBudget.set(spend.budgetId, spend);
    return targets.map(
      (t) =>
        byBudget.get(t.budgetId) ?? {
          budgetId: t.budgetId,
          scope: t.scope,
          scopeId: t.scopeId,
          ...spentFromNano(0n),
        },
    );
  }

  /**
   * Spend for the targets whose period floor has moved off the calendar:
   * MANUAL windows, anchored windows, and calendar windows reset
   * mid-period. The floor sits inside the rollup's calendar bucket, which
   * cannot answer it, so the total is summed straight off the ledger,
   * successful requests only. An anchored budget lives here permanently:
   * its periods never coincide with the calendar ones the rollup keys on.
   */
  private async readFlooredTargetSpend(
    tenantIds: string[],
    targets: BudgetSpendTarget[],
  ): Promise<ScopeSpend[]> {
    const floored = targets.filter((t) => t.periodFloorMs !== undefined);
    if (floored.length === 0) return [];

    const sums = flooredTargetSums(floored);
    // The table partitions by toYYYYMM(OccurredAt), and each target's own
    // floor is already inside its sumIf. Repeating the earliest of them as a
    // WHERE term is what lets ClickHouse prune partitions before the scan:
    // without it the read walks every month the tenant has ever written,
    // cold storage included, to sum a window that is usually this one.
    const earliestFloorMs = Math.min(...floored.map((t) => t.periodFloorMs ?? 0));
    try {
      const client = await this.resolveClient(tenantIds[0]!);
      const result = await client.query({
        query: `
            SELECT
              ${sums.sql}
            FROM ${EVENTS_TABLE} FINAL
            WHERE TenantId IN (${tenantPlaceholders(tenantIds)})
              AND Status = 'success'
              AND OccurredAt >= fromUnixTimestamp64Milli({earliestFloor:Int64})
          `,
        query_params: {
          ...tenantParams(tenantIds),
          ...sums.params,
          earliestFloor: earliestFloorMs,
        },
        format: "JSONEachRow",
      });
      const rows = (await result.json()) as Array<Record<string, string>>;
      const row = rows[0] ?? {};
      return floored.map((t, i) => ({
        budgetId: t.budgetId,
        scope: t.scope,
        scopeId: t.scopeId,
        ...spentFromNano(row[`T${i}`] ?? "0"),
      }));
    } catch (error) {
      logger.warn(
        { tenantIds, targets: floored.length, error },
        "failed to read boundary-floored gateway budget spend",
      );
      throw error;
    }
  }

  /**
   * Spend for one window's worth of targets, read off the rollup. It already
   * holds one pre-aggregated row per bucket per period, so every bucket in
   * the window is asked for at once and stitched back onto its budget after.
   */
  private async readRollupTargetSpend(args: {
    tenantIds: string[];
    window: GatewayBudgetWindow;
    targets: BudgetSpendTarget[];
    now: Date;
  }): Promise<ScopeSpend[]> {
    const { tenantIds, window, targets, now } = args;
    const scopeFilter = rollupScopeFilter(targets);
    try {
      // Any tenant resolves the client: the query hits
      // `gateway_budget_scope_totals`, a single physical table, and
      // `resolveClient` only differs by project for routing.
      const client = await this.resolveClient(tenantIds[0]!);
      const result = await client.query({
        query: `
            SELECT
              BudgetId,
              Scope,
              ScopeId,
              toString(sumMerge(SpendNanoUSD)) AS SpentNanoUSD
            FROM ${TOTALS_TABLE}
            WHERE TenantId IN (${tenantPlaceholders(tenantIds)})
              AND Window = {window:String}
              AND PeriodStart = fromUnixTimestamp64Milli({periodStart:Int64})
              AND (${scopeFilter.sql})
            GROUP BY BudgetId, Scope, ScopeId
          `,
        query_params: {
          ...tenantParams(tenantIds),
          ...scopeFilter.params,
          window: windowToClickHouse(window),
          periodStart: currentPeriodStart(window, now).getTime(),
        },
        format: "JSONEachRow",
      });
      const rows = (await result.json()) as RollupScopeRow[];
      return targets.map((t) => ({
        budgetId: t.budgetId,
        scope: t.scope,
        scopeId: t.scopeId,
        ...spentFromNano(sumRollupRowsForTarget(rows, t)),
      }));
    } catch (error) {
      logger.warn(
        { tenantIds, window, error },
        "failed to read gateway budget scope totals across tenants",
      );
      throw error;
    }
  }

  /**
   * Every bucket of one fanned-out budget, with what that bucket has spent
   * in the current period.
   *
   * An ATTRIBUTED_USER template is a single budget row that fans out into
   * one bucket per end user (`<anchor>:<endUserId>`), so its spend is not a
   * number: it is a distribution. This read hands back the raw pairs and
   * leaves the counting to the caller. One budget per call, because the
   * number of templates an organization runs is single digits while the
   * number of buckets under one template is not.
   *
   * What the pairs mean, which is what any count built on them inherits:
   *
   *   - A bucket appears here when it has at least one SUCCESS row in the
   *     current period after its floor. Spend of $0 still counts as seen:
   *     an end user served entirely by an unpriced model is a person the
   *     template is watching. A user whose every request failed is not,
   *     because failure rows never accrue spend anywhere.
   *   - `spentUsd` is directly comparable to the budget's `limitUsd` with
   *     `>=`, the comparator the gateway blocks on.
   *
   * Buckets are matched by `startsWith(ScopeId, '<anchor>:')`. The trailing
   * colon earns its place twice: it excludes rows written against the bare
   * anchor, and it stops an anchor from swallowing the buckets of another
   * anchor whose id merely begins with the same characters.
   */
  async getBucketSpendBreakdownForBudget(args: {
    budget: GatewayBudget;
    tenantIds: string[];
    boundaries: BudgetBucketBoundary[];
    now?: Date;
  }): Promise<BucketSpend[]> {
    const { budget, tenantIds, boundaries } = args;
    const now = args.now ?? new Date();
    if (tenantIds.length === 0) return [];

    const shape = bucketQueryShape({ budget, tenantIds, boundaries, now });
    const client = await this.resolveClient(tenantIds[0]!);
    const spentByBucket =
      shape.budgetFloorMs === undefined
        ? await this.rollupBucketSpend({ client, shape, budget, now })
        : await this.flooredBucketSpend({ client, shape, budget });

    return [...spentByBucket.entries()]
      .map(([scopeId, raw]) => ({ scopeId, ...spentFromNano(raw) }))
      .sort((a, b) => (a.scopeId < b.scopeId ? -1 : 1));
  }

  /**
   * Bucket spend for a budget still on its calendar boundary. The rollup
   * pre-aggregates one row per bucket per period, which is exactly the
   * question being asked.
   *
   * Buckets whose own boundary moved are unanswerable there, so they are
   * re-read from the raw ledger and overwrite what the rollup said. One
   * with nothing left after its floor drops out entirely: a bucket with no
   * spend in the current period is not a person the template saw.
   */
  private async rollupBucketSpend(args: {
    client: ClickHouseClientFor;
    shape: BucketQueryShape;
    budget: GatewayBudget;
    now: Date;
  }): Promise<Map<string, string>> {
    const { client, shape, budget, now } = args;
    const spentByBucket = new Map<string, string>();
    try {
      const result = await client.query({
        query: `
          SELECT
            ScopeId,
            toString(sumMerge(SpendNanoUSD)) AS SpentNanoUSD
          FROM ${TOTALS_TABLE}
          WHERE TenantId IN (${shape.tenantPlaceholders})
            AND Scope = {scope:String}
            AND Window = {window:String}
            AND PeriodStart = fromUnixTimestamp64Milli({periodStart:Int64})
            AND ${shape.bucketFilter}
          GROUP BY ScopeId
        `,
        query_params: {
          ...shape.params,
          periodStart: currentPeriodStart(budget.window, now).getTime(),
        },
        format: "JSONEachRow",
      });
      for (const row of (await result.json()) as BucketSpendRow[]) {
        spentByBucket.set(row.ScopeId, row.SpentNanoUSD);
      }
    } catch (error) {
      logger.warn(
        { tenantIds: shape.tenantIds, budgetId: budget.id, error },
        "failed to read gateway budget bucket spend from the rollup",
      );
      throw error;
    }

    if (shape.movedBoundaryPredicates.length === 0) return spentByBucket;

    for (const bucketScopeId of shape.movedBoundaryBuckets) {
      spentByBucket.delete(bucketScopeId);
    }
    for (const row of await this.readFlooredBucketSpend({
      client,
      shape,
      budgetId: budget.id,
      floorPredicate: `(${shape.movedBoundaryPredicates.join(" OR ")})`,
    })) {
      spentByBucket.set(row.ScopeId, row.SpentNanoUSD);
    }
    return spentByBucket;
  }

  /**
   * Bucket spend for a budget whose own boundary moved: a MANUAL window, or
   * a template reset mid-period. The floor now sits inside the rollup's
   * calendar bucket, which cannot answer it, so the whole read goes to the
   * raw ledger. Buckets with a boundary of their own keep it; every other
   * bucket reads from the template's floor.
   */
  private async flooredBucketSpend(args: {
    client: ClickHouseClientFor;
    shape: BucketQueryShape;
    budget: GatewayBudget;
  }): Promise<Map<string, string>> {
    const { client, shape, budget } = args;
    const templateFloor = "OccurredAt >= fromUnixTimestamp64Milli({budgetFloor:Int64})";
    const floorPredicate =
      shape.movedBoundaryPredicates.length > 0
        ? `(${shape.movedBoundaryPredicates.join(" OR ")} OR (ScopeId NOT IN {flooredBuckets:Array(String)} AND ${templateFloor}))`
        : templateFloor;

    const spentByBucket = new Map<string, string>();
    for (const row of await this.readFlooredBucketSpend({
      client,
      shape,
      budgetId: budget.id,
      floorPredicate,
    })) {
      spentByBucket.set(row.ScopeId, row.SpentNanoUSD);
    }
    return spentByBucket;
  }

  /**
   * Per-bucket spend straight off the ledger, bounded by whatever floor
   * predicate the caller built. `FINAL` collapses a replayed request to the
   * one row the ReplacingMergeTree will eventually keep.
   */
  private async readFlooredBucketSpend(args: {
    client: ClickHouseClientFor;
    shape: BucketQueryShape;
    floorPredicate: string;
    budgetId: string;
  }): Promise<BucketSpendRow[]> {
    const { client, shape } = args;
    try {
      const result = await client.query({
        query: `
          SELECT
            ScopeId,
            toString(sum(AmountNanoUSD)) AS SpentNanoUSD
          FROM ${EVENTS_TABLE} FINAL
          WHERE TenantId IN (${shape.tenantPlaceholders})
            AND Scope = {scope:String}
            AND Window = {window:String}
            AND Status = 'success'
            AND ${shape.bucketFilter}
            AND ${args.floorPredicate}
          GROUP BY ScopeId
        `,
        query_params: shape.params,
        format: "JSONEachRow",
      });
      return (await result.json()) as BucketSpendRow[];
    } catch (error) {
      logger.warn(
        { tenantIds: shape.tenantIds, budgetId: args.budgetId, error },
        "failed to read boundary-floored gateway budget bucket spend",
      );
      throw error;
    }
  }

  /**
   * Most recent ledger events for a single budget, ordered by `OccurredAt`
   * descending. Used by the budget detail page to render the recent-activity
   * panel (post-cutover replacement for `prisma.gatewayBudgetLedger.findMany`
   * in budget.service.ts:getDetail).
   *
   * Takes the full tenant fan-out because the ledger is sharded on
   * TenantId = the project the trace landed in: an org, team, principal,
   * or per-member group budget accrues rows under every project that
   * emitted a matching trace, so reading a single tenant would render
   * "No usage yet" on a budget that is actively debiting.
   *
   * Bounded by {@link RECENT_EVENTS_LOOKBACK_DAYS} on `OccurredAt`, the
   * table's partition key: without it ClickHouse opens every monthly
   * partition the budget has ever written to before it can sort and take
   * the top rows. The panel asks for recent activity, so the window is
   * part of the question, not a shortcut.
   */
  async recentEventsForBudget(
    tenantIds: string[],
    budgetId: string,
    limit = 20,
  ): Promise<LedgerEventRow[]> {
    if (tenantIds.length === 0) return [];
    const params: Record<string, string | number> = {
      budgetId,
      limit,
      since: Date.now() - RECENT_EVENTS_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
    };
    const tenantPlaceholders = tenantIds
      .map((id, i) => {
        params[`tenant${i}`] = id;
        return `{tenant${i}:String}`;
      })
      .join(",");
    // Any tenant resolves the client — the events table is a single
    // physical table; `resolveClient` only differs by project for routing.
    const client = await this.resolveClient(tenantIds[0]!);
    const result = await client.query({
      query: `
        SELECT
          GatewayRequestId AS id,
          BudgetId AS budgetId,
          VirtualKeyId AS virtualKeyId,
          toString(AmountNanoUSD) AS amountNanoUsd,
          Model AS model,
          ProviderSlot AS providerSlot,
          TokensInput AS tokensInput,
          TokensOutput AS tokensOutput,
          DurationMS AS durationMs,
          Status AS status,
          toUnixTimestamp64Milli(OccurredAt) AS occurredAtMs
        FROM ${EVENTS_TABLE}
        WHERE TenantId IN (${tenantPlaceholders})
          AND BudgetId = {budgetId:String}
          AND OccurredAt >= fromUnixTimestamp64Milli({since:Int64})
        ORDER BY OccurredAt DESC
        LIMIT {limit:UInt32}
      `,
      query_params: params,
      format: "JSONEachRow",
    });
    type Row = Omit<LedgerEventRow, "occurredAt" | "status" | "amountUsd"> & {
      amountNanoUsd: string;
      occurredAtMs: string;
      status: string;
    };
    const rows = (await result.json()) as Row[];
    return rows.map(toLedgerEventRow);
  }
}

function toLedgerEventRow(r: {
  id: string;
  budgetId: string;
  virtualKeyId: string;
  amountNanoUsd: string;
  model: string;
  providerSlot: string | null;
  tokensInput: number;
  tokensOutput: number;
  durationMs: number | null;
  status: string;
  occurredAtMs: string;
}): LedgerEventRow {
  return {
    id: r.id,
    budgetId: r.budgetId,
    virtualKeyId: r.virtualKeyId,
    // Rendered from the integer, so a single debit shown next to the request
    // that caused it is the amount that request was actually priced at.
    amountUsd: nanoUsdToDecimalString(BigInt(r.amountNanoUsd || "0")),
    model: r.model,
    providerSlot: r.providerSlot && r.providerSlot !== "" ? r.providerSlot : null,
    tokensInput: Number(r.tokensInput),
    tokensOutput: Number(r.tokensOutput),
    durationMs:
      r.durationMs === null || r.durationMs === undefined || Number(r.durationMs) === 0
        ? null
        : Number(r.durationMs),
    status: ledgerStatusFromCH(r.status),
    occurredAt: new Date(Number(r.occurredAtMs)),
  };
}

function ledgerStatusFromCH(raw: string): GatewayBudgetLedgerStatus {
  switch (raw.toLowerCase()) {
    case "success":
      return "SUCCESS";
    case "provider_error":
      return "PROVIDER_ERROR";
    case "blocked_by_guardrail":
      return "BLOCKED_BY_GUARDRAIL";
    case "cancelled":
      return "CANCELLED";
    default:
      return "SUCCESS";
  }
}

/**
 * Accept either raw budget rows (list views, which have no request
 * context) or explicit bucket targets (request paths, which do).
 */
function toSpendTargets(
  input: GatewayBudget[] | BudgetSpendTarget[],
  now: Date,
): BudgetSpendTarget[] {
  if (input.length === 0) return [];
  const first = input[0]!;
  return "budgetId" in first
    ? (input as BudgetSpendTarget[])
    : spendTargetsForBudgets({ budgets: input as GatewayBudget[], now });
}

function scopeToClickHouse(scope: GatewayBudgetScopeType): string {
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

function windowToClickHouse(window: GatewayBudgetWindow): string {
  return window.toString();
}
