import type { CodingAgentTraceSessionRecord } from "@langwatch/coding-agent-contract";
import { EventUtils, SecurityError } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import {
  clickHouseMomentOf,
  parseClickHouseDateTimeMs,
  type ClickHouseMoment,
} from "./clickhouse.mapper.ts";
import { CodingAgentTraceSessionRepository as TraceSessionRepository } from "../coding-agent-trace-session.repository.ts";

const TABLE_NAME = "coding_agent_trace_sessions" as const;

const logger = createLogger("langwatch:app-layer:coding-agent:trace-session-repository");

interface ClickHouseWriteRecord {
  TenantId: string;
  TraceId: string;
  SessionId: string;
  OccurredAt: ClickHouseMoment;
  UpdatedAt: ClickHouseMoment;
  _retention_days: number;
}

export class CodingAgentTraceSessionClickHouseRepository implements TraceSessionRepository {
  static create({
    clickhouse,
    defaultTraceRetentionDays,
  }: {
    clickhouse: ClickHouseQueryClient;
    defaultTraceRetentionDays: number;
  }): CodingAgentTraceSessionClickHouseRepository {
    return new CodingAgentTraceSessionClickHouseRepository(clickhouse, defaultTraceRetentionDays);
  }

  private constructor(
    private readonly clickhouse: ClickHouseQueryClient,
    private readonly defaultTraceRetentionDays: number,
  ) {}

  async ensure(records: CodingAgentTraceSessionRecord[], retentionDays?: number): Promise<void> {
    const [first] = records;
    if (!first) return;

    const tenantId = first.tenantId;
    EventUtils.validateTenantId({ tenantId }, "CodingAgentTraceSessionClickHouseRepository.ensure");
    // A batch is written for ONE tenant, so a row from another would land in
    // this tenant's ClickHouse. Refuse rather than cross the line.
    for (const record of records) {
      if (record.tenantId !== tenantId) {
        throw new SecurityError(
          "CodingAgentTraceSessionClickHouseRepository.ensure",
          "coding agent trace-session batch spans multiple tenants",
          tenantId,
        );
      }
    }

    const now = clickHouseMomentOf(nowInstant().epochMilliseconds);
    const values: ClickHouseWriteRecord[] = records.map((record) => ({
      TenantId: record.tenantId,
      TraceId: record.traceId,
      SessionId: record.sessionId,
      OccurredAt: clickHouseMomentOf(record.occurredAtMs),
      UpdatedAt: now,
      _retention_days: retentionDays ?? this.defaultTraceRetentionDays,
    }));

    try {
      await this.clickhouse.insert({
        tenantId,
        table: TABLE_NAME,
        rows: values,
        settings: { async_insert: 1, wait_for_async_insert: 1 },
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
    const { rows } = await this.clickhouse.query<{
      TraceId: string;
      SessionId: string;
      OccurredAt: string;
    }>({
      tenantId,
      table: TABLE_NAME,
      kind: "read",
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
      occurredAtMs: parseClickHouseDateTimeMs(first.OccurredAt),
    };
  }
}
