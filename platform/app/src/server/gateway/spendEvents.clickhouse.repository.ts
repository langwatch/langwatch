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
import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import type { GatewaySpendState } from "~/server/event-sourcing/pipelines/gateway-spend-processing/projections/gatewaySpend.foldProjection";
import { GATEWAY_SPEND_PROJECTION_VERSION_LATEST } from "~/server/event-sourcing/pipelines/gateway-spend-processing/schemas/constants";
import type { SpendFilters } from "./spendFilters";
import { buildSpendFilterClauses } from "./spendFilters";
import type { SpendBucket, SpendGroupByKey } from "./spendGrouping";
import { bucketExpression, groupByColumn } from "./spendGrouping";
import { nanoUsdToDecimalString } from "./wireMoney";

const TABLE = "gateway_spend" as const;

const logger = createLogger("langwatch:gateway:spend-repository");

export type SpendEventStatus = "admitted" | "confirmed" | "failed" | "settled";

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

/** Parse a summed Int64 nano-USD value, refusing silent float rounding:
 *  ClickHouse serializes Int64 as a string, and past 2^53 a Number would
 *  quietly lose integer precision on a money figure. */
export function parseSummedNanoUsd(value: unknown): number {
  const asBig = BigInt(String(value ?? 0));
  if (asBig > BigInt(Number.MAX_SAFE_INTEGER) || asBig < 0n) {
    throw new Error(
      `Summed nano-USD value ${asBig} exceeds the safe integer range`,
    );
  }
  return Number(asBig);
}

export const SPEND_ROW_COLUMNS = `TenantId, GatewayRequestId, OrganizationId, VirtualKeyId,
          PrincipalUserId, EndUserId, TraceId, Model, ProviderKey, RequestType,
          TokensInput, TokensOutput, TokensCacheRead, TokensCacheWrite,
          TokensReasoning, CostNanoUSD, RateVersion, Status, ErrorClass,
          HttpStatus, NeedsReconciliation, SettleReason, Labels, Metadata,
          DurationMS, toUnixTimestamp64Milli(OccurredAt) AS OccurredAtMs`;

export function mapSpendEventRow(r: Record<string, unknown>): SpendEventRow {
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

export interface SpendEventsPageCursor {
  occurredAtMs: number;
  gatewayRequestId: string;
}

/**
 * The cursor and filter predicates of a spend-events walk, as clause fragments
 * already carrying their leading AND plus the bound parameters they name. Each
 * fragment is optional; an absent filter contributes neither a clause nor a
 * parameter, so the query never binds a placeholder it does not reference.
 */
function buildSpendEventsWalkFilter({
  decoded,
  fromMs,
  toMs,
  filters,
}: {
  decoded: SpendEventsCursor | null;
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

/** One grouping dimension: the expression to group on and the alias it is
 *  selected as, so the walk can name it in ORDER BY and read it back. */
interface SummaryDimension {
  alias: string;
  expression: string;
}

/**
 * The bucket leads the grouping so a walk reads the window in time order,
 * which is the shape a caller charting spend expects a page to arrive in.
 */
function summaryDimensions({
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
 * A cursor whose arity no longer matches the grouping is ignored rather than
 * mixed in, since it names a walk over a different shape entirely.
 */
function summariesWalkClause({
  cursor,
  dimensions,
}: {
  cursor: string[] | null;
  dimensions: SummaryDimension[];
}): { clause: string; params: Record<string, unknown> } | null {
  if (cursor === null || cursor.length !== dimensions.length) return null;
  const left = dimensions.map((d) => d.expression).join(", ");
  const right = cursor.map((_, index) => `{cursor${index}:String}`).join(", ");
  const params: Record<string, unknown> = {};
  cursor.forEach((part, index) => {
    params[`cursor${index}`] = part;
  });
  return {
    clause:
      dimensions.length === 1
        ? `AND ${left} > ${right}`
        : `AND (${left}) > (${right})`,
    params,
  };
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

/**
 * Zero is the honest answer for an absent aggregate here: a group only exists
 * in the result because at least one row produced it, so a missing column is
 * a sum over rows that all carried nothing, not an unknown quantity.
 */
function summed(raw: Record<string, unknown>, column: string): number {
  return Number(raw[column] ?? 0);
}

/** A grouping value is a String column, so an absent one is the empty key. */
function grouped(raw: Record<string, unknown>, column: string): string {
  return String(raw[column] ?? "");
}

function mapSummaryRow({
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
    group[key] = grouped(raw, `GroupKey${index}`);
  }
  return {
    key: grouped(raw, "GroupKey0"),
    group,
    bucketStart: bucket === "none" ? null : grouped(raw, "GroupBucket"),
    eventCount: summed(raw, "EventCount"),
    settledCount: summed(raw, "SettledCount"),
    tokensInput: summed(raw, "TokensInput"),
    tokensOutput: summed(raw, "TokensOutput"),
    tokensCacheRead: summed(raw, "TokensCacheRead"),
    tokensCacheWrite: summed(raw, "TokensCacheWrite"),
    tokensReasoning: summed(raw, "TokensReasoning"),
    costNanoUsd: nano,
    costUsd: nanoUsdToDecimalString(nano),
  };
}

export class GatewaySpendEventsRepository {
  constructor(private readonly resolveClient: ClickHouseClientResolver) {}

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
      throw new Error(
        "GatewaySpendEventsRepository.upsertFromFold: entries span multiple tenants",
      );
    }
    const client = await this.resolveClient(tenantId);
    const records = entries.map(({ tenantId, gatewayRequestId, state }) => ({
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
      TokensInput: state.usage?.input_tokens ?? 0,
      TokensOutput: state.usage?.output_tokens ?? 0,
      TokensCacheRead: state.usage?.cache_read_input_tokens ?? 0,
      TokensCacheWrite: state.usage?.cache_creation_input_tokens ?? 0,
      TokensReasoning: state.usage?.reasoning_tokens ?? 0,
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
      logger.error(
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
  async readForFold({
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
    const row = mapSpendEventRow(r);
    const hasUsage =
      row.status === "confirmed" ||
      row.status === "failed" ||
      row.tokensInput > 0 ||
      row.tokensOutput > 0;
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
      usage: hasUsage
        ? {
            input_tokens: row.tokensInput,
            output_tokens: row.tokensOutput,
            cache_read_input_tokens: row.tokensCacheRead,
            cache_creation_input_tokens: row.tokensCacheWrite,
            reasoning_tokens: row.tokensReasoning,
          }
        : null,
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
    const rows = raw.map(mapSpendEventRow);
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
    return raw.map(mapSpendEventRow);
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

    const { clauses, params: filterParams } = buildSpendEventsWalkFilter({
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
    const rows = raw.map(mapSpendEventRow);
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
    if (tenantIds.length === 0) return { rows: [], nextCursor: null };
    const client = await this.resolveClient(tenantIds[0]!);

    const params: Record<string, unknown> = { tenantIds, fromMs, toMs, limit };
    const dimensions = summaryDimensions({ groupBy, bucket });
    if (bucket !== "none") params.timezone = timezone;

    const clauses: string[] = [];
    const walk = summariesWalkClause({
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

    const selection = dimensions
      .map((d) => `${d.expression} AS ${d.alias}`)
      .join(",\n          ");
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
          AND Status != 'admitted'
          AND OccurredAt >= fromUnixTimestamp64Milli({fromMs:Int64})
          AND OccurredAt < fromUnixTimestamp64Milli({toMs:Int64})
          ${clauses.join("\n          ")}
        GROUP BY ${grouping}
        ORDER BY ${ordering}
        LIMIT {limit:UInt32}
      `,
      query_params: params,
      format: "JSONEachRow",
    });
    const raw = (await result.json()) as Array<Record<string, unknown>>;
    const last = raw[raw.length - 1];
    const nextCursor =
      raw.length === limit && last
        ? encodeSpendSummariesCursor(
            dimensions.map((d) => String(last[d.alias] ?? "")),
          )
        : null;
    const rows = raw.map((r) => mapSummaryRow({ raw: r, groupBy, bucket }));
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
    const vkClause =
      virtualKeyId !== undefined
        ? "AND VirtualKeyId = {virtualKeyId:String}"
        : "";
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
}

export interface SpendEventsCursor {
  eventTimestampMs: number;
  gatewayRequestId: string;
}

/** Opaque, order-preserving page cursor: base64url "eventTs:requestId". */
export function encodeSpendEventsCursor(cursor: SpendEventsCursor): string {
  return Buffer.from(
    `${cursor.eventTimestampMs}:${cursor.gatewayRequestId}`,
    "utf8",
  ).toString("base64url");
}

/**
 * Opaque page cursor for the summaries rollup: base64url of the JSON array of
 * group-key parts last served, one per grouping dimension. Same encoding
 * conventions as {@link encodeSpendEventsCursor} so a caller treats both
 * surfaces' cursors identically: opaque, and passed back verbatim.
 *
 * The parts are carried as an array rather than joined, because a group key
 * is a caller-supplied value (a model name, an end user id) and any separator
 * chosen for it is a separator some caller's data already contains.
 */
export function encodeSpendSummariesCursor(groupKey: string[]): string {
  return Buffer.from(JSON.stringify(groupKey), "utf8").toString("base64url");
}

/**
 * The group-key parts a summaries cursor names, or null when it is not a
 * cursor this service minted.
 *
 * Anything that is not a JSON array of strings is one part: cursors minted
 * before a rollup could group by two dimensions are plain base64url text, and
 * a caller can be mid-walk across the deploy that changed this.
 *
 * The decision is made by parsing, never by looking at the first character.
 * Group keys are caller data, so a model or end-user id may legitimately open
 * with `[`, and sniffing would refuse that caller's perfectly good cursor and
 * restart their walk from the first page.
 */
export function decodeSpendSummariesCursor(encoded: string): string[] | null {
  try {
    const raw = Buffer.from(encoded, "base64url").toString("utf8");
    if (raw.length === 0) return null;
    return asGroupKeyParts(raw) ?? [raw];
  } catch {
    return null;
  }
}

/** The parts a payload names, or null when it is not the multi-part form. */
function asGroupKeyParts(raw: string): string[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return null;
  if (!parsed.every((part) => typeof part === "string")) return null;
  return parsed as string[];
}

export function decodeSpendEventsCursor(
  encoded: string,
): SpendEventsCursor | null {
  try {
    const raw = Buffer.from(encoded, "base64url").toString("utf8");
    const sep = raw.indexOf(":");
    if (sep <= 0) return null;
    const eventTimestampMs = Number(raw.slice(0, sep));
    const gatewayRequestId = raw.slice(sep + 1);
    if (
      !Number.isFinite(eventTimestampMs) ||
      eventTimestampMs < 0 ||
      gatewayRequestId.length === 0
    ) {
      return null;
    }
    return { eventTimestampMs, gatewayRequestId };
  } catch {
    return null;
  }
}
