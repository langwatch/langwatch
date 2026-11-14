import { checkTenantScope, type ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { buildCodingAgentTranscript } from "@langwatch/coding-agent-contract";
import { clickHouseQueryClientDouble } from "@langwatch/test-harness/client-doubles/clickhouse";
import { describe, expect, it } from "vitest";

import { LogRecordStorageClickHouseRepository } from "../log-record-storage.repository.ts";

function codexRow({
  attributes,
  eventName,
}: {
  attributes: Record<string, string>;
  eventName: string;
}) {
  return {
    TraceId: "trace-1",
    SpanId: "span-1",
    TimeMs: "2000",
    BodyText: null,
    AttributesFlatJson: JSON.stringify(attributes),
    ResourceAttributesFlatJson: "{}",
    ScopeName: "codex",
    ScopeVersion: "1",
    EventName: eventName,
  };
}

type ReadRequest = Parameters<ClickHouseQueryClient["read"]>[0];

function repositoryOver({ rows, reads = [] }: { rows: unknown[]; reads?: ReadRequest[] }) {
  return LogRecordStorageClickHouseRepository.create({
    reader: clickHouseQueryClientDouble({
      read: async (request: ReadRequest) => {
        reads.push(request);
        return { rows };
      },
    }),
  });
}

async function readLogs(rows: unknown[]) {
  return repositoryOver({ rows }).findLogRecordsByTraceId({
    tenantId: "project-1",
    traceId: "trace-1",
  });
}

describe("given a codex session whose events name themselves the OTel Event API way", () => {
  const toolAttributes = {
    call_id: "call_A",
    tool_name: "exec",
    arguments: '{"cmd":"ls"}',
    output: "hello.py",
    success: "true",
  };

  describe("when the Terminal transcript is derived from the stored logs", () => {
    /** @scenario "Codex events are rendered whichever way the agent named them" */
    it("renders an event named by the record's EventName like one named by an attribute", async () => {
      const logs = await readLogs([
        codexRow({ attributes: toolAttributes, eventName: "codex.tool_result" }),
      ]);

      const transcript = buildCodingAgentTranscript({
        spans: [],
        logs: logs.map((log) => ({ timestampMs: log.timeUnixMs, attributes: log.attributes })),
      });

      expect(transcript.entries.find((entry) => entry.kind === "tool")).toMatchObject({
        name: "exec",
        input: { cmd: "ls" },
        output: "hello.py",
      });
    });

    it("keeps an event.name attribute the record already carries", async () => {
      const logs = await readLogs([
        codexRow({
          attributes: { ...toolAttributes, "event.name": "codex.tool_result" },
          eventName: "something.else",
        }),
      ]);

      expect(logs[0]?.attributes["event.name"]).toBe("codex.tool_result");
    });
  });
});

describe("given the Terminal replay reading a session's logs", () => {
  /** @scenario "The Terminal replay's log read passes the tenant guard" */
  it("sends a statement the tenant guard accepts (WEB-5506)", async () => {
    const reads: ReadRequest[] = [];
    await repositoryOver({ rows: [], reads }).findLogRecordsByTraceId({
      tenantId: "project-1",
      traceId: "trace-1",
    });

    const request = reads[0];
    expect(request?.table).toBe("log_records");
    expect(request?.statement).toMatchObject({
      kind: "tenant",
      identity: "reader",
      settings: { SQL_langwatch_tenant_ids: "project-1" },
    });
    expect(request?.statement.sql).toContain("FINAL");
    expect(
      checkTenantScope({
        sql: request?.statement.sql ?? "",
        params: request?.statement.params,
        tenantId: "project-1",
      }),
    ).toBeNull();
  });
});

describe("given a release still rolling out that wrote the legacy stored logs", () => {
  describe("when trace reads a trace's stored logs", () => {
    /** @scenario "The legacy stored-log read is built on the tenant's own scope" */
    it("elects each record's latest version inside the partition window, on the tenant's scope", async () => {
      const reads: ReadRequest[] = [];
      const logs = await repositoryOver({
        rows: [
          {
            TraceId: "trace-1",
            SpanId: "span-1",
            TimeMs: 2000,
            Body: "hello",
            Attributes: { a: "1" },
            ResourceAttributes: {},
            ScopeName: "scope",
            ScopeVersion: null,
          },
        ],
        reads,
      }).findLogsByTraceId({ tenantId: "project-1", traceId: "trace-1", occurredAtMs: 10_000 });

      const request = reads[0];
      expect(request?.table).toBe("stored_log_records");
      expect(request?.statement).toMatchObject({
        kind: "tenant",
        identity: "reader",
        settings: { SQL_langwatch_tenant_ids: "project-1" },
      });
      expect(request?.statement.sql).toContain("max(UpdatedAt)");
      expect(request?.statement.sql).toContain("TimeUnixMs >= fromUnixTimestamp64Milli(");
      expect(logs).toEqual([
        {
          traceId: "trace-1",
          spanId: "span-1",
          timeUnixMs: 2000,
          body: "hello",
          attributes: { a: "1" },
          resourceAttributes: {},
          scopeName: "scope",
          scopeVersion: null,
        },
      ]);
    });
  });
});
