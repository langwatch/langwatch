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
 * See: migration 00064_create_gateway_spend.sql
 */

import { createLogger } from "@langwatch/observability";
import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import type { GatewaySpendState } from "~/server/event-sourcing/pipelines/gateway-spend-processing/projections/gatewaySpend.foldProjection";
import { GATEWAY_SPEND_PROJECTION_VERSION_LATEST } from "~/server/event-sourcing/pipelines/gateway-spend-processing/schemas/constants";
import { NANO_USD_PER_USD } from "~/server/event-sourcing/pipelines/gateway-spend-processing/services/spend-rating.service";

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
  /** Fixed-point USD string derived from costNanoUsd (6 decimals). */
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

/** Legacy filter vocabulary ("success"/"error") maps onto the lifecycle
 *  statuses so pre-pipeline API clients keep working. */
export function normalizeStatusFilter(
  status: string,
): SpendEventStatus | undefined {
  if (status === "success") return "confirmed";
  if (status === "error") return "failed";
  if (status === "") return undefined;
  if (
    status === "admitted" ||
    status === "confirmed" ||
    status === "failed" ||
    status === "settled"
  ) {
    return status;
  }
  // An unknown non-empty token is a caller bug: throwing beats silently
  // dropping the filter on a surface that feeds downstream billers.
  throw new Error(
    `Unknown spend status filter "${status}"; expected success, error, admitted, confirmed, failed, or settled`,
  );
}

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

function nanoToUsdString(nano: number): string {
  return (nano / NANO_USD_PER_USD).toFixed(6);
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
    costUsd: nanoToUsdString(nano),
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

export interface SpendEventsPageFilters {
  virtualKeyId?: string;
  endUserId?: string;
  model?: string;
  status?: string;
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
  virtualKeyId,
  endUserId,
  model,
  status,
}: {
  decoded: SpendEventsCursor | null;
  fromMs?: number;
  toMs?: number;
  virtualKeyId?: string;
  endUserId?: string;
  model?: string;
  status?: string;
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
  if (virtualKeyId !== undefined) {
    clauses.push("AND VirtualKeyId = {virtualKeyId:String}");
    params.virtualKeyId = virtualKeyId;
  }
  if (endUserId !== undefined) {
    clauses.push("AND EndUserId = {endUserId:String}");
    params.endUserId = endUserId;
  }
  if (model !== undefined) {
    clauses.push("AND Model = {model:String}");
    params.model = model;
  }
  const statusFilter =
    status !== undefined ? normalizeStatusFilter(status) : undefined;
  if (statusFilter !== undefined) {
    clauses.push("AND Status = {status:String}");
    params.status = statusFilter;
  }
  return { clauses, params };
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
    filters?: SpendEventsPageFilters;
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
    if (filters.virtualKeyId) {
      conditions.push("VirtualKeyId = {virtualKeyId:String}");
      params.virtualKeyId = filters.virtualKeyId;
    }
    if (filters.endUserId) {
      conditions.push("EndUserId = {endUserId:String}");
      params.endUserId = filters.endUserId;
    }
    if (filters.model) {
      conditions.push("Model = {model:String}");
      params.model = filters.model;
    }
    const statusFilter = filters.status
      ? normalizeStatusFilter(filters.status)
      : undefined;
    if (statusFilter) {
      conditions.push("Status = {status:String}");
      params.status = statusFilter;
    }
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
    virtualKeyId,
    endUserId,
    model,
    status,
  }: {
    tenantIds: string[];
    fromMs?: number;
    toMs?: number;
    cursor?: string | null;
    limit: number;
    virtualKeyId?: string;
    endUserId?: string;
    model?: string;
    status?: string;
  }): Promise<{ rows: SpendEventRow[]; nextCursor: string | null }> {
    if (tenantIds.length === 0) return { rows: [], nextCursor: null };
    const client = await this.resolveClient(tenantIds[0]!);
    const decoded = cursor ? decodeSpendEventsCursor(cursor) : null;

    const { clauses, params: filterParams } = buildSpendEventsWalkFilter({
      decoded,
      fromMs,
      toMs,
      virtualKeyId,
      endUserId,
      model,
      status,
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
   */
  async readSpendSummaries({
    tenantIds,
    groupBy,
    fromMs,
    toMs,
    limit = 500,
  }: {
    tenantIds: string[];
    groupBy: "virtual_key" | "end_user";
    fromMs: number;
    toMs: number;
    limit?: number;
  }): Promise<
    Array<{
      key: string;
      eventCount: number;
      settledCount: number;
      tokensInput: number;
      tokensOutput: number;
      tokensCacheRead: number;
      tokensCacheWrite: number;
      tokensReasoning: number;
      costNanoUsd: number;
      costUsd: string;
    }>
  > {
    if (tenantIds.length === 0) return [];
    const client = await this.resolveClient(tenantIds[0]!);
    const keyColumn = groupBy === "virtual_key" ? "VirtualKeyId" : "EndUserId";
    const result = await client.query({
      query: `
        SELECT
          ${keyColumn} AS GroupKey,
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
        GROUP BY GroupKey
        ORDER BY CostNanoUSD DESC, GroupKey ASC
        LIMIT {limit:UInt32}
      `,
      query_params: { tenantIds, fromMs, toMs, limit },
      format: "JSONEachRow",
    });
    const raw = (await result.json()) as Array<Record<string, unknown>>;
    return raw.map((r) => {
      const nano = parseSummedNanoUsd(r.CostNanoUSD);
      return {
        key: String(r.GroupKey ?? ""),
        eventCount: Number(r.EventCount ?? 0),
        settledCount: Number(r.SettledCount ?? 0),
        tokensInput: Number(r.TokensInput ?? 0),
        tokensOutput: Number(r.TokensOutput ?? 0),
        tokensCacheRead: Number(r.TokensCacheRead ?? 0),
        tokensCacheWrite: Number(r.TokensCacheWrite ?? 0),
        tokensReasoning: Number(r.TokensReasoning ?? 0),
        costNanoUsd: nano,
        costUsd: nanoToUsdString(nano),
      };
    });
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
      spendUsd: "0.000000",
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
      spendUsd: nanoToUsdString(nano),
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
