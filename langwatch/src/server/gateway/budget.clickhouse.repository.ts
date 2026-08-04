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
 * See: migration 00017_create_gateway_budget_ledger.sql
 * See: migration 00069_gateway_budget_scope_totals_budget_grain.sql
 * See: specs/ai-gateway/_shared/contract.md §4.5
 */

import { createLogger } from "@langwatch/observability";
import type {
  GatewayBudget,
  GatewayBudgetLedgerStatus,
  GatewayBudgetScopeType,
  GatewayBudgetWindow,
} from "@prisma/client";
import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import {
  bucketScopeIdFor,
  PROVIDER_BUCKET_SEPARATOR,
} from "./budgetResolution.service";
import {
  anchoredPeriodStart,
  isCyclicWindow,
  nextBoundaryFor,
} from "./budgetWindow";

const EVENTS_TABLE = "gateway_budget_ledger_events" as const;
const TOTALS_TABLE = "gateway_budget_scope_totals" as const;

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
  amountUsd: string;
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

export type ScopeSpend = {
  budgetId: string;
  scope: GatewayBudgetScopeType;
  scopeId: string;
  spentUsd: string;
};

/** One bucket of a fanned-out budget and what it has spent this period. */
export type BucketSpend = {
  scopeId: string;
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
 */
export function spendTargetsForBudgets(
  budgets: GatewayBudget[],
): BudgetSpendTarget[] {
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
          // MANUAL windows and mid-period resets move the boundary; the
          // list must total the CURRENT period, same as enforcement does.
          periodFloorMs: budgetPeriodFloorMs(b),
        }
      : {
          budgetId: b.id,
          scope: b.scopeType,
          scopeId: bucketScopeIdFor(b, b.scopeId),
          window: b.window,
          match: "exact" as const,
          periodFloorMs: budgetPeriodFloorMs(b),
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

/** Raw shape of a per-bucket spend row, in the ledger's column casing. */
type BucketSpendRow = { ScopeId: string; SpentUSD: string };

/** Raw shape of a rollup total row, in the rollup's column casing. */
type RollupScopeRow = {
  BudgetId: string;
  Scope: string;
  ScopeId: string;
  SpentUSD: string;
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
      bucketPeriodFloorMs(budget, b.periodStartedAt, now) ??
      b.periodStartedAt.getTime();
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
    const bucket = bucketMatchSql(
      t,
      `fbudgetId${i}`,
      `fscopeId${i}`,
      `fsuffix${i}`,
    );
    return `toString(sumIf(AmountUSD, Scope = {fscope${i}:String} AND ${bucket} AND Window = {fwindow${i}:String} AND OccurredAt >= fromUnixTimestamp64Milli({ffloor${i}:Int64}))) AS T${i}`;
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
    const bucket = bucketMatchSql(
      t,
      `budgetId${i}`,
      `scopeId${i}`,
      `suffix${i}`,
    );
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
 */
function sumRollupRowsForTarget(
  rows: RollupScopeRow[],
  target: BudgetSpendTarget,
): number {
  const scope = scopeToClickHouse(target.scope);
  return rows
    .filter((r) => rollupRowMatchesTarget(r, target, scope))
    .reduce((sum, r) => sum + (Number.parseFloat(r.SpentUSD) || 0), 0);
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
      AmountUSD: r.amountUsd,
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
      logger.error(
        { tenantId, count: rows.length, error },
        "failed to insert gateway budget ledger events",
      );
      throw error;
    }
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
      (
        (await probe.json()) as Array<{ BudgetId: string; ScopeId: string }>
      ).map((r) => [r.BudgetId, r.ScopeId]),
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
      toSpendTargets(budgets),
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
      toSpendTargets(budgets),
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
          spentUsd: "0",
        },
    );
  }

  /**
   * Spend for the targets whose period floor has moved off the calendar:
   * MANUAL windows, and calendar windows reset mid-period. The floor sits
   * inside the rollup's calendar bucket, which cannot answer it, so the
   * total is summed straight off the ledger, successful requests only.
   */
  private async readFlooredTargetSpend(
    tenantIds: string[],
    targets: BudgetSpendTarget[],
  ): Promise<ScopeSpend[]> {
    const floored = targets.filter((t) => t.periodFloorMs !== undefined);
    if (floored.length === 0) return [];

    const sums = flooredTargetSums(floored);
    try {
      const client = await this.resolveClient(tenantIds[0]!);
      const result = await client.query({
        query: `
            SELECT
              ${sums.sql}
            FROM ${EVENTS_TABLE} FINAL
            WHERE TenantId IN (${tenantPlaceholders(tenantIds)})
              AND Status = 'success'
          `,
        query_params: { ...tenantParams(tenantIds), ...sums.params },
        format: "JSONEachRow",
      });
      const rows = (await result.json()) as Array<Record<string, string>>;
      const row = rows[0] ?? {};
      return floored.map((t, i) => ({
        budgetId: t.budgetId,
        scope: t.scope,
        scopeId: t.scopeId,
        spentUsd: (Number.parseFloat(row[`T${i}`] ?? "0") || 0).toFixed(6),
      }));
    } catch (error) {
      logger.error(
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
              toString(sumMerge(SpendUSD)) AS SpentUSD
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
        spentUsd: sumRollupRowsForTarget(rows, t).toFixed(6),
      }));
    } catch (error) {
      logger.error(
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
      .map(([scopeId, raw]) => ({
        scopeId,
        spentUsd: (Number.parseFloat(raw) || 0).toFixed(6),
      }))
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
            toString(sumMerge(SpendUSD)) AS SpentUSD
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
        spentByBucket.set(row.ScopeId, row.SpentUSD);
      }
    } catch (error) {
      logger.error(
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
      spentByBucket.set(row.ScopeId, row.SpentUSD);
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
    const templateFloor =
      "OccurredAt >= fromUnixTimestamp64Milli({budgetFloor:Int64})";
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
      spentByBucket.set(row.ScopeId, row.SpentUSD);
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
            toString(sum(AmountUSD)) AS SpentUSD
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
      logger.error(
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
   */
  async recentEventsForBudget(
    tenantId: string,
    budgetId: string,
    limit = 20,
  ): Promise<LedgerEventRow[]> {
    const client = await this.resolveClient(tenantId);
    const result = await client.query({
      query: `
        SELECT
          GatewayRequestId AS id,
          BudgetId AS budgetId,
          VirtualKeyId AS virtualKeyId,
          toString(AmountUSD) AS amountUsd,
          Model AS model,
          ProviderSlot AS providerSlot,
          TokensInput AS tokensInput,
          TokensOutput AS tokensOutput,
          DurationMS AS durationMs,
          Status AS status,
          toUnixTimestamp64Milli(OccurredAt) AS occurredAtMs
        FROM ${EVENTS_TABLE}
        WHERE TenantId = {tenantId:String}
          AND BudgetId = {budgetId:String}
        ORDER BY OccurredAt DESC
        LIMIT {limit:UInt32}
      `,
      query_params: { tenantId, budgetId, limit },
      format: "JSONEachRow",
    });
    type Row = Omit<LedgerEventRow, "occurredAt" | "status"> & {
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
  amountUsd: string;
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
    amountUsd: r.amountUsd,
    model: r.model,
    providerSlot:
      r.providerSlot && r.providerSlot !== "" ? r.providerSlot : null,
    tokensInput: Number(r.tokensInput),
    tokensOutput: Number(r.tokensOutput),
    durationMs:
      r.durationMs === null ||
      r.durationMs === undefined ||
      Number(r.durationMs) === 0
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
): BudgetSpendTarget[] {
  if (input.length === 0) return [];
  const first = input[0]!;
  return "budgetId" in first
    ? (input as BudgetSpendTarget[])
    : spendTargetsForBudgets(input as GatewayBudget[]);
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

/**
 * Start-of-period (UTC) for the current window.
 *
 * This is one half of a contract: the rollup only ever returns a row when
 * this lands on exactly the PeriodStart the materialised view bucketed the
 * debit into. The other half is the multiIf() in
 * 00069_gateway_budget_scope_totals_budget_grain.sql, and the two are pinned
 * together by budget.clickhouse.repository.periodStart.integration.test.ts.
 * Change one without the other and the affected window stops accruing
 * entirely: spend is written, every read returns 0, and budgets on that
 * window silently stop enforcing.
 */
/**
 * The OccurredAt lower bound a spend read must honor for a budget whose
 * period boundary is not the calendar one, or undefined for the rollup
 * fast path. MANUAL windows always read from their stored boundary. An
 * anchored budget always reads from its own period start, since the rollup
 * buckets by calendar period and has no row that matches an anchored one. A
 * calendar (or TOTAL) window reads from the boundary only after an actual
 * mid-period reset (lastResetAt set) and only until the next calendar
 * boundary passes it; an unreset TOTAL budget keeps its lifetime-bucket
 * semantics.
 *
 * `cycleAnchorAt` is required rather than optional so that a caller reading
 * a budget row cannot forget it and silently get a calendar floor for an
 * anchored budget, which would count another period's spend against it.
 */
export function budgetPeriodFloorMs(
  budget: {
    window: GatewayBudgetWindow;
    currentPeriodStartedAt: Date;
    lastResetAt: Date | null;
    cycleAnchorAt: Date | null;
  },
  now: Date = new Date(),
): number | undefined {
  if (budget.window === "MANUAL") {
    return budget.currentPeriodStartedAt.getTime();
  }
  if (budget.cycleAnchorAt && isCyclicWindow(budget.window)) {
    const anchored = anchoredPeriodStart(
      budget.window,
      budget.cycleAnchorAt,
      now,
    ).getTime();
    // A reset forgives the spend so far but never re-phases the cycle: the
    // clamp holds only until this period ends, and the next one starts on
    // the anchor's schedule as if the reset had not happened. Same shape as
    // the calendar clamp below, with the anchored boundary in place of the
    // calendar one.
    return budget.lastResetAt
      ? Math.max(anchored, budget.currentPeriodStartedAt.getTime())
      : anchored;
  }
  if (!budget.lastResetAt) return undefined;
  const boundary = budget.currentPeriodStartedAt.getTime();
  return boundary > currentPeriodStart(budget.window, now).getTime()
    ? boundary
    : undefined;
}

/**
 * The period a budget is actually in right now, as opposed to the one its
 * stored columns claim.
 *
 * `currentPeriodStartedAt` and `resetsAt` are written once at create and
 * again at each explicit reset, and nothing sweeps them forward when a
 * period rolls. For a calendar budget past its first boundary the stored
 * start is therefore its creation date and the stored reset instant is in
 * the past, while enforcement has long since moved on to the current
 * calendar period. Reporting the stored pair tells a caller their month
 * started in March.
 *
 * So every read-side surface computes the pair here instead: anchored
 * budgets report their anchored bounds, cyclic ones their calendar bounds
 * (clamped forward by a mid-period reset, exactly as the floor is), and
 * TOTAL / MANUAL pass their stored values through since those windows have
 * no boundary to drift past.
 */
export function effectiveBudgetPeriod(
  budget: {
    window: GatewayBudgetWindow;
    currentPeriodStartedAt: Date;
    resetsAt: Date;
    lastResetAt: Date | null;
    cycleAnchorAt: Date | null;
  },
  now: Date = new Date(),
): { currentPeriodStartedAt: Date; resetsAt: Date } {
  if (!isCyclicWindow(budget.window)) {
    return {
      currentPeriodStartedAt: budget.currentPeriodStartedAt,
      resetsAt: budget.resetsAt,
    };
  }
  const floorMs = budgetPeriodFloorMs(budget, now);
  return {
    currentPeriodStartedAt:
      floorMs === undefined
        ? currentPeriodStart(budget.window, now)
        : new Date(floorMs),
    resetsAt: nextBoundaryFor(budget, now),
  };
}

/**
 * The OccurredAt lower bound for ONE bucket of a budget: the later of the
 * budget's own period floor and that bucket's boundary row, whichever of
 * the two exist. A per-bucket reset moves only its own boundary, so a read
 * that ignored it would keep counting spend the reset forgave; a template
 * reset moves the budget floor and outranks a stale bucket boundary.
 *
 * There is no calendar clamp here on purpose: enforcement reads the same
 * floor, and a display that clamped would disagree with the figure that
 * actually blocks a request.
 */
export function bucketPeriodFloorMs(
  budget: {
    window: GatewayBudgetWindow;
    currentPeriodStartedAt: Date;
    lastResetAt: Date | null;
    cycleAnchorAt: Date | null;
  },
  boundaryPeriodStartedAt: Date | null | undefined,
  now: Date = new Date(),
): number | undefined {
  const candidates = [
    budgetPeriodFloorMs(budget, now),
    boundaryPeriodStartedAt?.getTime(),
  ].filter((n): n is number => typeof n === "number");
  return candidates.length > 0 ? Math.max(...candidates) : undefined;
}

export function currentPeriodStart(
  window: GatewayBudgetWindow,
  now: Date,
): Date {
  const d = new Date(now.getTime());
  if (window === "MINUTE") {
    d.setUTCSeconds(0, 0);
    return d;
  }
  if (window === "HOUR") {
    d.setUTCMinutes(0, 0, 0);
    return d;
  }
  if (window === "DAY") {
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }
  if (window === "WEEK") {
    d.setUTCHours(0, 0, 0, 0);
    const day = d.getUTCDay();
    // ISO week start (Monday). Matches ClickHouse toStartOfWeek(t, 1).
    const delta = day === 0 ? 6 : day - 1;
    d.setUTCDate(d.getUTCDate() - delta);
    return d;
  }
  if (window === "MONTH") {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  }
  // TOTAL and MANUAL: one lifetime bucket, keyed by the epoch sentinel
  // (the MV's multiIf falls through to epoch for both). MANUAL is never
  // read through the PeriodStart fast path (budgetPeriodFloorMs always
  // floors it onto the raw-events read); the sentinel only keys where its
  // debits land in the rollup.
  return new Date(0);
}
