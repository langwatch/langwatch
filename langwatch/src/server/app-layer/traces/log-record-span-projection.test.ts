import { describe, it, expect } from "vitest";
import type { NormalizedLogRecord } from "~/server/event-sourcing/pipelines/trace-processing/schemas/logRecords";
import { projectLogRecordsToSpans } from "./log-record-span-projection";

const CLAUDE_SCOPE = "com.anthropic.claude_code.events";

function record(
  partial: Partial<NormalizedLogRecord> & {
    spanId: string;
    timeUnixMs: number;
    attributes: Record<string, string>;
  },
): NormalizedLogRecord {
  return {
    id: `proj-${partial.spanId}`,
    tenantId: "project_test",
    traceId: "trace_abc",
    severityNumber: 9,
    severityText: "INFO",
    body: "",
    resourceAttributes: {},
    scopeName: CLAUDE_SCOPE,
    scopeVersion: null,
    ...partial,
  };
}

function requestBody(model: string): string {
  return JSON.stringify({
    model,
    system: [{ type: "text", text: "You are Claude Code." }],
    messages: [{ role: "user", content: [{ type: "text", text: `ask ${model}` }] }],
  });
}

function responseBody(model: string, text: string): string {
  return JSON.stringify({
    model,
    role: "assistant",
    content: [{ type: "text", text }],
    usage: { input_tokens: 5, output_tokens: 7 },
  });
}

/**
 * Two real-shaped Claude Code turns: a haiku `generate_session_title` utility
 * call and an opus `repl_main_thread` conversation turn, each with its
 * api_request (timing/cost) + api_request_body (input) + api_response_body
 * (output) triplet, plus a user_prompt and two lifecycle hook events.
 */
function twoTurnTrace(): NormalizedLogRecord[] {
  const base = {
    "event.name": "",
    "service.name": "claude-code",
    "session.id": "session-1",
  };
  return [
    record({
      spanId: "hook-1",
      timeUnixMs: 1000,
      attributes: { ...base, "event.name": "hook_registered" },
    }),
    record({
      spanId: "prompt-1",
      timeUnixMs: 1100,
      attributes: { ...base, "event.name": "user_prompt" },
    }),
    // ---- haiku title-gen turn (non-conversational) ----
    record({
      spanId: "haiku-reqbody",
      timeUnixMs: 1200,
      attributes: {
        ...base,
        "event.name": "api_request_body",
        model: "claude-haiku-4-5",
        query_source: "generate_session_title",
        body: requestBody("claude-haiku-4-5"),
      },
    }),
    record({
      spanId: "haiku-req",
      timeUnixMs: 1500,
      attributes: {
        ...base,
        "event.name": "api_request",
        model: "claude-haiku-4-5",
        query_source: "generate_session_title",
        request_id: "req-haiku",
        duration_ms: "300",
        input_tokens: "100",
        output_tokens: "10",
        cost_usd: "0.0005",
      },
    }),
    record({
      spanId: "haiku-respbody",
      timeUnixMs: 1500,
      attributes: {
        ...base,
        "event.name": "api_response_body",
        model: "claude-haiku-4-5",
        query_source: "generate_session_title",
        request_id: "req-haiku",
        body: responseBody("claude-haiku-4-5", '{"title": "Some title"}'),
      },
    }),
    // ---- opus main-thread turn (conversational) ----
    record({
      spanId: "opus-reqbody",
      timeUnixMs: 1600,
      attributes: {
        ...base,
        "event.name": "api_request_body",
        model: "claude-opus-4-7",
        query_source: "repl_main_thread",
        body: requestBody("claude-opus-4-7"),
      },
    }),
    record({
      spanId: "opus-req",
      timeUnixMs: 2000,
      attributes: {
        ...base,
        "event.name": "api_request",
        model: "claude-opus-4-7",
        query_source: "repl_main_thread",
        request_id: "req-opus",
        duration_ms: "400",
        input_tokens: "200",
        output_tokens: "20",
        cost_usd: "0.3",
      },
    }),
    record({
      spanId: "opus-respbody",
      timeUnixMs: 2000,
      attributes: {
        ...base,
        "event.name": "api_response_body",
        model: "claude-opus-4-7",
        query_source: "repl_main_thread",
        request_id: "req-opus",
        body: responseBody("claude-opus-4-7", "MARKER-OUTPUT-9090"),
      },
    }),
    record({
      spanId: "hook-2",
      timeUnixMs: 2100,
      attributes: { ...base, "event.name": "mcp_server_connection" },
    }),
  ];
}

describe("projectLogRecordsToSpans", () => {
  describe("given an empty record set", () => {
    it("returns no spans", () => {
      expect(projectLogRecordsToSpans({ records: [], totalCount: 0 })).toEqual([]);
    });
  });

  describe("given a two-turn Claude Code log-only trace", () => {
    const records = twoTurnTrace();
    const spans = projectLogRecordsToSpans({
      records,
      totalCount: records.length,
    });
    const byId = new Map(spans.map((s) => [s.spanId, s]));

    /** @scenario Each model call is shown as a single call span */
    it("collapses each api_request triplet into one llm span", () => {
      const llmSpans = spans.filter((s) => s.type === "llm");
      expect(llmSpans.map((s) => s.spanId).sort()).toEqual([
        "haiku-req",
        "opus-req",
      ]);
    });

    it("does not emit standalone spans for consumed request/response bodies", () => {
      for (const consumed of [
        "haiku-reqbody",
        "haiku-respbody",
        "opus-reqbody",
        "opus-respbody",
      ]) {
        expect(byId.has(consumed)).toBe(false);
      }
    });

    it("keeps output count bounded at or below the record count", () => {
      // triplets (6 records) collapse to 2 llm spans; the other 3 records map
      // 1:1; plus one synthetic root.
      expect(spans.length).toBeLessThanOrEqual(records.length + 1);
      expect(spans.length).toBe(2 + 3 + 1);
    });

    /** @scenario The waterfall is populated from the trace's log records */
    it("parents every projected span under one synthetic session root", () => {
      const roots = spans.filter((s) => s.parentSpanId === null);
      expect(roots).toHaveLength(1);
      expect(roots[0]!.name).toBe("Claude Code session");
      for (const span of spans) {
        if (span.parentSpanId === null) continue;
        expect(span.parentSpanId).toBe(roots[0]!.spanId);
      }
    });

    /** @scenario The conversation turn shows its prompt and reply */
    it("folds input from the api_request_body matched by (model, query_source)", () => {
      expect(byId.get("haiku-req")!.input).toContain("ask claude-haiku-4-5");
      expect(byId.get("opus-req")!.input).toContain("ask claude-opus-4-7");
    });

    /** @scenario A title-generation turn never borrows a main-thread prompt */
    it("does not cross-pair title-gen input with main-thread input", () => {
      expect(byId.get("haiku-req")!.input).not.toContain("claude-opus-4-7");
      expect(byId.get("opus-req")!.input).not.toContain("claude-haiku-4-5");
    });

    /** @scenario Utility-call replies are not shown as the assistant's answer */
    it("surfaces assistant output only for conversational query sources", () => {
      // opus repl_main_thread = conversational -> output shown
      expect(byId.get("opus-req")!.output).toBe("MARKER-OUTPUT-9090");
      // haiku generate_session_title = utility -> output suppressed
      expect(byId.get("haiku-req")!.output).toBeNull();
    });

    it("carries tokens + cost from the api_request event", () => {
      expect(byId.get("opus-req")!.metrics).toEqual({
        promptTokens: 200,
        completionTokens: 20,
        cost: 0.3,
      });
    });

    it("derives llm span timing from duration_ms (end - duration)", () => {
      const opus = byId.get("opus-req")!;
      expect(opus.endTimeMs).toBe(2000);
      expect(opus.startTimeMs).toBe(1600);
      expect(opus.durationMs).toBe(400);
    });

    it("maps non-llm log records 1:1 to event spans", () => {
      expect(byId.get("hook-1")!.name).toBe("Hook registered");
      expect(byId.get("prompt-1")!.name).toBe("User prompt");
      expect(byId.get("hook-2")!.name).toBe("MCP server connection");
    });

    it("marks every projected span as read-derived in params", () => {
      for (const span of spans) {
        expect(span.params).toMatchObject({
          synthetic: true,
          source: "log-record-projection",
        });
      }
    });
  });

  describe("when the record set was truncated past the read cap", () => {
    const records = twoTurnTrace();
    const spans = projectLogRecordsToSpans({
      records,
      totalCount: records.length + 250,
    });

    /** @scenario Very large log-only traces are bounded with an elision marker */
    it("emits an elision marker span reporting the dropped count", () => {
      const marker = spans.find((s) => s.name.includes("elided"));
      expect(marker).toBeDefined();
      expect(marker!.name).toContain("250 more log records elided");
      expect(marker!.params).toMatchObject({ elidedRecords: 250 });
    });

    it("records the elided count on the root span params", () => {
      const root = spans.find((s) => s.parentSpanId === null)!;
      expect(root.params).toMatchObject({ elidedRecords: 250 });
    });
  });

  describe("given an api_request_body with no matching api_request", () => {
    it("renders the orphan request body as an event span instead of dropping it", () => {
      const records = [
        record({
          spanId: "orphan-reqbody",
          timeUnixMs: 500,
          attributes: {
            "event.name": "api_request_body",
            model: "claude-opus-4-7",
            query_source: "repl_main_thread",
            body: requestBody("claude-opus-4-7"),
          },
        }),
      ];
      const spans = projectLogRecordsToSpans({ records, totalCount: 1 });
      const orphan = spans.find((s) => s.spanId === "orphan-reqbody");
      expect(orphan).toBeDefined();
      expect(orphan!.type).toBe("span");
      expect(orphan!.input).toContain("ask claude-opus-4-7");
    });
  });

  describe("given non-Claude log records", () => {
    it("names the root generically and still projects event spans", () => {
      const records = [
        {
          id: "p1",
          tenantId: "project_test",
          traceId: "t1",
          spanId: "s1",
          timeUnixMs: 10,
          severityNumber: 9,
          severityText: "INFO",
          body: "hello",
          attributes: { "event.name": "custom_event" },
          resourceAttributes: {},
          scopeName: "some.other.scope",
          scopeVersion: null,
        } satisfies NormalizedLogRecord,
      ];
      const spans = projectLogRecordsToSpans({ records, totalCount: 1 });
      const root = spans.find((s) => s.parentSpanId === null)!;
      expect(root.name).toBe("Session (log records)");
      expect(spans.find((s) => s.spanId === "s1")!.name).toBe("Custom event");
    });
  });
});
