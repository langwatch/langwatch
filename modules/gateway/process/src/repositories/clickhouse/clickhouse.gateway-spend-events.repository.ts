import type { IdBoundOptions } from "@langwatch/clickhouse-client";
import {
  clickhouseRead,
  type ConditionOps,
  type Expression,
  fn,
  param,
  type ReaderScope,
  tenantScope,
} from "@langwatch/clickhouse-client/builder";
import {
  type GatewaySpendDay,
  type GatewayUsageCount,
  type SpendUsage,
  nanoUsdToDecimalString,
  parseSummedNanoUsd,
  type SpendEventRow,
  type SpendEventStatus,
  type SpendFilters,
  SPEND_STATUS_IN_FLIGHT,
  type SpendBucket,
  type SpendGroupByKey,
} from "@langwatch/gateway-contract";
/**
 * Gateway spend: the per-request billing record, one row per REQUEST at its
 * latest status, keyed (TenantId, GatewayRequestId) on a ReplacingMergeTree;
 * every read here is FINAL since RMT dedup is eventual. CostNanoUSD is canonical.
 */
import { createLogger } from "@langwatch/observability";
import { Temporal, toDate } from "@langwatch/time";
import { z } from "zod";

import type { GatewaySpendState } from "../../eventing/gateway-spend.projection.ts";
import {
  GatewaySpendEventsRepository,
  type GatewaySpendModelTotal,
  type GatewaySpendVirtualKeyTotal,
  type GatewaySpendWindow,
  type SpendEventsPageCursor,
  type SpendSummaryRow,
} from "../../repositories/gateway-spend-events.repository.ts";
import * as spendCursors from "../../rules/gateway-spend-cursor.rules.ts";
import * as spendFilters from "../../rules/gateway-spend-filters.rules.ts";
import * as spendGrouping from "../../rules/gateway-spend-grouping.rules.ts";
import {
  EMPTY_SPEND_USAGE,
  GATEWAY_SPEND_PROJECTION_VERSION_LATEST,
} from "../../rules/gateway-spend-projection.rules.ts";
import type { GatewayClickHouseResolver } from "./clickhouse.gateway-session.store.ts";
import {
  spendBucketExpression,
  type SpendCondition,
  spendFilterConditions,
} from "./clickhouse.gateway-spend-query.mapper.ts";
import { gatewaySpend as spend } from "./clickhouse.gateway-spend.table.ts";

const asString = (value: unknown): string =>
  typeof value === "string" || typeof value === "number" || typeof value === "bigint"
    ? String(value)
    : "";

const NANO_PER_USD = 1_000_000_000;
const countedRowsSchema = z.array(z.object({ Total: z.string(), SpendNanoUsd: z.string() }));
const earliestRowsSchema = z.array(z.object({ Total: z.string(), FirstMs: z.string() }));
const TABLE = "gateway_spend" as const;

/**
 * Deadline for one page of the rollup walk. Generous, since a closed-month reconciliation is
 * expected to be slow and worth waiting for; finite, since the aggregation rebuilds per page and
 * an unbounded one would hold a reader open indefinitely.
 */
const SUMMARIES_MAX_EXECUTION_SECONDS = 60;

const logger = createLogger("langwatch:gateway:spend-repository");

/** One grouping dimension: the expression grouped on, and the alias it is selected as. */
interface SummaryDimension {
  alias: string;
  expression: Expression<string, "gateway_spend">;
}

/** The columns a spend row maps from (`mapSpendEventRow`). */
const SPEND_ROW = {
  TenantId: spend.TenantId,
  GatewayRequestId: spend.GatewayRequestId,
  OrganizationId: spend.OrganizationId,
  VirtualKeyId: spend.VirtualKeyId,
  PrincipalUserId: spend.PrincipalUserId,
  EndUserId: spend.EndUserId,
  TraceId: spend.TraceId,
  Model: spend.Model,
  ProviderKey: spend.ProviderKey,
  RequestType: spend.RequestType,
  TokensInput: spend.TokensInput,
  TokensOutput: spend.TokensOutput,
  TokensCacheRead: spend.TokensCacheRead,
  TokensCacheWrite: spend.TokensCacheWrite,
  TokensReasoning: spend.TokensReasoning,
  TokensInputImage: spend.TokensInputImage,
  TokensOutputImage: spend.TokensOutputImage,
  ImageCount: spend.ImageCount,
  CostNanoUSD: spend.CostNanoUSD,
  RateVersion: spend.RateVersion,
  Status: spend.Status,
  ErrorClass: spend.ErrorClass,
  HttpStatus: spend.HttpStatus,
  NeedsReconciliation: spend.NeedsReconciliation,
  SettleReason: spend.SettleReason,
  Labels: spend.Labels,
  Metadata: spend.Metadata,
  DurationMS: spend.DurationMS,
  OccurredAtMs: fn.toUnixTimestamp64Milli(spend.OccurredAt),
};

/** Each request's latest stored row (FINAL), selecting what a spend row maps from. */
function spendRowsOf(scope: ReaderScope) {
  return clickhouseRead({ scope }).from(spend).final().select(SPEND_ROW);
}

type SpendRowsRead = ReturnType<typeof spendRowsOf>;

/** `OccurredAt` bounded at each end a caller gives, so the month partitions prune. */
function occurredWithin({ fromMs, toMs }: { fromMs?: number; toMs?: number }): SpendCondition[] {
  const conditions: SpendCondition[] = [];
  if (fromMs !== undefined) conditions.push(({ gte }) => gte(spend.OccurredAt, fromMs));
  if (toMs !== undefined) conditions.push(({ lt }) => lt(spend.OccurredAt, toMs));
  return conditions;
}

const CHARGED_STATUSES = ["confirmed", "failed"];
const METERED_READ_MAX_EXECUTION_SECONDS = 20;
const DAY_MS = 86_400_000;

/** The order the per-tenant statements page in, applied again once their pages merge. */
function newestFirst(left: SpendEventRow, right: SpendEventRow): number {
  const byTime = right.occurredAt.epochMilliseconds - left.occurredAt.epochMilliseconds;
  if (byTime !== 0) return byTime;
  if (left.gatewayRequestId === right.gatewayRequestId) return 0;
  return left.gatewayRequestId < right.gatewayRequestId ? 1 : -1;
}

/**
 * Main's governance metered-lane read: each request at its latest version, then summed per one
 * dimension (`governanceGatewaySpend.clickhouse.repository.ts`). Never grouped by person.
 */
function meteredRequests({
  tenantIds,
  fromMs,
  toMs,
}: {
  tenantIds: readonly string[];
  fromMs: number;
  toMs: number;
}) {
  const scope = tenantScope.set({ tenantIds });
  const latest = <V, T extends string>(value: Expression<V, T>) =>
    fn.argMax(value, spend.EventTimestamp);
  const requests = clickhouseRead({ scope })
    .from(spend)
    .select({
      GatewayRequestId: spend.GatewayRequestId,
      RequestStatus: latest(spend.Status),
      RequestCostNanoUSD: latest(spend.CostNanoUSD),
      RequestOccurredAt: latest(spend.OccurredAt),
      RequestModel: latest(spend.Model),
      RequestVirtualKeyId: latest(spend.VirtualKeyId),
      RequestTokensInput: latest(spend.TokensInput),
      RequestTokensOutput: latest(spend.TokensOutput),
      RequestTokensCacheRead: latest(spend.TokensCacheRead),
      RequestTokensCacheWrite: latest(spend.TokensCacheWrite),
      RequestTokensReasoning: latest(spend.TokensReasoning),
    })
    .groupBy(spend.TenantId, spend.GatewayRequestId)
    .having(({ and, gte, lt }) =>
      and(gte(latest(spend.OccurredAt), fromMs), lt(latest(spend.OccurredAt), toMs)),
    )
    .as("requests");
  const tokens = [
    requests.RequestTokensOutput,
    requests.RequestTokensCacheRead,
    requests.RequestTokensCacheWrite,
    requests.RequestTokensReasoning,
  ].reduce<Expression<number, "requests">>(
    (total, each) => fn.plus(total, each),
    requests.RequestTokensInput,
  );
  /** The four figures every metered row carries, and the summed amount a ranking orders by. */
  const figuresOf = <C>({ and, eq, gt, oneOf }: ConditionOps<"requests", C>) => {
    const charged = oneOf(requests.RequestStatus, CHARGED_STATUSES);
    const amount = fn.sumIf(requests.RequestCostNanoUSD, charged);
    const figures = {
      AmountNanoUsd: fn.toString(amount),
      RequestCount: fn.countIf(charged),
      PricedRequestCount: fn.countIf(and(charged, gt(requests.RequestCostNanoUSD, 0))),
      RequestsWithoutAmount: fn.plus(
        fn.countIf(and(charged, eq(requests.RequestCostNanoUSD, 0), gt(tokens, 0))),
        fn.countIf(eq(requests.RequestStatus, "settled")),
      ),
    };
    return { figures, amount };
  };
  /** The figures, plus the amount as a number to rank by: `AmountNanoUsd` is text. */
  const ranked = <C>(ops: ConditionOps<"requests", C>) => {
    const { figures, amount } = figuresOf(ops);
    return { ...figures, AmountRank: amount };
  };
  const figures = <C>(ops: ConditionOps<"requests", C>) => figuresOf(ops).figures;
  return { requests, figures, ranked, start: clickhouseRead({ scope }).from(requests) };
}

const meteredFiguresSchema = z.object({
  AmountNanoUsd: z.union([z.string(), z.number()]),
  RequestCount: z.coerce.number(),
  PricedRequestCount: z.coerce.number(),
  RequestsWithoutAmount: z.coerce.number(),
});

const meteredFigures = (row: z.infer<typeof meteredFiguresSchema>) => ({
  amountNanoUsd: parseSummedNanoUsd(row.AmountNanoUsd),
  requestCount: row.RequestCount,
  pricedRequestCount: row.PricedRequestCount,
  requestsWithoutAmount: row.RequestsWithoutAmount,
});

const spendDayRowsSchema = z.array(z.object({ ...meteredFiguresSchema.shape, Day: z.string() }));
const spendModelRowsSchema = z.array(
  z.object({ ...meteredFiguresSchema.shape, Model: z.string() }),
);
const spendVirtualKeyRowsSchema = z.array(
  z.object({ ...meteredFiguresSchema.shape, VirtualKeyId: z.string() }),
);

const utcDayStartMs = (day: string): number =>
  Temporal.Instant.from(`${day}T00:00:00.000Z`).epochMilliseconds;

/** A window of whole UTC days, `toDay` included. */
const meteredWindow = ({ tenantIds, fromDay, toDay }: GatewaySpendWindow) => ({
  tenantIds,
  fromMs: utcDayStartMs(fromDay),
  toMs: utcDayStartMs(toDay) + DAY_MS,
});

const METERED_SETTINGS = { max_execution_time: METERED_READ_MAX_EXECUTION_SECONDS };

export class ClickHouseGatewaySpendEventsRepository extends GatewaySpendEventsRepository {
  static create(resolveClient: GatewayClickHouseResolver): ClickHouseGatewaySpendEventsRepository {
    return new ClickHouseGatewaySpendEventsRepository(resolveClient);
  }

  constructor(private readonly resolveClient: GatewayClickHouseResolver) {
    super();
  }

  /**
   * Fold-store writer: one ReplacingMergeTree version per apply-batch commit. Absolute state in,
   * absolute row out; version is the fold's monotonic updatedAt, so a redelivered batch
   * re-setting the same state replaces rather than duplicates.
   */
  async upsertFromFold(
    entries: {
      tenantId: string;
      gatewayRequestId: string;
      state: GatewaySpendState;
    }[],
  ): Promise<void> {
    if (entries.length === 0) return;
    const tenantId = entries[0]!.tenantId;
    if (entries.some((e) => e.tenantId !== tenantId)) {
      throw new Error(
        "ClickHouseGatewaySpendEventsRepository.upsertFromFold: entries span multiple tenants",
      );
    }
    const client = await this.resolveClient(tenantId);
    const records = entries.map(({ gatewayRequestId, state }) => ({
      TenantId: tenantId,
      GatewayRequestId: gatewayRequestId,
      OrganizationId: state.organizationId,
      VirtualKeyId: state.virtualKeyId,
      PrincipalUserId: state.principalUserId,
      EndUserId: state.endUserId,
      TraceId: state.traceId,
      Model: state.model,
      ProviderKey: state.providerKey,
      RequestType: state.requestType,
      Status: state.status === "" ? "admitted" : state.status,
      ErrorClass: state.errorType,
      HttpStatus: state.httpStatus,
      NeedsReconciliation: state.needsReconciliation ? 1 : 0,
      SettleReason: state.settleReason,
      ...ClickHouseGatewaySpendEventsRepository.usageColumns(state.usage),
      CostNanoUSD: state.costNanoUsd,
      RateVersion: state.rateVersion,
      Labels: state.labels,
      Metadata: state.metadataJson,
      PodId: state.podId,
      PodSeq: state.podSeq,
      DurationMS: state.durationMs,
      OccurredAt: toDate(
        Temporal.Instant.fromEpochMilliseconds(state.occurredAtMs || state.LastEventOccurredAt),
      ),
      Version: GATEWAY_SPEND_PROJECTION_VERSION_LATEST,
      CreatedAt: state.createdAt,
      LastEventOccurredAt: state.LastEventOccurredAt,
      EventTimestamp: state.updatedAt,
    }));
    try {
      await client.insert({
        table: TABLE,
        values: records,
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
      });
    } catch (error) {
      logger.warn(
        { tenantId, count: records.length, error },
        "failed to upsert gateway spend rows",
      );
      throw error;
    }
  }

  /**
   * Read-back for the fold store: latest committed state for one request, or null. Only rows
   * stamped with the CURRENT projection version decode; an older stamp reports a miss so the
   * projection refolds that aggregate from the log instead of trusting an undecodable shape.
   */
  async findForFold({
    tenantId,
    gatewayRequestId,
  }: {
    tenantId: string;
    gatewayRequestId: string;
  }): Promise<GatewaySpendState | null> {
    const client = await this.resolveClient(tenantId);
    const statement = clickhouseRead({ scope: tenantScope.single({ tenantId }) })
      .from(spend)
      .final()
      .select({
        ...SPEND_ROW,
        PodId: spend.PodId,
        PodSeq: spend.PodSeq,
        TokensCacheWrite1h: spend.TokensCacheWrite1h,
        TokensInputAudio: spend.TokensInputAudio,
        TokensOutputAudio: spend.TokensOutputAudio,
        CharsInput: spend.CharsInput,
        AudioMS: spend.AudioMS,
        WebSearchRequests: spend.WebSearchRequests,
        Version: spend.Version,
        CreatedAt: spend.CreatedAt,
        LastEventOccurredAt: spend.LastEventOccurredAt,
        EventTimestamp: spend.EventTimestamp,
      })
      .where(({ idBound }) => idBound(spend.GatewayRequestId, gatewayRequestId))
      .limit(1)
      .build();
    const { rows: raw } = await client.read({ statement, idBound: { fallback: "unbounded" } });
    const r = raw[0];
    if (!r) return null;
    if (String(r.Version) !== GATEWAY_SPEND_PROJECTION_VERSION_LATEST) {
      return null;
    }
    const row = ClickHouseGatewaySpendEventsRepository.mapSpendEventRow(r);
    const usage = ClickHouseGatewaySpendEventsRepository.foldUsage(row, r);
    return {
      status: row.status,
      organizationId: row.organizationId,
      virtualKeyId: row.virtualKeyId,
      principalUserId: row.principalUserId,
      endUserId: row.endUserId,
      model: row.model,
      providerKey: row.providerKey,
      traceId: row.traceId,
      requestType: row.requestType,
      labels: row.labels,
      metadataJson: row.metadata,
      podId: asString(r.PodId),
      podSeq: Number(r.PodSeq ?? 0),
      usage,
      rateVersion: row.rateVersion,
      costNanoUsd: row.costNanoUsd,
      errorType: row.errorClass,
      httpStatus: row.httpStatus,
      needsReconciliation: row.needsReconciliation,
      settleReason: asString(r.SettleReason),
      occurredAtMs: row.occurredAt.epochMilliseconds,
      durationMs: row.durationMs,
      createdAt: Number(r.CreatedAt ?? 0),
      updatedAt: Number(r.EventTimestamp ?? 0),
      LastEventOccurredAt: Number(r.LastEventOccurredAt ?? 0),
    };
  }

  /**
   * Newest-first page read for the ledger UI. Keyset pagination on
   * (OccurredAt, GatewayRequestId) DESC so a page boundary never skips or
   * repeats rows while inserts land.
   */
  async readSpendEventsPage({
    tenantId,
    fromMs,
    toMs,
    filters = {},
    cursor,
    limit = 50,
  }: {
    tenantId: string;
    fromMs: number;
    toMs: number;
    filters?: SpendFilters;
    cursor?: SpendEventsPageCursor;
    limit?: number;
  }): Promise<{
    rows: SpendEventRow[];
    nextCursor: SpendEventsPageCursor | null;
  }> {
    const client = await this.resolveClient(tenantId);
    let read = spendRowsOf(tenantScope.single({ tenantId }));
    const conditions = [...occurredWithin({ fromMs, toMs }), ...spendFilterConditions({ filters })];
    for (const condition of conditions) read = read.where(condition);
    if (cursor) {
      read = read.where(({ lt }) =>
        lt(
          fn.tuple(spend.OccurredAt, spend.GatewayRequestId),
          fn.tuple(param.epochMs(cursor.occurredAtMs), param.string(cursor.gatewayRequestId)),
        ),
      );
    }
    const statement = read
      .orderBy(spend.OccurredAt, "DESC")
      .orderBy(spend.GatewayRequestId, "DESC")
      .limit(limit)
      .build();
    const { rows: raw } = await client.read({ statement });
    const rows = raw.map((row) => ClickHouseGatewaySpendEventsRepository.mapSpendEventRow(row));
    const last = rows[rows.length - 1];
    return {
      rows,
      nextCursor:
        rows.length === limit && last
          ? {
              occurredAtMs: last.occurredAt.epochMilliseconds,
              gatewayRequestId: last.gatewayRequestId,
            }
          : null,
    };
  }

  /**
   * Replacement-aware range read for tests and internal consumers.
   */
  async readSpendEvents({
    tenantId,
    fromMs,
    toMs,
    limit = 1000,
  }: {
    tenantId: string;
    fromMs: number;
    toMs: number;
    limit?: number;
  }): Promise<SpendEventRow[]> {
    const client = await this.resolveClient(tenantId);
    const statement = spendRowsOf(tenantScope.single({ tenantId }))
      .where(({ range }) => range(spend.OccurredAt, { from: fromMs, until: toMs }))
      .orderBy(spend.OccurredAt, "ASC")
      .orderBy(spend.GatewayRequestId, "ASC")
      .limit(limit)
      .build();
    const { rows: raw } = await client.read({ statement });
    return raw.map((row) => ClickHouseGatewaySpendEventsRepository.mapSpendEventRow(row));
  }

  /**
   * Org-wide cursor page for reconciliation. Ordered ASCENDING by
   * (EventTimestamp, GatewayRequestId) so late-restated rows sort after the
   * cursor, never skipped; from/to stay OccurredAt (request-time) bounds.
   */
  async readSpendEventsAcrossTenants(input: {
    tenantIds: string[];
    statuses: string[];
    fromMs?: number;
    toMs?: number;
    cursor?: string | null;
    limit: number;
  }): Promise<{ rows: SpendEventRow[]; nextCursor: string | null }> {
    if (input.tenantIds.length === 0 || input.statuses.length === 0) {
      return { rows: [], nextCursor: null };
    }
    const { statuses, limit } = input;
    const cursor = input.cursor ? spendCursors.decodeSpendEventsCursor(input.cursor) : null;
    const narrow = (base: SpendRowsRead): SpendRowsRead => {
      let read = base.where(({ oneOf }) => oneOf(spend.Status, statuses));
      for (const condition of occurredWithin(input)) read = read.where(condition);
      if (cursor) {
        read = read.where(({ lt }) =>
          lt(
            fn.tuple(spend.OccurredAt, spend.GatewayRequestId),
            fn.tuple(param.epochMs(cursor.eventTimestampMs), param.string(cursor.gatewayRequestId)),
          ),
        );
      }
      return read
        .orderBy(spend.OccurredAt, "DESC")
        .orderBy(spend.GatewayRequestId, "DESC")
        .limit(limit);
    };
    const perTenant = await Promise.all(
      input.tenantIds.map((tenantId) => this.readTenantSpendRows({ tenantId, narrow })),
    );
    const rows = perTenant.flat().toSorted(newestFirst).slice(0, input.limit);
    const last = rows.at(-1);
    return {
      rows,
      nextCursor:
        rows.length === input.limit && last
          ? spendCursors.encodeSpendEventsCursor({
              eventTimestampMs: last.occurredAt.epochMilliseconds,
              gatewayRequestId: last.gatewayRequestId,
            })
          : null,
    };
  }

  async findSpendEventAcrossTenants(input: {
    tenantIds: string[];
    gatewayRequestId: string;
    statuses: string[];
  }): Promise<SpendEventRow | null> {
    if (input.statuses.length === 0) return null;
    const perTenant = await Promise.all(
      input.tenantIds.map((tenantId) =>
        this.readTenantSpendRows({
          tenantId,
          narrow: (read) =>
            read
              .where(({ idBound }) => idBound(spend.GatewayRequestId, input.gatewayRequestId))
              .where(({ oneOf }) => oneOf(spend.Status, input.statuses))
              .limit(1),
          idBound: { fallback: "unbounded" },
        }),
      ),
    );
    return perTenant.flat()[0] ?? null;
  }

  /** One statement per project tenant: the tenant guard admits exactly one tenant per read. */
  private async readTenantSpendRows({
    tenantId,
    narrow,
    idBound,
  }: {
    tenantId: string;
    narrow: (read: SpendRowsRead) => SpendRowsRead;
    idBound?: IdBoundOptions;
  }): Promise<SpendEventRow[]> {
    const client = await this.resolveClient(tenantId);
    const statement = narrow(spendRowsOf(tenantScope.single({ tenantId }))).build();
    const { rows } = await client.read({
      statement,
      ...(idBound === undefined ? {} : { idBound }),
    });
    return rows.map((row) => ClickHouseGatewaySpendEventsRepository.mapSpendEventRow(row));
  }

  async walkSpendEvents({
    tenantIds,
    fromMs,
    toMs,
    cursor,
    limit,
    filters = {},
    SKIP_COLD_SCAN_CHECK,
  }: {
    tenantIds: string[];
    fromMs?: number;
    toMs?: number;
    cursor?: string | null;
    limit: number;
    filters?: SpendFilters;
    SKIP_COLD_SCAN_CHECK?: true;
  }): Promise<{ rows: SpendEventRow[]; nextCursor: string | null }> {
    if (tenantIds.length === 0) return { rows: [], nextCursor: null };
    const client = await this.resolveClient(tenantIds[0]!);
    const decoded = cursor ? spendCursors.decodeSpendEventsCursor(cursor) : null;

    let read = clickhouseRead({ scope: tenantScope.set({ tenantIds }) })
      .from(spend)
      .final()
      .select({ ...SPEND_ROW, EventTimestamp: spend.EventTimestamp });
    if (decoded) {
      read = read.where(({ gt }) =>
        gt(
          fn.tuple(spend.EventTimestamp, spend.GatewayRequestId),
          fn.tuple(param.uint64(decoded.eventTimestampMs), param.string(decoded.gatewayRequestId)),
        ),
      );
    }
    const conditions = [...occurredWithin({ fromMs, toMs }), ...spendFilterConditions({ filters })];
    for (const condition of conditions) read = read.where(condition);
    const statement = read
      .orderBy(spend.EventTimestamp, "ASC")
      .orderBy(spend.GatewayRequestId, "ASC")
      .limit(limit)
      .build();
    const { rows: raw } = await client.read({
      statement,
      ...(SKIP_COLD_SCAN_CHECK === true ? { declaresFullScan: true as const } : {}),
    });
    const rows = raw.map((row) => ClickHouseGatewaySpendEventsRepository.mapSpendEventRow(row));
    const last = raw[raw.length - 1];
    return {
      rows,
      nextCursor:
        raw.length === limit && last
          ? spendCursors.encodeSpendEventsCursor({
              eventTimestampMs: Number(last.EventTimestamp),
              gatewayRequestId: String(last.GatewayRequestId),
            })
          : null,
    };
  }

  /**
   * Windowed end-user rollup, summing the integer nano column once. Settled
   * spend is counted SEPARATELY so it stays visible rather than reading as
   * zero. Paged by GROUP KEY (immutable), not cost — cost moves as folds land.
   */
  async readSpendSummaries({
    tenantIds,
    groupBy,
    bucket = "none",
    timezone = "UTC",
    fromMs,
    toMs,
    cursor,
    limit = 500,
    filters = {},
  }: {
    tenantIds: string[];
    groupBy: SpendGroupByKey[];
    bucket?: SpendBucket;
    timezone?: string;
    fromMs: number;
    toMs: number;
    cursor?: string | null;
    limit?: number;
    filters?: SpendFilters;
  }): Promise<{ rows: SpendSummaryRow[]; nextCursor: string | null }> {
    // The fixed predicate below drops in-flight rows, so narrowing to that
    // status asks for the intersection of two disjoint sets. The REST boundary
    // refuses it by schema; anything reaching here with it is a caller bug, and
    // an empty page would be read as "no such spend".
    if (
      filters.status !== undefined &&
      spendFilters.normalizeStatusFilter(filters.status) === SPEND_STATUS_IN_FLIGHT
    ) {
      throw new Error(
        `readSpendSummaries cannot narrow to "${SPEND_STATUS_IN_FLIGHT}": rollups exclude in-flight rows, so the read would always be empty`,
      );
    }
    if (tenantIds.length === 0) return { rows: [], nextCursor: null };
    const client = await this.resolveClient(tenantIds[0]!);
    const dimensions = ClickHouseGatewaySpendEventsRepository.summaryDimensions({
      groupBy,
      bucket,
      timezone,
    });
    const keys = dimensions.map((dimension) => dimension.alias);

    let read = clickhouseRead({ scope: tenantScope.set({ tenantIds }) })
      .from(spend)
      .final()
      .select((ops) => {
        const charged = ops.oneOf(spend.Status, CHARGED_STATUSES);
        const sumCharged = (column: Expression<number, "gateway_spend">) =>
          fn.sumIf(column, charged);
        return {
          ...Object.fromEntries(
            dimensions.map((dimension) => [dimension.alias, dimension.expression]),
          ),
          EventCount: fn.countIf(charged),
          SettledCount: fn.countIf(ops.eq(spend.Status, "settled")),
          SumTokensInput: sumCharged(spend.TokensInput),
          SumTokensOutput: sumCharged(spend.TokensOutput),
          SumTokensCacheRead: sumCharged(spend.TokensCacheRead),
          SumTokensCacheWrite: sumCharged(spend.TokensCacheWrite),
          SumTokensReasoning: sumCharged(spend.TokensReasoning),
          SumTokensInputImage: sumCharged(spend.TokensInputImage),
          SumTokensOutputImage: sumCharged(spend.TokensOutputImage),
          SumImageCount: sumCharged(spend.ImageCount),
          SumCostNanoUSD: sumCharged(spend.CostNanoUSD),
        };
      })
      .where(({ and, ne, range }) =>
        and(
          ne(spend.Status, SPEND_STATUS_IN_FLIGHT),
          range(spend.OccurredAt, { from: fromMs, until: toMs }),
        ),
      );
    const walk = ClickHouseGatewaySpendEventsRepository.summariesWalkCondition({
      cursor: cursor ? spendCursors.decodeSpendSummariesCursor(cursor) : null,
      dimensions,
    });
    if (walk) read = read.where(walk);
    for (const condition of spendFilterConditions({ filters })) {
      read = read.where(condition);
    }
    read = read.groupBy(...dimensions.map((dimension) => dimension.expression));
    for (const dimension of dimensions) read = read.orderBy(dimension.expression, "ASC");

    const { rows: raw } = await client.read({
      // LIMIT bounds rows returned, not rows aggregated: every page rebuilds
      // the whole group set under FINAL before discarding all but one page,
      // so the walk gets a deadline instead of running as long as the group
      // set takes. Memory is uncapped: the server profile caps each query.
      statement: read
        .limit(limit)
        .settings({ max_execution_time: SUMMARIES_MAX_EXECUTION_SECONDS })
        .build(),
    });
    const last = raw[raw.length - 1];
    const nextCursor =
      raw.length === limit && last
        ? spendCursors.encodeSpendSummariesCursor(
            keys.map((key) => asString((last as Record<string, unknown>)[key])),
          )
        : null;
    const rows = raw.map((r) =>
      ClickHouseGatewaySpendEventsRepository.mapSummaryRow({ raw: r, groupBy, bucket }),
    );
    return { rows, nextCursor };
  }

  /**
   * Confirmed rows only, and the window is optional: a lifetime allowance
   * reads the whole ledger, and a caller that gives one bounds `OccurredAt`
   * so the month partitions prune.
   */
  async sumCostNanoUsdByRequestType({
    tenantIds,
    requestType,
    fromMs,
    toMs,
  }: {
    tenantIds: string[];
    requestType: string;
    fromMs?: number;
    toMs?: number;
  }): Promise<number> {
    if (tenantIds.length === 0) return 0;
    const client = await this.resolveClient(tenantIds[0]!);
    let read = clickhouseRead({ scope: tenantScope.set({ tenantIds }) })
      .from(spend)
      .final()
      .select({ SumCostNanoUSD: fn.sum(spend.CostNanoUSD) })
      .where(({ and, eq }) =>
        and(eq(spend.RequestType, requestType), eq(spend.Status, "confirmed")),
      );
    for (const condition of occurredWithin({ fromMs, toMs })) read = read.where(condition);
    const { rows } = await client.read({ statement: read.build() });
    return parseSummedNanoUsd(rows[0]?.SumCostNanoUSD ?? 0);
  }

  async sumDaysForOrganizationProjects(input: GatewaySpendWindow): Promise<GatewaySpendDay[]> {
    if (input.tenantIds.length === 0) return [];
    const client = await this.resolveClient(input.tenantIds[0]!);
    const metered = meteredRequests(meteredWindow(input));
    const day = fn.toDate(fn.toStartOfDay(metered.requests.RequestOccurredAt, { timeZone: "UTC" }));
    const statement = metered.start
      .select((ops) => ({ Day: day, ...metered.figures(ops) }))
      .groupBy(day)
      .orderBy("Day")
      .settings(METERED_SETTINGS)
      .build();
    const { rows } = await client.read({ statement });
    return spendDayRowsSchema.parse(rows).map((row) => ({ day: row.Day, ...meteredFigures(row) }));
  }

  async sumWindowByModel(input: GatewaySpendWindow): Promise<GatewaySpendModelTotal[]> {
    if (input.tenantIds.length === 0) return [];
    const client = await this.resolveClient(input.tenantIds[0]!);
    const metered = meteredRequests(meteredWindow(input));
    const statement = metered.start
      .select((ops) => ({ Model: metered.requests.RequestModel, ...metered.ranked(ops) }))
      .groupBy(metered.requests.RequestModel)
      .orderBy("AmountRank", "DESC")
      .orderBy("Model")
      .settings(METERED_SETTINGS)
      .build();
    const { rows } = await client.read({ statement });
    return spendModelRowsSchema
      .parse(rows)
      .map((row) => ({ model: row.Model, ...meteredFigures(row) }));
  }

  async sumWindowByVirtualKey(input: GatewaySpendWindow): Promise<GatewaySpendVirtualKeyTotal[]> {
    if (input.tenantIds.length === 0) return [];
    const client = await this.resolveClient(input.tenantIds[0]!);
    const metered = meteredRequests(meteredWindow(input));
    const statement = metered.start
      .select((ops) => ({
        VirtualKeyId: metered.requests.RequestVirtualKeyId,
        ...metered.ranked(ops),
      }))
      .groupBy(metered.requests.RequestVirtualKeyId)
      .orderBy("AmountRank", "DESC")
      .orderBy("VirtualKeyId")
      .settings(METERED_SETTINGS)
      .build();
    const { rows } = await client.read({ statement });
    return spendVirtualKeyRowsSchema
      .parse(rows)
      .map((row) => ({ virtualKeyId: row.VirtualKeyId, ...meteredFigures(row) }));
  }

  async readEndUserSpend({
    tenantIds,
    endUserId,
    fromMs,
    toMs,
    virtualKeyId,
  }: {
    tenantIds: string[];
    endUserId: string;
    fromMs: number;
    toMs: number;
    virtualKeyId?: string;
  }): Promise<{
    spendUsd: string;
    spendNanoUsd: number;
    requestCount: number;
    tokensInput: number;
    tokensOutput: number;
    tokensCacheRead: number;
    tokensCacheWrite: number;
    tokensReasoning: number;
    tokensInputImage: number;
    tokensOutputImage: number;
    imageCount: number;
  }> {
    const empty = {
      spendUsd: nanoUsdToDecimalString(0),
      spendNanoUsd: 0,
      requestCount: 0,
      tokensInput: 0,
      tokensOutput: 0,
      tokensCacheRead: 0,
      tokensCacheWrite: 0,
      tokensReasoning: 0,
      tokensInputImage: 0,
      tokensOutputImage: 0,
      imageCount: 0,
    };
    if (tenantIds.length === 0) return empty;
    const client = await this.resolveClient(tenantIds[0]!);
    let read = clickhouseRead({ scope: tenantScope.set({ tenantIds }) })
      .from(spend)
      .final()
      .select({
        SpendNanoUSD: fn.sum(spend.CostNanoUSD),
        RequestCount: fn.count(),
        SumTokensInput: fn.sum(spend.TokensInput),
        SumTokensOutput: fn.sum(spend.TokensOutput),
        SumTokensCacheRead: fn.sum(spend.TokensCacheRead),
        SumTokensCacheWrite: fn.sum(spend.TokensCacheWrite),
        SumTokensReasoning: fn.sum(spend.TokensReasoning),
        SumTokensInputImage: fn.sum(spend.TokensInputImage),
        SumTokensOutputImage: fn.sum(spend.TokensOutputImage),
        SumImageCount: fn.sum(spend.ImageCount),
      })
      .where(({ and, eq, range }) =>
        and(eq(spend.EndUserId, endUserId), range(spend.OccurredAt, { from: fromMs, until: toMs })),
      );
    if (virtualKeyId !== undefined) {
      read = read.where(({ eq }) => eq(spend.VirtualKeyId, virtualKeyId));
    }
    const { rows: raw } = await client.read({ statement: read.build() });
    const row = raw[0];
    if (!row) return empty;
    const nano = parseSummedNanoUsd(row.SpendNanoUSD);
    return {
      spendUsd: nanoUsdToDecimalString(nano),
      spendNanoUsd: nano,
      requestCount: Number(row.RequestCount ?? 0),
      tokensInput: Number(row.SumTokensInput ?? 0),
      tokensOutput: Number(row.SumTokensOutput ?? 0),
      tokensCacheRead: Number(row.SumTokensCacheRead ?? 0),
      tokensCacheWrite: Number(row.SumTokensCacheWrite ?? 0),
      tokensReasoning: Number(row.SumTokensReasoning ?? 0),
      tokensInputImage: Number(row.SumTokensInputImage ?? 0),
      tokensOutputImage: Number(row.SumTokensOutputImage ?? 0),
      imageCount: Number(row.SumImageCount ?? 0),
    };
  }

  static mapSpendEventRow(r: Record<string, unknown>): SpendEventRow {
    const nano = Number(r.CostNanoUSD ?? 0);
    const status = String(r.Status) as SpendEventStatus;
    return {
      tenantId: String(r.TenantId),
      gatewayRequestId: String(r.GatewayRequestId),
      organizationId: String(r.OrganizationId),
      teamId: "",
      virtualKeyId: String(r.VirtualKeyId),
      principalUserId: String(r.PrincipalUserId),
      endUserId: String(r.EndUserId),
      traceId: String(r.TraceId),
      model: String(r.Model),
      providerKey: String(r.ProviderKey),
      requestType: asString(r.RequestType),
      tokensInput: Number(r.TokensInput),
      tokensOutput: Number(r.TokensOutput),
      tokensCacheRead: Number(r.TokensCacheRead),
      tokensCacheWrite: Number(r.TokensCacheWrite),
      tokensReasoning: Number(r.TokensReasoning),
      tokensInputImage: Number(r.TokensInputImage ?? 0),
      tokensOutputImage: Number(r.TokensOutputImage ?? 0),
      imageCount: Number(r.ImageCount ?? 0),
      costNanoUsd: nano,
      costUsd: nanoUsdToDecimalString(nano),
      rateVersion: asString(r.RateVersion),
      status,
      errorClass: String(r.ErrorClass),
      httpStatus: Number(r.HttpStatus),
      needsReconciliation: Number(r.NeedsReconciliation ?? 0) === 1,
      settleReason: asString(r.SettleReason),
      labels: Array.isArray(r.Labels) ? r.Labels.map(String) : [],
      metadata: asString(r.Metadata),
      durationMs: Number(r.DurationMS),
      occurredAt: Temporal.Instant.fromEpochMilliseconds(Number(r.OccurredAtMs)),
    };
  }

  /**
   * The bucket leads the grouping so a walk reads the window in time order,
   * which is the shape a caller charting spend expects a page to arrive in.
   */
  private static summaryDimensions({
    groupBy,
    bucket,
    timezone,
  }: {
    groupBy: SpendGroupByKey[];
    bucket: SpendBucket;
    timezone: string;
  }): SummaryDimension[] {
    const dimensions: SummaryDimension[] = [];
    if (bucket !== "none") {
      dimensions.push({
        alias: "GroupBucket",
        expression: spendBucketExpression({ bucket, timezone }),
      });
    }
    for (const [index, key] of groupBy.entries()) {
      dimensions.push({
        alias: `GroupKey${index}`,
        expression: spend[spendGrouping.groupByColumn(key)],
      });
    }
    return dimensions;
  }

  /**
   * Tuple comparison over the grouping expressions, advancing a multi-dimension
   * walk without serving a boundary group twice. Arity mismatch is refused,
   * not dropped — dropping it would silently reset to page one.
   */
  private static summariesWalkCondition({
    cursor,
    dimensions,
  }: {
    cursor: string[] | null;
    dimensions: SummaryDimension[];
  }): SpendCondition | null {
    if (cursor === null) return null;
    if (cursor.length !== dimensions.length) {
      throw new Error(
        `cursor names a walk over ${cursor.length} dimension(s); this request groups by ${dimensions.length}`,
      );
    }
    const [only] = dimensions;
    if (dimensions.length === 1 && only !== undefined) {
      return ({ gt }) => gt(only.expression, param.string(cursor[0]!));
    }
    return ({ gt }) =>
      gt(
        fn.tuple(...dimensions.map((dimension) => dimension.expression)),
        fn.tuple(...cursor.map((part) => param.string(part))),
      );
  }

  /**
   * Zero is the honest answer for an absent aggregate here: a group only exists
   * in the result because at least one row produced it, so a missing column is
   * a sum over rows that all carried nothing, not an unknown quantity.
   */
  private static summed(raw: Record<string, unknown>, column: string): number {
    return Number(raw[column] ?? 0);
  }

  /** A grouping value is a String column, so an absent one is the empty key. */
  private static grouped(raw: Record<string, unknown>, column: string): string {
    return asString(raw[column]);
  }

  private static mapSummaryRow({
    raw,
    groupBy,
    bucket,
  }: {
    raw: Record<string, unknown>;
    groupBy: SpendGroupByKey[];
    bucket: SpendBucket;
  }): SpendSummaryRow {
    const nano = parseSummedNanoUsd(raw.SumCostNanoUSD);
    const group: Record<string, string> = {};
    for (const [index, key] of groupBy.entries()) {
      group[key] = ClickHouseGatewaySpendEventsRepository.grouped(raw, `GroupKey${index}`);
    }
    return {
      key: ClickHouseGatewaySpendEventsRepository.grouped(raw, "GroupKey0"),
      group,
      bucketStart:
        bucket === "none"
          ? null
          : ClickHouseGatewaySpendEventsRepository.grouped(raw, "GroupBucket"),
      eventCount: ClickHouseGatewaySpendEventsRepository.summed(raw, "EventCount"),
      settledCount: ClickHouseGatewaySpendEventsRepository.summed(raw, "SettledCount"),
      tokensInput: ClickHouseGatewaySpendEventsRepository.summed(raw, "SumTokensInput"),
      tokensOutput: ClickHouseGatewaySpendEventsRepository.summed(raw, "SumTokensOutput"),
      tokensCacheRead: ClickHouseGatewaySpendEventsRepository.summed(raw, "SumTokensCacheRead"),
      tokensCacheWrite: ClickHouseGatewaySpendEventsRepository.summed(raw, "SumTokensCacheWrite"),
      tokensReasoning: ClickHouseGatewaySpendEventsRepository.summed(raw, "SumTokensReasoning"),
      tokensInputImage: ClickHouseGatewaySpendEventsRepository.summed(raw, "SumTokensInputImage"),
      tokensOutputImage: ClickHouseGatewaySpendEventsRepository.summed(raw, "SumTokensOutputImage"),
      imageCount: ClickHouseGatewaySpendEventsRepository.summed(raw, "SumImageCount"),
      costNanoUsd: nano,
      costUsd: nanoUsdToDecimalString(nano),
    };
  }

  /** One quantity column per field of the vocabulary. A request with no
   *  measured usage writes zeros, which is what the column defaults hold for
   *  every row written before the quantity existed. */
  private static usageColumns(usage: SpendUsage | null): Record<string, number> {
    const quantities = usage ?? EMPTY_SPEND_USAGE;
    return {
      TokensInput: quantities.input_tokens,
      TokensOutput: quantities.output_tokens,
      TokensCacheRead: quantities.cache_read_input_tokens,
      TokensCacheWrite: quantities.cache_creation_input_tokens,
      TokensCacheWrite1h: quantities.cache_creation_1h_tokens,
      TokensReasoning: quantities.reasoning_tokens,
      TokensInputAudio: quantities.input_audio_tokens,
      TokensOutputAudio: quantities.output_audio_tokens,
      CharsInput: quantities.input_chars,
      AudioMS: quantities.audio_ms,
      TokensInputImage: quantities.input_image_tokens,
      TokensOutputImage: quantities.output_image_tokens,
      ImageCount: quantities.image_count,
      WebSearchRequests: quantities.web_search_requests,
    };
  }

  /**
   * Quantities a spend row carries, or null if it measured nothing, read off
   * the raw row since a late admission rewrites it whole. Usage isn't tokens
   * alone — a character-priced call has zero tokens, thousands of characters.
   */
  private static foldUsage(row: SpendEventRow, raw: Record<string, unknown>): SpendUsage | null {
    const quantity = (column: string): number => Number(raw[column] ?? 0);
    const measured = [
      row.tokensInput,
      row.tokensOutput,
      quantity("CharsInput"),
      quantity("AudioMS"),
      quantity("TokensInputAudio"),
      quantity("TokensOutputAudio"),
      quantity("TokensCacheWrite1h"),
      quantity("TokensInputImage"),
      quantity("TokensOutputImage"),
      quantity("ImageCount"),
      quantity("WebSearchRequests"),
    ];
    const outcome = row.status === "confirmed" || row.status === "failed";
    if (!outcome && !measured.some((value) => value > 0)) return null;
    return {
      input_tokens: row.tokensInput,
      output_tokens: row.tokensOutput,
      cache_read_input_tokens: row.tokensCacheRead,
      cache_creation_input_tokens: row.tokensCacheWrite,
      cache_creation_1h_tokens: quantity("TokensCacheWrite1h"),
      reasoning_tokens: row.tokensReasoning,
      input_audio_tokens: quantity("TokensInputAudio"),
      output_audio_tokens: quantity("TokensOutputAudio"),
      input_chars: quantity("CharsInput"),
      audio_ms: quantity("AudioMS"),
      input_image_tokens: quantity("TokensInputImage"),
      output_image_tokens: quantity("TokensOutputImage"),
      image_count: quantity("ImageCount"),
      web_search_requests: quantity("WebSearchRequests"),
    };
  }

  /** Per project, so each read routes to the tenant's server; the ledger keeps thirteen months. */
  async countUsage({
    projectIds,
    since,
  }: {
    projectIds: readonly string[];
    since?: number;
  }): Promise<GatewayUsageCount> {
    const perProject = await Promise.all(
      [...new Set(projectIds)].map(async (tenantId) => {
        const client = await this.resolveClient(tenantId);
        const scope = tenantScope.single({ tenantId });
        let counting = clickhouseRead({ scope })
          .from(spend)
          .final()
          .select({
            Total: fn.toString(fn.count()),
            SpendNanoUsd: fn.toString(fn.sum(spend.CostNanoUSD)),
          });
        if (since !== undefined)
          counting = counting.where(({ gte }) => gte(spend.OccurredAt, since));
        const first = clickhouseRead({ scope })
          .from(spend)
          .select({
            Total: fn.toString(fn.count()),
            FirstMs: fn.toString(fn.toUnixTimestamp64Milli(fn.min(spend.OccurredAt))),
          });
        const [countedRows, earliestRows] = await Promise.all([
          client.read({ statement: counting.build() }),
          client.read({ statement: first.build() }),
        ]);
        const [counted] = countedRowsSchema.parse(countedRows.rows);
        const [earliest] = earliestRowsSchema.parse(earliestRows.rows);
        return {
          requests: Number.parseInt(counted?.Total ?? "0", 10),
          spendUsd: Number(counted?.SpendNanoUsd ?? "0") / NANO_PER_USD,
          first:
            Number.parseInt(earliest?.Total ?? "0", 10) === 0
              ? []
              : [Number(earliest?.FirstMs ?? "0")],
        };
      }),
    );
    const firsts = perProject.flatMap((project) => project.first);
    return {
      requests: perProject.reduce((sum, project) => sum + project.requests, 0),
      spendUsd: perProject.reduce((sum, project) => sum + project.spendUsd, 0),
      ...(firsts.length === 0 ? {} : { firstRequestAt: Math.min(...firsts) }),
    };
  }
}
