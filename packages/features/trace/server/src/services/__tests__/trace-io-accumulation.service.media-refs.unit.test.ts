/**
 * The accumulator's TEXT choice and its MEDIA collection, driven through the
 * real canonicalisation pass and the real media-reference adapter so the
 * refs a span carries on the wire are what the trace ends up quoting.
 *
 * Background — 2026-05-14 prod UX regression: trace summaries showed the raw
 * JSON wrapper (e.g. `{"output":"Hey there"}`) instead of the extracted
 * human-readable text (`Hey there`). The accumulator was stringifying the raw
 * payload instead of using the already-extracted `text`.
 */
import type { NormalizedSpan, TraceSummaryData } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";
import { TraceMediaReferenceAdapter } from "../../adapters/trace-media-reference.adapter";
import {
  TraceIoExtractionPort,
  type TraceIoSide,
  type TraceIoValue,
} from "../../ports/trace-io-extraction.port";
import { TraceCanonicalisationService } from "../trace-canonicalisation.service";
import { TraceIOAccumulationService } from "../trace-io-accumulation.service";

type Rich = { raw: unknown; text: string; source: "gen_ai" | "langwatch" };

/** Returns whatever the case asks for, per side. Never looks at the span. */
class StubExtraction extends TraceIoExtractionPort {
  constructor(private readonly sides: { input?: Rich; output?: Rich }) {
    super();
  }
  tryExtractRichIOFromSpan(_span: NormalizedSpan, side: TraceIoSide): TraceIoValue | null {
    return (this.sides[side] as TraceIoValue | undefined) ?? null;
  }
  tryExtractFallbackIOFromSpan(): TraceIoValue | null {
    return null;
  }
}

function accumulator(sides: { input?: Rich; output?: Rich }): TraceIOAccumulationService {
  return TraceIOAccumulationService.create(
    new StubExtraction(sides),
    TraceCanonicalisationService.create(),
    TraceMediaReferenceAdapter.create(),
  );
}

function emptyState(): TraceSummaryData {
  return {
    traceId: "t1",
    computedInput: null,
    computedOutput: null,
    outputFromRootSpan: false,
    outputSpanEndTimeMs: 0,
    blockedByGuardrail: false,
    attributes: {},
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

describe("TraceIOAccumulationService — preferText behaviour", () => {
  /** @scenario Accumulator uses extracted text not raw JSON wrapper */
  it("uses the extracted human-readable text when present (unwraps {output:'...'} → '...')", () => {
    const result = accumulator({
      input: { raw: { input: "hey there" }, text: "hey there", source: "langwatch" },
      output: {
        // The exact prod regression payload: nlpgo's workflow emits
        // `langwatch.output = {"output":"Hey what can I help you with today?"}`.
        raw: { output: "Hey what can I help you with today?" },
        text: "Hey what can I help you with today?",
        source: "langwatch",
      },
    }).accumulateIO({ state: emptyState(), span: rootSpan() });

    expect(result.computedInput).toBe("hey there");
    expect(result.computedOutput).toBe("Hey what can I help you with today?");
    expect(result.computedOutput).not.toBe(
      JSON.stringify({ output: "Hey what can I help you with today?" }),
    );
  });

  /** @scenario Accumulator falls back to raw stringification when no text extracted */
  it("falls back to JSON.stringify(raw) when text extraction returns empty (preserves non-null guarantee)", () => {
    const result = accumulator({
      output: {
        // Unknown shape — the extraction service couldn't pull a clean text
        // out, so it returns an empty `text` and the raw payload. computedOutput
        // must stay non-null so the UI does not render `<empty>` for a span
        // that DOES have output data.
        raw: { weird_shape: { nested: [1, 2, 3] } },
        text: "",
        source: "langwatch",
      },
    }).accumulateIO({ state: emptyState(), span: rootSpan() });

    expect(result.computedOutput).toBe(JSON.stringify({ weird_shape: { nested: [1, 2, 3] } }));
  });

  it("uses the raw string directly when raw is already a plain string", () => {
    const result = accumulator({
      output: {
        raw: "Already a plain string",
        text: "Already a plain string",
        source: "langwatch",
      },
    }).accumulateIO({ state: emptyState(), span: rootSpan() });

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
      const result = accumulator({
        input: { raw: { input: "shipment 4417?" }, text: "shipment 4417?", source: "langwatch" },
        output: {
          raw: { output: "it arrives tomorrow" },
          text: "it arrives tomorrow",
          source: "langwatch",
        },
      }).accumulateIO({
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

  const IMAGE_URL = "/api/files/p1/i1";
  const AUDIO_URL = "/api/files/p1/a1";

  const textOnlyIO = (text: string): Rich => ({ raw: { input: text }, text, source: "langwatch" });

  /**
   * A span the way the wire records it: the picture is on the span attribute,
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
  function foldSpans(spans: Array<{ span: NormalizedSpan; input?: Rich }>) {
    let state = emptyState();
    let last!: ReturnType<TraceIOAccumulationService["accumulateIO"]>;
    for (const { span, input } of spans) {
      last = accumulator({ input }).accumulateIO({ state, span });
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
        { span: childCarrying("s2", IMAGE_URL), input: textOnlyIO("what is this?") },
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
          span: spanCarrying({ spanId: "s1", parentSpanId: null, url: IMAGE_URL }),
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
      const result = foldSpans([{ span: rootSpan(), input: textOnlyIO("just words") }]);

      expect(result.inputMediaRefs).toBeNull();
    });
  });
});
