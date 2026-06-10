/**
 * Unit test for TraceIOAccumulationService's preferText handling.
 *
 * Background — 2026-05-14 prod UX regression: trace summaries showed
 * the raw JSON wrapper (e.g. `{"output":"Hey there"}`) instead of the
 * extracted human-readable text (`Hey there`). Root cause: the
 * accumulator was using `JSON.stringify(outputResult.raw)` instead of
 * the already-extracted `outputResult.text` field that
 * `extractRichIOFromSpan` populates by running `messagesToText` /
 * `extractTextFromPlainJson`.
 *
 * This test pins the new behaviour: when the extraction service
 * successfully unwraps the payload (via COMMON_TEXT_KEYS like
 * `output`, `text`, `answer`, etc.), the trace summary's
 * computedOutput is the extracted text, not the raw wrapper.
 */
import { describe, expect, it } from "vitest";
import { TraceIOAccumulationService } from "../trace-io-accumulation.service";
import type { TraceIOExtractionService } from "~/server/app-layer/traces/trace-io-extraction.service";
import type { NormalizedSpan } from "../../../schemas/spans";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";

function emptyState(): TraceSummaryData {
  return {
    traceId: "t1",
    spanCount: 0,
    totalDurationMs: 0,
    computedIOSchemaVersion: "2026-04-28",
    computedInput: null,
    computedOutput: null,
    timeToFirstTokenMs: null,
    timeToLastTokenMs: null,
    tokensPerSecond: null,
    containsErrorStatus: false,
    containsOKStatus: false,
    errorMessage: null,
    models: [],
    totalCost: null,
    tokensEstimated: false,
    totalPromptTokenCount: null,
    totalCompletionTokenCount: null,
    outputFromRootSpan: false,
    outputSpanEndTimeMs: 0,
    blockedByGuardrail: false,
    rootSpanType: "span",
    containsAi: false,
    containsPrompt: false,
    selectedPromptId: null,
    selectedPromptSpanId: null,
    selectedPromptStartTimeMs: null,
    lastUsedPromptId: null,
    lastUsedPromptVersionNumber: null,
    lastUsedPromptVersionId: null,
    lastUsedPromptSpanId: null,
    lastUsedPromptStartTimeMs: null,
    topicId: null,
    subTopicId: null,
    annotationIds: [],
    traceName: "",
    rootSpanStartTimeMs: 0,
    attributes: {},
    events: [],
    scenarioRoleCosts: {},
    scenarioRoleLatencies: {},
    scenarioRoleSpans: {},
    spanCosts: {},
    occurredAt: 0,
    createdAt: 0,
    updatedAt: 0,
    LastEventOccurredAt: 0,
  } as unknown as TraceSummaryData;
}

function rootSpan(overrides?: Partial<NormalizedSpan>): NormalizedSpan {
  return {
    traceId: "t1",
    spanId: "s1",
    parentSpanId: null,
    name: "root",
    startTimeUnixMs: 0,
    endTimeUnixMs: 1000,
    spanAttributes: {},
    resourceAttributes: {},
    events: [],
    links: [],
    ...overrides,
  } as unknown as NormalizedSpan;
}

/**
 * Stub IO extraction service. The accumulator delegates payload
 * understanding to this — we just need to control what it returns.
 */
function stubExtractor(opts: {
  input?: { raw: unknown; text: string; source: "gen_ai" | "langwatch" };
  output?: { raw: unknown; text: string; source: "gen_ai" | "langwatch" };
}): TraceIOExtractionService {
  return {
    extractRichIOFromSpan: (
      _span: NormalizedSpan,
      type: "input" | "output",
    ) => (type === "input" ? opts.input ?? null : opts.output ?? null),
    extractFallbackIOFromSpan: () => null,
  } as unknown as TraceIOExtractionService;
}

describe("TraceIOAccumulationService — preferText behaviour", () => {
  /** @scenario Accumulator uses extracted text not raw JSON wrapper */
  it("uses the extracted human-readable text when present (unwraps {output:'...'} → '...')", () => {
    const extractor = stubExtractor({
      input: {
        raw: { input: "hey there" },
        text: "hey there",
        source: "langwatch",
      },
      output: {
        // The exact prod regression payload: nlpgo's workflow emits
        // `langwatch.output = {"output":"Hey what can I help you with today?"}`.
        raw: { output: "Hey what can I help you with today?" },
        text: "Hey what can I help you with today?",
        source: "langwatch",
      },
    });
    const accumulator = new TraceIOAccumulationService(extractor);

    const result = accumulator.accumulateIO({
      state: emptyState(),
      span: rootSpan(),
    });

    expect(result.computedInput).toBe("hey there");
    expect(result.computedOutput).toBe(
      "Hey what can I help you with today?",
    );
    // The bug we're fixing produced these instead:
    expect(result.computedOutput).not.toBe(
      JSON.stringify({ output: "Hey what can I help you with today?" }),
    );
  });

  /** @scenario Accumulator falls back to raw stringification when no text extracted */
  it("falls back to JSON.stringify(raw) when text extraction returns empty (preserves non-null guarantee)", () => {
    const extractor = stubExtractor({
      output: {
        // Unknown shape — the extraction service couldn't pull a clean
        // text out, so it returns an empty `text` and the raw payload.
        // We still want computedOutput non-null so the UI doesn't
        // render `<empty>` for spans that DO have output data.
        raw: { weird_shape: { nested: [1, 2, 3] } },
        text: "",
        source: "langwatch",
      },
    });
    const accumulator = new TraceIOAccumulationService(extractor);

    const result = accumulator.accumulateIO({
      state: emptyState(),
      span: rootSpan(),
    });

    expect(result.computedOutput).toBe(
      JSON.stringify({ weird_shape: { nested: [1, 2, 3] } }),
    );
  });

  it("uses the raw string directly when raw is already a plain string", () => {
    const extractor = stubExtractor({
      output: {
        raw: "Already a plain string",
        text: "Already a plain string",
        source: "langwatch",
      },
    });
    const accumulator = new TraceIOAccumulationService(extractor);

    const result = accumulator.accumulateIO({
      state: emptyState(),
      span: rootSpan(),
    });

    expect(result.computedOutput).toBe("Already a plain string");
  });
});

describe("TraceIOAccumulationService — claude utility spans", () => {
  const utilityOutput = stubExtractor({
    output: {
      raw: "echo 'test otlp 4'",
      text: "echo 'test otlp 4'",
      source: "gen_ai",
    },
  });

  describe("given a non-conversational claude_code query source", () => {
    it("does not let a prompt_suggestion reply become the trace headline output", () => {
      const accumulator = new TraceIOAccumulationService(utilityOutput);

      const result = accumulator.accumulateIO({
        state: emptyState(),
        span: rootSpan({
          spanAttributes: { "claude_code.query_source": "prompt_suggestion" },
        }),
      });

      // The suggestion is on the span (for the span detail) but must not
      // clobber the trace's headline output, like a tool span.
      expect(result.computedOutput).toBeNull();
    });

    it("skips generate_session_title too", () => {
      const accumulator = new TraceIOAccumulationService(utilityOutput);

      const result = accumulator.accumulateIO({
        state: emptyState(),
        span: rootSpan({
          spanAttributes: {
            "claude_code.query_source": "generate_session_title",
          },
        }),
      });

      expect(result.computedOutput).toBeNull();
    });
  });

  describe("given a conversational claude_code query source", () => {
    it("still lifts the reply for repl_main_thread", () => {
      const accumulator = new TraceIOAccumulationService(utilityOutput);

      const result = accumulator.accumulateIO({
        state: emptyState(),
        span: rootSpan({
          spanAttributes: { "claude_code.query_source": "repl_main_thread" },
        }),
      });

      expect(result.computedOutput).toBe("echo 'test otlp 4'");
    });
  });
});
