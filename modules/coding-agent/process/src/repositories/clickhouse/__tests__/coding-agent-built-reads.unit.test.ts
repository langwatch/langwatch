/**
 * ADR-202: coding-agent's single-tenant reads are built statements, sent as the reader with the
 * tenant setting the row policy reads.
 */
import type { ReaderReadStatement } from "@langwatch/clickhouse-client/builder";
import { describe, expect, it } from "vitest";

import { CodingAgentSessionEventsClickHouseRepository } from "../clickhouse.coding-agent-session-event.repository.ts";
import { CodingAgentTraceSessionClickHouseRepository } from "../clickhouse.coding-agent-trace-session.repository.ts";
import { SessionMetricSeriesClickHouseRepository } from "../clickhouse.session-metric-series.repository.ts";

function recordingClient(rows: Record<string, unknown>[] = []) {
  const statements: ReaderReadStatement[] = [];
  const clickhouse = {
    read: async ({ statement }: { statement: ReaderReadStatement }) => {
      statements.push(statement);
      return { rows };
    },
    insert: async () => undefined,
  } as never;
  return { clickhouse, statements };
}

const expectSingleTenantRead = (statement: ReaderReadStatement | undefined) => {
  expect(statement).toMatchObject({ identity: "reader", kind: "tenant", tenantId: "project_1" });
  expect(statement?.settings).toMatchObject({ SQL_langwatch_tenant_ids: "project_1" });
};

describe("coding-agent built reads", () => {
  describe("when a trace's session mapping is read", () => {
    it("elects the latest version per trace and prefers a session that is not the trace", async () => {
      const { clickhouse, statements } = recordingClient([
        { TraceId: "trace_1", SessionId: "session_1", OccurredAtMs: "1782000000000" },
      ]);
      const repository = CodingAgentTraceSessionClickHouseRepository.create({
        clickhouse,
        defaultTraceRetentionDays: 30,
      });

      const record = await repository.findByTraceId({ tenantId: "project_1", traceId: "trace_1" });

      expect(record).toEqual({
        tenantId: "project_1",
        traceId: "trace_1",
        sessionId: "session_1",
        occurredAtMs: 1782000000000,
      });
      const [statement] = statements;
      expectSingleTenantRead(statement);
      expect(statement?.sql).toContain("FROM coding_agent_trace_sessions");
      expect(statement?.sql).toMatch(/max\(UpdatedAt\)/);
      expect(statement?.sql).toContain("LIMIT 1");
    });
  });

  describe("when a session's metric totals are read", () => {
    it("converges each unit by argMax before summing", async () => {
      const { clickhouse, statements } = recordingClient([
        { SessionId: "session_1", MetricName: "tokens", Bucket: "input", Total: "5" },
      ]);
      const repository = SessionMetricSeriesClickHouseRepository.create({
        clickhouse,
        defaultTraceRetentionDays: 30,
      });

      const totals = await repository.findTotalsBySessionIds({
        tenantId: "project_1",
        sessionIds: ["session_1"],
        fromMs: 1_000,
        toMs: 2_000,
      });

      expect(totals).toEqual([
        { sessionId: "session_1", metricName: "tokens", bucket: "input", total: 5 },
      ]);
      const [statement] = statements;
      expectSingleTenantRead(statement);
      expect(statement?.sql).toContain("FROM session_metric_series");
      expect(statement?.sql).toMatch(/argMax\(Value, tuple\(AsOf, UpdatedAt\)\)/);
    });
  });

  describe("when a session's events page is read", () => {
    it("dedups each record by LIMIT 1 BY after the newest version", async () => {
      const { clickhouse, statements } = recordingClient();
      const repository = CodingAgentSessionEventsClickHouseRepository.create({
        clickhouse,
        defaultTraceRetentionDays: 30,
      });

      await repository.listBySessionId({
        tenantId: "project_1",
        sessionId: "session_1",
        kinds: ["model_call"],
        cursor: { timeUnixMs: 1_000, recordId: "record_1" },
        limit: 50,
      });

      const [statement] = statements;
      expectSingleTenantRead(statement);
      expect(statement?.sql).toContain("FROM coding_agent_session_events");
      expect(statement?.sql).toMatch(/LIMIT 1 BY TimeUnixMs, RecordId/);
      expect(statement?.sql).toMatch(/tuple\(TimeUnixMs, RecordId\) > /);
    });
  });
});
