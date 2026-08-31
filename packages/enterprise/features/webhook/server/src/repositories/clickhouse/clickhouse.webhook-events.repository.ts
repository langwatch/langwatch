import {
  WebhookEventsRepositoryPort,
  type WebhookEventsPage,
} from "../../ports/webhook-events.port";
import type {
  WebhookSpendEventRow,
  WebhookSpendEventStatus,
} from "../../services/webhook-envelope.service";
import { nanoUsdToDecimalString } from "../../adapters/nano-usd.adapter";

const SPEND_TABLE = "gateway_spend";
const SPEND_ROW_COLUMNS = `TenantId, GatewayRequestId, OrganizationId, VirtualKeyId,
          PrincipalUserId, EndUserId, TraceId, Model, ProviderKey, RequestType,
          TokensInput, TokensOutput, TokensCacheRead, TokensCacheWrite,
          TokensReasoning, CostNanoUSD, RateVersion, Status, ErrorClass,
          HttpStatus, NeedsReconciliation, SettleReason, Labels, Metadata,
          DurationMS, toUnixTimestamp64Milli(OccurredAt) AS OccurredAtMs`;

export type WebhookClickHouseClient = {
  query(input: {
    query: string;
    query_params: Record<string, unknown>;
    format: "JSONEachRow";
  }): Promise<{ json(): Promise<unknown> }>;
};

export type WebhookClickHouseClientResolver = (
  tenantId: string,
) => Promise<WebhookClickHouseClient>;

function mapSpendEventRow(raw: Record<string, unknown>): WebhookSpendEventRow {
  const costNanoUsd = Number(raw.CostNanoUSD ?? 0);
  return {
    tenantId: String(raw.TenantId),
    gatewayRequestId: String(raw.GatewayRequestId),
    organizationId: String(raw.OrganizationId),
    teamId: "",
    virtualKeyId: String(raw.VirtualKeyId),
    principalUserId: String(raw.PrincipalUserId),
    endUserId: String(raw.EndUserId),
    traceId: String(raw.TraceId),
    model: String(raw.Model),
    providerKey: String(raw.ProviderKey),
    requestType: String(raw.RequestType ?? ""),
    tokensInput: Number(raw.TokensInput),
    tokensOutput: Number(raw.TokensOutput),
    tokensCacheRead: Number(raw.TokensCacheRead),
    tokensCacheWrite: Number(raw.TokensCacheWrite),
    tokensReasoning: Number(raw.TokensReasoning),
    costNanoUsd,
    costUsd: nanoUsdToDecimalString(costNanoUsd),
    rateVersion: String(raw.RateVersion ?? ""),
    status: String(raw.Status) as WebhookSpendEventStatus,
    errorClass: String(raw.ErrorClass),
    httpStatus: Number(raw.HttpStatus),
    needsReconciliation: Number(raw.NeedsReconciliation ?? 0) === 1,
    settleReason: String(raw.SettleReason ?? ""),
    labels: Array.isArray(raw.Labels) ? raw.Labels.map(String) : [],
    metadata: String(raw.Metadata ?? ""),
    durationMs: Number(raw.DurationMS),
    occurredAt: new Date(Number(raw.OccurredAtMs)),
  };
}

function rowStatusesFor(types?: string[]): string[] {
  if (!types) return ["confirmed", "failed", "settled"];
  return [
    ...new Set(
      types.flatMap((type) => {
        if (type === "gateway.request.completed") return ["confirmed", "failed"];
        if (type === "gateway.request.settled") return ["settled"];
        return [];
      }),
    ),
  ];
}

export type WebhookEventsCursor = {
  occurredAtMs: number;
  gatewayRequestId: string;
};

function encodeCursor(cursor: WebhookEventsCursor): string {
  return Buffer.from(`${cursor.occurredAtMs}:${cursor.gatewayRequestId}`, "utf8").toString(
    "base64url",
  );
}

function decodeCursor(encoded: string): WebhookEventsCursor | null {
  try {
    const raw = Buffer.from(encoded, "base64url").toString("utf8");
    const separator = raw.indexOf(":");
    if (separator <= 0) return null;
    const occurredAtMs = Number(raw.slice(0, separator));
    const gatewayRequestId = raw.slice(separator + 1);
    return Number.isFinite(occurredAtMs) && gatewayRequestId.length > 0
      ? { occurredAtMs, gatewayRequestId }
      : null;
  } catch {
    return null;
  }
}

function parseEventId(id: string): { gatewayRequestId: string; statuses: string[] } | null {
  const separator = id.lastIndexOf(":");
  if (separator <= 0 || separator === id.length - 1) return null;
  const gatewayRequestId = id.slice(0, separator);
  const suffix = id.slice(separator + 1);
  if (suffix === "completed") return { gatewayRequestId, statuses: ["confirmed", "failed"] };
  if (suffix === "settled") return { gatewayRequestId, statuses: ["settled"] };
  return null;
}

export class WebhookEventsClickHouseRepository extends WebhookEventsRepositoryPort {
  private constructor(private readonly resolveClient: WebhookClickHouseClientResolver) {
    super();
  }

  static create(resolveClient: WebhookClickHouseClientResolver): WebhookEventsClickHouseRepository {
    return new WebhookEventsClickHouseRepository(resolveClient);
  }

  static encodeCursor(cursor: WebhookEventsCursor): string {
    return encodeCursor(cursor);
  }

  static tryDecodeCursor(encoded: string): WebhookEventsCursor | null {
    return decodeCursor(encoded);
  }

  static tryParseEventId(id: string): { gatewayRequestId: string; statuses: string[] } | null {
    return parseEventId(id);
  }

  async readEmittedEventsPage(input: {
    tenantIds: string[];
    fromMs?: number;
    toMs?: number;
    cursor?: string | null;
    limit: number;
    types?: string[];
  }): Promise<WebhookEventsPage> {
    if (input.tenantIds.length === 0) return { rows: [], nextCursor: null };
    const statuses = rowStatusesFor(input.types);
    if (statuses.length === 0) return { rows: [], nextCursor: null };
    const clauses: string[] = [];
    const queryParams: Record<string, unknown> = {
      tenantIds: input.tenantIds,
      statuses,
      limit: input.limit,
    };
    if (input.fromMs !== undefined) {
      clauses.push("AND OccurredAt >= fromUnixTimestamp64Milli({fromMs:Int64})");
      queryParams.fromMs = input.fromMs;
    }
    if (input.toMs !== undefined) {
      clauses.push("AND OccurredAt < fromUnixTimestamp64Milli({toMs:Int64})");
      queryParams.toMs = input.toMs;
    }
    const cursor = input.cursor ? decodeCursor(input.cursor) : null;
    if (cursor) {
      clauses.push(
        "AND (OccurredAt, GatewayRequestId) < (fromUnixTimestamp64Milli({cursorOccurredAtMs:Int64}), {cursorRequestId:String})",
      );
      queryParams.cursorOccurredAtMs = cursor.occurredAtMs;
      queryParams.cursorRequestId = cursor.gatewayRequestId;
    }
    const client = await this.resolveClient(input.tenantIds[0]!);
    const result = await client.query({
      query: `SELECT ${SPEND_ROW_COLUMNS}
        FROM ${SPEND_TABLE} FINAL
        WHERE TenantId IN {tenantIds:Array(String)}
          AND Status IN {statuses:Array(String)}
          ${clauses.join("\n          ")}
        ORDER BY OccurredAt DESC, GatewayRequestId DESC
        LIMIT {limit:UInt32}`,
      query_params: queryParams,
      format: "JSONEachRow",
    });
    const rows = ((await result.json()) as Array<Record<string, unknown>>).map(mapSpendEventRow);
    const last = rows.at(-1);
    return {
      rows,
      nextCursor:
        rows.length === input.limit && last
          ? encodeCursor({
              occurredAtMs: last.occurredAt.getTime(),
              gatewayRequestId: last.gatewayRequestId,
            })
          : null,
    };
  }

  async tryReadEmittedEventById(input: {
    tenantIds: string[];
    id: string;
  }): Promise<WebhookSpendEventRow | null> {
    if (input.tenantIds.length === 0) return null;
    const parsed = parseEventId(input.id);
    if (!parsed) return null;
    const client = await this.resolveClient(input.tenantIds[0]!);
    const result = await client.query({
      query: `SELECT ${SPEND_ROW_COLUMNS}
        FROM ${SPEND_TABLE} FINAL
        WHERE TenantId IN {tenantIds:Array(String)}
          AND GatewayRequestId = {gatewayRequestId:String}
          AND Status IN {statuses:Array(String)}
        LIMIT 1`,
      query_params: {
        tenantIds: input.tenantIds,
        gatewayRequestId: parsed.gatewayRequestId,
        statuses: parsed.statuses,
      },
      format: "JSONEachRow",
    });
    const row = ((await result.json()) as Array<Record<string, unknown>>)[0];
    return row ? mapSpendEventRow(row) : null;
  }
}
