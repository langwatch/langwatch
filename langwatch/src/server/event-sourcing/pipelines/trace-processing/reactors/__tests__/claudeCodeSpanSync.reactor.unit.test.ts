import { describe, expect, it, vi } from "vitest";

import { CLAUDE_CODE_KIND_ATTR } from "~/server/app-layer/traces/claude-code-log-to-span";
import type { StoredLogRecordRow } from "~/server/app-layer/traces/repositories/log-record-storage.repository";
import {
  LOG_RECORD_RECEIVED_EVENT_TYPE,
  SPAN_RECEIVED_EVENT_TYPE,
} from "../../schemas/constants";
import type { OtlpSpan } from "../../schemas/otlp";
import type { RecordSpanCommandData } from "../../schemas/commands";
import type {
  LogRecordReceivedEvent,
  SpanReceivedEvent,
} from "../../schemas/events";
import { createClaudeCodeSpanSyncReactor } from "../claudeCodeSpanSync.reactor";

const SCOPE = "com.anthropic.claude_code.events";
const TENANT = "project_test";
const TRACE = "a3c6656cf433e97549f654034be02955";

const row = (
  eventName: string,
  attrs: Record<string, string>,
  timeUnixMs: number,
  spanId = "0000000000000000",
): StoredLogRecordRow => ({
  traceId: TRACE,
  spanId,
  timeUnixMs,
  attributes: { "event.name": eventName, [CLAUDE_CODE_KIND_ATTR]: "x", ...attrs },
  resourceAttributes: { "service.name": "claude-code" },
  scopeName: SCOPE,
  scopeVersion: "2.1.62",
});

// A whole tool-using turn delivered (as it really is) across batches: the
// request body lands first, the anchor + response + tool_result later, and the
// tool's output only appears in the NEXT model call's request body transcript.
const turnRows = (): StoredLogRecordRow[] => [
  row("user_prompt", { "session.id": "s", "prompt.id": "p", prompt: "List /tmp" }, 100, "aa00000000000001"),
  row(
    "api_request_body",
    {
      "session.id": "s",
      model: "claude-opus-4-8",
      query_source: "repl_main_thread",
      body: JSON.stringify({
        model: "claude-opus-4-8",
        messages: [{ role: "user", content: [{ type: "text", text: "List /tmp" }] }],
      }),
    },
    200,
    "aa00000000000002",
  ),
  row(
    "tool_result",
    {
      "session.id": "s",
      tool_name: "Bash",
      tool_use_id: "toolu_1",
      success: "true",
      duration_ms: "50",
      tool_input: '{"command":"ls /tmp"}',
    },
    1_000,
    "aa00000000000003",
  ),
  row(
    "api_request",
    {
      "session.id": "s",
      model: "claude-opus-4-8",
      input_tokens: "100",
      output_tokens: "20",
      cost_usd: "0.05",
      duration_ms: "800",
      request_id: "req_1",
      query_source: "repl_main_thread",
    },
    1_200,
    "aa00000000000004",
  ),
  row(
    "api_response_body",
    {
      "session.id": "s",
      model: "claude-opus-4-8",
      request_id: "req_1",
      query_source: "repl_main_thread",
      body: JSON.stringify({ content: [{ type: "text", text: "There are 3 files." }] }),
    },
    1_200,
    "aa00000000000005",
  ),
  // The next model call's request feeds the tool's result back to the model.
  row(
    "api_request_body",
    {
      "session.id": "s",
      model: "claude-opus-4-8",
      query_source: "repl_main_thread",
      body: JSON.stringify({
        model: "claude-opus-4-8",
        messages: [
          {
            role: "user",
            content: [
              { tool_use_id: "toolu_1", type: "tool_result", content: "a.txt\nb.txt\nc.txt" },
            ],
          },
        ],
      }),
    },
    2_000,
    "aa00000000000006",
  ),
];

const logEvent = (): LogRecordReceivedEvent =>
  ({
    type: LOG_RECORD_RECEIVED_EVENT_TYPE,
    tenantId: TENANT,
    aggregateId: TRACE,
    occurredAt: 1_700_000_000_000,
    data: { scopeName: SCOPE },
  }) as unknown as LogRecordReceivedEvent;

const spanType = (s: OtlpSpan): string | undefined =>
  (s.attributes.find((a) => a.key === "langwatch.span.type")?.value as { stringValue?: string })
    ?.stringValue;
const strAttr = (s: OtlpSpan, key: string): string | undefined =>
  (s.attributes.find((a) => a.key === key)?.value as { stringValue?: string })
    ?.stringValue;

function setup(rows: StoredLogRecordRow[]) {
  const getMarkedClaudeCodeLogs = vi.fn(async () => rows);
  const recorded: RecordSpanCommandData[] = [];
  const recordSpan = vi.fn(async (data: RecordSpanCommandData) => {
    recorded.push(data);
  });
  const reactor = createClaudeCodeSpanSyncReactor({
    getMarkedClaudeCodeLogs,
    recordSpan,
  });
  return { reactor, getMarkedClaudeCodeLogs, recordSpan, recorded };
}

describe("createClaudeCodeSpanSyncReactor", () => {
  describe("when a claude_code log is folded over the whole turn", () => {
    it("emits a root turn span with the model + tool spans as complete children", async () => {
      const { reactor, recorded } = setup(turnRows());
      await reactor.handle(logEvent(), {
        tenantId: TENANT,
        aggregateId: TRACE,
        foldState: undefined,
      });

      const spans = recorded.map((r) => r.span);
      const root = spans.find((s) => s.parentSpanId === null)!;
      const model = spans.find((s) => spanType(s) === "llm")!;
      const tool = spans.find((s) => spanType(s) === "tool")!;

      // Root carries the user's prompt; model + tool are its children.
      expect(spanType(root)).toBe("agent");
      expect(strAttr(root, "langwatch.input")).toBe("List /tmp");
      expect(model.parentSpanId).toBe(root.spanId);
      expect(tool.parentSpanId).toBe(root.spanId);

      // The model span — split across batches — has BOTH input and output, plus
      // its tokens and cost (the bug this whole rework fixes).
      expect(strAttr(model, "gen_ai.input.messages")).toBe(
        JSON.stringify([{ role: "user", content: "List /tmp" }]),
      );
      expect(strAttr(model, "gen_ai.completion")).toBe("There are 3 files.");
      expect(
        model.attributes.find((a) => a.key === "langwatch.span.cost")?.value,
      ).toEqual({ doubleValue: 0.05 });

      // The Bash tool span recovered its output from the next call's transcript.
      expect(strAttr(tool, "langwatch.input")).toBe('{"command":"ls /tmp"}');
      expect(strAttr(tool, "langwatch.output")).toBe("a.txt\nb.txt\nc.txt");

      // PII level defaults to STRICT when the logs carry no stamped level.
      expect(recorded[0]!.piiRedactionLevel).toBe("STRICT");
    });

    it("re-fires idempotently: the same logs produce the same span ids", async () => {
      const { reactor, recorded } = setup(turnRows());
      const ctx = { tenantId: TENANT, aggregateId: TRACE, foldState: undefined };
      await reactor.handle(logEvent(), ctx);
      const firstIds = recorded.map((r) => r.span.spanId).sort();
      recorded.length = 0;
      await reactor.handle(logEvent(), ctx);
      const secondIds = recorded.map((r) => r.span.spanId).sort();
      expect(secondIds).toEqual(firstIds);
    });
  });

  describe("the reactor gate", () => {
    it("ignores non-log events so the spans it emits never re-trigger it", async () => {
      const { reactor, getMarkedClaudeCodeLogs, recordSpan } = setup(turnRows());
      const spanEvent = {
        type: SPAN_RECEIVED_EVENT_TYPE,
        tenantId: TENANT,
        aggregateId: TRACE,
        occurredAt: 1,
        data: {},
      } as unknown as SpanReceivedEvent;
      await reactor.handle(spanEvent, {
        tenantId: TENANT,
        aggregateId: TRACE,
        foldState: undefined,
      });
      expect(getMarkedClaudeCodeLogs).not.toHaveBeenCalled();
      expect(recordSpan).not.toHaveBeenCalled();
    });

    it("ignores log events from non-claude scopes", async () => {
      const { reactor, getMarkedClaudeCodeLogs } = setup(turnRows());
      const codexLog = {
        type: LOG_RECORD_RECEIVED_EVENT_TYPE,
        tenantId: TENANT,
        aggregateId: TRACE,
        occurredAt: 1,
        data: { scopeName: "com.openai.codex.events" },
      } as unknown as LogRecordReceivedEvent;
      await reactor.handle(codexLog, {
        tenantId: TENANT,
        aggregateId: TRACE,
        foldState: undefined,
      });
      expect(getMarkedClaudeCodeLogs).not.toHaveBeenCalled();
    });
  });
});
