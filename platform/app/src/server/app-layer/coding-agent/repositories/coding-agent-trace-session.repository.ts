import { SecurityError, validateTenantId } from "@langwatch/clickhouse";
import { createLogger } from "@langwatch/observability";
import type { ClickHouseClientResolver } from "~/server/app-layer/clients/clickhouse/tenant-client";
import { writeTargetFor } from "~/server/app-layer/clients/clickhouse/write-targets";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import type { CodingAgentTraceSession } from "~/server/event-sourcing/coding-agent-processing/schema";

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
    records: CodingAgentTraceSession[],
    retentionDays?: number,
  ): Promise<void>;

  /** The session a trace belongs to, or null. A keyed point read. */
  findByTraceId(params: {
    tenantId: string;
    traceId: string;
  }): Promise<CodingAgentTraceSession | null>;
}

/** No-op store for deployments without ClickHouse. */
export class NullCodingAgentTraceSessionRepository
  implements CodingAgentTraceSessionRepository
{
  async ensure(): Promise<void> {
    // no-op
  }

  async findByTraceId(): Promise<CodingAgentTraceSession | null> {
    return null;
  }
}

/**
 * A type alias rather than an interface: only an anonymous object type gets an
 * implicit index signature, and without one it cannot be passed as the client's
 * `rows`.
 */
type ClickHouseWriteRecord = {
  TenantId: string;
  TraceId: string;
  SessionId: string;
  OccurredAt: Date;
  UpdatedAt: Date;
  _retention_days: number;
};

export class CodingAgentTraceSessionClickHouseRepository
  implements CodingAgentTraceSessionRepository
{
  constructor(private readonly resolveClient: ClickHouseClientResolver) {}

  async ensure(
    records: CodingAgentTraceSession[],
    retentionDays?: number,
  ): Promise<void> {
    if (records.length === 0) return;

    const tenantId = records[0]!.tenantId;
    validateTenantId(
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
    const rows: ClickHouseWriteRecord[] = records.map((record) => ({
      TenantId: record.tenantId,
      TraceId: record.traceId,
      SessionId: record.sessionId,
      OccurredAt: new Date(record.occurredAt),
      UpdatedAt: now,
      _retention_days: retentionDays ?? PLATFORM_DEFAULT_RETENTION_DAYS,
    }));

    const client = await this.resolveClient(tenantId);
    try {
      await client.insert({
        table: TABLE_NAME,
        rows,
        target: writeTargetFor(TABLE_NAME),
      });
    } catch (error) {
      logger.error(
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
  }): Promise<CodingAgentTraceSession | null> {
    validateTenantId(
      { tenantId },
      "CodingAgentTraceSessionClickHouseRepository.findByTraceId",
    );
    const client = await this.resolveClient(tenantId);

    const rows = await client.query<{
      TraceId: string;
      SessionId: string;
      OccurredAt: string;
    }>({
      table: TABLE_NAME,
      sql: `
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
      params: { tenantId, traceId },
    });

    const first = rows[0];
    if (!first) return null;
    return {
      tenantId,
      traceId: first.TraceId,
      sessionId: first.SessionId,
      occurredAt: new Date(first.OccurredAt).getTime(),
    };
  }
}
