import { nanoUsdToDecimalString } from "@langwatch/gateway-contract";
import { Temporal } from "@langwatch/time";
import type { WebhookSpendEventRow, WebhookSpendEventStatus } from "@langwatch/webhook-contract";

import { WebhookEventsRepository, type WebhookEventsPage } from "../webhook-events.repository.ts";

const asString = (value: unknown): string =>
  typeof value === "string" || typeof value === "number" || typeof value === "bigint"
    ? String(value)
    : "";

const SPEND_TABLE = "gateway_spend";
const SPEND_ROW_COLUMNS = `TenantId, GatewayRequestId, OrganizationId, VirtualKeyId,
          PrincipalUserId, EndUserId, TraceId, Model, ProviderKey, RequestType,
          TokensInput, TokensOutput, TokensCacheRead, TokensCacheWrite,
          TokensReasoning, TokensInputImage, TokensOutputImage, ImageCount,
          CostNanoUSD, RateVersion, Status, ErrorClass,
          HttpStatus, NeedsReconciliation, SettleReason, Labels, Metadata,
          DurationMS, toUnixTimestamp64Milli(OccurredAt) AS OccurredAtMs`;

type WebhookClickHouseClient = {
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
    requestType: asString(raw.RequestType),
    tokensInput: Number(raw.TokensInput),
    tokensOutput: Number(raw.TokensOutput),
    tokensCacheRead: Number(raw.TokensCacheRead),
    tokensCacheWrite: Number(raw.TokensCacheWrite),
    tokensReasoning: Number(raw.TokensReasoning),
    tokensInputImage: Number(raw.TokensInputImage ?? 0),
    tokensOutputImage: Number(raw.TokensOutputImage ?? 0),
    imageCount: Number(raw.ImageCount ?? 0),
    costNanoUsd,
    costUsd: nanoUsdToDecimalString(costNanoUsd),
    rateVersion: asString(raw.RateVersion),
    status: String(raw.Status) as WebhookSpendEventStatus,
    errorClass: String(raw.ErrorClass),
    httpStatus: Number(raw.HttpStatus),
    needsReconciliation: Number(raw.NeedsReconciliation ?? 0) === 1,
    settleReason: asString(raw.SettleReason),
    labels: Array.isArray(raw.Labels) ? raw.Labels.map(String) : [],
    metadata: asString(raw.Metadata),
    durationMs: Number(raw.DurationMS),
    occurredAt: Temporal.Instant.fromEpochMilliseconds(Number(raw.OccurredAtMs)),
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** The order the SQL pages in, applied again after the per-tenant pages merge. */
function newestFirst(left: WebhookSpendEventRow, right: WebhookSpendEventRow): number {
  const byTime = right.occurredAt.epochMilliseconds - left.occurredAt.epochMilliseconds;
  if (byTime !== 0) return byTime;
  if (left.gatewayRequestId === right.gatewayRequestId) return 0;
  return left.gatewayRequestId < right.gatewayRequestId ? 1 : -1;
}

type WebhookEventsCursor = {
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

export class WebhookEventsClickHouseRepository extends WebhookEventsRepository {
  private constructor(private readonly resolveClient: WebhookClickHouseClientResolver) {
    super();
  }

  static create(resolveClient: WebhookClickHouseClientResolver): WebhookEventsClickHouseRepository {
    return new WebhookEventsClickHouseRepository(resolveClient);
  }

  /** Over the process's routed member, which resolves each tenant's client itself. */
  static forRoutedClickHouse(
    clickhouse: WebhookRoutedClickHouse,
  ): WebhookEventsClickHouseRepository {
    return new WebhookEventsClickHouseRepository(createWebhookClickHouseResolver(clickhouse));
  }

  static encodeCursor(cursor: WebhookEventsCursor): string {
    return encodeCursor(cursor);
  }

  static findCursor(encoded: string): WebhookEventsCursor | null {
    return decodeCursor(encoded);
  }

  static findEventId(id: string): { gatewayRequestId: string; statuses: string[] } | null {
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
    const queryParams: Record<string, unknown> = { statuses, limit: input.limit };
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
    const query = `SELECT ${SPEND_ROW_COLUMNS}
        FROM ${SPEND_TABLE} FINAL
        WHERE TenantId = {tenantId:String}
          AND Status IN {statuses:Array(String)}
          ${clauses.join("\n          ")}
        ORDER BY OccurredAt DESC, GatewayRequestId DESC
        LIMIT {limit:UInt32}`;
    const perTenant = await Promise.all(
      input.tenantIds.map((tenantId) => this.readTenantRows({ tenantId, query, queryParams })),
    );
    const rows = perTenant.flat().toSorted(newestFirst).slice(0, input.limit);
    const last = rows.at(-1);
    return {
      rows,
      nextCursor:
        rows.length === input.limit && last
          ? encodeCursor({
              occurredAtMs: last.occurredAt.epochMilliseconds,
              gatewayRequestId: last.gatewayRequestId,
            })
          : null,
    };
  }

  async findEmittedEventById(input: {
    tenantIds: string[];
    id: string;
  }): Promise<WebhookSpendEventRow | null> {
    const parsed = parseEventId(input.id);
    if (!parsed) return null;
    const perTenant = await Promise.all(
      input.tenantIds.map((tenantId) =>
        this.readTenantRows({
          tenantId,
          query: `SELECT ${SPEND_ROW_COLUMNS}
        FROM ${SPEND_TABLE} FINAL
        WHERE TenantId = {tenantId:String}
          AND GatewayRequestId = {gatewayRequestId:String}
          AND Status IN {statuses:Array(String)}
        LIMIT 1`,
          queryParams: {
            gatewayRequestId: parsed.gatewayRequestId,
            statuses: parsed.statuses,
          },
        }),
      ),
    );
    return perTenant.flat()[0] ?? null;
  }

  /** One statement per project tenant: the tenant guard admits exactly one tenant per read. */
  private async readTenantRows({
    tenantId,
    query,
    queryParams,
  }: {
    tenantId: string;
    query: string;
    queryParams: Record<string, unknown>;
  }): Promise<WebhookSpendEventRow[]> {
    const client = await this.resolveClient(tenantId);
    const result = await client.query({
      query,
      query_params: { ...queryParams, tenantId },
      format: "JSONEachRow",
    });
    const raw = await result.json();
    return Array.isArray(raw) ? raw.filter(isRecord).map(mapSpendEventRow) : [];
  }
}

/** Adapts the routed process member to Webhook's tenant-resolved read client. */
export type WebhookRoutedClickHouse = Readonly<{
  query(input: {
    tenantId: string;
    sql: string;
    params?: Record<string, unknown>;
  }): Promise<{ rows: unknown[] }>;
}>;

function createWebhookClickHouseResolver(
  clickhouse: WebhookRoutedClickHouse,
): WebhookClickHouseClientResolver {
  return (tenantId) =>
    Promise.resolve({
      async query(input) {
        const result = await clickhouse.query({
          tenantId,
          sql: input.query,
          params: input.query_params,
        });
        return { json: async () => result.rows };
      },
    });
}
