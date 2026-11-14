/**
 * The gateway budget ledger in ClickHouse.
 */

import {
  clickhouseRead,
  type Expression,
  fn,
  tenantScope,
} from "@langwatch/clickhouse-client/builder";
import {
  type GatewayBudgetLedgerStatus,
  type GatewayBudgetResource,
  type GatewayBudgetScopeType,
  type GatewayBudgetWindow,
  computeBucketPeriodFloorMs,
  computeBudgetPeriodFloorMs,
  currentPeriodStart,
  PROVIDER_BUCKET_SEPARATOR,
  nanoUsdToDecimalString,
  parseSummedNanoUsd,
} from "@langwatch/gateway-contract";
import { createLogger } from "@langwatch/observability";
import { type Instant, nowInstant, Temporal, toDate } from "@langwatch/time";

import { budgetSpendTargetsFor } from "../../rules/gateway-budget-spend-targets.rules.ts";
import type {
  GatewayBudgetSpendRepository,
  GatewayBudgetSpendRecord,
} from "../gateway-budget-spend.repository.ts";
import { gatewayBudgetLedgerEvents as ledger } from "./clickhouse.gateway-budget-ledger-events.table.ts";
import {
  type BucketFloor,
  bucketFloorCondition,
  bucketMatchCondition,
  budgetBucketsCondition,
  flooredTargetCondition,
} from "./clickhouse.gateway-budget-query.mapper.ts";
import { gatewayBudgetScopeTotals as totals } from "./clickhouse.gateway-budget-scope-totals.table.ts";
import type { GatewayClickHouseResolver } from "./clickhouse.gateway-session.store.ts";

const EVENTS_TABLE = "gateway_budget_ledger_events" as const;

/**
 * Wide enough to cover a month-long recurring window; narrow enough that the read prunes to a
 * handful of `toYYYYMM(OccurredAt)` partitions.
 */
const RECENT_EVENTS_LOOKBACK_DAYS = 90;

const logger = createLogger("langwatch:gateway:budget-clickhouse-repository");

type BudgetDebitRow = {
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
   * The amount a caller states; `AmountUSD` is derived from this one so the two can't drift,
   * since a `Decimal(18, 6)` can't hold a nano figure.
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
  occurredAt: Instant;
};

/**
 * Deliberately not a `GatewayBudgetScopeType`, so no budget can be created under it and every
 * enforcement read resolves real budgets first (ADR-088).
 */
const PULLED_USAGE_SCOPE = "pulled" as const;

/**
 * The ledger's storage key is `(TenantId, BudgetId, GatewayRequestId)` and demands one; this is
 * not a cuid, so it can never equal a real `GatewayBudget.id`. One shared value also keeps
 * pulled rows contiguous under the sorting key, so the read below stays an index seek.
 */
const PULLED_USAGE_BUDGET_ID = "pulled" as const;

/**
 * One pulled usage item, priced. Deliberately not a `BudgetDebitRow`: there is
 * no budget, no scope type and no gateway request behind any of this.
 */
type PulledUsageRow = {
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
  occurredAt: Instant;
  /** Monotonic pull time — the ReplacingMergeTree version column. */
  observedAt: Instant;
};

/** What a scope spent outside the gateway, over a window. */
type PulledUsageTotals = {
  /** The exact total, in the nano-USD integer the items were priced in. */
  spentNanoUsd: number;
  /** The same total as its display string, derived from `spentNanoUsd`. */
  spentUsd: string;
  /** How many distinct usage items, after restatements collapse. */
  items: number;
  tokensInput: number;
  tokensOutput: number;
};

type ScopeSpend = {
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
type BudgetBucketBoundary = {
  bucketScopeId: string;
  periodStartedAt: Instant;
};

/**
 * `scopeId` is the ledger bucket, not the budget's target: a provider-filtered budget and a
 * per-member GROUP allowance each accrue under their own key. `match: "prefix"` sums every
 * bucket under the key, for a GROUP budget's whole-group total.
 */
type BudgetSpendTarget = {
  budgetId: string;
  scope: GatewayBudgetScopeType;
  scopeId: string;
  window: GatewayBudgetWindow;
  match?: "exact" | "prefix";
  /**
   * Only meaningful with `match: "prefix"`: anchors the bucket's provider suffix so a filtered
   * group budget matches its own buckets, not an unfiltered sibling's.
   */
  bucketSuffix?: string | null;
  /**
   * Lower bound (unix ms) when the period boundary isn't the calendar one (MANUAL windows, or a
   * reset mid-period). Forces the raw-ledger read bounded by OccurredAt, since the rollup's
   * PeriodStart-equality fast path can't see a moved boundary.
   */
  periodFloorMs?: number;
};

/**
 * Read-shape for ledger events, scoped to whatever the caller needs (one VK, one budget, or all
 * VKs in a project). Field names mirror the equivalent Prisma row.
 */
type LedgerEventRow = {
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
  occurredAt: Instant;
};

/**
 * Raw shape of a per-bucket spend row, in the ledger's column casing.
 */
type BucketSpendRow = { ScopeId: string; SpentNanoUSD: string };

/** Raw shape of a rollup total row, in the rollup's column casing. */
type RollupScopeRow = {
  BudgetId: string;
  Scope: string;
  ScopeId: string;
  SpentNanoUSD: string;
};

type ClickHouseClientFor = Awaited<ReturnType<GatewayClickHouseResolver>>;

/**
 * Everything the two per-bucket reads share: bound parameters, the bucket predicate, and any
 * per-bucket floors. Built once so the rollup and raw-ledger paths can't drift on which buckets
 * they mean.
 */
type BucketQueryShape = {
  tenantIds: string[];
  budgetId: string;
  /** The budget's own key; its buckets are `<scopeId>:<member>`. */
  scopeId: string;
  providerKey: string | null | undefined;
  /** Scope and window as the ledger spells them. */
  scope: string;
  window: string;
  /** One floor per bucket whose boundary moved. */
  movedBoundaries: BucketFloor[];
  /** The template's own floor, or undefined while it sits on the calendar. */
  budgetFloorMs: number | undefined;
};

export class GatewayBudgetClickHouseRepository implements GatewayBudgetSpendRepository {
  static create(resolveClient: GatewayClickHouseResolver): GatewayBudgetClickHouseRepository {
    return new GatewayBudgetClickHouseRepository(resolveClient);
  }

  constructor(private readonly resolveClient: GatewayClickHouseResolver) {}

  /**
   * Idempotent at the ledger level (ReplacingMergeTree dedups on merge), but the
   * gateway_budget_scope_totals view aggregates at INSERT time and does not dedup — a replay
   * without a pre-insert guard multiplies the rollup total until the next merge.
   */
  async insertDebit(rows: BudgetDebitRow[]): Promise<void> {
    if (rows.length === 0) return;
    const tenantId = rows[0]!.tenantId;
    const gatewayRequestId = rows[0]!.gatewayRequestId;
    if (rows.some((r) => r.tenantId !== tenantId)) {
      throw new Error("GatewayBudgetClickHouseRepository.insertDebit: rows span multiple tenants");
    }
    if (rows.some((r) => r.gatewayRequestId !== gatewayRequestId)) {
      throw new Error(
        "GatewayBudgetClickHouseRepository.insertDebit: rows span multiple gateway_request_ids",
      );
    }

    if (await this.requestInLedger({ tenantId, gatewayRequestId })) {
      logger.debug(
        { tenantId, gatewayRequestId, batchSize: rows.length },
        "skipping replay — gateway_request_id already in ledger",
      );
      return;
    }

    await this.insertRows(rows);
  }

  /**
   * Whether the ledger holds the request: bounded by its id index once ready, unbounded before.
   * An index miss never alone declares a request new: the recent probe confirms it, so a lost
   * index row cannot double-debit a replay, and a hit there is counted as a found miss.
   */
  private async requestInLedger({
    tenantId,
    gatewayRequestId,
  }: {
    tenantId: string;
    gatewayRequestId: string;
  }): Promise<boolean> {
    const client = await this.resolveClient(tenantId);
    const statement = clickhouseRead({ scope: tenantScope.single({ tenantId }) })
      .from(ledger)
      .select({ GatewayRequestId: ledger.GatewayRequestId })
      .where(({ idBound }) => idBound(ledger.GatewayRequestId, gatewayRequestId))
      .limit(1)
      .build();
    const { rows } = await client.read({ statement, idBound: { fallback: "unbounded" } });
    return rows.length > 0;
  }

  /** Map + insert debit rows; shared by every probing insert path. */
  private async insertRows(rows: BudgetDebitRow[]): Promise<void> {
    const tenantId = rows[0]!.tenantId;
    const client = await this.resolveClient(tenantId);
    const records = rows.map((r) => ({
      TenantId: r.tenantId,
      BudgetId: r.budgetId,
      Scope: GatewayBudgetClickHouseRepository.scopeToClickHouse(r.scope),
      ScopeId: r.scopeId,
      Window: GatewayBudgetClickHouseRepository.windowToClickHouse(r.window),
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
      OccurredAt: toDate(r.occurredAt),
      EventTimestamp: nowInstant().epochMilliseconds,
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
   * DIRECTLY with a provider, pulled from that provider's own record.
   * The pulled-usage write (ADR-088). Cost the customer already spent
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
      GatewayRequestId: GatewayBudgetClickHouseRepository.pulledRequestId(r.restatementKey),
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
      OccurredAt: toDate(r.occurredAt),
      // The ReplacingMergeTree version. Pull time, not bucket time: a
      // restatement of period P keeps P's OccurredAt, so ordering versions by
      // it would compare the period against itself.
      EventTimestamp: r.observedAt.epochMilliseconds,
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
   */
  private async pulledRowsThatChanged({
    tenantId,
    rows,
  }: {
    tenantId: string;
    rows: PulledUsageRow[];
  }): Promise<PulledUsageRow[]> {
    const client = await this.resolveClient(tenantId);
    // `OccurredAt` is the partition key, so probing without it scans every partition the tenant
    // ever wrote. A restatement always carries its ORIGINAL bucket time, so any prior version
    // stays inside this span; the day of slack per side is for provider nudges, not correctness.
    const occurredAtMs = rows.map((r) => r.occurredAt.epochMilliseconds);
    const SPAN_SLACK_MS = 24 * 60 * 60 * 1000;
    const latest = <V, T extends string>(value: Expression<V, T>) =>
      fn.argMax(value, ledger.EventTimestamp);
    const statement = clickhouseRead({ scope: tenantScope.single({ tenantId }) })
      .from(ledger)
      .select({
        GatewayRequestId: ledger.GatewayRequestId,
        LatestAmountNanoUSD: latest(ledger.AmountNanoUSD),
        LatestTokensInput: latest(ledger.TokensInput),
        LatestTokensOutput: latest(ledger.TokensOutput),
        LatestTokensCacheRead: latest(ledger.TokensCacheRead),
        LatestTokensCacheWrite: latest(ledger.TokensCacheWrite),
      })
      .where(({ and, eq, gte, lte, oneOf }) =>
        and(
          eq(ledger.BudgetId, PULLED_USAGE_BUDGET_ID),
          gte(ledger.OccurredAt, Math.min(...occurredAtMs) - SPAN_SLACK_MS),
          lte(ledger.OccurredAt, Math.max(...occurredAtMs) + SPAN_SLACK_MS),
          oneOf(
            ledger.GatewayRequestId,
            rows.map((r) => GatewayBudgetClickHouseRepository.pulledRequestId(r.restatementKey)),
          ),
        ),
      )
      .groupBy(ledger.GatewayRequestId)
      .build();
    const { rows: probed } = await client.read({ statement });
    const existing = new Map(probed.map((r) => [r.GatewayRequestId, r]));

    return rows.filter((row) => {
      const seen = existing.get(
        GatewayBudgetClickHouseRepository.pulledRequestId(row.restatementKey),
      );
      if (!seen) return true;
      return !(
        BigInt(seen.LatestAmountNanoUSD ?? 0) === BigInt(row.amountNanoUsd) &&
        Number(seen.LatestTokensInput) === row.tokensInput &&
        Number(seen.LatestTokensOutput) === row.tokensOutput &&
        Number(seen.LatestTokensCacheRead) === row.tokensCacheRead &&
        Number(seen.LatestTokensCacheWrite) === row.tokensCacheWrite
      );
    });
  }

  /**
   * Pulled cost for one org/team scope, collapsed to one row per usage item.
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
    from: Instant;
    to: Instant;
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
    const scope = tenantScope.single({ tenantId });
    const items = clickhouseRead({ scope })
      .from(ledger)
      .select({
        GatewayRequestId: ledger.GatewayRequestId,
        Amount: fn.argMax(ledger.AmountNanoUSD, ledger.EventTimestamp),
        TokensIn: fn.argMax(ledger.TokensInput, ledger.EventTimestamp),
        TokensOut: fn.argMax(ledger.TokensOutput, ledger.EventTimestamp),
      })
      .where(({ and, eq, oneOf, range }) =>
        and(
          eq(ledger.Scope, PULLED_USAGE_SCOPE),
          oneOf(ledger.ScopeId, scopeIds),
          range(ledger.OccurredAt, { from: from.epochMilliseconds, until: to.epochMilliseconds }),
        ),
      )
      .groupBy(ledger.GatewayRequestId)
      .as("items");
    const statement = clickhouseRead({ scope })
      .from(items)
      .select({
        SpentNanoUSD: fn.toString(fn.sum(items.Amount)),
        Items: fn.count(),
        SumTokensInput: fn.toString(fn.sum(items.TokensIn)),
        SumTokensOutput: fn.toString(fn.sum(items.TokensOut)),
      })
      .build();
    const {
      rows: [row],
    } = await client.read({ statement });
    if (!row) return empty;

    const nano = BigInt(row.SpentNanoUSD || "0");
    return {
      spentNanoUsd: parseSummedNanoUsd(nano),
      spentUsd: nanoUsdToDecimalString(nano),
      items: Number(row.Items ?? 0),
      tokensInput: Number(row.SumTokensInput ?? 0),
      tokensOutput: Number(row.SumTokensOutput ?? 0),
    };
  }

  /**
   * The budgets already on one request, bounded by the id index once ready; a miss confirms
   * against the recent ledger, so a lost index row cannot double-debit.
   */
  private async budgetsOnRequest({
    tenantId,
    gatewayRequestId,
    budgetIds,
  }: {
    tenantId: string;
    gatewayRequestId: string;
    budgetIds: string[];
  }): Promise<{ BudgetId: string; ScopeId: string }[]> {
    const client = await this.resolveClient(tenantId);
    const statement = clickhouseRead({ scope: tenantScope.single({ tenantId }) })
      .from(ledger)
      .select({ BudgetId: ledger.BudgetId, ScopeId: ledger.ScopeId })
      .distinct()
      .where(({ and, idBound, oneOf }) =>
        and(idBound(ledger.GatewayRequestId, gatewayRequestId), oneOf(ledger.BudgetId, budgetIds)),
      )
      .build();
    const { rows } = await client.read({ statement, idBound: { fallback: "unbounded" } });
    return rows;
  }

  /**
   * One request resolves several budgets, each landing its own row, so the probe is per
   * (BudgetId, GatewayRequestId) rather than the whole-request one `insertDebit` takes — a
   * whole-request probe would silently skip every budget after the first it saw.
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
    const probed = await this.budgetsOnRequest({ tenantId, gatewayRequestId, budgetIds });
    const existing = new Map(probed.map((r) => [r.BudgetId, r.ScopeId]));
    // A budget already on this request suppresses the row (idempotent replay) — unless the
    // existing row names a DIFFERENT bucket, since the ledger key has no bucket in it. That
    // silently drops one side's spend from whichever bucket enforcement reads.
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
  async findSpendForBudgets(
    tenantId: string,
    budgets: GatewayBudgetResource[] | BudgetSpendTarget[],
    // The instant the read is anchored to. Injectable so a test that wrote
    // a debit at a known time can read the same period deterministically
    // instead of racing the wall clock across a MINUTE or HOUR boundary.
    now: Instant = nowInstant(),
  ): Promise<ScopeSpend[]> {
    return this.findSpendForTargetsAcrossTenants(
      [tenantId],
      GatewayBudgetClickHouseRepository.toSpendTargets(budgets, now),
      now,
    );
  }

  /**
   * Same as `findSpendForBudgets` but sums across tenants (projects): an ORG/TEAM/PRINCIPAL-scoped
   * budget accumulates ledger rows under whichever project actually emitted the trace, since
   * TenantId on the ledger row is the project, not the budget's scope.
   */
  async findSpendForBudgetsAcrossTenants(
    tenantIds: string[],
    budgets: GatewayBudgetResource[] | BudgetSpendTarget[],
    now: Instant = nowInstant(),
  ): Promise<ScopeSpend[]> {
    return this.readTargetSpend({
      tenantIds,
      targets: GatewayBudgetClickHouseRepository.toSpendTargets(budgets, now),
      now,
    });
  }

  /** The same read as `findSpendForBudgetsAcrossTenants`, abandoned (retries too) on abort. */
  async findSpendForBudgetsAcrossTenantsUntil({
    tenantIds,
    budgets,
    signal,
  }: {
    tenantIds: string[];
    budgets: GatewayBudgetResource[] | BudgetSpendTarget[];
    signal: AbortSignal;
  }): Promise<ScopeSpend[]> {
    const now = nowInstant();
    return this.readTargetSpend({
      tenantIds,
      targets: GatewayBudgetClickHouseRepository.toSpendTargets(budgets, now),
      now,
      signal,
    });
  }

  /**
   * The one spend read. Sums the rollup for each target's bucket in its own
   * current period, across every tenant given.
   */
  async findSpendForTargetsAcrossTenants(
    tenantIds: string[],
    targets: BudgetSpendTarget[],
    now: Instant = nowInstant(),
  ): Promise<ScopeSpend[]> {
    return this.readTargetSpend({ tenantIds, targets, now });
  }

  private async readTargetSpend({
    tenantIds,
    targets,
    now,
    signal,
  }: {
    tenantIds: string[];
    targets: BudgetSpendTarget[];
    now: Instant;
    signal?: AbortSignal;
  }): Promise<ScopeSpend[]> {
    if (targets.length === 0 || tenantIds.length === 0) return [];

    // Two reads, because a target whose boundary has moved cannot be
    // answered from the rollup: the rollup's buckets are keyed by calendar
    // PeriodStart and pre-aggregate the whole bucket, so a floor sitting
    // inside one is unanswerable there.
    const spends = await this.readFlooredTargetSpend({ tenantIds, targets, signal });
    for (const [window, targetsForWindow] of GatewayBudgetClickHouseRepository.targetsByWindow(
      targets,
    )) {
      spends.push(
        ...(await this.readRollupTargetSpend({
          tenantIds,
          window,
          targets: targetsForWindow,
          now,
          signal,
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
          ...GatewayBudgetClickHouseRepository.spentFromNano(0n),
        },
    );
  }

  /**
   * Spend for targets whose period floor has moved off the calendar (MANUAL, anchored, or reset
   * mid-period): the rollup's calendar bucket can't answer it, so the total is summed straight
   * off the ledger. An anchored budget lives here permanently.
   */
  private async readFlooredTargetSpend({
    tenantIds,
    targets,
    signal,
  }: {
    tenantIds: string[];
    targets: BudgetSpendTarget[];
    signal?: AbortSignal;
  }): Promise<ScopeSpend[]> {
    const floored = targets.filter((t) => t.periodFloorMs !== undefined);
    if (floored.length === 0) return [];

    // The table partitions by toYYYYMM(OccurredAt), and each target's own
    // floor is already inside its sumIf. Repeating the earliest of them as a
    // WHERE term is what lets ClickHouse prune partitions before the scan:
    // without it the read walks every month the tenant has ever written,
    // cold storage included, to sum a window that is usually this one.
    const earliestFloorMs = Math.min(...floored.map((t) => t.periodFloorMs ?? 0));
    try {
      const client = await this.resolveClient(tenantIds[0]!);
      const statement = clickhouseRead({ scope: tenantScope.set({ tenantIds }) })
        .from(ledger)
        .final()
        .select((ops) =>
          Object.fromEntries(
            floored.map((target, i) => [
              `T${i}`,
              fn.toString(
                fn.sumIf(
                  ledger.AmountNanoUSD,
                  flooredTargetCondition({
                    ops,
                    target,
                    scope: GatewayBudgetClickHouseRepository.scopeToClickHouse(target.scope),
                    window: GatewayBudgetClickHouseRepository.windowToClickHouse(target.window),
                    floorMs: target.periodFloorMs ?? 0,
                  }),
                ),
              ),
            ]),
          ),
        )
        .where(({ and, eq, gte }) =>
          and(eq(ledger.Status, "success"), gte(ledger.OccurredAt, earliestFloorMs)),
        )
        .build();
      const { rows } = await client.read({ statement, ...(signal && { signal }) });
      const row: Record<string, string | undefined> = rows[0] ?? {};
      return floored.map((t, i) => ({
        budgetId: t.budgetId,
        scope: t.scope,
        scopeId: t.scopeId,
        ...GatewayBudgetClickHouseRepository.spentFromNano(row[`T${i}`] ?? "0"),
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
    now: Instant;
    signal?: AbortSignal;
  }): Promise<ScopeSpend[]> {
    const { tenantIds, window, targets, now, signal } = args;
    try {
      // Any tenant resolves the client: the query hits
      // `gateway_budget_scope_totals`, a single physical table, and
      // `resolveClient` only differs by project for routing.
      const client = await this.resolveClient(tenantIds[0]!);
      const statement = clickhouseRead({ scope: tenantScope.set({ tenantIds }) })
        .from(totals)
        .select({
          BudgetId: totals.BudgetId,
          Scope: totals.Scope,
          ScopeId: totals.ScopeId,
          SpentNanoUSD: fn.toString(fn.sumMerge(totals.SpendNanoUSD)),
        })
        .where((ops) =>
          ops.and(
            ops.eq(totals.Window, GatewayBudgetClickHouseRepository.windowToClickHouse(window)),
            ops.eq(totals.PeriodStart, currentPeriodStart(window, now).epochMilliseconds),
            ops.or(
              ...targets.map((target) =>
                ops.and(
                  ops.eq(
                    totals.Scope,
                    GatewayBudgetClickHouseRepository.scopeToClickHouse(target.scope),
                  ),
                  bucketMatchCondition({ ops, columns: totals, target }),
                ),
              ),
            ),
          ),
        )
        .groupBy(totals.BudgetId, totals.Scope, totals.ScopeId)
        .build();
      const { rows } = await client.read({ statement, ...(signal && { signal }) });
      return targets.map((t) => ({
        budgetId: t.budgetId,
        scope: t.scope,
        scopeId: t.scopeId,
        ...GatewayBudgetClickHouseRepository.spentFromNano(
          GatewayBudgetClickHouseRepository.sumRollupRowsForTarget(rows, t),
        ),
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
   * Every bucket of one fanned-out budget, with what that bucket has spent in the
   * current period.
   */
  async findBucketSpendBreakdownForBudget(args: {
    budget: GatewayBudgetSpendRecord;
    tenantIds: string[];
    boundaries: BudgetBucketBoundary[];
    now?: Instant;
  }): Promise<BucketSpend[]> {
    const { budget, tenantIds, boundaries } = args;
    const now = args.now ?? nowInstant();
    if (tenantIds.length === 0) return [];

    const shape = GatewayBudgetClickHouseRepository.bucketQueryShape({
      budget,
      tenantIds,
      boundaries,
      now,
    });
    const client = await this.resolveClient(tenantIds[0]!);
    const spentByBucket =
      shape.budgetFloorMs === undefined
        ? await this.rollupBucketSpend({ client, shape, budget, now })
        : await this.flooredBucketSpend({ client, shape, budget });

    return [...spentByBucket.entries()]
      .map(([scopeId, raw]) => ({
        scopeId,
        ...GatewayBudgetClickHouseRepository.spentFromNano(raw),
      }))
      .toSorted((a, b) => (a.scopeId < b.scopeId ? -1 : 1));
  }

  /**
   * Bucket spend for a budget still on its calendar boundary. The rollup
   * pre-aggregates one row per bucket per period, which is exactly the question
   * being asked.
   */
  private async rollupBucketSpend(args: {
    client: ClickHouseClientFor;
    shape: BucketQueryShape;
    budget: GatewayBudgetSpendRecord;
    now: Instant;
  }): Promise<Map<string, string>> {
    const { client, shape, budget, now } = args;
    const spentByBucket = new Map<string, string>();
    try {
      const statement = clickhouseRead({ scope: tenantScope.set({ tenantIds: shape.tenantIds }) })
        .from(totals)
        .select({
          ScopeId: totals.ScopeId,
          SpentNanoUSD: fn.toString(fn.sumMerge(totals.SpendNanoUSD)),
        })
        .where((ops) =>
          ops.and(
            ops.eq(totals.Scope, shape.scope),
            ops.eq(totals.Window, shape.window),
            ops.eq(totals.PeriodStart, currentPeriodStart(budget.window, now).epochMilliseconds),
            budgetBucketsCondition({
              ops,
              columns: totals,
              ...GatewayBudgetClickHouseRepository.bucketsOf(shape),
            }),
          ),
        )
        .groupBy(totals.ScopeId)
        .build();
      const { rows } = await client.read({ statement });
      for (const row of rows) {
        spentByBucket.set(row.ScopeId, row.SpentNanoUSD);
      }
    } catch (error) {
      logger.warn(
        { tenantIds: shape.tenantIds, budgetId: budget.id, error },
        "failed to read gateway budget bucket spend from the rollup",
      );
      throw error;
    }

    if (shape.movedBoundaries.length === 0) return spentByBucket;

    for (const moved of shape.movedBoundaries) {
      spentByBucket.delete(moved.bucketScopeId);
    }
    for (const row of await this.readFlooredBucketSpend({
      client,
      shape,
      budgetId: budget.id,
      templateFloorMs: undefined,
    })) {
      spentByBucket.set(row.ScopeId, row.SpentNanoUSD);
    }
    return spentByBucket;
  }

  /**
   * Bucket spend for a budget whose own boundary moved (MANUAL, or a template reset mid-period):
   * the rollup's calendar bucket can't answer it, so the read goes to the raw ledger. Buckets
   * with a boundary of their own keep it; every other bucket reads the template's floor.
   */
  private async flooredBucketSpend(args: {
    client: ClickHouseClientFor;
    shape: BucketQueryShape;
    budget: GatewayBudgetSpendRecord;
  }): Promise<Map<string, string>> {
    const { client, shape, budget } = args;
    const spentByBucket = new Map<string, string>();
    for (const row of await this.readFlooredBucketSpend({
      client,
      shape,
      budgetId: budget.id,
      templateFloorMs: shape.budgetFloorMs,
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
    /** Every bucket without a moved boundary reads from here; none when undefined. */
    templateFloorMs: number | undefined;
    budgetId: string;
  }): Promise<BucketSpendRow[]> {
    const { client, shape } = args;
    try {
      const statement = clickhouseRead({ scope: tenantScope.set({ tenantIds: shape.tenantIds }) })
        .from(ledger)
        .final()
        .select({
          ScopeId: ledger.ScopeId,
          SpentNanoUSD: fn.toString(fn.sum(ledger.AmountNanoUSD)),
        })
        .where((ops) =>
          ops.and(
            ops.eq(ledger.Scope, shape.scope),
            ops.eq(ledger.Window, shape.window),
            ops.eq(ledger.Status, "success"),
            budgetBucketsCondition({
              ops,
              columns: ledger,
              ...GatewayBudgetClickHouseRepository.bucketsOf(shape),
            }),
            bucketFloorCondition({
              ops,
              moved: shape.movedBoundaries,
              templateFloorMs: args.templateFloorMs,
            }),
          ),
        )
        .groupBy(ledger.ScopeId)
        .build();
      const { rows } = await client.read({ statement });
      return rows;
    } catch (error) {
      logger.warn(
        { tenantIds: shape.tenantIds, budgetId: args.budgetId, error },
        "failed to read boundary-floored gateway budget bucket spend",
      );
      throw error;
    }
  }

  /**
   * Most recent ledger events for one budget, ordered by `OccurredAt` descending. Backs the
   * budget detail page's recent-activity panel.
   */
  async recentEventsForBudget(
    tenantIds: string[],
    budgetId: string,
    limit = 20,
  ): Promise<LedgerEventRow[]> {
    if (tenantIds.length === 0) return [];
    const since =
      nowInstant().epochMilliseconds - RECENT_EVENTS_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
    // Any tenant resolves the client — the events table is a single
    // physical table; `resolveClient` only differs by project for routing.
    const client = await this.resolveClient(tenantIds[0]!);
    const statement = clickhouseRead({ scope: tenantScope.set({ tenantIds }) })
      .from(ledger)
      .select({
        id: ledger.GatewayRequestId,
        budgetId: ledger.BudgetId,
        virtualKeyId: ledger.VirtualKeyId,
        amountNanoUsd: fn.toString(ledger.AmountNanoUSD),
        model: ledger.Model,
        providerSlot: ledger.ProviderSlot,
        tokensInput: ledger.TokensInput,
        tokensOutput: ledger.TokensOutput,
        durationMs: ledger.DurationMS,
        status: ledger.Status,
        occurredAtMs: fn.toUnixTimestamp64Milli(ledger.OccurredAt),
      })
      .where(({ and, eq, gte }) =>
        and(eq(ledger.BudgetId, budgetId), gte(ledger.OccurredAt, since)),
      )
      .orderBy(ledger.OccurredAt, "DESC")
      .limit(limit)
      .build();
    const { rows } = await client.read({ statement });
    return rows.map((row) => GatewayBudgetClickHouseRepository.toLedgerEventRow(row));
  }

  /**
   * Namespaces a restatement key inside the `GatewayRequestId` column.
   */
  private static pulledRequestId(restatementKey: string): string {
    return `${PULLED_USAGE_SCOPE}:${restatementKey}`;
  }

  private static bucketQueryShape(args: {
    budget: GatewayBudgetSpendRecord;
    tenantIds: string[];
    boundaries: BudgetBucketBoundary[];
    now: Instant;
  }): BucketQueryShape {
    const { budget, tenantIds, boundaries, now } = args;
    return {
      tenantIds,
      budgetId: budget.id,
      scopeId: budget.scopeId,
      providerKey: budget.providerKey,
      scope: GatewayBudgetClickHouseRepository.scopeToClickHouse(budget.scopeType),
      window: GatewayBudgetClickHouseRepository.windowToClickHouse(budget.window),
      // A bucket whose boundary moved reads from that boundary, or from the
      // template's own floor when the template was reset more recently.
      movedBoundaries: boundaries.map((b) => ({
        bucketScopeId: b.bucketScopeId,
        floorMs:
          computeBucketPeriodFloorMs(budget, b.periodStartedAt, now) ??
          b.periodStartedAt.epochMilliseconds,
      })),
      budgetFloorMs: computeBudgetPeriodFloorMs(budget, now),
    };
  }

  /** The budget whose buckets a breakdown reads. */
  private static bucketsOf(shape: BucketQueryShape) {
    return { budgetId: shape.budgetId, scopeId: shape.scopeId, providerKey: shape.providerKey };
  }

  /**
   * The targets still sitting on their calendar boundary, grouped by window.
   * The rollup is keyed by period, so one round-trip answers every target that
   * shares a window.
   */
  private static targetsByWindow(
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
  private static rollupRowMatchesTarget(
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
   * What one target's buckets total in a rollup result. The query asks for every
   * target in the window at once, so the rows come back mixed and each target
   * picks out its own.
   */
  private static sumRollupRowsForTarget(rows: RollupScopeRow[], target: BudgetSpendTarget): bigint {
    const scope = GatewayBudgetClickHouseRepository.scopeToClickHouse(target.scope);
    return rows
      .filter((r) => GatewayBudgetClickHouseRepository.rollupRowMatchesTarget(r, target, scope))
      .reduce((sum, r) => sum + BigInt(r.SpentNanoUSD || "0"), 0n);
  }

  /** One exact total, in both units the surface publishes. */
  private static spentFromNano(nano: bigint | string): {
    spentNanoUsd: number;
    spentUsd: string;
  } {
    const exact = typeof nano === "bigint" ? nano : BigInt(nano || "0");
    return {
      spentNanoUsd: parseSummedNanoUsd(exact),
      spentUsd: nanoUsdToDecimalString(exact),
    };
  }

  private static toLedgerEventRow(r: {
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
    occurredAtMs: string | number;
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
      status: GatewayBudgetClickHouseRepository.ledgerStatusFromCH(r.status),
      occurredAt: Temporal.Instant.fromEpochMilliseconds(Number(r.occurredAtMs)),
    };
  }

  private static ledgerStatusFromCH(raw: string): GatewayBudgetLedgerStatus {
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
  private static toSpendTargets(
    input: GatewayBudgetResource[] | BudgetSpendTarget[],
    now: Instant,
  ): BudgetSpendTarget[] {
    if (input.length === 0) return [];
    const first = input[0]!;
    return "budgetId" in first
      ? (input as BudgetSpendTarget[])
      : budgetSpendTargetsFor({
          budgets: input as GatewayBudgetResource[],
          now,
        });
  }

  private static scopeToClickHouse(scope: GatewayBudgetScopeType): string {
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

  private static windowToClickHouse(window: GatewayBudgetWindow): string {
    return window.toString();
  }
}
