// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import {
  mapSpendEventRow,
  SPEND_ROW_COLUMNS,
  type SpendEventRow,
} from "~/server/gateway/spendEvents.clickhouse.repository";

const SPEND_TABLE = "gateway_spend" as const;

/**
 * The row statuses an emitted-type filter selects: completed covers the
 * confirmed and failed outcomes, settled is its own stream. Admitted rows
 * are in-flight requests, never emitted events, so they are always
 * excluded. An unknown type contributes no status, which yields an empty
 * page (forward-compatible probing).
 */
function rowStatusesFor(types?: string[]): string[] {
  if (!types) return ["confirmed", "failed", "settled"];
  const statusesOfType = (type: string): string[] => {
    if (type === "gateway.request.completed") return ["confirmed", "failed"];
    if (type === "gateway.request.settled") return ["settled"];
    return [];
  };
  return [...new Set(types.flatMap(statusesOfType))];
}

/**
 * An event id, split back into the row it names.
 *
 * Ids are minted as `<gatewayRequestId>:<suffix>` by `spendRowToEnvelope`,
 * and the suffix is what says which of the two events on a single request is
 * meant. `admitted` is deliberately unparseable here: those rows are in-flight
 * requests, never emitted events, so an id naming one addresses nothing this
 * log ever served.
 */
export function parseEventId(
  id: string,
): { gatewayRequestId: string; statuses: string[] } | null {
  const sep = id.lastIndexOf(":");
  if (sep <= 0 || sep === id.length - 1) return null;
  const gatewayRequestId = id.slice(0, sep);
  const suffix = id.slice(sep + 1);
  if (suffix === "completed") {
    return { gatewayRequestId, statuses: ["confirmed", "failed"] };
  }
  if (suffix === "settled") {
    return { gatewayRequestId, statuses: ["settled"] };
  }
  return null;
}

/** The optional WHERE fragments and the parameters they bind: the time
 *  window, then the cursor position. Order matters only for readability of
 *  the generated SQL. */
function pageFilters(params: {
  fromMs?: number;
  toMs?: number;
  cursor?: string | null;
}): { clauses: string[]; queryParams: Record<string, number | string> } {
  const clauses: string[] = [];
  const queryParams: Record<string, number | string> = {};
  if (params.fromMs !== undefined) {
    clauses.push("AND OccurredAt >= fromUnixTimestamp64Milli({fromMs:Int64})");
    queryParams.fromMs = params.fromMs;
  }
  if (params.toMs !== undefined) {
    clauses.push("AND OccurredAt < fromUnixTimestamp64Milli({toMs:Int64})");
    queryParams.toMs = params.toMs;
  }
  const decoded = params.cursor ? decodeCursor(params.cursor) : null;
  if (decoded) {
    clauses.push(
      "AND (OccurredAt, GatewayRequestId) < (fromUnixTimestamp64Milli({cursorOccurredAtMs:Int64}), {cursorRequestId:String})",
    );
    queryParams.cursorOccurredAtMs = decoded.occurredAtMs;
    queryParams.cursorRequestId = decoded.gatewayRequestId;
  }
  return { clauses, queryParams };
}

export interface EmittedEventsPage {
  rows: SpendEventRow[];
  /** Opaque continuation: pass back to read the next page; null at the end. */
  nextCursor: string | null;
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

    const statuses = rowStatusesFor(types);
    if (statuses.length === 0) return { rows: [], nextCursor: null };
    const client = await this.resolveClient(tenantIds[0]!);

    const { clauses, queryParams } = pageFilters({ fromMs, toMs, cursor });

    const result = await client.query({
      query: `
        SELECT ${SPEND_ROW_COLUMNS}
        FROM ${SPEND_TABLE} FINAL
        WHERE TenantId IN {tenantIds:Array(String)}
          AND Status IN {statuses:Array(String)}
          ${clauses.join("\n          ")}
        ORDER BY OccurredAt DESC, GatewayRequestId DESC
        LIMIT {limit:UInt32}
      `,
      query_params: {
        tenantIds,
        statuses,
        ...queryParams,
        limit,
      },
      format: "JSONEachRow",
    });
    const raw = (await result.json()) as Array<Record<string, unknown>>;
    const rows = raw.map(mapSpendEventRow);
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

  /**
   * One emitted event by its id, or null when this log does not hold it.
   *
   * Null covers three cases the caller cannot tell apart and does not need
   * to: never emitted, out of retention, or belonging to another
   * organization. Collapsing them is deliberate: distinguishing "expired"
   * from "not yours" would make the endpoint an existence oracle for other
   * tenants' request ids.
   *
   * The lookup is a point read on the table's own sort key
   * (TenantId, GatewayRequestId), so it does not scan the partition.
   */
  async readEmittedEventById({
    tenantIds,
    id,
  }: {
    tenantIds: string[];
    id: string;
  }): Promise<SpendEventRow | null> {
    if (tenantIds.length === 0) return null;
    const parsed = parseEventId(id);
    if (!parsed) return null;
    const client = await this.resolveClient(tenantIds[0]!);

    const result = await client.query({
      query: `
        SELECT ${SPEND_ROW_COLUMNS}
        FROM ${SPEND_TABLE} FINAL
        WHERE TenantId IN {tenantIds:Array(String)}
          AND GatewayRequestId = {gatewayRequestId:String}
          AND Status IN {statuses:Array(String)}
        LIMIT 1
      `,
      query_params: {
        tenantIds,
        gatewayRequestId: parsed.gatewayRequestId,
        statuses: parsed.statuses,
      },
      format: "JSONEachRow",
    });
    const raw = (await result.json()) as Array<Record<string, unknown>>;
    const row = raw[0];
    return row ? mapSpendEventRow(row) : null;
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
