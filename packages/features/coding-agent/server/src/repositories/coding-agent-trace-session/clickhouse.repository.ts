import type { CodingAgentTraceSessionRecord } from "@langwatch/coding-agent-contract";
import { EventUtils, SecurityError } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import type { CodingAgentClickHousePort } from "../../ports/coding-agent-clickhouse.port";
import { CodingAgentTraceSessionRepository as TraceSessionRepository } from "../coding-agent-trace-session.repository";

const TABLE_NAME = "coding_agent_trace_sessions" as const;

const logger = createLogger("langwatch:app-layer:coding-agent:trace-session-repository");

interface ClickHouseWriteRecord {
  TenantId: string;
  TraceId: string;
  SessionId: string;
  OccurredAt: Date;
  UpdatedAt: Date;
  _retention_days: number;
}

export class CodingAgentTraceSessionClickHouseRepository implements TraceSessionRepository {
  static create({
    clickHouse,
    defaultTraceRetentionDays,
  }: {
    clickHouse: CodingAgentClickHousePort;
    defaultTraceRetentionDays: number;
  }): CodingAgentTraceSessionClickHouseRepository {
    return new CodingAgentTraceSessionClickHouseRepository(clickHouse, defaultTraceRetentionDays);
  }

  private constructor(
    private readonly clickHouse: CodingAgentClickHousePort,
    private readonly defaultTraceRetentionDays: number,
  ) {}

  async ensure(records: CodingAgentTraceSessionRecord[], retentionDays?: number): Promise<void> {
    const [first] = records;
    if (!first) return;

    const tenantId = first.tenantId;
    EventUtils.validateTenantId({ tenantId }, "CodingAgentTraceSessionClickHouseRepository.ensure");
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
      _retention_days: retentionDays ?? this.defaultTraceRetentionDays,
    }));

    const client = await this.clickHouse.resolve(tenantId);
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
   * The mapping row for one trace. IN-tuple dedup (max(UpdatedAt) per key), never FINAL.
   * The closing `ORDER BY` is not decoration (ADR-071 sequencing step 4). A
   */
  async tryFindByTraceId({
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
    const client = await this.clickHouse.resolve(tenantId);

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
