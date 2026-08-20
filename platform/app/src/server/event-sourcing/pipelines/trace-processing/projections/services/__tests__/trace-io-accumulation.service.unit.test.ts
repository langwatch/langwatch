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
import type { TraceIOExtractionService } from "~/server/app-layer/traces/trace-io-extraction.service";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { LogRecordReceivedEventData } from "../../../schemas/events";
import type { NormalizedSpan } from "../../../schemas/spans";
import {
  extractIOFromLogRecord,
  TraceIOAccumulationService,
} from "../trace-io-accumulation.service";

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
    extractRichIOFromSpan: (_span: NormalizedSpan, type: "input" | "output") =>
      type === "input" ? (opts.input ?? null) : (opts.output ?? null),
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
    expect(result.computedOutput).toBe("Hey what can I help you with today?");
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

describe("TraceIOAccumulationService: media refs", () => {
  const audioPart = (id: string) => ({
    type: "input_audio",
    input_audio: { url: `/api/files/p1/${id}`, mimeType: "audio/wav" },
  });

  describe("given a voice turn whose transcript holds both sides", () => {
    /** @scenario "A media ref remembers the role of the message it came from" */
    it("records which side of the conversation each recording came from", () => {
      // A voice agent's span input is the whole transcript, so the caller's
      // recording and the agent's reply both ride the input attribute.
      const accumulator = new TraceIOAccumulationService(
        stubExtractor({
          input: {
            raw: { input: "shipment 4417?" },
            text: "shipment 4417?",
            source: "langwatch",
          },
          output: {
            raw: { output: "it arrives tomorrow" },
            text: "it arrives tomorrow",
            source: "langwatch",
          },
        }),
      );

      const result = accumulator.accumulateIO({
        state: emptyState(),
        span: rootSpan({
          spanAttributes: {
            "langwatch.input": JSON.stringify([
              { role: "user", content: [audioPart("spoken")] },
              { role: "assistant", content: [audioPart("reply")] },
            ]),
            "langwatch.output": JSON.stringify([
              { role: "assistant", content: [audioPart("reply")] },
            ]),
          },
        } as never),
      });

      expect(JSON.parse(result.inputMediaRefs!)).toEqual([
        { kind: "audio", url: "/api/files/p1/spoken", role: "user" },
        { kind: "audio", url: "/api/files/p1/reply", role: "assistant" },
      ]);
      expect(JSON.parse(result.outputMediaRefs!)).toEqual([
        { kind: "audio", url: "/api/files/p1/reply", role: "assistant" },
      ]);
    });
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

describe("extractIOFromLogRecord — claude assistant_response fallback", () => {
  function claudeLog(
    attributes: Record<string, string>,
  ): LogRecordReceivedEventData {
    return {
      traceId: "t1",
      spanId: "s1",
      timeUnixMs: 1000,
      severityNumber: 9,
      severityText: "INFO",
      body: "claude_code.assistant_response",
      attributes,
      resourceAttributes: {},
      scopeName: "com.anthropic.claude_code.events",
      scopeVersion: null,
      piiRedactionLevel: "STRICT",
    };
  }

  describe("given a conversational assistant_response event (light path, no raw bodies)", () => {
    it("lifts the reply text as the trace output", () => {
      const result = extractIOFromLogRecord(
        claudeLog({
          "event.name": "assistant_response",
          query_source: "repl_main_thread",
          response: "E aí! Tudo bem?",
        }),
      );

      expect(result).toEqual({ input: null, output: "E aí! Tudo bem?" });
    });
  });

  describe("given a non-conversational assistant_response event", () => {
    it("does not let a utility reply become the trace output", () => {
      const result = extractIOFromLogRecord(
        claudeLog({
          "event.name": "assistant_response",
          query_source: "generate_session_title",
          response: "Telemetry chat",
        }),
      );

      expect(result).toEqual({ input: null, output: null });
    });
  });

  describe("given an assistant_response event with an empty response", () => {
    it("returns no output", () => {
      const result = extractIOFromLogRecord(
        claudeLog({
          "event.name": "assistant_response",
          query_source: "repl_main_thread",
          response: "",
        }),
      );

      expect(result).toEqual({ input: null, output: null });
    });
  });
});

/**
 * Media refs are a separate question from the computed text: which span names
 * the trace, and where the trace's media is. A wrapper span sets the headline
 * text while the model call underneath it holds the picture, so the refs
 * accumulate across spans rather than following the text's winner.
 */
describe("TraceIOAccumulationService: media refs", () => {
  const IMAGE_URL = "/api/files/p1/i1";
  const AUDIO_URL = "/api/files/p1/a1";

  const textOnlyIO = (text: string) => ({
    raw: { input: text },
    text,
    source: "langwatch" as const,
  });

  /**
   * A span the way the wire records it: the picture rides the span attribute,
   * and what the extraction service reports about the span is a separate
   * question. Instrumentation for several SDKs reports the text alone.
   */
  const spanCarrying = ({
    spanId,
    parentSpanId,
    url,
  }: {
    spanId: string;
    parentSpanId: string | null;
    url: string;
  }) =>
    rootSpan({
      spanId,
      parentSpanId,
      name: parentSpanId === null ? "root" : "llm",
      spanAttributes: {
        "langwatch.input": JSON.stringify([
          { role: "user", content: [{ type: "image_url", image_url: { url } }] },
        ]),
      },
    } as never);

  /** Fold a list of spans through the accumulator the way the projection does. */
  function foldSpans(
    spans: Array<{
      span: NormalizedSpan;
      input?: { raw: unknown; text: string; source: "gen_ai" | "langwatch" };
    }>,
  ) {
    let state = emptyState();
    let last!: ReturnType<TraceIOAccumulationService["accumulateIO"]>;
    for (const { span, input } of spans) {
      const accumulator = new TraceIOAccumulationService(
        stubExtractor({ input }),
      );
      last = accumulator.accumulateIO({ state, span });
      state = {
        ...state,
        computedInput: last.computedInput,
        computedOutput: last.computedOutput,
        outputFromRootSpan: last.outputFromRootSpan,
        outputSpanEndTimeMs: last.outputSpanEndTimeMs,
        attributes: {
          ...state.attributes,
          "langwatch.reserved.output_source": last.outputSource,
          ...(last.inputMediaRefs
            ? { "langwatch.reserved.media_refs.input": last.inputMediaRefs }
            : {}),
        },
      } as TraceSummaryData;
    }
    return last;
  }

  const childCarrying = (spanId: string, url: string) =>
    spanCarrying({ spanId, parentSpanId: "s1", url });

  describe("given a text-only root span and a child model call carrying the image", () => {
    /** @scenario Media on a child span reaches the trace's refs */
    it("keeps the child's image on the trace, whichever span folds first", () => {
      const child = { span: childCarrying("s2", IMAGE_URL) };
      const root = { span: rootSpan(), input: textOnlyIO("what is this?") };

      const rootFirst = foldSpans([root, child]);
      expect(rootFirst.computedInput).toBe("what is this?");
      expect(JSON.parse(rootFirst.inputMediaRefs!)).toEqual([
        { kind: "image", url: IMAGE_URL, role: "user" },
      ]);

      // Spans arrive in whatever order the queue hands them over, and the root
      // winning the headline text must not wipe what the child contributed.
      const childFirst = foldSpans([child, root]);
      expect(childFirst.computedInput).toBe("what is this?");
      expect(JSON.parse(childFirst.inputMediaRefs!)).toEqual([
        { kind: "image", url: IMAGE_URL, role: "user" },
      ]);
    });
  });

  describe("given instrumentation that reports the text and drops the picture", () => {
    /** @scenario Media on a child span reaches the trace's refs */
    it("still finds the picture on the span the customer sent", () => {
      // What several SDK instrumentations do: the reported messages carry the
      // question only, while the recorded request carries the attachment too.
      const result = foldSpans([
        {
          span: childCarrying("s2", IMAGE_URL),
          input: textOnlyIO("what is this?"),
        },
      ]);

      expect(result.computedInput).toBe("what is this?");
      expect(JSON.parse(result.inputMediaRefs!)).toEqual([
        { kind: "image", url: IMAGE_URL, role: "user" },
      ]);
    });
  });

  describe("given both the winning span and a child carrying media", () => {
    /** @scenario The headline span's media is preferred over a child's */
    it("puts the winning span's media first", () => {
      const result = foldSpans([
        { span: childCarrying("s2", AUDIO_URL) },
        {
          span: spanCarrying({
            spanId: "s1",
            parentSpanId: null,
            url: IMAGE_URL,
          }),
          input: textOnlyIO("what is this?"),
        },
      ]);

      expect(JSON.parse(result.inputMediaRefs!)).toEqual([
        { kind: "image", url: IMAGE_URL, role: "user" },
        { kind: "image", url: AUDIO_URL, role: "user" },
      ]);
    });
  });

  describe("given the same stored object quoted by two spans", () => {
    /** @scenario One recording reachable through two paths collapses to one ref */
    it("records it once", () => {
      const result = foldSpans([
        { span: childCarrying("s2", IMAGE_URL) },
        { span: childCarrying("s3", IMAGE_URL) },
      ]);

      expect(JSON.parse(result.inputMediaRefs!)).toEqual([
        { kind: "image", url: IMAGE_URL, role: "user" },
      ]);
    });
  });

  describe("given a span with no media at all", () => {
    it("leaves the trace's refs empty rather than inventing an attribute", () => {
      const result = foldSpans([
        { span: rootSpan(), input: textOnlyIO("just words") },
      ]);

      expect(result.inputMediaRefs).toBeNull();
    });
  });
});
