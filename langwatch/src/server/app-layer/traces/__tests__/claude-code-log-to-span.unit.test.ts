import { describe, expect, it } from "vitest";

import {
  type ClaudeCodeLogRecordInput,
  convertClaudeCodeLogsToSpans,
  isClaudeCodeConvertibleLog,
} from "../claude-code-log-to-span";
import type { OtlpSpan } from "../../../event-sourcing/pipelines/trace-processing/schemas/otlp";

const TRACE = "a3c6656cf433e97549f654034be02955";

const rec = (
  over: Partial<ClaudeCodeLogRecordInput> & {
    eventName: string;
    attrs: Record<string, string>;
  },
): ClaudeCodeLogRecordInput => ({
  traceId: TRACE,
  spanId: over.spanId ?? "9376fa726d53e62a",
  timeUnixMs: over.timeUnixMs ?? 1_700_000_000_000,
  resource: null,
  instrumentationScope: null,
  ...over,
});

const attr = (span: OtlpSpan, key: string): unknown =>
  span.attributes.find((a) => a.key === key)?.value;

const requestBody = (text: string) =>
  JSON.stringify({
    model: "claude-opus-4-7",
    messages: [{ role: "user", content: [{ type: "text", text }] }],
  });

const responseBody = (text: string) =>
  JSON.stringify({ content: [{ type: "text", text }] });

describe("isClaudeCodeConvertibleLog", () => {
  it("matches only the 3 model-call events under the claude_code scope", () => {
    const scope = "com.anthropic.claude_code.events";
    expect(isClaudeCodeConvertibleLog(scope, "api_request")).toBe(true);
    expect(isClaudeCodeConvertibleLog(scope, "api_request_body")).toBe(true);
    expect(isClaudeCodeConvertibleLog(scope, "api_response_body")).toBe(true);
    expect(isClaudeCodeConvertibleLog(scope, "user_prompt")).toBe(false);
    expect(isClaudeCodeConvertibleLog(scope, "hook_registered")).toBe(false);
    expect(isClaudeCodeConvertibleLog(scope, undefined)).toBe(false);
    expect(isClaudeCodeConvertibleLog("com.openai.codex.events", "api_request")).toBe(
      false,
    );
  });
});

describe("convertClaudeCodeLogsToSpans", () => {
  describe("when the full triplet is present in one batch", () => {
    const build = () =>
      convertClaudeCodeLogsToSpans([
        rec({
          eventName: "api_request",
          spanId: "aaaaaaaaaaaaaaaa",
          timeUnixMs: 1_700_000_002_113,
          attrs: {
            "event.name": "api_request",
            "event.sequence": "2",
            "session.id": "sess_1",
            model: "claude-opus-4-7",
            input_tokens: "120",
            output_tokens: "30",
            cache_read_tokens: "63429",
            cache_creation_tokens: "1024",
            cost_usd: "0.0875",
            duration_ms: "2113",
            request_id: "req_a",
            query_source: "repl_main_thread",
          },
        }),
        rec({
          eventName: "api_request_body",
          spanId: "bbbbbbbbbbbbbbbb",
          timeUnixMs: 1_700_000_001_000,
          attrs: {
            "event.name": "api_request_body",
            "event.sequence": "1",
            model: "claude-opus-4-7",
            query_source: "repl_main_thread",
            body: requestBody("Reply with PONG-Z"),
          },
        }),
        rec({
          eventName: "api_response_body",
          spanId: "cccccccccccccccc",
          timeUnixMs: 1_700_000_002_100,
          attrs: {
            "event.name": "api_response_body",
            "event.sequence": "3",
            model: "claude-opus-4-7",
            query_source: "repl_main_thread",
            request_id: "req_a",
            body: responseBody("PONG-Z"),
          },
        }),
      ]);

    it("collapses the three records into ONE gen_ai llm span", () => {
      const spans = build();
      expect(spans).toHaveLength(1);
      const { span } = spans[0]!;
      expect(attr(span, "langwatch.span.type")).toEqual({ stringValue: "llm" });
      expect(attr(span, "gen_ai.system")).toEqual({ stringValue: "claude_code" });
      expect(attr(span, "gen_ai.request.model")).toEqual({
        stringValue: "claude-opus-4-7",
      });
    });

    it("lifts tokens + cache + cost onto the span", () => {
      const { span } = build()[0]!;
      expect(attr(span, "gen_ai.usage.input_tokens")).toEqual({ intValue: 120 });
      expect(attr(span, "gen_ai.usage.output_tokens")).toEqual({ intValue: 30 });
      // REGRESSION GUARD: cache_read (~0.1x input) must stay distinct from
      // cache_creation (~1.25x input) — a swap mis-bills by ~12x.
      expect(attr(span, "gen_ai.usage.cache_read.input_tokens")).toEqual({
        intValue: 63429,
      });
      expect(attr(span, "gen_ai.usage.cache_creation.input_tokens")).toEqual({
        intValue: 1024,
      });
      // cost via the reserved fallback key (priority 3 in computeSpanCost).
      expect(attr(span, "langwatch.span.cost")).toEqual({ doubleValue: 0.0875 });
    });

    it("joins input from the body and output from the response", () => {
      const { span } = build()[0]!;
      expect(attr(span, "gen_ai.prompt")).toEqual({
        stringValue: "Reply with PONG-Z",
      });
      expect(attr(span, "gen_ai.completion")).toEqual({ stringValue: "PONG-Z" });
    });

    it("uses the api_request SpanId as the span id (idempotent)", () => {
      const { span } = build()[0]!;
      expect(span.spanId).toBe("aaaaaaaaaaaaaaaa");
      expect(span.traceId).toBe(TRACE);
    });

    it("anchors timing on the api_request: start = end - duration", () => {
      const { span } = build()[0]!;
      // end = 1_700_000_002_113 ms, duration 2113 ms -> start = 1_700_000_000_000.
      // Nanos are exact (BigInt), not float-rounded.
      expect(span.endTimeUnixNano).toBe("1700000002113000000");
      expect(span.startTimeUnixNano).toBe("1700000000000000000");
    });
  });

  describe("when the response is a non-conversational utility call", () => {
    it("keeps cost + tokens but withholds the completion text", () => {
      const spans = convertClaudeCodeLogsToSpans([
        rec({
          eventName: "api_request",
          spanId: "1111111111111111",
          attrs: {
            "event.name": "api_request",
            model: "claude-haiku-4-5-20251001",
            input_tokens: "457",
            output_tokens: "11",
            cost_usd: "0.000512",
            request_id: "req_title",
            query_source: "generate_session_title",
          },
        }),
        rec({
          eventName: "api_response_body",
          spanId: "2222222222222222",
          attrs: {
            "event.name": "api_response_body",
            request_id: "req_title",
            query_source: "generate_session_title",
            body: responseBody('{"title": "List temporary directory"}'),
          },
        }),
      ]);
      expect(spans).toHaveLength(1);
      const { span } = spans[0]!;
      // usage still folds (cost is byte-identical to today regardless of gate)
      expect(attr(span, "langwatch.span.cost")).toEqual({ doubleValue: 0.000512 });
      expect(attr(span, "gen_ai.usage.input_tokens")).toEqual({ intValue: 457 });
      // ...but the utility text is NOT surfaced as the assistant's reply
      expect(attr(span, "gen_ai.completion")).toBeUndefined();
    });
  });

  describe("when a turn has only the api_request (no bodies)", () => {
    it("still emits an llm span with usage + cost, no input/output text", () => {
      const spans = convertClaudeCodeLogsToSpans([
        rec({
          eventName: "api_request",
          spanId: "3333333333333333",
          attrs: {
            "event.name": "api_request",
            model: "claude-opus-4-7",
            input_tokens: "6",
            output_tokens: "24",
            cost_usd: "0.39",
            request_id: "req_x",
            query_source: "sdk",
          },
        }),
      ]);
      expect(spans).toHaveLength(1);
      const { span } = spans[0]!;
      expect(attr(span, "langwatch.span.cost")).toEqual({ doubleValue: 0.39 });
      expect(attr(span, "gen_ai.prompt")).toBeUndefined();
      expect(attr(span, "gen_ai.completion")).toBeUndefined();
    });
  });

  describe("when two model calls share (model, query_source) in one batch", () => {
    it("pairs bodies to requests consume-once in time order", () => {
      const spans = convertClaudeCodeLogsToSpans([
        rec({
          eventName: "api_request_body",
          spanId: "b1b1b1b1b1b1b1b1",
          timeUnixMs: 1_000,
          attrs: {
            "event.name": "api_request_body",
            model: "m",
            query_source: "repl_main_thread",
            body: requestBody("first input"),
          },
        }),
        rec({
          eventName: "api_request",
          spanId: "a1a1a1a1a1a1a1a1",
          timeUnixMs: 1_100,
          attrs: {
            "event.name": "api_request",
            model: "m",
            query_source: "repl_main_thread",
            request_id: "r1",
          },
        }),
        rec({
          eventName: "api_request_body",
          spanId: "b2b2b2b2b2b2b2b2",
          timeUnixMs: 2_000,
          attrs: {
            "event.name": "api_request_body",
            model: "m",
            query_source: "repl_main_thread",
            body: requestBody("second input"),
          },
        }),
        rec({
          eventName: "api_request",
          spanId: "a2a2a2a2a2a2a2a2",
          timeUnixMs: 2_100,
          attrs: {
            "event.name": "api_request",
            model: "m",
            query_source: "repl_main_thread",
            request_id: "r2",
          },
        }),
      ]);
      expect(spans).toHaveLength(2);
      const first = spans.find((s) => s.span.spanId === "a1a1a1a1a1a1a1a1")!;
      const second = spans.find((s) => s.span.spanId === "a2a2a2a2a2a2a2a2")!;
      expect(attr(first.span, "gen_ai.prompt")).toEqual({
        stringValue: "first input",
      });
      expect(attr(second.span, "gen_ai.prompt")).toEqual({
        stringValue: "second input",
      });
    });
  });

  describe("when the triplet is split across batches (cross-batch orphan)", () => {
    it("emits the api_request span in batch N and a marked orphan span for a late body", () => {
      // Batch N: api_request alone (its body/response landed elsewhere).
      const batchN = convertClaudeCodeLogsToSpans([
        rec({
          eventName: "api_request",
          spanId: "a0a0a0a0a0a0a0a0",
          attrs: {
            "event.name": "api_request",
            model: "claude-opus-4-7",
            input_tokens: "10",
            output_tokens: "5",
            cost_usd: "0.01",
            request_id: "req_split",
            query_source: "repl_main_thread",
          },
        }),
      ]);
      expect(batchN).toHaveLength(1);
      expect(batchN[0]!.span.spanId).toBe("a0a0a0a0a0a0a0a0");
      expect(attr(batchN[0]!.span, "claude_code.orphan")).toBeUndefined();

      // Batch N+1: the response arrives late, with no api_request to anchor on.
      const batchNext = convertClaudeCodeLogsToSpans([
        rec({
          eventName: "api_response_body",
          spanId: "c0c0c0c0c0c0c0c0",
          attrs: {
            "event.name": "api_response_body",
            model: "claude-opus-4-7",
            request_id: "req_split",
            query_source: "repl_main_thread",
            body: responseBody("late answer"),
          },
        }),
      ]);
      expect(batchNext).toHaveLength(1);
      const orphan = batchNext[0]!.span;
      // Never silently dropped: its own span, clearly marked, carrying the text.
      expect(orphan.spanId).toBe("c0c0c0c0c0c0c0c0");
      expect(attr(orphan, "claude_code.orphan")).toEqual({ boolValue: true });
      expect(attr(orphan, "claude_code.orphan_kind")).toEqual({
        stringValue: "api_response_body",
      });
      expect(attr(orphan, "gen_ai.completion")).toEqual({
        stringValue: "late answer",
      });
    });
  });

  describe("idempotency", () => {
    it("produces byte-identical spans for the same input twice", () => {
      const input: ClaudeCodeLogRecordInput[] = [
        rec({
          eventName: "api_request",
          spanId: "deadbeefdeadbeef",
          attrs: {
            "event.name": "api_request",
            model: "claude-opus-4-7",
            input_tokens: "1",
            output_tokens: "2",
            cost_usd: "0.03",
            request_id: "req_idem",
            query_source: "repl_main_thread",
          },
        }),
      ];
      const a = convertClaudeCodeLogsToSpans(input);
      const b = convertClaudeCodeLogsToSpans(input);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });
  });

  it("returns no spans for an empty batch", () => {
    expect(convertClaudeCodeLogsToSpans([])).toEqual([]);
  });
});
