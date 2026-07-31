// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { createLogger } from "@langwatch/observability";
import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import type { SpendEventRow } from "~/server/gateway/spendEvents.clickhouse.repository";

const SPEND_TABLE = "gateway_spend" as const;

const logger = createLogger("langwatch:webhooks:events-repository");

export interface EmittedEventsPage {
  rows: SpendEventRow[];
  /** Opaque continuation: pass back to read the next page; null at the end. */
  nextCursor: string | null;
}

const SPEND_COLUMNS = `
  TenantId, GatewayRequestId, OrganizationId, VirtualKeyId,
  PrincipalUserId, EndUserId, TraceId, Model, ProviderKey, RequestType,
  TokensInput, TokensOutput, TokensCacheRead, TokensCacheWrite,
  TokensReasoning, CostNanoUSD, RateVersion, Status, ErrorClass,
  HttpStatus, NeedsReconciliation, SettleReason, Labels, Metadata,
  DurationMS, toUnixTimestamp64Milli(OccurredAt) AS OccurredAtMs`;

function mapSpendRow(r: Record<string, unknown>): SpendEventRow {
  const nano = Number(r.CostNanoUSD ?? 0);
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
    costUsd: (nano / 1_000_000_000).toFixed(6),
    rateVersion: String(r.RateVersion ?? ""),
    status: String(r.Status) as SpendEventRow["status"],
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
 * The organization's emitted-events log read: GET /api/webhooks/v1/events
 * pages the spend records as envelopes, Stripe /v1/events parity, newest
 * first over a (OccurredAt, GatewayRequestId) cursor. Delivery itself
 * consumes the event log through the process manager's transactional inbox
 * and never reads this table; this repository exists for the listing only.
 * Admitted rows are in-flight requests, not emitted events, and are never
 * served here.
 */
export class WebhookEventsClickHouseRepository {
  constructor(private readonly resolveClient: ClickHouseClientResolver) {}

  /**
   * The org's emitted-events log (Stripe /v1/events parity), newest first,
   * cursor-paged over (OccurredAt, GatewayRequestId). `tenantIds` is the
   * org's project set; callers resolve it, this layer only reads.
   */
  async readEmittedEventsPage({
    tenantIds,
    fromMs,
    toMs,
    cursor,
    limit,
    types,
  }: {
    tenantIds: string[];
    fromMs?: number;
    toMs?: number;
    cursor?: string | null;
    limit: number;
    /** Emitted event types to serve; omitted means every emitted type.
     *  Unknown types yield an empty page (forward-compatible probing). */
    types?: string[];
  }): Promise<EmittedEventsPage> {
    if (tenantIds.length === 0) return { rows: [], nextCursor: null };

    // The emitted-type filter maps to row statuses: completed covers the
    // confirmed and failed outcomes, settled is its own stream. Admitted
    // rows are in-flight and never emitted, so they are always excluded.
    const statusesFor = (t: string): string[] =>
      t === "gateway.request.completed"
        ? ["confirmed", "failed"]
        : t === "gateway.request.settled"
          ? ["settled"]
          : [];
    const statuses = types
      ? [...new Set(types.flatMap(statusesFor))]
      : ["confirmed", "failed", "settled"];
    if (statuses.length === 0) return { rows: [], nextCursor: null };
    const client = await this.resolveClient(tenantIds[0]!);

    const decoded = cursor ? decodeCursor(cursor) : null;
    const cursorClause = decoded
      ? `AND (OccurredAt, GatewayRequestId) < (fromUnixTimestamp64Milli({cursorOccurredAtMs:Int64}), {cursorRequestId:String})`
      : "";
    const fromClause =
      fromMs !== undefined
        ? `AND OccurredAt >= fromUnixTimestamp64Milli({fromMs:Int64})`
        : "";
    const toClause =
      toMs !== undefined
        ? `AND OccurredAt < fromUnixTimestamp64Milli({toMs:Int64})`
        : "";

    const result = await client.query({
      query: `
        SELECT ${SPEND_COLUMNS}
        FROM ${SPEND_TABLE} FINAL
        WHERE TenantId IN {tenantIds:Array(String)}
          AND Status IN {statuses:Array(String)}
          ${fromClause}
          ${toClause}
          ${cursorClause}
        ORDER BY OccurredAt DESC, GatewayRequestId DESC
        LIMIT {limit:UInt32}
      `,
      query_params: {
        tenantIds,
        statuses,
        ...(fromMs !== undefined ? { fromMs } : {}),
        ...(toMs !== undefined ? { toMs } : {}),
        ...(decoded
          ? {
              cursorOccurredAtMs: decoded.occurredAtMs,
              cursorRequestId: decoded.gatewayRequestId,
            }
          : {}),
        limit,
      },
      format: "JSONEachRow",
    });
    const raw = (await result.json()) as Array<Record<string, unknown>>;
    const rows = raw.map(mapSpendRow);
    const last = rows[rows.length - 1];
    return {
      rows,
      nextCursor:
        rows.length === limit && last
          ? encodeCursor({
              occurredAtMs: last.occurredAt.getTime(),
              gatewayRequestId: last.gatewayRequestId,
            })
          : null,
    };
  }
}

interface EventsCursor {
  occurredAtMs: number;
  gatewayRequestId: string;
}

export function encodeCursor(cursor: EventsCursor): string {
  return Buffer.from(
    `${cursor.occurredAtMs}:${cursor.gatewayRequestId}`,
    "utf8",
  ).toString("base64url");
}

export function decodeCursor(encoded: string): EventsCursor | null {
  try {
    const raw = Buffer.from(encoded, "base64url").toString("utf8");
    const sep = raw.indexOf(":");
    if (sep <= 0) return null;
    const occurredAtMs = Number(raw.slice(0, sep));
    const gatewayRequestId = raw.slice(sep + 1);
    if (!Number.isFinite(occurredAtMs) || gatewayRequestId.length === 0) {
      return null;
    }
    return { occurredAtMs, gatewayRequestId };
  } catch {
    return null;
  }
}
