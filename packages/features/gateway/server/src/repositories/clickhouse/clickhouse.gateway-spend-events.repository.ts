/**
 * Gateway spend, the per-request billing record, projected from the
 * gateway_spend_processing command pipeline.
 *
 * One row per gateway REQUEST at its latest lifecycle status (admitted ->
 * confirmed | failed | settled), keyed (TenantId, GatewayRequestId) on a
 * ReplacingMergeTree whose version is the fold's monotonic updatedAt. The
 * fold is the only writer; every read here is replacement-aware (FINAL)
 * because RMT dedup is eventual and these reads back reconciliation.
 *
 * Money: CostNanoUSD is integer nano-USD rated in the fold. The row's
 * `costUsd` string is derived at the read boundary for response-shape
 * stability; sums downstream should prefer the integer.
 *
 * See: migration 00067_create_gateway_spend.sql
 */

import { createLogger } from "@langwatch/observability";
import type { GatewayClickHouseResolver } from "../../ports/gateway-clickhouse.port";
import type { GatewaySpendState } from "../../projections/gateway-spend.projection";
import { EMPTY_SPEND_USAGE, type SpendUsage } from "../../processes/gateway-spend-commands.process";
import { GATEWAY_SPEND_PROJECTION_VERSION_LATEST } from "../../adapters/gateway-spend-constants.adapter";
import type { SpendFilters } from "../../adapters/gateway-spend-filters.adapter";
import {
  buildSpendFilterClauses,
  normalizeStatusFilter,
  SPEND_STATUS_IN_FLIGHT,
  type SpendEventStatus,
} from "../../adapters/gateway-spend-filters.adapter";
import { parseSummedNanoUsd } from "../../adapters/gateway-spend-parse.adapter";
import type { SpendBucket, SpendGroupByKey } from "../../adapters/gateway-spend-grouping.adapter";
import { bucketExpression, groupByColumn } from "../../adapters/gateway-spend-grouping.adapter";
import { nanoUsdToDecimalString } from "../../adapters/gateway-wire-money.adapter";
import {
  decodeSpendEventsCursor,
  decodeSpendSummariesCursor,
  encodeSpendEventsCursor,
  encodeSpendSummariesCursor,
  type GatewaySpendEventsCursor,
} from "../../adapters/gateway-spend-cursor.adapter";
import { GatewaySpendEventsPort } from "../../ports/gateway-spend-events.port";

const TABLE = "gateway_spend" as const;

/**
 * Deadline for one page of the rollup walk. Generous, because a reconciliation
 * over a closed month is expected to be slow and is worth waiting for; finite,
 * because the aggregation is rebuilt per page and an unbounded one would let a
 * single wide query hold a reader open for as long as it liked.
 */
const SUMMARIES_MAX_EXECUTION_SECONDS = 60;

const logger = createLogger("langwatch:gateway:spend-repository");

export type SpendEventRow = {
  tenantId: string;
  gatewayRequestId: string;
  organizationId: string;
  /** Not carried by the command pipeline; kept for response-shape
   *  stability, always empty. */
  teamId: string;
  virtualKeyId: string;
  principalUserId: string;
  endUserId: string;
  traceId: string;
  model: string;
  providerKey: string;
  requestType: string;
  tokensInput: number;
  tokensOutput: number;
  tokensCacheRead: number;
  tokensCacheWrite: number;
  tokensReasoning: number;
  /** Integer nano-USD, the authoritative figure. */
  costNanoUsd: number;
  /** Decimal USD string derived from costNanoUsd, up to 9 fractional digits. */
  costUsd: string;
  rateVersion: string;
  status: SpendEventStatus;
  errorClass: string;
  httpStatus: number;
  needsReconciliation: boolean;
  /** Why settlement fired, set only on settled rows. */
  settleReason: string;
  labels: string[];
  metadata: string;
  durationMs: number;
  occurredAt: Date;
};

export const SPEND_ROW_COLUMNS = `TenantId, GatewayRequestId, OrganizationId, VirtualKeyId,
          PrincipalUserId, EndUserId, TraceId, Model, ProviderKey, RequestType,
          TokensInput, TokensOutput, TokensCacheRead, TokensCacheWrite,
          TokensReasoning, CostNanoUSD, RateVersion, Status, ErrorClass,
          HttpStatus, NeedsReconciliation, SettleReason, Labels, Metadata,
          DurationMS, toUnixTimestamp64Milli(OccurredAt) AS OccurredAtMs`;

export interface SpendEventsPageCursor {
  occurredAtMs: number;
  gatewayRequestId: string;
}

/** One grouping dimension: the expression to group on and the alias it is
 *  selected as, so the walk can name it in ORDER BY and read it back. */
interface SummaryDimension {
  alias: string;
  expression: string;
}

export interface SpendSummaryRow {
  /**
   * The first grouping dimension's value. It stays the first dimension so a
   * consumer written against the single-dimension surface keeps reading what
   * it always did. Two dimensions can share one flat key; `group` is the
   * field that tells them apart.
   */
  key: string;
  /** Every grouping dimension by name, e.g. `{ model: "gpt-5-mini" }`. */
  group: Record<string, string>;
  /** Start of the time bucket in the requested zone, null when unbucketed. */
  bucketStart: string | null;
  eventCount: number;
  settledCount: number;
  tokensInput: number;
  tokensOutput: number;
  tokensCacheRead: number;
  tokensCacheWrite: number;
  tokensReasoning: number;
  costNanoUsd: number;
  costUsd: string;
}

export class GatewaySpendEventsRepository extends GatewaySpendEventsPort {
  constructor(private readonly resolveClient: GatewayClickHouseResolver) {
    super();
  }

  /**
   * Fold-store writer: one ReplacingMergeTree version per apply-batch
   * commit. Absolute state in, absolute row out; the RMT version is the
   * fold's monotonic updatedAt, so redelivered batches that re-set the
   * same state replace rather than duplicate.
   */
  async upsertFromFold(
    entries: Array<{
      tenantId: string;
      gatewayRequestId: string;
      state: GatewaySpendState;
    }>,
  ): Promise<void> {
    if (entries.length === 0) return;
    const tenantId = entries[0]!.tenantId;
    if (entries.some((e) => e.tenantId !== tenantId)) {
      throw new Error("GatewaySpendEventsRepository.upsertFromFold: entries span multiple tenants");
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
      ...GatewaySpendEventsRepository.usageColumns(state.usage),
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
   * Read-back for the fold store: the latest committed state for one
   * request, or null. Only rows stamped with the CURRENT projection
   * version decode; an older stamp reports a miss so the projection
   * refolds that aggregate once from the log instead of trusting a shape
   * it cannot fully decode.
   */
  async tryReadForFold({
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
               Version, CreatedAt, LastEventOccurredAt, EventTimestamp
        FROM ${TABLE} FINAL
        WHERE TenantId = {tenantId:String}
          AND GatewayRequestId = {gatewayRequestId:String}
        LIMIT 1
      `,
      query_params: { tenantId, gatewayRequestId },
      format: "JSONEachRow",
    });
    const raw = (await result.json()) as Array<Record<string, unknown>>;
    const r = raw[0];
    if (!r) return null;
    if (String(r.Version) !== GATEWAY_SPEND_PROJECTION_VERSION_LATEST) {
      return null;
    }
    const row = GatewaySpendEventsRepository.mapSpendEventRow(r);
    const usage = GatewaySpendEventsRepository.foldUsage(row, r);
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
      podId: String(r.PodId ?? ""),
      podSeq: Number(r.PodSeq ?? 0),
      usage,
      rateVersion: row.rateVersion,
      costNanoUsd: row.costNanoUsd,
      errorType: row.errorClass,
      httpStatus: row.httpStatus,
      needsReconciliation: row.needsReconciliation,
      settleReason: String(r.SettleReason ?? ""),
      occurredAtMs: row.occurredAt.getTime(),
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
    const filterSql = buildSpendFilterClauses({ filters });
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
    const raw = (await result.json()) as Array<Record<string, unknown>>;
    const rows = raw.map((row) => GatewaySpendEventsRepository.mapSpendEventRow(row));
    const last = rows[rows.length - 1];
    return {
      rows,
      nextCursor:
        rows.length === limit && last
          ? {
              occurredAtMs: last.occurredAt.getTime(),
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
    const raw = (await result.json()) as Array<Record<string, unknown>>;
    return raw.map((row) => GatewaySpendEventsRepository.mapSpendEventRow(row));
  }

  /**
   * Org-wide cursor page for the reconciliation pull surface
   * (GET /api/gateway/v1/spend-events). Ordered ASCENDING by
   * (EventTimestamp, GatewayRequestId): EventTimestamp is the fold's
   * replacement version, so rows written or restated late still sort AFTER
   * an in-flight cursor and are never skipped. `from`/`to` remain
   * OccurredAt bounds (billing periods are request-time periods).
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
    const decoded = cursor ? decodeSpendEventsCursor(cursor) : null;

    const { clauses, params: filterParams } = GatewaySpendEventsRepository.spendEventsWalkFilter({
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
    const raw = (await result.json()) as Array<Record<string, unknown>>;
    const rows = raw.map((row) => GatewaySpendEventsRepository.mapSpendEventRow(row));
    const last = raw[raw.length - 1];
    return {
      rows,
      nextCursor:
        raw.length === limit && last
          ? encodeSpendEventsCursor({
              eventTimestampMs: Number(last.EventTimestamp),
              gatewayRequestId: String(last.GatewayRequestId),
            })
          : null,
    };
  }

  /**
   * Windowed rollup for one external end user across the org's tenants
   * (GET /api/gateway/v1/end-users/:id/spend). Sums the integer nano
   * column; the USD string is derived once from the summed integer.
   * Admitted/settled rows carry zero quantities and zero cost, so
   * including them keeps requestCount honest without touching money.
   */
  /**
   * Reconciliation checksum fast path: per-key rollups over the spend
   * records, grouped by virtual key or end user. Money sums only priced
   * outcomes (confirmed and failed); settled requests are counted
   * SEPARATELY so unpriced spend is visible in the checksum instead of
   * silently reading as zero cost. Admitted rows are in-flight and
   * excluded. FINAL keeps the read replacement-aware.
   *
   * Paged by GROUP KEY ascending, not by cost descending. A checksum is only
   * a checksum if it covers every key, and a cursor over a cost ordering is
   * not walkable: the sums it orders by keep moving as late folds land, so a
   * key can cross the page boundary between two calls and be served twice or
   * skipped entirely. The group key is immutable, so the walk is exact.
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
      normalizeStatusFilter(filters.status) === SPEND_STATUS_IN_FLIGHT
    ) {
      throw new Error(
        `readSpendSummaries cannot narrow to "${SPEND_STATUS_IN_FLIGHT}": rollups exclude in-flight rows, so the read would always be empty`,
      );
    }
    if (tenantIds.length === 0) return { rows: [], nextCursor: null };
    const client = await this.resolveClient(tenantIds[0]!);

    const params: Record<string, unknown> = { tenantIds, fromMs, toMs, limit };
    const dimensions = GatewaySpendEventsRepository.summaryDimensions({ groupBy, bucket });
    if (bucket !== "none") params.timezone = timezone;

    const clauses: string[] = [];
    const walk = GatewaySpendEventsRepository.summariesWalkClause({
      cursor: cursor ? decodeSpendSummariesCursor(cursor) : null,
      dimensions,
    });
    if (walk) {
      clauses.push(walk.clause);
      Object.assign(params, walk.params);
    }

    const filterSql = buildSpendFilterClauses({ filters });
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
      // LIMIT bounds the rows returned, not the rows aggregated: every page of
      // the walk rebuilds the whole group set under FINAL before discarding all
      // but one page of it. A wide window bucketed by hour and grouped on two
      // dimensions is therefore paid for once per page, so the walk gets a
      // deadline instead of running for as long as the group set takes.
      //
      // Memory is deliberately NOT capped here: the server profile already
      // enforces a per-query ceiling and the shared defaults spill GROUP BY
      // state to disk, so a client-side cap could only raise the ceiling
      // (server/clickhouse/queryDefaults.ts).
      clickhouse_settings: {
        max_execution_time: SUMMARIES_MAX_EXECUTION_SECONDS,
      },
    });
    const raw = (await result.json()) as Array<Record<string, unknown>>;
    const last = raw[raw.length - 1];
    const nextCursor =
      raw.length === limit && last
        ? encodeSpendSummariesCursor(dimensions.map((d) => String(last[d.alias] ?? "")))
        : null;
    const rows = raw.map((r) =>
      GatewaySpendEventsRepository.mapSummaryRow({ raw: r, groupBy, bucket }),
    );
    return { rows, nextCursor };
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
          sum(TokensReasoning) AS TokensReasoning
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
    const raw = (await result.json()) as Array<Record<string, unknown>>;
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
      requestType: String(r.RequestType ?? ""),
      tokensInput: Number(r.TokensInput),
      tokensOutput: Number(r.TokensOutput),
      tokensCacheRead: Number(r.TokensCacheRead),
      tokensCacheWrite: Number(r.TokensCacheWrite),
      tokensReasoning: Number(r.TokensReasoning),
      costNanoUsd: nano,
      costUsd: nanoUsdToDecimalString(nano),
      rateVersion: String(r.RateVersion ?? ""),
      status,
      errorClass: String(r.ErrorClass),
      httpStatus: Number(r.HttpStatus),
      needsReconciliation: Number(r.NeedsReconciliation ?? 0) === 1,
      settleReason: String(r.SettleReason ?? ""),
      labels: Array.isArray(r.Labels) ? r.Labels.map(String) : [],
      metadata: String(r.Metadata ?? ""),
      durationMs: Number(r.DurationMS),
      occurredAt: new Date(Number(r.OccurredAtMs)),
    };
  }

  /**
   * The cursor and filter predicates of a spend-events walk, as clause fragments
   * already carrying their leading AND plus the bound parameters they name. Each
   * fragment is optional; an absent filter contributes neither a clause nor a
   * parameter, so the query never binds a placeholder it does not reference.
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
    const filterSql = buildSpendFilterClauses({ filters });
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
        expression: bucketExpression({ bucket, timezoneParam: "timezone" }),
      });
    }
    for (const [index, key] of groupBy.entries()) {
      dimensions.push({
        alias: `GroupKey${index}`,
        expression: groupByColumn(key),
      });
    }
    return dimensions;
  }

  /**
   * Tuple comparison over the grouping expressions: the one predicate that
   * advances a multi-dimension walk without serving a boundary group twice.
   *
   * A cursor whose arity does not match the grouping names a walk over a
   * different shape entirely, and is refused. Dropping the predicate instead
   * would serve page one again under a fresh cursor, with nothing in the
   * response to say the walk had reset, and a reconciliation would fold the
   * same groups into its checksum twice. The REST boundary refuses this by
   * comparing the two before the read, so anything reaching here is a caller
   * bug.
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
    return String(raw[column] ?? "");
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
      group[key] = GatewaySpendEventsRepository.grouped(raw, `GroupKey${index}`);
    }
    return {
      key: GatewaySpendEventsRepository.grouped(raw, "GroupKey0"),
      group,
      bucketStart:
        bucket === "none" ? null : GatewaySpendEventsRepository.grouped(raw, "GroupBucket"),
      eventCount: GatewaySpendEventsRepository.summed(raw, "EventCount"),
      settledCount: GatewaySpendEventsRepository.summed(raw, "SettledCount"),
      tokensInput: GatewaySpendEventsRepository.summed(raw, "TokensInput"),
      tokensOutput: GatewaySpendEventsRepository.summed(raw, "TokensOutput"),
      tokensCacheRead: GatewaySpendEventsRepository.summed(raw, "TokensCacheRead"),
      tokensCacheWrite: GatewaySpendEventsRepository.summed(raw, "TokensCacheWrite"),
      tokensReasoning: GatewaySpendEventsRepository.summed(raw, "TokensReasoning"),
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
    };
  }

  /**
   * The quantities a spend row carries, or null when it measured nothing.
   *
   * The quantity columns beyond the five token classes are read straight off
   * the raw row rather than through {@link mapSpendEventRow}: the mapped row
   * shapes the REST and UI surfaces, and widening it would change those
   * response bodies. The fold needs them regardless, because a late admission
   * folding over a confirmed request rewrites the whole row from this state,
   * so a quantity that does not decode here is a quantity zeroed on the next
   * write.
   *
   * Any measured quantity counts as usage, not the token classes alone: a
   * character-priced call has zero tokens and 4000 characters, and reading it
   * back as "no usage" would drop them.
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
    };
  }
}
