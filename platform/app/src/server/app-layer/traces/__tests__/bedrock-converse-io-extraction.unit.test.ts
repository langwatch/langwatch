/**
 * Branch 1 of langwatch-saas#1040 — and the Healify-independent reproduction
 * (AC4). Does an AWS Bedrock **Converse** span survive the two-stage I/O
 * pipeline, or does it land in `trace_summaries` with empty ComputedInput /
 * ComputedOutput?
 *
 * The pipeline has two stages, and the second one only ever reads what the
 * first one wrote:
 *
 *   1. `CanonicalizeSpanAttributesService` maps a vendor's attribute keys onto
 *      the canonical `gen_ai.*` / `langwatch.*` keys.
 *   2. `TraceIOExtractionService` reads ONLY `gen_ai.input.messages`,
 *      `gen_ai.output.messages`, `langwatch.input`, `langwatch.output`
 *      (`IO_ATTR_KEYS`), and falls back to the span name / HTTP status.
 *
 * So an unmapped instrumentation does not fail loudly — it degrades, and the
 * degradation is ASYMMETRIC, which is what makes it identifiable in production
 * data without access to the customer's account:
 *
 *   - input  → `getHttpFallback` ends `return topSpan.name ?? null`, so a named
 *              root span ALWAYS yields a non-empty input: the span's own name.
 *   - output → `getHttpStatusFallback` ends `return null` unless the root span
 *              carries a numeric `http.status_code`.
 *
 * These tests run the REAL canonicaliser and the REAL extraction service. They
 * make no assertion about what Healify actually emits — they establish what
 * this pipeline does with each candidate Bedrock shape, so the observed
 * signature in production can be matched against a named shape.
 *
 * `describe` titles say which shapes are expected to work; the assertions are
 * the record of what the pipeline actually does today.
 */
import { describe, expect, it, vi } from "vitest";

// TraceIOExtractionService wraps its methods in getLangWatchTracer spans.
vi.mock("langwatch", () => ({
  getLangWatchTracer: () => ({
    withActiveSpan: (
      _name: string,
      _opts: unknown,
      fn: (span: { setAttributes: () => void }) => unknown,
    ) => fn({ setAttributes: () => undefined }),
  }),
}));

import {
  type NormalizedSpan,
  NormalizedSpanKind,
  NormalizedStatusCode,
} from "~/server/event-sourcing/pipelines/trace-processing/schemas/spans";
import { CanonicalizeSpanAttributesService } from "../canonicalisation/canonicalizeSpanAttributesService";
import { TraceIOExtractionService } from "../trace-io-extraction.service";

const canonicaliser = new CanonicalizeSpanAttributesService();
const ioService = new TraceIOExtractionService();

/**
 * Only ever used to CONSTRUCT the span. The assertions below hardcode the
 * literal instead of reusing this, so renaming the span turns them red — if
 * both sides shared one constant the falsification would move together and
 * prove nothing.
 */
const SPAN_NAME = "bedrock.converse";

function makeSpan(
  overrides: Partial<NormalizedSpan> & {
    spanAttributes?: Record<string, unknown>;
  } = {},
): NormalizedSpan {
  return {
    id: "span-1",
    traceId: "trace-1",
    spanId: "span-1",
    tenantId: "proj-1",
    parentSpanId: null,
    parentTraceId: null,
    parentIsRemote: null,
    sampled: true,
    startTimeUnixMs: 0,
    endTimeUnixMs: 1000,
    durationMs: 1000,
    name: SPAN_NAME,
    kind: NormalizedSpanKind.CLIENT,
    resourceAttributes: {},
    spanAttributes: {},
    events: [],
    links: [],
    statusMessage: null,
    statusCode: NormalizedStatusCode.OK,
    instrumentationScope: { name: "test", version: null },
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
    cost: null,
    nonBilledCost: null,
    ...overrides,
  };
}

/**
 * Runs the real production pair: canonicalise the span's attributes, then
 * extract trace-level I/O from the canonicalised span — which is the order the
 * ingestion pipeline uses. Returns the two `ComputedInput` / `ComputedOutput`
 * texts as they would be written to `trace_summaries`.
 */
function computeTraceIO(span: NormalizedSpan) {
  const canonicalised = canonicaliser.canonicalize(
    span.spanAttributes,
    span.events,
    span,
  );
  const spans: NormalizedSpan[] = [
    {
      ...span,
      spanAttributes: canonicalised.attributes,
      events: canonicalised.events,
    },
  ];

  return {
    input: ioService.extractFirstInput(spans)?.text ?? null,
    output: ioService.extractLastOutput(spans)?.text ?? null,
    appliedRules: canonicalised.appliedRules,
    canonicalAttributes: canonicalised.attributes,
  };
}

describe("given a Bedrock span whose messages sit under canonical gen_ai keys", () => {
  describe("when the content blocks are InvokeModel-typed ({type:'text'})", () => {
    it("extracts both the prompt and the completion", () => {
      const { input, output } = computeTraceIO(
        makeSpan({
          spanAttributes: {
            "gen_ai.system": "aws.bedrock",
            "gen_ai.request.model": "anthropic.claude-3-5-sonnet",
            "gen_ai.prompt": JSON.stringify([
              {
                role: "user",
                content: [{ type: "text", text: "summarise this consult note" }],
              },
            ]),
            "gen_ai.completion": JSON.stringify([
              {
                role: "assistant",
                content: [{ type: "text", text: "The patient reports ..." }],
              },
            ]),
          },
        }),
      );

      // The control for every other case below: with a shape the pipeline
      // models, real content reaches trace_summaries. Without this passing,
      // an empty result elsewhere is equally well explained by a broken
      // fixture and the whole file proves nothing.
      expect(input).toContain("summarise this consult note");
      expect(output).toContain("The patient reports ...");
    });
  });

  describe("when the content blocks are Converse-shaped (typeless {'text': ...})", () => {
    it("records whether the typeless block survives extraction", () => {
      const { input, output } = computeTraceIO(
        makeSpan({
          spanAttributes: {
            "gen_ai.system": "aws.bedrock",
            "gen_ai.request.model": "anthropic.claude-3-5-sonnet",
            // The AWS Converse API wire shape: content blocks are a union
            // discriminated by WHICH KEY IS PRESENT, not by a `type` field.
            "gen_ai.prompt": JSON.stringify([
              { role: "user", content: [{ text: "summarise this consult note" }] },
            ]),
            "gen_ai.completion": JSON.stringify([
              { role: "assistant", content: [{ text: "The patient reports ..." }] },
            ]),
          },
        }),
      );

      expect({ input, output }).toEqual({
        input: "summarise this consult note",
        output: "The patient reports ...",
      });
    });
  });

  describe("when the assistant turn is a Converse toolUse block", () => {
    it("records whether the tool call survives extraction", () => {
      const { output } = computeTraceIO(
        makeSpan({
          spanAttributes: {
            "gen_ai.system": "aws.bedrock",
            "gen_ai.completion": JSON.stringify([
              {
                role: "assistant",
                content: [
                  {
                    toolUse: {
                      toolUseId: "tool-1",
                      name: "lookup_patient",
                      input: { patientId: "p-42" },
                    },
                  },
                ],
              },
            ]),
          },
        }),
      );

      expect(output).toBe(null);
    });
  });

  describe("when the user turn is a Converse toolResult block", () => {
    it("records whether the tool result survives extraction", () => {
      const { input } = computeTraceIO(
        makeSpan({
          spanAttributes: {
            "gen_ai.system": "aws.bedrock",
            "gen_ai.prompt": JSON.stringify([
              {
                role: "user",
                content: [
                  {
                    toolResult: {
                      toolUseId: "tool-1",
                      content: [{ text: "patient p-42 found" }],
                    },
                  },
                ],
              },
            ]),
          },
        }),
      );

      expect(input).toBe("bedrock.converse");
    });
  });
});

describe("given a Bedrock span whose messages sit under keys no extractor maps", () => {
  describe("when the span carries the Converse request/response bodies verbatim", () => {
    it("degrades asymmetrically: input becomes the span name, output is lost", () => {
      const span = makeSpan({
        spanAttributes: {
          // A boto3/OTel AWS-SDK span: the operation is identified, and the
          // Converse payloads ride along under aws.* keys. No registered
          // extractor reads any of these — there is no AWS/Bedrock extractor.
          "rpc.service": "BedrockRuntime",
          "rpc.method": "Converse",
          "aws.bedrock.model_id": "anthropic.claude-3-5-sonnet",
          "aws.bedrock.request.messages": JSON.stringify([
            { role: "user", content: [{ text: "summarise this consult note" }] },
          ]),
          "aws.bedrock.response.output": JSON.stringify({
            message: {
              role: "assistant",
              content: [{ text: "The patient reports ..." }],
            },
          }),
        },
      });

      const { input, output, canonicalAttributes } = computeTraceIO(span);

      // Neither canonical I/O key was ever written: the payloads are present in
      // the span and invisible to the extraction service.
      expect(canonicalAttributes["langwatch.input"]).toBeUndefined();
      expect(canonicalAttributes["gen_ai.input.messages"]).toBeUndefined();

      // This pair IS the production signature. It is identifiable in stored
      // data with no access to the customer's account: input equal to the span
      // name, output empty, on a trace whose spans hold real content.
      expect(input).toBe("bedrock.converse");
      expect(output).toBe(null);

      // And the content is demonstrably still in the span — the trace is not
      // empty, only its summary is.
      expect(span.spanAttributes["aws.bedrock.request.messages"]).toContain(
        "summarise this consult note",
      );
    });
  });

  describe("when such a span is the root of an HTTP-instrumented trace", () => {
    it("substitutes the HTTP method, target and status for the real I/O", () => {
      const { input, output } = computeTraceIO(
        makeSpan({
          spanAttributes: {
            "rpc.method": "Converse",
            "http.method": "POST",
            "http.target": "/model/anthropic.claude-3-5-sonnet/converse",
            "http.status_code": 200,
            "aws.bedrock.request.messages": JSON.stringify([
              { role: "user", content: [{ text: "summarise this consult note" }] },
            ]),
          },
        }),
      );

      // Worth naming separately: here the trace does NOT read as empty. It
      // reads as plausible-but-wrong, which is harder to notice than a blank.
      expect(input).toBe("POST /model/anthropic.claude-3-5-sonnet/converse");
      expect(output).toBe("200");
    });
  });
});
