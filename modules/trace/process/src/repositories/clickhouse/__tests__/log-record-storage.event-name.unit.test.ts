import { buildCodingAgentTranscript } from "@langwatch/coding-agent-contract";
import { describe, expect, it, vi } from "vitest";

import { LogRecordStorageClickHouseRepository } from "../log-record-storage.repository.ts";

function codexRow({ attributes, eventName }: { attributes: Record<string, string>; eventName: string }) {
  return {
    TraceId: "trace-1",
    SpanId: "span-1",
    TimeUnixMs: "2000",
    BodyText: null,
    AttributesFlatJson: JSON.stringify(attributes),
    ResourceAttributesFlatJson: "{}",
    ScopeName: "codex",
    ScopeVersion: "1",
    EventName: eventName,
  };
}

async function readLogs(rows: unknown[]) {
  const query = vi.fn(async () => ({ json: async () => rows }));
  const repository = LogRecordStorageClickHouseRepository.create((async () => ({ query })) as never);
  return repository.findLogRecordsByTraceId({ tenantId: "project-1", traceId: "trace-1" });
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
      const logs = await readLogs([codexRow({ attributes: toolAttributes, eventName: "codex.tool_result" })]);

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
