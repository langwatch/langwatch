/**
 * Gateway spend events — the per-request billing record.
 *
 * One row per gateway request, written UNCONDITIONALLY by the billingExport
 * reactor (the budget ledger next door only gets rows when a budget
 * applies). Keyed (TenantId, GatewayRequestId) on a ReplacingMergeTree;
 * replays collapse at merge time and the insert path probes first so the
 * scope-total-style double-count failure mode cannot recur here.
 *
 * Reads are replacement-aware by construction (FINAL): RMT dedup is
 * eventual, and this table backs reconciliation reads where a transient
 * duplicate would double-bill downstream.
 *
 * See: migration 00059_create_gateway_spend_events.sql
 */

import { createLogger } from "@langwatch/observability";
import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";

const TABLE = "gateway_spend_events" as const;

const logger = createLogger("langwatch:gateway:spend-events-repository");

export type SpendEventRow = {
  tenantId: string;
  gatewayRequestId: string;
  organizationId: string;
  teamId: string;
  virtualKeyId: string;
  principalUserId: string;
  endUserId: string;
  traceId: string;
  model: string;
  providerKey: string;
  tokensInput: number;
  tokensOutput: number;
  tokensCacheRead: number;
  tokensCacheWrite: number;
  tokensReasoning: number;
  /** Fixed-point decimal string for CH Decimal(18,6). */
  costUsd: string;
  status: "success" | "error";
  errorClass: string;
  httpStatus: number;
  labels: string[];
  metadata: string;
  durationMs: number;
  occurredAt: Date;
};

function mapSpendEventRow(r: Record<string, unknown>): SpendEventRow {
  return {
    tenantId: String(r.TenantId),
    gatewayRequestId: String(r.GatewayRequestId),
    organizationId: String(r.OrganizationId),
    teamId: String(r.TeamId),
    virtualKeyId: String(r.VirtualKeyId),
    principalUserId: String(r.PrincipalUserId),
    endUserId: String(r.EndUserId),
    traceId: String(r.TraceId),
    model: String(r.Model),
    providerKey: String(r.ProviderKey),
    tokensInput: Number(r.TokensInput),
    tokensOutput: Number(r.TokensOutput),
    tokensCacheRead: Number(r.TokensCacheRead),
    tokensCacheWrite: Number(r.TokensCacheWrite),
    tokensReasoning: Number(r.TokensReasoning),
    costUsd: String(r.CostUSD),
    status: r.Status === "error" ? "error" : "success",
    errorClass: String(r.ErrorClass),
    httpStatus: Number(r.HttpStatus),
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
  status?: "success" | "error";
}

export class GatewaySpendEventsRepository {
  constructor(private readonly resolveClient: ClickHouseClientResolver) {}

  /**
   * Newest-first page read for the ledger UI. Keyset pagination on
   * (OccurredAt, GatewayRequestId) DESC so a page boundary never skips or
   * repeats rows while inserts land; FINAL for the same no-transient-
   * duplicates reason as readSpendEvents.
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
    if (filters.status) {
      conditions.push("Status = {status:String}");
      params.status = filters.status;
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
        SELECT
          TenantId, GatewayRequestId, OrganizationId, TeamId, VirtualKeyId,
          PrincipalUserId, EndUserId, TraceId, Model, ProviderKey,
          TokensInput, TokensOutput, TokensCacheRead, TokensCacheWrite,
          TokensReasoning, toString(CostUSD) AS CostUSD, Status, ErrorClass,
          HttpStatus, Labels, Metadata, DurationMS,
          toUnixTimestamp64Milli(OccurredAt) AS OccurredAtMs
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
   * Insert rows, skipping any gateway_request_id the table already has.
   * At-least-once reactor delivery makes replays normal, not exceptional;
   * the probe keeps them invisible to FINAL-less aggregate readers too.
   * Returns how many rows were actually written (the metric the reactor
   * publishes).
   */
  async insertSpendEvents(rows: SpendEventRow[]): Promise<number> {
    if (rows.length === 0) return 0;
    const tenantId = rows[0]!.tenantId;
    if (rows.some((r) => r.tenantId !== tenantId)) {
      throw new Error(
        "GatewaySpendEventsRepository.insertSpendEvents: rows span multiple tenants",
      );
    }

    const requestIds = [...new Set(rows.map((r) => r.gatewayRequestId))];
    const client = await this.resolveClient(tenantId);
    const probe = await client.query({
      query: `SELECT DISTINCT GatewayRequestId FROM ${TABLE} WHERE TenantId = {tenantId:String} AND GatewayRequestId IN {requestIds:Array(String)}`,
      query_params: { tenantId, requestIds },
      format: "JSONEachRow",
    });
    const seen = new Set(
      ((await probe.json()) as Array<{ GatewayRequestId: string }>).map(
        (r) => r.GatewayRequestId,
      ),
    );
    const fresh = rows.filter((r) => !seen.has(r.gatewayRequestId));
    if (fresh.length === 0) return 0;

    const records = fresh.map((r) => ({
      TenantId: r.tenantId,
      GatewayRequestId: r.gatewayRequestId,
      OrganizationId: r.organizationId,
      TeamId: r.teamId,
      VirtualKeyId: r.virtualKeyId,
      PrincipalUserId: r.principalUserId,
      EndUserId: r.endUserId,
      TraceId: r.traceId,
      Model: r.model,
      ProviderKey: r.providerKey,
      TokensInput: r.tokensInput,
      TokensOutput: r.tokensOutput,
      TokensCacheRead: r.tokensCacheRead,
      TokensCacheWrite: r.tokensCacheWrite,
      TokensReasoning: r.tokensReasoning,
      CostUSD: r.costUsd,
      Status: r.status,
      ErrorClass: r.errorClass,
      HttpStatus: r.httpStatus,
      Labels: r.labels,
      Metadata: r.metadata,
      DurationMS: r.durationMs,
      OccurredAt: r.occurredAt.getTime(),
      EventTimestamp: Date.now(),
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
        { tenantId, count: fresh.length, error },
        "failed to insert gateway spend events",
      );
      throw error;
    }
    return fresh.length;
  }

  /**
   * Replacement-aware read for tests and the reconciliation surface.
   * FINAL costs a merge-on-read but this path is paged and off the hot
   * path; correctness (no transient duplicates) wins.
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
        SELECT
          TenantId, GatewayRequestId, OrganizationId, TeamId, VirtualKeyId,
          PrincipalUserId, EndUserId, TraceId, Model, ProviderKey,
          TokensInput, TokensOutput, TokensCacheRead, TokensCacheWrite,
          TokensReasoning, toString(CostUSD) AS CostUSD, Status, ErrorClass,
          HttpStatus, Labels, Metadata, DurationMS,
          toUnixTimestamp64Milli(OccurredAt) AS OccurredAtMs
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
    return raw.map((r) => ({
      tenantId: String(r.TenantId),
      gatewayRequestId: String(r.GatewayRequestId),
      organizationId: String(r.OrganizationId),
      teamId: String(r.TeamId),
      virtualKeyId: String(r.VirtualKeyId),
      principalUserId: String(r.PrincipalUserId),
      endUserId: String(r.EndUserId),
      traceId: String(r.TraceId),
      model: String(r.Model),
      providerKey: String(r.ProviderKey),
      tokensInput: Number(r.TokensInput),
      tokensOutput: Number(r.TokensOutput),
      tokensCacheRead: Number(r.TokensCacheRead),
      tokensCacheWrite: Number(r.TokensCacheWrite),
      tokensReasoning: Number(r.TokensReasoning),
      costUsd: String(r.CostUSD),
      status: r.Status === "error" ? "error" : "success",
      errorClass: String(r.ErrorClass),
      httpStatus: Number(r.HttpStatus),
      labels: Array.isArray(r.Labels) ? r.Labels.map(String) : [],
      metadata: String(r.Metadata ?? ""),
      durationMs: Number(r.DurationMS),
      occurredAt: new Date(Number(r.OccurredAtMs)),
    }));
  }
}
