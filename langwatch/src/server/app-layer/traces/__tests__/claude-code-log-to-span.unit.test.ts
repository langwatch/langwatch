import { describe, expect, it } from "vitest";
import type { OtlpSpan } from "../../../event-sourcing/pipelines/trace-processing/schemas/otlp";
import {
  type ClaudeCodeLogRecordInput,
  convertClaudeCodeLogsToSpans,
  convertClaudeCodeToolLogsToSpans,
  convertClaudeCodeTurnToSpans,
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

const strVal = (span: OtlpSpan, key: string): string | undefined =>
  (attr(span, key) as { stringValue?: string } | undefined)?.stringValue;

// startTimeUnixNano is typed as string | number | {low,high}; the converter
// always emits the string form, so coerce before BigInt for the comparisons.
const startNano = (span: OtlpSpan): bigint =>
  BigInt(String(span.startTimeUnixNano));

const requestBody = (text: string) =>
  JSON.stringify({
    model: "claude-opus-4-7",
    messages: [{ role: "user", content: [{ type: "text", text }] }],
  });

const responseBody = (text: string) =>
  JSON.stringify({ content: [{ type: "text", text }] });

// A model response that calls a tool: the assistant turn carries a tool_use block.
const responseBodyWithToolUse = (toolName: string, input: unknown) =>
  JSON.stringify({
    content: [{ type: "tool_use", id: "toolu_x", name: toolName, input }],
  });

// A later model request that feeds a tool's result back to the model, keyed by
// tool_use_id — the ONLY place claude reports a tool's stdout. Real wire shape
// (from raw dumps): the tool_result block keys are `tool_use_id`, `type`,
// `content` (a plain string for Bash), `is_error`.
const requestBodyWithToolResult = (toolUseId: string, result: string) =>
  JSON.stringify({
    model: "claude-opus-4-7",
    messages: [
      { role: "user", content: [{ type: "text", text: "run it" }] },
      {
        role: "assistant",
        content: [{ type: "tool_use", id: toolUseId, name: "Bash", input: {} }],
      },
      {
        role: "user",
        content: [
          {
            tool_use_id: toolUseId,
            type: "tool_result",
            content: result,
            is_error: false,
          },
        ],
      },
    ],
  });

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
  describe("when the whole turn's model events are folded together", () => {
    /** @scenario "A model call split across export batches still has input and output" */
    it("rejoins a request body delivered in an earlier batch with its later anchor + response", () => {
      // The body (call START) sorts before the anchor + response (call END);
      // folding the whole turn makes both halves visible at once.
      const spans = convertClaudeCodeLogsToSpans([
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

      // One llm span, no second input-only duplicate.
      expect(spans).toHaveLength(1);
      const { span } = spans[0]!;
      expect(span.spanId).toBe("aaaaaaaaaaaaaaaa");
      expect(strVal(span, "langwatch.span.type")).toBe("llm");
      expect(strVal(span, "gen_ai.request.model")).toBe("claude-opus-4-7");
      // Tokens + cache + cost (cache_read ~0.1x vs cache_creation ~1.25x stay distinct).
      expect(attr(span, "gen_ai.usage.input_tokens")).toEqual({ intValue: 120 });
      expect(attr(span, "gen_ai.usage.cache_read.input_tokens")).toEqual({
        intValue: 63429,
      });
      expect(attr(span, "gen_ai.usage.cache_creation.input_tokens")).toEqual({
        intValue: 1024,
      });
      expect(attr(span, "langwatch.span.cost")).toEqual({ doubleValue: 0.0875 });
      // Input from the earlier-batch body, output from the response.
      expect(strVal(span, "gen_ai.input.messages")).toBe(
        JSON.stringify([{ role: "user", content: "Reply with PONG-Z" }]),
      );
      expect(strVal(span, "gen_ai.completion")).toBe("PONG-Z");
      // A complete triplet is NOT nudged: start = end - duration exactly.
      expect(span.endTimeUnixNano).toBe("1700000002113000000");
      expect(span.startTimeUnixNano).toBe("1700000000000000000");
    });
  });

  describe("when a model call's reply is a tool invocation", () => {
    /** @scenario "The model call that invokes a tool shows the tool call as its output" */
    it("renders the chosen tool as the model span's output", () => {
      const spans = convertClaudeCodeLogsToSpans([
        rec({
          eventName: "api_request_body",
          spanId: "bbbbbbbbbbbbbbbb",
          timeUnixMs: 1_000,
          attrs: {
            "event.name": "api_request_body",
            model: "claude-opus-4-8",
            query_source: "repl_main_thread",
            body: requestBody("list the temp dir"),
          },
        }),
        rec({
          eventName: "api_request",
          spanId: "aaaaaaaaaaaaaaaa",
          timeUnixMs: 2_000,
          attrs: {
            "event.name": "api_request",
            model: "claude-opus-4-8",
            request_id: "req_tool",
            query_source: "repl_main_thread",
          },
        }),
        rec({
          eventName: "api_response_body",
          spanId: "cccccccccccccccc",
          timeUnixMs: 2_000,
          attrs: {
            "event.name": "api_response_body",
            model: "claude-opus-4-8",
            request_id: "req_tool",
            query_source: "repl_main_thread",
            body: responseBodyWithToolUse("Bash", { command: "ls /tmp" }),
          },
        }),
      ]);
      const { span } = spans[0]!;
      const completion = strVal(span, "gen_ai.completion") ?? "";
      expect(completion).toContain("[tool_use: Bash]");
      expect(completion).toContain("ls /tmp");
      expect(strVal(span, "gen_ai.input.messages")).toBe(
        JSON.stringify([{ role: "user", content: "list the temp dir" }]),
      );
    });
  });

  describe("when a turn has a tool-deciding call and a final reply call", () => {
    /** @scenario "Two model calls in one turn keep their own input and output" */
    it("gives each model call its own input and output, never cross-attributed", () => {
      const spans = convertClaudeCodeLogsToSpans([
        rec({
          eventName: "api_request_body",
          spanId: "b1b1b1b1b1b1b1b1",
          timeUnixMs: 1_000,
          attrs: {
            "event.name": "api_request_body",
            model: "m",
            query_source: "repl_main_thread",
            body: requestBody("first question"),
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
          eventName: "api_response_body",
          spanId: "c1c1c1c1c1c1c1c1",
          timeUnixMs: 1_100,
          attrs: {
            "event.name": "api_response_body",
            model: "m",
            query_source: "repl_main_thread",
            request_id: "r1",
            body: responseBody("first answer"),
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
            body: requestBody("second question"),
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
        rec({
          eventName: "api_response_body",
          spanId: "c2c2c2c2c2c2c2c2",
          timeUnixMs: 2_100,
          attrs: {
            "event.name": "api_response_body",
            model: "m",
            query_source: "repl_main_thread",
            request_id: "r2",
            body: responseBody("second answer"),
          },
        }),
      ]);
      expect(spans).toHaveLength(2);
      const first = spans.find((s) => s.span.spanId === "a1a1a1a1a1a1a1a1")!.span;
      const second = spans.find((s) => s.span.spanId === "a2a2a2a2a2a2a2a2")!.span;
      expect(strVal(first, "gen_ai.input.messages")).toBe(
        JSON.stringify([{ role: "user", content: "first question" }]),
      );
      expect(strVal(first, "gen_ai.completion")).toBe("first answer");
      expect(strVal(second, "gen_ai.input.messages")).toBe(
        JSON.stringify([{ role: "user", content: "second question" }]),
      );
      expect(strVal(second, "gen_ai.completion")).toBe("second answer");
    });
  });

  describe("idempotency", () => {
    /** @scenario "Re-ingesting the same logs does not duplicate the spans" */
    it("produces byte-identical spans for the same turn folded twice", () => {
      const input: ClaudeCodeLogRecordInput[] = [
        rec({
          eventName: "api_request_body",
          spanId: "bbbbbbbbbbbbbbbb",
          timeUnixMs: 1_000,
          attrs: {
            "event.name": "api_request_body",
            model: "claude-opus-4-7",
            query_source: "repl_main_thread",
            body: requestBody("hi"),
          },
        }),
        rec({
          eventName: "api_request",
          spanId: "deadbeefdeadbeef",
          timeUnixMs: 2_000,
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
        rec({
          eventName: "api_response_body",
          spanId: "cccccccccccccccc",
          timeUnixMs: 2_000,
          attrs: {
            "event.name": "api_response_body",
            model: "claude-opus-4-7",
            request_id: "req_idem",
            query_source: "repl_main_thread",
            body: responseBody("hey"),
          },
        }),
      ];
      const a = convertClaudeCodeLogsToSpans(input);
      const b = convertClaudeCodeLogsToSpans(input);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      expect(a[0]!.span.spanId).toBe("deadbeefdeadbeef");
    });
  });

  describe("when a model call's body arrives in a later batch than its anchor", () => {
    /** @scenario "A late batch completes the span instead of duplicating it" */
    it("re-emits the SAME span at a strictly greater StartTime once the input lands", () => {
      const anchor = rec({
        eventName: "api_request",
        spanId: "a0a0a0a0a0a0a0a0",
        timeUnixMs: 2_000,
        attrs: {
          "event.name": "api_request",
          model: "claude-opus-4-8",
          input_tokens: "10",
          output_tokens: "5",
          cost_usd: "0.01",
          duration_ms: "1000",
          request_id: "req_late",
          query_source: "repl_main_thread",
        },
      });
      const response = rec({
        eventName: "api_response_body",
        spanId: "c0c0c0c0c0c0c0c0",
        timeUnixMs: 2_000,
        attrs: {
          "event.name": "api_response_body",
          model: "claude-opus-4-8",
          request_id: "req_late",
          query_source: "repl_main_thread",
          body: responseBody("late answer"),
        },
      });
      const body = rec({
        eventName: "api_request_body",
        spanId: "b0b0b0b0b0b0b0b0",
        timeUnixMs: 1_000,
        attrs: {
          "event.name": "api_request_body",
          model: "claude-opus-4-8",
          query_source: "repl_main_thread",
          body: requestBody("the question"),
        },
      });

      // Fold 1: anchor + response only (body still missing) — one missing part.
      const partial = convertClaudeCodeLogsToSpans([anchor, response])[0]!.span;
      // Fold 2: the body lands — the SAME span, now complete.
      const complete = convertClaudeCodeLogsToSpans([anchor, response, body])[0]!
        .span;

      expect(partial.spanId).toBe("a0a0a0a0a0a0a0a0");
      expect(complete.spanId).toBe(partial.spanId);
      // The completed span wins the read's max(StartTime): strictly greater.
      expect(startNano(complete)).toBeGreaterThan(startNano(partial));
      expect(strVal(partial, "gen_ai.input.messages")).toBeUndefined();
      expect(strVal(complete, "gen_ai.input.messages")).toBe(
        JSON.stringify([{ role: "user", content: "the question" }]),
      );
    });
  });

  describe("when a turn has only the api_request (no bodies)", () => {
    /** @scenario "A model call with genuinely no bodies still appears" */
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
      expect(attr(span, "gen_ai.usage.output_tokens")).toEqual({ intValue: 24 });
      expect(strVal(span, "gen_ai.input.messages")).toBeUndefined();
      expect(strVal(span, "gen_ai.completion")).toBeUndefined();
    });
  });

  describe("a non-conversational utility call", () => {
    it("keeps cost + tokens AND carries its reply text on the span", () => {
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
      const { span } = spans[0]!;
      expect(attr(span, "langwatch.span.cost")).toEqual({
        doubleValue: 0.000512,
      });
      expect(attr(span, "gen_ai.usage.input_tokens")).toEqual({ intValue: 457 });
      expect(strVal(span, "gen_ai.completion")).toBe(
        '{"title": "List temporary directory"}',
      );
      // Named by query_source so the waterfall reads what the call was FOR.
      expect(span.name).toBe("generate_session_title");
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
      expect(strVal(span, "gen_ai.response.id")).toBe("req_rich");
      expect(strVal(span, "gen_ai.request.reasoning_effort")).toBe("xhigh");
    });

    it("captures every other emitted attribute under claude_code.* without double-copying canonical ones", () => {
      const { span } = buildRich()[0]!;
      expect(strVal(span, "claude_code.speed")).toBe("normal");
      expect(strVal(span, "claude_code.terminal.type")).toBe("tmux");
      expect(strVal(span, "claude_code.query_source")).toBe("repl_main_thread");
      expect(attr(span, "claude_code.model")).toBeUndefined();
      expect(attr(span, "claude_code.request_id")).toBeUndefined();
      expect(attr(span, "claude_code.effort")).toBeUndefined();
    });
  });

  describe("a truncated, unparseable api_request_body", () => {
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
              model: "claude-opus-4-8",
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

    it("falls back to the clean user_prompt text instead of the raw blob", () => {
      const { span } = build(
        new Map([["p_42", "Turn 2: reply with exactly PONG-CLAUDE-B2."]]),
      )[0]!;
      expect(strVal(span, "gen_ai.input.messages")).toBe(
        JSON.stringify([
          { role: "user", content: "Turn 2: reply with exactly PONG-CLAUDE-B2." },
        ]),
      );
    });

    it("drops the input rather than leaking the raw truncated JSON blob", () => {
      const { span } = build(new Map())[0]!;
      expect(strVal(span, "gen_ai.input.messages")).toBeUndefined();
      for (const a of span.attributes) {
        expect(a.value.stringValue ?? "").not.toContain(truncated);
      }
    });
  });

  describe("span name for utility vs conversational calls", () => {
    const nameFor = (querySource: string): string =>
      convertClaudeCodeLogsToSpans([
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
      ])[0]!.span.name;

    it("names a conversational call by its model", () => {
      expect(nameFor("repl_main_thread")).toBe("claude-opus-4-8");
    });

    it("names utility calls by query_source so they read clearly", () => {
      expect(nameFor("generate_session_title")).toBe("generate_session_title");
      expect(nameFor("prompt_suggestion")).toBe("prompt_suggestion");
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

  describe("when decision + result are present", () => {
    const build = () =>
      convertClaudeCodeToolLogsToSpans([toolDecision(), toolResult()]);

    it("collapses the pair into ONE tool span keyed by tool_use_id", () => {
      const spans = build();
      expect(spans).toHaveLength(1);
      const { span } = spans[0]!;
      expect(strVal(span, "langwatch.span.type")).toBe("tool");
      expect(strVal(span, "gen_ai.operation.name")).toBe("execute_tool");
      expect(strVal(span, "gen_ai.tool.name")).toBe("Bash");
      expect(strVal(span, "gen_ai.tool.call.id")).toBe(TOOL_USE_ID);
      expect(span.name).toBe("Bash");
    });

    it("puts the command on langwatch.input as the instrumented call", () => {
      const { span } = build()[0]!;
      expect(strVal(span, "langwatch.input")).toBe(
        '{"command":"echo \\"test otlp\\""}',
      );
      expect(attr(span, "gen_ai.tool.call.arguments")).toBeUndefined();
    });

    it("captures success + duration + sizes under claude_code.*", () => {
      const { span } = build()[0]!;
      expect(strVal(span, "claude_code.success")).toBe("true");
      expect(strVal(span, "claude_code.duration_ms")).toBe("714");
      expect(strVal(span, "claude_code.decision")).toBe("accept");
      expect(strVal(span, "claude_code.tool_result_size_bytes")).toBe("9");
    });

    it("derives a deterministic span id from tool_use_id, order-independent", () => {
      const a = build();
      const b = convertClaudeCodeToolLogsToSpans([toolResult(), toolDecision()]);
      expect(a[0]!.span.spanId).toBe(b[0]!.span.spanId);
      expect(a[0]!.span.spanId).not.toBe("d1d1d1d1d1d1d1d1");
    });
  });

  describe("when only the tool_decision is present (result not yet arrived)", () => {
    it("emits no span until the terminal result lands", () => {
      expect(convertClaudeCodeToolLogsToSpans([toolDecision()])).toEqual([]);
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

describe("convertClaudeCodeTurnToSpans (tool output recovery)", () => {
  const TOOL_USE_ID = "toolu_bash_42";

  const toolResult = rec({
    eventName: "tool_result",
    spanId: "f2f2f2f2f2f2f2f2",
    timeUnixMs: 1_500,
    attrs: {
      "event.name": "tool_result",
      "event.sequence": "10",
      tool_name: "Bash",
      tool_use_id: TOOL_USE_ID,
      success: "true",
      duration_ms: "100",
      tool_input: '{"command":"ls /tmp"}',
    },
  });

  // The NEXT model call's request body feeds the tool result back to the model.
  const nextModelBody = rec({
    eventName: "api_request_body",
    spanId: "b3b3b3b3b3b3b3b3",
    timeUnixMs: 3_000,
    attrs: {
      "event.name": "api_request_body",
      model: "claude-opus-4-7",
      query_source: "repl_main_thread",
      body: requestBodyWithToolResult(TOOL_USE_ID, "tmpfile.txt\nother.txt"),
    },
  });

  const toolSpanOf = (spans: { span: OtlpSpan }[]) =>
    spans.find((s) => strVal(s.span, "langwatch.span.type") === "tool")!.span;

  /** @scenario "A tool call's output is recovered from the following model call" */
  it("attaches the tool result from the next call's transcript to the tool span", () => {
    const tool = toolSpanOf(
      convertClaudeCodeTurnToSpans([toolResult, nextModelBody]),
    );
    expect(strVal(tool, "langwatch.input")).toBe('{"command":"ls /tmp"}');
    expect(strVal(tool, "langwatch.output")).toBe("tmpfile.txt\nother.txt");
  });

  /** @scenario "A tool whose result never reaches a later call has no invented output" */
  it("leaves the output empty when no later call fed the result back", () => {
    const tool = toolSpanOf(convertClaudeCodeTurnToSpans([toolResult]));
    expect(strVal(tool, "langwatch.input")).toBe('{"command":"ls /tmp"}');
    expect(strVal(tool, "langwatch.output")).toBeUndefined();
  });

  it("nudges the output-less tool span earlier so the recovered version wins", () => {
    const withoutOutput = toolSpanOf(convertClaudeCodeTurnToSpans([toolResult]));
    const withOutput = toolSpanOf(
      convertClaudeCodeTurnToSpans([toolResult, nextModelBody]),
    );
    // Same span (deterministic id), but the version WITH the recovered output
    // starts later, so it wins the read's max(StartTime).
    expect(withOutput.spanId).toBe(withoutOutput.spanId);
    expect(startNano(withOutput)).toBeGreaterThan(startNano(withoutOutput));
  });
});
