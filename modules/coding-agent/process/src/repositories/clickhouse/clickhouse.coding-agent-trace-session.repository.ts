import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { clickhouseRead, cond, fn, tenantScope } from "@langwatch/clickhouse-client/builder";
import type { CodingAgentTraceSessionRecord } from "@langwatch/coding-agent-contract";
import { EventUtils, SecurityError } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

import type { CodingAgentTraceSessionRepository as TraceSessionRepository } from "../coding-agent-trace-session.repository.ts";
import { codingAgentTraceSessions } from "./clickhouse.coding-agent-trace-sessions.table.ts";
import { clickHouseMomentOf, type ClickHouseMoment } from "./clickhouse.mapper.ts";

const TABLE_NAME = "coding_agent_trace_sessions" as const;

const logger = createLogger("langwatch:app-layer:coding-agent:trace-session-repository");

interface ClickHouseWriteRecord {
  [key: string]: unknown;
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
    clickhouse: Pick<ClickHouseQueryClient, "read" | "insert">;
    defaultTraceRetentionDays: number;
  }): CodingAgentTraceSessionClickHouseRepository {
    return new CodingAgentTraceSessionClickHouseRepository(clickhouse, defaultTraceRetentionDays);
  }

  private constructor(
    private readonly clickhouse: Pick<ClickHouseQueryClient, "read" | "insert">,
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
        throw new SecurityError({
          operation: "CodingAgentTraceSessionClickHouseRepository.ensure",
          message: "coding agent trace-session batch spans multiple tenants",
          tenantId,
        });
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
   * The closing `ORDER BY` is not decoration (ADR-071 sequencing step 4). With the id index
   * on, both the scan and its dedup subquery read only the range the trace's rows span.
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
    const t = codingAgentTraceSessions;
    const statement = clickhouseRead({ scope: tenantScope.single({ tenantId }) })
      .from(t)
      .select({
        TraceId: t.TraceId,
        SessionId: t.SessionId,
        OccurredAtMs: fn.toUnixTimestamp64Milli(t.OccurredAt),
      })
      .where(({ and, eq, idBound }) => and(eq(t.TraceId, traceId), idBound(t.TraceId, traceId)))
      .latestVersion()
      .orderBy(cond.ne(t.SessionId, t.TraceId), "DESC")
      .orderBy(t.OccurredAt, "DESC")
      .orderBy(t.SessionId, "ASC")
      .limit(1)
      .build();
    const { rows } = await this.clickhouse.read({ statement, idBound: { fallback: "unbounded" } });

    const first = rows[0];
    if (!first) return null;
    return {
      tenantId,
      traceId: first.TraceId,
      sessionId: first.SessionId,
      occurredAtMs: Number(first.OccurredAtMs),
    };
  }
}
