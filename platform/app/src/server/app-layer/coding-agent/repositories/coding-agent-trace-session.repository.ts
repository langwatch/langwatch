import { EventUtils, SecurityError } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import type { CodingAgentTraceSessionRecord } from "~/server/event-sourcing/pipelines/coding-agent-processing/projections/codingAgentTraceSessions.mapProjection";

const TABLE_NAME = "coding_agent_trace_sessions" as const;

const logger = createLogger(
  "langwatch:app-layer:coding-agent:trace-session-repository",
);

/**
 * Persistence for the (trace → session) map rows (ADR-056 §4, migration
 * 00051). A ReplacingMergeTree keyed (TenantId, TraceId): re-contributions
 * of the same trace simply write a newer version of the same mapping.
 */
export interface CodingAgentTraceSessionRepository {
  ensure(
    records: CodingAgentTraceSessionRecord[],
    retentionDays?: number,
  ): Promise<void>;

  /** The session a trace belongs to, or null. A keyed point read. */
  findByTraceId(params: {
    tenantId: string;
    traceId: string;
  }): Promise<CodingAgentTraceSessionRecord | null>;
}

/** No-op store for deployments without ClickHouse. */
export class NullCodingAgentTraceSessionRepository
  implements CodingAgentTraceSessionRepository
{
  async ensure(): Promise<void> {
    // no-op
  }

  async findByTraceId(): Promise<CodingAgentTraceSessionRecord | null> {
    return null;
  }
}

interface ClickHouseWriteRecord {
  TenantId: string;
  TraceId: string;
  SessionId: string;
  OccurredAt: Date;
  UpdatedAt: Date;
  _retention_days: number;
}

export class CodingAgentTraceSessionClickHouseRepository
  implements CodingAgentTraceSessionRepository
{
  constructor(private readonly resolveClient: ClickHouseClientResolver) {}

  async ensure(
    records: CodingAgentTraceSessionRecord[],
    retentionDays?: number,
  ): Promise<void> {
    if (records.length === 0) return;

    const tenantId = records[0]!.tenantId;
    EventUtils.validateTenantId(
      { tenantId },
      "CodingAgentTraceSessionClickHouseRepository.ensure",
    );
    // A batch insert resolves ONE client, so a row from another tenant would
    // be written into this tenant's ClickHouse. Refuse rather than cross the
    // line.
    for (const record of records) {
      if (record.tenantId !== tenantId) {
        throw new SecurityError(
          "CodingAgentTraceSessionClickHouseRepository.ensure",
          "coding agent trace-session batch spans multiple tenants",
          tenantId,
        );
      }
    }

    const now = new Date();
    const values: ClickHouseWriteRecord[] = records.map((record) => ({
      TenantId: record.tenantId,
      TraceId: record.traceId,
      SessionId: record.sessionId,
      OccurredAt: new Date(record.occurredAtMs),
      UpdatedAt: now,
      _retention_days: retentionDays ?? PLATFORM_DEFAULT_RETENTION_DAYS,
    }));

    const client = await this.resolveClient(tenantId);
    try {
      await client.insert({
        table: TABLE_NAME,
        values,
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
      });
    } catch (error) {
      logger.warn(
        { error, tenantId, count: records.length },
        "failed to write coding agent trace-session mappings",
      );
      throw error;
    }
  }

  /**
   * The mapping row for one trace. IN-tuple dedup (max(UpdatedAt) per key),
   * never FINAL. No time filter: the sort key (TenantId, TraceId) makes this
   * a keyed seek, and the caller usually has no timestamp yet — this read is
   * how it FINDS one (the mapping's OccurredAt seeds the session read's
   * partition hint).
   *
   * The closing `ORDER BY` is not decoration (ADR-071 sequencing step 4). A
   * tie on `max(UpdatedAt)` is not merely possible here, it is the normal case
   * for the shape that matters: one trace can map to a provider session key
   * and — from a span that carried no `gen_ai.conversation.id` — to a
   * trace-id fallback, and `ensure` stamps ONE `now` across a whole batch, so
   * both rows land on the same `UpdatedAt` and both satisfy the IN-tuple. A
   * bare `LIMIT 1` then picks arbitrarily, and picking the fallback resolves
   * the trace to an empty single-trace pseudo-session — the drawer opens the
   * wrong session. So a real mapping outranks the fallback first, and the
   * remaining keys only make the order total.
   */
  async findByTraceId({
    tenantId,
    traceId,
  }: {
    tenantId: string;
    traceId: string;
  }): Promise<CodingAgentTraceSessionRecord | null> {
    EventUtils.validateTenantId(
      { tenantId },
      "CodingAgentTraceSessionClickHouseRepository.findByTraceId",
    );
    const client = await this.resolveClient(tenantId);

    const result = await client.query({
      query: `
        SELECT TraceId, SessionId, OccurredAt
        FROM ${TABLE_NAME}
        WHERE TenantId = {tenantId:String}
          AND TraceId = {traceId:String}
          AND (TenantId, TraceId, UpdatedAt) IN (
            SELECT TenantId, TraceId, max(UpdatedAt)
            FROM ${TABLE_NAME}
            WHERE TenantId = {tenantId:String}
              AND TraceId = {traceId:String}
            GROUP BY TenantId, TraceId
          )
        ORDER BY SessionId != TraceId DESC, OccurredAt DESC, SessionId ASC
        LIMIT 1
      `,
      query_params: { tenantId, traceId },
      format: "JSONEachRow",
    });

    const rows = await result.json<{
      TraceId: string;
      SessionId: string;
      OccurredAt: string;
    }>();
    const first = rows[0];
    if (!first) return null;
    return {
      tenantId,
      traceId: first.TraceId,
      sessionId: first.SessionId,
      occurredAtMs: new Date(first.OccurredAt).getTime(),
    };
  }
}
