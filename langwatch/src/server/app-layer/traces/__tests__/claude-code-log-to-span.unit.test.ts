import { describe, expect, it } from "vitest";
import type { OtlpSpan } from "../../../event-sourcing/pipelines/trace-processing/schemas/otlp";
import {
  type ClaudeCodeLogRecordInput,
  convertClaudeCodeLogsToSpans,
  convertClaudeCodeToolLogsToSpans,
  isClaudeCodeConvertibleLog,
  isClaudeCodeToolLog,
} from "../claude-code-log-to-span";

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
    expect(
      isClaudeCodeConvertibleLog("com.openai.codex.events", "api_request"),
    ).toBe(false);
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
      expect(attr(span, "gen_ai.system")).toEqual({
        stringValue: "claude_code",
      });
      expect(attr(span, "gen_ai.request.model")).toEqual({
        stringValue: "claude-opus-4-7",
      });
    });

    it("lifts tokens + cache + cost onto the span", () => {
      const { span } = build()[0]!;
      expect(attr(span, "gen_ai.usage.input_tokens")).toEqual({
        intValue: 120,
      });
      expect(attr(span, "gen_ai.usage.output_tokens")).toEqual({
        intValue: 30,
      });
      // REGRESSION GUARD: cache_read (~0.1x input) must stay distinct from
      // cache_creation (~1.25x input) — a swap mis-bills by ~12x.
      expect(attr(span, "gen_ai.usage.cache_read.input_tokens")).toEqual({
        intValue: 63429,
      });
      expect(attr(span, "gen_ai.usage.cache_creation.input_tokens")).toEqual({
        intValue: 1024,
      });
      // cost via the reserved fallback key (priority 3 in computeSpanCost).
      expect(attr(span, "langwatch.span.cost")).toEqual({
        doubleValue: 0.0875,
      });
    });

    it("joins input from the body and output from the response", () => {
      const { span } = build()[0]!;
      // Input is the structured conversation, not a raw-JSON-blob single message.
      expect(attr(span, "gen_ai.input.messages")).toEqual({
        stringValue: JSON.stringify([
          { role: "user", content: "Reply with PONG-Z" },
        ]),
      });
      expect(attr(span, "gen_ai.prompt")).toBeUndefined();
      expect(attr(span, "gen_ai.completion")).toEqual({
        stringValue: "PONG-Z",
      });
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

  describe("provenance + spare attributes claude emits", () => {
    const buildRich = () =>
      convertClaudeCodeLogsToSpans([
        rec({
          eventName: "api_request",
          spanId: "dddddddddddddddd",
          timeUnixMs: 1_700_000_002_113,
          attrs: {
            "event.name": "api_request",
            "session.id": "sess_1",
            model: "claude-opus-4-8",
            input_tokens: "120",
            output_tokens: "30",
            cost_usd: "0.0875",
            request_id: "req_rich",
            effort: "xhigh",
            speed: "normal",
            "terminal.type": "tmux",
            duration_ms: "1402",
            query_source: "repl_main_thread",
          },
        }),
      ]);

    it("maps request_id -> gen_ai.response.id and effort -> reasoning_effort", () => {
      const { span } = buildRich()[0]!;
      expect(attr(span, "gen_ai.response.id")).toEqual({
        stringValue: "req_rich",
      });
      expect(attr(span, "gen_ai.request.reasoning_effort")).toEqual({
        stringValue: "xhigh",
      });
    });

    it("captures every other emitted attribute under claude_code.*", () => {
      const { span } = buildRich()[0]!;
      expect(attr(span, "claude_code.speed")).toEqual({ stringValue: "normal" });
      expect(attr(span, "claude_code.terminal.type")).toEqual({
        stringValue: "tmux",
      });
      expect(attr(span, "claude_code.duration_ms")).toEqual({
        stringValue: "1402",
      });
      expect(attr(span, "claude_code.query_source")).toEqual({
        stringValue: "repl_main_thread",
      });
    });

    it("does NOT double-copy attrs already lifted to canonical keys", () => {
      const { span } = buildRich()[0]!;
      expect(attr(span, "claude_code.model")).toBeUndefined();
      expect(attr(span, "claude_code.cost_usd")).toBeUndefined();
      expect(attr(span, "claude_code.request_id")).toBeUndefined();
      expect(attr(span, "claude_code.effort")).toBeUndefined();
      expect(attr(span, "claude_code.session.id")).toBeUndefined();
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
      expect(attr(span, "langwatch.span.cost")).toEqual({
        doubleValue: 0.000512,
      });
      expect(attr(span, "gen_ai.usage.input_tokens")).toEqual({
        intValue: 457,
      });
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
      expect(attr(first.span, "gen_ai.input.messages")).toEqual({
        stringValue: JSON.stringify([{ role: "user", content: "first input" }]),
      });
      expect(attr(second.span, "gen_ai.input.messages")).toEqual({
        stringValue: JSON.stringify([
          { role: "user", content: "second input" },
        ]),
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

  describe("when the api_request_body is truncated (unparseable)", () => {
    // claude-code truncates large request bodies inline (body_truncated=true,
    // ~64KB), so JSON.parse fails and extractUserTextFromRequestBody yields null.
    const truncated =
      '{"model":"claude-opus-4-8","messages":[{"role":"user","content":[{"type":"text","text":"Tur';

    const build = (promptTextById?: Map<string, string>) =>
      convertClaudeCodeLogsToSpans(
        [
          rec({
            eventName: "api_request",
            spanId: "aaaaaaaaaaaaaaaa",
            attrs: {
              "event.name": "api_request",
              "session.id": "sess_t",
              model: "claude-opus-4-8",
              input_tokens: "2",
              output_tokens: "15",
              request_id: "req_t",
              query_source: "repl_main_thread",
              "prompt.id": "p_42",
            },
          }),
          rec({
            eventName: "api_request_body",
            spanId: "bbbbbbbbbbbbbbbb",
            attrs: {
              "event.name": "api_request_body",
              model: "claude-opus-4-8",
              query_source: "repl_main_thread",
              "prompt.id": "p_42",
              body_truncated: "true",
              body: truncated,
            },
          }),
        ],
        promptTextById,
      );

    it("uses the clean co-batched user_prompt text instead of the raw truncated blob", () => {
      const { span } = build(
        new Map([
          [
            "p_42",
            "Turn 2: reply with exactly PONG-CLAUDE-B2 and nothing else.",
          ],
        ]),
      )[0]!;
      expect(attr(span, "gen_ai.input.messages")).toEqual({
        stringValue: JSON.stringify([
          {
            role: "user",
            content:
              "Turn 2: reply with exactly PONG-CLAUDE-B2 and nothing else.",
          },
        ]),
      });
    });

    it("drops the input rather than emitting the raw truncated JSON blob", () => {
      // The old behavior wrapped the raw truncated body as a single user
      // message, surfacing claude's `[TRUNCATED ...]` marker + the whole
      // request JSON as the trace input. With no clean user_prompt to fall back
      // to, the input is simply absent instead.
      const { span } = build(new Map())[0]!;
      expect(attr(span, "gen_ai.input.messages")).toBeUndefined();
      expect(attr(span, "gen_ai.prompt")).toBeUndefined();
      // The body string never leaks into any attribute value.
      for (const a of span.attributes) {
        expect(a.value.stringValue ?? "").not.toContain(truncated);
      }
    });
  });

  describe("when the api_request_body parses AND a user_prompt text exists", () => {
    it("prefers the parsed body's latest user turn over the user_prompt map", () => {
      const spans = convertClaudeCodeLogsToSpans(
        [
          rec({
            eventName: "api_request",
            spanId: "aaaaaaaaaaaaaaaa",
            attrs: {
              "event.name": "api_request",
              model: "m",
              request_id: "req_p",
              query_source: "repl_main_thread",
              "prompt.id": "p_1",
            },
          }),
          rec({
            eventName: "api_request_body",
            spanId: "bbbbbbbbbbbbbbbb",
            attrs: {
              "event.name": "api_request_body",
              model: "m",
              query_source: "repl_main_thread",
              "prompt.id": "p_1",
              body: requestBody("parsed body text"),
            },
          }),
        ],
        new Map([["p_1", "user_prompt text"]]),
      );
      expect(attr(spans[0]!.span, "gen_ai.input.messages")).toEqual({
        stringValue: JSON.stringify([
          { role: "user", content: "parsed body text" },
        ]),
      });
    });
  });

  describe("when the api_request_body is a multi-turn conversation", () => {
    it("parses system + every turn into the structured input.messages", () => {
      const body = JSON.stringify({
        model: "claude-opus-4-8",
        system: "You are a coding assistant.",
        messages: [
          { role: "user", content: "First question" },
          {
            role: "assistant",
            content: [{ type: "text", text: "First answer" }],
          },
          {
            role: "user",
            content: [
              { type: "text", text: "Second question" },
              { type: "tool_result", content: [{ type: "text", text: "42" }] },
            ],
          },
        ],
      });
      const spans = convertClaudeCodeLogsToSpans([
        rec({
          eventName: "api_request",
          spanId: "aaaaaaaaaaaaaaaa",
          attrs: {
            "event.name": "api_request",
            model: "claude-opus-4-8",
            request_id: "req_m",
            query_source: "repl_main_thread",
          },
        }),
        rec({
          eventName: "api_request_body",
          spanId: "bbbbbbbbbbbbbbbb",
          attrs: {
            "event.name": "api_request_body",
            model: "claude-opus-4-8",
            query_source: "repl_main_thread",
            body,
          },
        }),
      ]);
      // System prompt + each turn, content flattened to text, in order.
      expect(attr(spans[0]!.span, "gen_ai.input.messages")).toEqual({
        stringValue: JSON.stringify([
          { role: "system", content: "You are a coding assistant." },
          { role: "user", content: "First question" },
          { role: "assistant", content: "First answer" },
          { role: "user", content: "Second question\n\n42" },
        ]),
      });
      // Model is lifted to the span, not buried in the input.
      expect(attr(spans[0]!.span, "gen_ai.request.model")).toEqual({
        stringValue: "claude-opus-4-8",
      });
    });
  });

  describe("when an api_request_body is orphaned across batches", () => {
    // api_request_body is logged at call START, the api_request anchor at call
    // END; a tool-using turn splits them across export batches. The body has no
    // request_id, so it can't re-pair — it must be DROPPED, not emitted as a
    // duplicate, input-less span that also sorts before the anchor in the
    // waterfall. The turn input is on the trace via user_prompt.
    it("drops a lone api_request_body instead of emitting an orphan span", () => {
      const spans = convertClaudeCodeLogsToSpans([
        rec({
          eventName: "api_request_body",
          spanId: "b9b9b9b9b9b9b9b9",
          attrs: {
            "event.name": "api_request_body",
            model: "claude-opus-4-8",
            query_source: "repl_main_thread",
            body: requestBody("late conversation body"),
          },
        }),
      ]);
      expect(spans).toEqual([]);
    });

    it("emits the anchor (with its output) even when its body split off", () => {
      // The anchor + its response co-batch (both logged at call END); only the
      // body landed in the prior batch. The anchor span still carries usage and
      // the assistant reply — just no per-span input.
      const spans = convertClaudeCodeLogsToSpans([
        rec({
          eventName: "api_request",
          spanId: "a7a7a7a7a7a7a7a7",
          attrs: {
            "event.name": "api_request",
            model: "claude-opus-4-8",
            input_tokens: "2",
            output_tokens: "14",
            request_id: "req_late",
            query_source: "repl_main_thread",
          },
        }),
        rec({
          eventName: "api_response_body",
          spanId: "c7c7c7c7c7c7c7c7",
          attrs: {
            "event.name": "api_response_body",
            request_id: "req_late",
            query_source: "repl_main_thread",
            body: responseBody("Done — output was test otlp."),
          },
        }),
      ]);
      expect(spans).toHaveLength(1);
      const { span } = spans[0]!;
      expect(span.spanId).toBe("a7a7a7a7a7a7a7a7");
      expect(attr(span, "gen_ai.input.messages")).toBeUndefined();
      expect(attr(span, "gen_ai.completion")).toEqual({
        stringValue: "Done — output was test otlp.",
      });
    });
  });

  describe("span name for utility vs conversational calls", () => {
    const nameFor = (querySource: string): unknown => {
      const { span } = convertClaudeCodeLogsToSpans([
        rec({
          eventName: "api_request",
          spanId: "eeeeeeeeeeeeeeee",
          attrs: {
            "event.name": "api_request",
            model: "claude-opus-4-8",
            request_id: "req_n",
            query_source: querySource,
          },
        }),
      ])[0]!;
      return span.name;
    };

    it("names a conversational call by its model", () => {
      expect(nameFor("repl_main_thread")).toBe("claude-opus-4-8");
    });

    it("names utility calls by query_source so they read clearly", () => {
      // Otherwise the waterfall shows mystery "claude-opus-4-8" spans that carry
      // no conversation — the user couldn't tell what they were FOR.
      expect(nameFor("generate_session_title")).toBe("generate_session_title");
      expect(nameFor("prompt_suggestion")).toBe("prompt_suggestion");
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

describe("isClaudeCodeToolLog", () => {
  it("matches only tool_decision / tool_result under the claude_code scope", () => {
    const scope = "com.anthropic.claude_code.events";
    expect(isClaudeCodeToolLog(scope, "tool_decision")).toBe(true);
    expect(isClaudeCodeToolLog(scope, "tool_result")).toBe(true);
    expect(isClaudeCodeToolLog(scope, "api_request")).toBe(false);
    expect(isClaudeCodeToolLog(scope, "user_prompt")).toBe(false);
    expect(isClaudeCodeToolLog(scope, undefined)).toBe(false);
    expect(isClaudeCodeToolLog("com.openai.codex.events", "tool_result")).toBe(
      false,
    );
  });
});

describe("convertClaudeCodeToolLogsToSpans", () => {
  const TOOL_USE_ID = "toolu_01Cx3rukYCF2Jd2dnWTZQHjv";

  const toolDecision = (over: Partial<ClaudeCodeLogRecordInput> = {}) =>
    rec({
      eventName: "tool_decision",
      spanId: "d1d1d1d1d1d1d1d1",
      timeUnixMs: 1_700_000_000_845,
      attrs: {
        "event.name": "tool_decision",
        "event.sequence": "37",
        "session.id": "sess_tool",
        tool_name: "Bash",
        tool_use_id: TOOL_USE_ID,
        decision: "accept",
        source: "config",
        tool_parameters: '{"full_command":"echo \\"test otlp\\""}',
      },
      ...over,
    });

  const toolResult = (over: Partial<ClaudeCodeLogRecordInput> = {}) =>
    rec({
      eventName: "tool_result",
      spanId: "f1f1f1f1f1f1f1f1",
      timeUnixMs: 1_700_000_001_559,
      attrs: {
        "event.name": "tool_result",
        "event.sequence": "38",
        "session.id": "sess_tool",
        tool_name: "Bash",
        tool_use_id: TOOL_USE_ID,
        success: "true",
        duration_ms: "714",
        tool_input: '{"command":"echo \\"test otlp\\""}',
        tool_result_size_bytes: "9",
      },
      ...over,
    });

  describe("when both tool_decision and tool_result are present", () => {
    const build = () =>
      convertClaudeCodeToolLogsToSpans([toolDecision(), toolResult()]);

    it("collapses the pair into ONE tool span keyed by tool_use_id", () => {
      const spans = build();
      expect(spans).toHaveLength(1);
      const { span } = spans[0]!;
      expect(attr(span, "langwatch.span.type")).toEqual({ stringValue: "tool" });
      expect(attr(span, "gen_ai.operation.name")).toEqual({
        stringValue: "execute_tool",
      });
      expect(attr(span, "gen_ai.tool.name")).toEqual({ stringValue: "Bash" });
      expect(attr(span, "gen_ai.tool.call.id")).toEqual({
        stringValue: TOOL_USE_ID,
      });
      expect(span.name).toBe("Bash");
    });

    it("puts the command on langwatch.input as the instrumented call", () => {
      const { span } = build()[0]!;
      // tool_input (the clean tool call) wins over tool_parameters.
      expect(attr(span, "langwatch.input")).toEqual({
        stringValue: '{"command":"echo \\"test otlp\\""}',
      });
      // The non-standard gen_ai.tool.call.arguments is gone; the call rides on
      // langwatch.input now. Safe because the trace-IO fold skips tool spans
      // (see trace-io-accumulation.service.ts), so it never hijacks the trace
      // headline input. No output: claude reports only the result size.
      expect(attr(span, "gen_ai.tool.call.arguments")).toBeUndefined();
      expect(attr(span, "langwatch.output")).toBeUndefined();
      expect(attr(span, "gen_ai.output.messages")).toBeUndefined();
    });

    it("captures success + duration + sizes under claude_code.*", () => {
      const { span } = build()[0]!;
      expect(attr(span, "claude_code.success")).toEqual({ stringValue: "true" });
      expect(attr(span, "claude_code.duration_ms")).toEqual({
        stringValue: "714",
      });
      expect(attr(span, "claude_code.decision")).toEqual({
        stringValue: "accept",
      });
      expect(attr(span, "claude_code.tool_result_size_bytes")).toEqual({
        stringValue: "9",
      });
    });

    it("anchors timing on tool_result: start = result_time - duration", () => {
      const { span } = build()[0]!;
      // end = 1_700_000_001_559 ms, duration 714 ms -> start = 1_700_000_000_845.
      expect(span.endTimeUnixNano).toBe("1700000001559000000");
      expect(span.startTimeUnixNano).toBe("1700000000845000000");
    });

    it("derives a deterministic span id from tool_use_id (idempotent)", () => {
      const a = build();
      const b = convertClaudeCodeToolLogsToSpans([toolResult(), toolDecision()]);
      // Order-independent + stable: same trace + tool_use_id -> same span id.
      expect(a[0]!.span.spanId).toBe(b[0]!.span.spanId);
      expect(a[0]!.span.spanId).not.toBe("d1d1d1d1d1d1d1d1");
    });
  });

  describe("when only the tool_result is present (decision split off)", () => {
    it("still emits a complete tool span", () => {
      const spans = convertClaudeCodeToolLogsToSpans([toolResult()]);
      expect(spans).toHaveLength(1);
      const { span } = spans[0]!;
      expect(attr(span, "gen_ai.tool.name")).toEqual({ stringValue: "Bash" });
      expect(attr(span, "langwatch.input")).toEqual({
        stringValue: '{"command":"echo \\"test otlp\\""}',
      });
    });
  });

  describe("when only the tool_decision is present (result not yet arrived)", () => {
    it("emits a zero-duration tool span at the decision time", () => {
      const spans = convertClaudeCodeToolLogsToSpans([toolDecision()]);
      expect(spans).toHaveLength(1);
      const { span } = spans[0]!;
      expect(span.startTimeUnixNano).toBe("1700000000845000000");
      expect(span.endTimeUnixNano).toBe("1700000000845000000");
    });
  });

  it("ignores records with no tool_use_id and returns [] for an empty batch", () => {
    expect(convertClaudeCodeToolLogsToSpans([])).toEqual([]);
    const noId = convertClaudeCodeToolLogsToSpans([
      rec({
        eventName: "tool_result",
        attrs: { "event.name": "tool_result", tool_name: "Bash" },
      }),
    ]);
    expect(noId).toEqual([]);
  });
});
