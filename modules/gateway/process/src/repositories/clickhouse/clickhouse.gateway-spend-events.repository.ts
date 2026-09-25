import {
  type GatewayUsageCount,
  type SpendUsage,
  nanoUsdToDecimalString,
  parseSummedNanoUsd,
  type SpendEventRow,
  type SpendEventStatus,
  type SpendFilters,
} from "@langwatch/gateway-contract";
/**
 * Gateway spend: the per-request billing record, one row per REQUEST at its
 * latest status, keyed (TenantId, GatewayRequestId) on a ReplacingMergeTree;
 * every read here is FINAL since RMT dedup is eventual. CostNanoUSD is canonical.
 */
import { createLogger } from "@langwatch/observability";
import { Temporal } from "@langwatch/time";
import { z } from "zod";

import type { GatewayClickHouseResolver } from "../../app/gateway.members.ts";
import {
  EMPTY_SPEND_USAGE,
  GATEWAY_SPEND_PROJECTION_VERSION_LATEST,
} from "../../eventing/gateway-spend-commands.process.ts";
import type { GatewaySpendState } from "../../eventing/gateway-spend.projection.ts";
import {
  GatewaySpendEventsRepository,
  type SpendBucket,
  type SpendEventsPageCursor,
  type SpendGroupByKey,
  type SpendSummaryRow,
} from "../../repositories/gateway-spend-events.repository.ts";
import {
  GatewaySpendCursorAdapter,
  type GatewaySpendEventsCursor,
} from "../../rules/gateway-spend-cursor.rules.ts";
import {
  GatewaySpendFiltersAdapter,
  SPEND_STATUS_IN_FLIGHT,
} from "../../rules/gateway-spend-filters.rules.ts";
import { GatewaySpendGroupingAdapter } from "../../rules/gateway-spend-grouping.rules.ts";

const asString = (value: unknown): string =>
  typeof value === "string" || typeof value === "number" || typeof value === "bigint"
    ? String(value)
    : "";

const spendCursors = GatewaySpendCursorAdapter.create();
const NANO_PER_USD = 1_000_000_000;
const usageRowsSchema = z.array(
  z.object({ Total: z.string(), SpendNanoUsd: z.string(), FirstMs: z.string() }),
);
const TABLE = "gateway_spend" as const;

/**
 * Deadline for one page of the rollup walk. Generous, since a closed-month reconciliation is
 * expected to be slow and worth waiting for; finite, since the aggregation rebuilds per page and
 * an unbounded one would hold a reader open indefinitely.
 */
const SUMMARIES_MAX_EXECUTION_SECONDS = 60;

const logger = createLogger("langwatch:gateway:spend-repository");

export const SPEND_ROW_COLUMNS = `TenantId, GatewayRequestId, OrganizationId, VirtualKeyId,
          PrincipalUserId, EndUserId, TraceId, Model, ProviderKey, RequestType,
          TokensInput, TokensOutput, TokensCacheRead, TokensCacheWrite,
          TokensReasoning, CostNanoUSD, RateVersion, Status, ErrorClass,
          HttpStatus, NeedsReconciliation, SettleReason, Labels, Metadata,
          DurationMS, toUnixTimestamp64Milli(OccurredAt) AS OccurredAtMs`;

/** One grouping dimension: the expression to group on and the alias it is
 *  selected as, so the walk can name it in ORDER BY and read it back. */
interface SummaryDimension {
  alias: string;
  expression: string;
}

const spendFilters = GatewaySpendFiltersAdapter.create();
const spendGrouping = GatewaySpendGroupingAdapter.create();

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
      OccurredAt: state.occurredAtMs || state.LastEventOccurredAt,
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
    const result = await client.query({
      query: `
        SELECT ${SPEND_ROW_COLUMNS}, SettleReason, PodId, PodSeq,
               TokensCacheWrite1h, TokensInputAudio, TokensOutputAudio,
               CharsInput, AudioMS,
               TokensInputImage, TokensOutputImage, ImageCount,
               Version, CreatedAt, LastEventOccurredAt, EventTimestamp
        FROM ${TABLE} FINAL
        WHERE TenantId = {tenantId:String}
          AND GatewayRequestId = {gatewayRequestId:String}
        LIMIT 1
      `,
      query_params: { tenantId, gatewayRequestId },
      format: "JSONEachRow",
    });
    const raw = (await result.json()) as Record<string, unknown>[];
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
    const conditions: string[] = [
      "TenantId = {tenantId:String}",
      "OccurredAt >= fromUnixTimestamp64Milli({fromMs:Int64})",
      "OccurredAt < fromUnixTimestamp64Milli({toMs:Int64})",
    ];
    const params: Record<string, unknown> = { tenantId, fromMs, toMs, limit };
    const filterSql = spendFilters.buildSpendFilterClauses({ filters });
    conditions.push(...filterSql.clauses);
    Object.assign(params, filterSql.params);
    if (cursor) {
      conditions.push(
        "(OccurredAt, GatewayRequestId) < (fromUnixTimestamp64Milli({cursorOccurredAtMs:Int64}), {cursorRequestId:String})",
      );
      params.cursorOccurredAtMs = cursor.occurredAtMs;
      params.cursorRequestId = cursor.gatewayRequestId;
    }

    const result = await client.query({
      query: `
        SELECT ${SPEND_ROW_COLUMNS}
        FROM ${TABLE} FINAL
        WHERE ${conditions.join(" AND ")}
        ORDER BY OccurredAt DESC, GatewayRequestId DESC
        LIMIT {limit:UInt32}
      `,
      query_params: params,
      format: "JSONEachRow",
    });
    const raw = (await result.json()) as Record<string, unknown>[];
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
    const result = await client.query({
      query: `
        SELECT ${SPEND_ROW_COLUMNS}
        FROM ${TABLE} FINAL
        WHERE TenantId = {tenantId:String}
          AND OccurredAt >= fromUnixTimestamp64Milli({fromMs:Int64})
          AND OccurredAt < fromUnixTimestamp64Milli({toMs:Int64})
        ORDER BY OccurredAt ASC, GatewayRequestId ASC
        LIMIT {limit:UInt32}
      `,
      query_params: { tenantId, fromMs, toMs, limit },
      format: "JSONEachRow",
    });
    const raw = (await result.json()) as Record<string, unknown>[];
    return raw.map((row) => ClickHouseGatewaySpendEventsRepository.mapSpendEventRow(row));
  }

  /**
   * Org-wide cursor page for reconciliation. Ordered ASCENDING by
   * (EventTimestamp, GatewayRequestId) so late-restated rows sort after the
   * cursor, never skipped; from/to stay OccurredAt (request-time) bounds.
   */
  async walkSpendEvents({
    tenantIds,
    fromMs,
    toMs,
    cursor,
    limit,
    filters = {},
  }: {
    tenantIds: string[];
    fromMs?: number;
    toMs?: number;
    cursor?: string | null;
    limit: number;
    filters?: SpendFilters;
  }): Promise<{ rows: SpendEventRow[]; nextCursor: string | null }> {
    if (tenantIds.length === 0) return { rows: [], nextCursor: null };
    const client = await this.resolveClient(tenantIds[0]!);
    const decoded = cursor ? spendCursors.decodeSpendEventsCursor(cursor) : null;

    const { clauses, params: filterParams } =
      ClickHouseGatewaySpendEventsRepository.spendEventsWalkFilter({
        decoded,
        fromMs,
        toMs,
        filters,
      });
    const params: Record<string, unknown> = {
      tenantIds,
      limit,
      ...filterParams,
    };

    const result = await client.query({
      query: `
        SELECT ${SPEND_ROW_COLUMNS}, EventTimestamp
        FROM ${TABLE} FINAL
        WHERE TenantId IN {tenantIds:Array(String)}
          ${clauses.join("\n          ")}
        ORDER BY EventTimestamp ASC, GatewayRequestId ASC
        LIMIT {limit:UInt32}
      `,
      query_params: params,
      format: "JSONEachRow",
    });
    const raw = (await result.json()) as Record<string, unknown>[];
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

    const params: Record<string, unknown> = { tenantIds, fromMs, toMs, limit };
    const dimensions = ClickHouseGatewaySpendEventsRepository.summaryDimensions({
      groupBy,
      bucket,
    });
    if (bucket !== "none") params.timezone = timezone;

    const clauses: string[] = [];
    const walk = ClickHouseGatewaySpendEventsRepository.summariesWalkClause({
      cursor: cursor ? spendCursors.decodeSpendSummariesCursor(cursor) : null,
      dimensions,
    });
    if (walk) {
      clauses.push(walk.clause);
      Object.assign(params, walk.params);
    }

    const filterSql = spendFilters.buildSpendFilterClauses({ filters });
    clauses.push(...filterSql.clauses.map((clause) => `AND ${clause}`));
    Object.assign(params, filterSql.params);

    const selection = dimensions.map((d) => `${d.expression} AS ${d.alias}`).join(",\n          ");
    const grouping = dimensions.map((d) => d.alias).join(", ");
    const ordering = dimensions.map((d) => `${d.alias} ASC`).join(", ");

    const result = await client.query({
      query: `
        SELECT
          ${selection},
          countIf(Status IN ('confirmed', 'failed')) AS EventCount,
          countIf(Status = 'settled') AS SettledCount,
          sumIf(TokensInput, Status IN ('confirmed', 'failed')) AS TokensInput,
          sumIf(TokensOutput, Status IN ('confirmed', 'failed')) AS TokensOutput,
          sumIf(TokensCacheRead, Status IN ('confirmed', 'failed')) AS TokensCacheRead,
          sumIf(TokensCacheWrite, Status IN ('confirmed', 'failed')) AS TokensCacheWrite,
          sumIf(TokensReasoning, Status IN ('confirmed', 'failed')) AS TokensReasoning,
          sumIf(TokensInputImage, Status IN ('confirmed', 'failed')) AS TokensInputImage,
          sumIf(TokensOutputImage, Status IN ('confirmed', 'failed')) AS TokensOutputImage,
          sumIf(ImageCount, Status IN ('confirmed', 'failed')) AS ImageCount,
          sumIf(CostNanoUSD, Status IN ('confirmed', 'failed')) AS CostNanoUSD
        FROM ${TABLE} FINAL
        WHERE TenantId IN {tenantIds:Array(String)}
          AND Status != '${SPEND_STATUS_IN_FLIGHT}'
          AND OccurredAt >= fromUnixTimestamp64Milli({fromMs:Int64})
          AND OccurredAt < fromUnixTimestamp64Milli({toMs:Int64})
          ${clauses.join("\n          ")}
        GROUP BY ${grouping}
        ORDER BY ${ordering}
        LIMIT {limit:UInt32}
      `,
      query_params: params,
      format: "JSONEachRow",
      // LIMIT bounds rows returned, not rows aggregated: every page rebuilds
      // the whole group set under FINAL before discarding all but one page,
      // so the walk gets a deadline instead of running as long as the group
      // set takes. Memory is deliberately uncapped here — the server profile
      // already enforces a per-query ceiling (server/clickhouse/queryDefaults.ts).
      clickhouse_settings: {
        max_execution_time: SUMMARIES_MAX_EXECUTION_SECONDS,
      },
    });
    const raw = (await result.json()) as Record<string, unknown>[];
    const last = raw[raw.length - 1];
    const nextCursor =
      raw.length === limit && last
        ? spendCursors.encodeSpendSummariesCursor(dimensions.map((d) => asString(last[d.alias])))
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
    const clauses: string[] = [];
    if (fromMs !== undefined) {
      clauses.push("AND OccurredAt >= fromUnixTimestamp64Milli({fromMs:Int64})");
    }
    if (toMs !== undefined) {
      clauses.push("AND OccurredAt < fromUnixTimestamp64Milli({toMs:Int64})");
    }
    const result = await client.query({
      query: `
        SELECT sum(CostNanoUSD) AS CostNanoUSD
        FROM ${TABLE} FINAL
        WHERE TenantId IN {tenantIds:Array(String)}
          AND RequestType = {requestType:String}
          AND Status = 'confirmed'
          ${clauses.join("\n          ")}
      `,
      query_params: {
        tenantIds,
        requestType,
        ...(fromMs === undefined ? {} : { fromMs }),
        ...(toMs === undefined ? {} : { toMs }),
      },
      format: "JSONEachRow",
    });
    const rows = (await result.json()) as Record<string, unknown>[];
    return parseSummedNanoUsd(rows[0]?.CostNanoUSD ?? 0);
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
    const vkClause = virtualKeyId !== undefined ? "AND VirtualKeyId = {virtualKeyId:String}" : "";
    const result = await client.query({
      query: `
        SELECT
          sum(CostNanoUSD) AS SpendNanoUSD,
          count() AS RequestCount,
          sum(TokensInput) AS TokensInput,
          sum(TokensOutput) AS TokensOutput,
          sum(TokensCacheRead) AS TokensCacheRead,
          sum(TokensCacheWrite) AS TokensCacheWrite,
          sum(TokensReasoning) AS TokensReasoning,
          sum(TokensInputImage) AS TokensInputImage,
          sum(TokensOutputImage) AS TokensOutputImage,
          sum(ImageCount) AS ImageCount
        FROM ${TABLE} FINAL
        WHERE TenantId IN {tenantIds:Array(String)}
          AND EndUserId = {endUserId:String}
          AND OccurredAt >= fromUnixTimestamp64Milli({fromMs:Int64})
          AND OccurredAt < fromUnixTimestamp64Milli({toMs:Int64})
          ${vkClause}
      `,
      query_params: {
        tenantIds,
        endUserId,
        fromMs,
        toMs,
        ...(virtualKeyId !== undefined ? { virtualKeyId } : {}),
      },
      format: "JSONEachRow",
    });
    const raw = (await result.json()) as Record<string, unknown>[];
    const row = raw[0];
    if (!row) return empty;
    const nano = parseSummedNanoUsd(row.SpendNanoUSD);
    return {
      spendUsd: nanoUsdToDecimalString(nano),
      spendNanoUsd: nano,
      requestCount: Number(row.RequestCount ?? 0),
      tokensInput: Number(row.TokensInput ?? 0),
      tokensOutput: Number(row.TokensOutput ?? 0),
      tokensCacheRead: Number(row.TokensCacheRead ?? 0),
      tokensCacheWrite: Number(row.TokensCacheWrite ?? 0),
      tokensReasoning: Number(row.TokensReasoning ?? 0),
      tokensInputImage: Number(row.TokensInputImage ?? 0),
      tokensOutputImage: Number(row.TokensOutputImage ?? 0),
      imageCount: Number(row.ImageCount ?? 0),
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
   * Cursor and filter predicates of a spend-events walk, as clause fragments already carrying
   * their leading AND plus bound parameters. Each is optional; an absent filter contributes
   * neither clause nor parameter, so the query never binds a placeholder it doesn't reference.
   */
  private static spendEventsWalkFilter({
    decoded,
    fromMs,
    toMs,
    filters,
  }: {
    decoded: GatewaySpendEventsCursor | null;
    fromMs?: number;
    toMs?: number;
    filters: SpendFilters;
  }): { clauses: string[]; params: Record<string, unknown> } {
    const clauses: string[] = [];
    const params: Record<string, unknown> = {};
    if (decoded) {
      clauses.push(
        "AND (EventTimestamp, GatewayRequestId) > ({cursorEventTs:UInt64}, {cursorRequestId:String})",
      );
      params.cursorEventTs = decoded.eventTimestampMs;
      params.cursorRequestId = decoded.gatewayRequestId;
    }
    if (fromMs !== undefined) {
      clauses.push("AND OccurredAt >= fromUnixTimestamp64Milli({fromMs:Int64})");
      params.fromMs = fromMs;
    }
    if (toMs !== undefined) {
      clauses.push("AND OccurredAt < fromUnixTimestamp64Milli({toMs:Int64})");
      params.toMs = toMs;
    }
    const filterSql = spendFilters.buildSpendFilterClauses({ filters });
    clauses.push(...filterSql.clauses.map((clause) => `AND ${clause}`));
    Object.assign(params, filterSql.params);
    return { clauses, params };
  }

  /**
   * The bucket leads the grouping so a walk reads the window in time order,
   * which is the shape a caller charting spend expects a page to arrive in.
   */
  private static summaryDimensions({
    groupBy,
    bucket,
  }: {
    groupBy: SpendGroupByKey[];
    bucket: SpendBucket;
  }): SummaryDimension[] {
    const dimensions: SummaryDimension[] = [];
    if (bucket !== "none") {
      dimensions.push({
        alias: "GroupBucket",
        expression: spendGrouping.bucketExpression({ bucket, timezoneParam: "timezone" }),
      });
    }
    for (const [index, key] of groupBy.entries()) {
      dimensions.push({
        alias: `GroupKey${index}`,
        expression: spendGrouping.groupByColumn(key),
      });
    }
    return dimensions;
  }

  /**
   * Tuple comparison over the grouping expressions, advancing a multi-dimension
   * walk without serving a boundary group twice. Arity mismatch is refused,
   * not dropped — dropping it would silently reset to page one.
   */
  private static summariesWalkClause({
    cursor,
    dimensions,
  }: {
    cursor: string[] | null;
    dimensions: SummaryDimension[];
  }): { clause: string; params: Record<string, unknown> } | null {
    if (cursor === null) return null;
    if (cursor.length !== dimensions.length) {
      throw new Error(
        `cursor names a walk over ${cursor.length} dimension(s); this request groups by ${dimensions.length}`,
      );
    }
    const left = dimensions.map((d) => d.expression).join(", ");
    const right = cursor.map((_, index) => `{cursor${index}:String}`).join(", ");
    const params: Record<string, unknown> = {};
    cursor.forEach((part, index) => {
      params[`cursor${index}`] = part;
    });
    return {
      clause: dimensions.length === 1 ? `AND ${left} > ${right}` : `AND (${left}) > (${right})`,
      params,
    };
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
    const nano = parseSummedNanoUsd(raw.CostNanoUSD);
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
      tokensInput: ClickHouseGatewaySpendEventsRepository.summed(raw, "TokensInput"),
      tokensOutput: ClickHouseGatewaySpendEventsRepository.summed(raw, "TokensOutput"),
      tokensCacheRead: ClickHouseGatewaySpendEventsRepository.summed(raw, "TokensCacheRead"),
      tokensCacheWrite: ClickHouseGatewaySpendEventsRepository.summed(raw, "TokensCacheWrite"),
      tokensReasoning: ClickHouseGatewaySpendEventsRepository.summed(raw, "TokensReasoning"),
      tokensInputImage: ClickHouseGatewaySpendEventsRepository.summed(raw, "TokensInputImage"),
      tokensOutputImage: ClickHouseGatewaySpendEventsRepository.summed(raw, "TokensOutputImage"),
      imageCount: ClickHouseGatewaySpendEventsRepository.summed(raw, "ImageCount"),
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
    const window =
      since === undefined ? "" : "AND OccurredAt >= fromUnixTimestamp64Milli({since:Int64})";
    const perProject = await Promise.all(
      [...new Set(projectIds)].map(async (tenantId) => {
        const client = await this.resolveClient(tenantId);
        const read = async (query: string) => {
          const result = await client.query({
            query,
            query_params: since === undefined ? { tenantId } : { tenantId, since },
            format: "JSONEachRow",
          });
          return usageRowsSchema.parse(await result.json())[0];
        };
        const [counted, earliest] = await Promise.all([
          read(`
            SELECT toString(count()) AS Total,
                   toString(sum(CostNanoUSD)) AS SpendNanoUsd,
                   '0' AS FirstMs
            FROM ${TABLE} FINAL
            WHERE TenantId = {tenantId:String}
              ${window}`),
          read(`
            SELECT toString(count()) AS Total,
                   '0' AS SpendNanoUsd,
                   toString(toUnixTimestamp64Milli(min(OccurredAt))) AS FirstMs
            FROM ${TABLE}
            WHERE TenantId = {tenantId:String}`),
        ]);
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
