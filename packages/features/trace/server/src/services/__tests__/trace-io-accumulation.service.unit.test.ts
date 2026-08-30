/**
 * Characterization of `accumulateIO` — the rule that decides which span's text
 * becomes a trace's headline input and output.
 *
 * It runs once per span and carries its answer forward in `TraceSummaryData`,
 * so the behaviour worth pinning is which span WINS: a root beats a child, a
 * semantic match beats a stringified fallback, and some span kinds never
 * compete at all. Every collaborator is faked, so these are the accumulation
 * rules on their own, with no payload parsing in the way.
 */

import type { NormalizedSpan, TraceSummaryData } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";
import { TraceCanonicalisationService } from "../trace-canonicalisation.service";
import {
  TraceMediaReferencePort,
  type TraceMediaReference,
} from "../../ports/trace-media-reference.port";
import {
  TraceIoExtractionPort,
  type TraceIoSide,
  type TraceIoValue,
} from "../../ports/trace-io-extraction.port";
import { OUTPUT_SOURCE, TraceIOAccumulationService } from "../trace-io-accumulation.service";

type Extracted = { rich?: TraceIoValue | null; fallback?: TraceIoValue | null };

/** Returns whatever the case asks for, per side. Never looks at the span. */
class FakeExtraction extends TraceIoExtractionPort {
  constructor(private readonly sides: { input?: Extracted; output?: Extracted }) {
    super();
  }
  tryExtractRichIOFromSpan(_span: NormalizedSpan, side: TraceIoSide): TraceIoValue | null {
    return this.sides[side]?.rich ?? null;
  }
  tryExtractFallbackIOFromSpan(_span: NormalizedSpan, side: TraceIoSide): TraceIoValue | null {
    return this.sides[side]?.fallback ?? null;
  }
}

/** Collects one reference per span so "did this span contribute?" is visible. */
class FakeMediaReferences extends TraceMediaReferencePort {
  constructor(private readonly found: TraceMediaReference[] = []) {
    super();
  }
  collect(): TraceMediaReference[] {
    return this.found;
  }
  parse(serialized: string | null): TraceMediaReference[] {
    return serialized === null ? [] : (JSON.parse(serialized) as TraceMediaReference[]);
  }
  merge({
    existing,
    incoming,
    precedence,
  }: {
    existing: TraceMediaReference[];
    incoming: TraceMediaReference[];
    precedence: "append" | "prepend";
  }): TraceMediaReference[] {
    return precedence === "prepend" ? [...incoming, ...existing] : [...existing, ...incoming];
  }
  trySerialize(references: TraceMediaReference[]): string | null {
    return references.length === 0 ? null : JSON.stringify(references);
  }
}

function value(text: string, source: TraceIoValue["source"] = "gen_ai"): TraceIoValue {
  return { raw: { any: text }, text, source };
}

function accumulator(
  sides: { input?: Extracted; output?: Extracted },
  media: TraceMediaReference[] = [],
): TraceIOAccumulationService {
  return TraceIOAccumulationService.create(
    new FakeExtraction(sides),
    TraceCanonicalisationService.create(),
    new FakeMediaReferences(media),
  );
}

function state(overrides: Partial<TraceSummaryData> = {}): TraceSummaryData {
  return {
    traceId: "t1",
    computedInput: null,
    computedOutput: null,
    outputFromRootSpan: false,
    outputSpanEndTimeMs: 0,
    blockedByGuardrail: false,
    attributes: {},
    ...overrides,
  } as unknown as TraceSummaryData;
}

function span(overrides: Partial<NormalizedSpan> = {}): NormalizedSpan {
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

describe("TraceIOAccumulationService", () => {
  describe("given a span kind that never defines the trace's headline I/O", () => {
    for (const spanType of ["evaluation", "guardrail", "tool"]) {
      describe(`when the span is a ${spanType} span carrying its own input and output`, () => {
        it("leaves the accumulated text untouched", () => {
          const result = accumulator({
            input: { rich: value("tool input") },
            output: { rich: value("tool output") },
          }).accumulateIO({
            state: state(),
            span: span({ spanAttributes: { "langwatch.span.type": spanType } }),
          });

          expect(result.computedInput).toBeNull();
          expect(result.computedOutput).toBeNull();
        });
      });
    }

    describe("when the span is a non-conversational Claude Code utility call", () => {
      it("leaves the accumulated text untouched", () => {
        const result = accumulator({
          output: { rich: value("Generated session title") },
        }).accumulateIO({
          state: state(),
          span: span({ spanAttributes: { "claude_code.query_source": "generate_session_title" } }),
        });

        expect(result.computedOutput).toBeNull();
      });
    });
  });

  describe("given a guardrail span", () => {
    describe("when it reports that it did not pass", () => {
      it("marks the trace blocked", () => {
        const result = accumulator({}).accumulateIO({
          state: state(),
          span: span({
            spanAttributes: {
              "langwatch.span.type": "guardrail",
              "langwatch.output": { passed: false },
            },
          }),
        });

        expect(result.blockedByGuardrail).toBe(true);
      });
    });

    describe("when it reports that it passed", () => {
      it("leaves the trace unblocked", () => {
        const result = accumulator({}).accumulateIO({
          state: state(),
          span: span({
            spanAttributes: {
              "langwatch.span.type": "guardrail",
              "langwatch.output": { passed: true },
            },
          }),
        });

        expect(result.blockedByGuardrail).toBe(false);
      });
    });
  });

  describe("given input already accumulated from a semantic match", () => {
    const current = state({ computedInput: "first" });

    describe("when a later child span also has a semantic input", () => {
      it("keeps the first, because only a root may overwrite it", () => {
        const result = accumulator({ input: { rich: value("second") } }).accumulateIO({
          state: current,
          span: span({ parentSpanId: "s0" }),
        });

        expect(result.computedInput).toBe("first");
      });
    });

    describe("when a root span has a semantic input", () => {
      it("overwrites it", () => {
        const result = accumulator({ input: { rich: value("second") } }).accumulateIO({
          state: current,
          span: span({ parentSpanId: null }),
        });

        expect(result.computedInput).toBe("second");
      });
    });
  });

  describe("given input accumulated only as a fallback", () => {
    describe("when any span produces a semantic input", () => {
      it("replaces the fallback and clears the fallback flag", () => {
        const result = accumulator({ input: { rich: value("semantic") } }).accumulateIO({
          state: state({
            computedInput: "stringified payload",
            attributes: { "langwatch.reserved.input_is_fallback": "true" },
          }),
          span: span({ parentSpanId: "s0" }),
        });

        expect(result.computedInput).toBe("semantic");
        expect(result.inputIsFallback).toBe(false);
      });
    });
  });

  describe("given no input accumulated yet", () => {
    describe("when the span has no semantic input but a stringifiable payload", () => {
      it("takes the fallback and records that it is one", () => {
        const result = accumulator({ input: { fallback: value("stringified") } }).accumulateIO({
          state: state(),
          span: span(),
        });

        expect(result.computedInput).toBe("stringified");
        expect(result.inputIsFallback).toBe(true);
      });
    });

    describe("when a semantic input exists", () => {
      it("prefers it and does not mark a fallback", () => {
        const result = accumulator({
          input: { rich: value("semantic"), fallback: value("stringified") },
        }).accumulateIO({ state: state(), span: span() });

        expect(result.computedInput).toBe("semantic");
        expect(result.inputIsFallback).toBe(false);
      });
    });
  });

  describe("given output accumulated from a fallback", () => {
    describe("when a semantic output arrives on a span that finished earlier", () => {
      it("still overrides, because end time never rescues a fallback", () => {
        const result = accumulator({ output: { rich: value("semantic") } }).accumulateIO({
          state: state({
            computedOutput: "stringified",
            outputSpanEndTimeMs: 9_000,
            attributes: { "langwatch.reserved.output_is_fallback": "true" },
          }),
          span: span({ parentSpanId: "s0", endTimeUnixMs: 1_000 }),
        });

        expect(result.computedOutput).toBe("semantic");
        expect(result.outputIsFallback).toBe(false);
      });
    });
  });

  describe("given an output from a root span", () => {
    const current = state({
      computedOutput: "earlier root reply",
      outputFromRootSpan: true,
      outputSpanEndTimeMs: 5_000,
    });

    describe("when another root span finishes later", () => {
      it("takes the later reply, so the winner is deterministic by end time", () => {
        const result = accumulator({ output: { rich: value("later root reply") } }).accumulateIO({
          state: current,
          span: span({ parentSpanId: null, endTimeUnixMs: 6_000 }),
        });

        expect(result.computedOutput).toBe("later root reply");
        expect(result.outputSpanEndTimeMs).toBe(6_000);
      });
    });

    describe("when a child span produces an output", () => {
      it("keeps the root's, because a child never displaces a root", () => {
        const result = accumulator({ output: { rich: value("child reply") } }).accumulateIO({
          state: current,
          span: span({ parentSpanId: "s0", endTimeUnixMs: 9_000 }),
        });

        expect(result.computedOutput).toBe("earlier root reply");
      });
    });
  });

  describe("given an output source", () => {
    describe("when the winning span declared it explicitly", () => {
      it("records the source as explicit", () => {
        const result = accumulator({
          output: { rich: value("reply", "langwatch") },
        }).accumulateIO({ state: state(), span: span() });

        expect(result.outputSource).toBe(OUTPUT_SOURCE.EXPLICIT);
      });
    });

    describe("when the source was inferred from instrumentation", () => {
      it("records the source as inferred", () => {
        const result = accumulator({
          output: { rich: value("reply", "gen_ai") },
        }).accumulateIO({ state: state(), span: span() });

        expect(result.outputSource).toBe(OUTPUT_SOURCE.INFERRED);
      });
    });
  });

  describe("given media on a span", () => {
    const picture: TraceMediaReference = { kind: "image", url: "https://example.test/a.png" };
    const drawing: TraceMediaReference = { kind: "image", url: "https://example.test/b.png" };

    describe("when the span carries media but loses the headline text", () => {
      it("still collects the media, because the winning span is rarely the one holding it", () => {
        const result = accumulator({ input: { rich: value("child input") } }, [
          picture,
        ]).accumulateIO({
          state: state({ computedInput: "root input" }),
          span: span({ parentSpanId: "s0", spanAttributes: { "langwatch.input": "payload" } }),
        });

        expect(result.computedInput).toBe("root input");
        expect(result.inputMediaRefs).toBe(JSON.stringify([picture]));
      });
    });

    describe("when the span both wins the headline text and carries media", () => {
      it("puts its media first, so the list thumbnail matches the headline", () => {
        const result = accumulator({ input: { rich: value("root input") } }, [
          drawing,
        ]).accumulateIO({
          state: state({
            attributes: { "langwatch.reserved.media_refs.input": JSON.stringify([picture]) },
          }),
          span: span({ parentSpanId: null, spanAttributes: { "langwatch.input": "payload" } }),
        });

        expect(result.inputMediaRefs).toBe(JSON.stringify([drawing, picture]));
      });
    });
  });
});
