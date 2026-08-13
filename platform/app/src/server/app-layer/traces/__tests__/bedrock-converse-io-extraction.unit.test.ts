/**
 * Branch 1 of langwatch-saas#1040 — and the customer-independent reproduction
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
 * make no assertion about what the customer integration actually emits — they establish what
 * this pipeline does with each candidate Bedrock shape, so the observed
 * signature in production can be matched against a named shape.
 *
 * OUTCOME (production data hydrated 2026-08-13, issue #1040): none of these
 * rows describes the affected customer. Their empty Bedrock spans carry NO payload attribute
 * under any key — mapped or unmapped — so there is nothing for stage 2 to read
 * and no mapping change would populate them. The content is never emitted;
 * AWS's botocore instrumentation omits message content unless
 * OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true.
 *
 * The gaps this file originally characterised are now FIXED and these tests
 * assert the fixed behaviour:
 * - Converse's key-discriminated content blocks ({toolUse}, {toolResult})
 *   are handled by extractTextsFromParts in extractors/_messages.ts.
 * - aws.bedrock.* payload keys are mapped to canonical gen_ai.* keys by
 *   BedrockExtractor (extractors/bedrock.ts).
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
                content: [
                  { type: "text", text: "summarise this shipping manifest" },
                ],
              },
            ]),
            "gen_ai.completion": JSON.stringify([
              {
                role: "assistant",
                content: [{ type: "text", text: "The shipment contains ..." }],
              },
            ]),
          },
        }),
      );

      // The control for every other case below: with a shape the pipeline
      // models, real content reaches trace_summaries. Without this passing,
      // an empty result elsewhere is equally well explained by a broken
      // fixture and the whole file proves nothing.
      expect(input).toContain("summarise this shipping manifest");
      expect(output).toContain("The shipment contains ...");
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
              {
                role: "user",
                content: [{ text: "summarise this shipping manifest" }],
              },
            ]),
            "gen_ai.completion": JSON.stringify([
              {
                role: "assistant",
                content: [{ text: "The shipment contains ..." }],
              },
            ]),
          },
        }),
      );

      expect({ input, output }).toEqual({
        input: "summarise this shipping manifest",
        output: "The shipment contains ...",
      });
    });
  });

  describe("when the assistant turn is a Converse toolUse block", () => {
    /** @scenario Converse toolUse block survives extraction */
    it("extracts the tool call's input as the output text", () => {
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
                      name: "lookup_order",
                      input: { orderId: "ord-42" },
                    },
                  },
                ],
              },
            ]),
          },
        }),
      );

      expect(output).toContain('"orderId":"ord-42"');
    });
  });

  describe("when the user turn is a Converse toolResult block", () => {
    /** @scenario Converse toolResult block survives extraction */
    it("extracts the tool result's inner text as the input", () => {
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
                      content: [{ text: "order ord-42 found" }],
                    },
                  },
                ],
              },
            ]),
          },
        }),
      );

      expect(input).toBe("order ord-42 found");
    });
  });
});

describe("given a Bedrock span whose messages sit under aws.bedrock.* keys", () => {
  describe("when the span carries the Converse request/response bodies verbatim", () => {
    /** @scenario "aws.bedrock.* payload keys are mapped to canonical keys" */
    it("maps the payloads to canonical keys and extracts both sides", () => {
      const span = makeSpan({
        spanAttributes: {
          // A boto3/OTel AWS-SDK span: the operation is identified, and the
          // Converse payloads ride along under aws.* keys, which the
          // BedrockExtractor maps onto the canonical gen_ai.* keys.
          "rpc.service": "BedrockRuntime",
          "rpc.method": "Converse",
          "aws.bedrock.model_id": "anthropic.claude-3-5-sonnet",
          "aws.bedrock.request.messages": JSON.stringify([
            {
              role: "user",
              content: [{ text: "summarise this shipping manifest" }],
            },
          ]),
          "aws.bedrock.response.output": JSON.stringify({
            message: {
              role: "assistant",
              content: [{ text: "The shipment contains ..." }],
            },
          }),
        },
      });

      const { input, output, canonicalAttributes } = computeTraceIO(span);

      // The canonical input key is now written from the aws.bedrock.* payload.
      expect(canonicalAttributes["gen_ai.input.messages"]).toBeDefined();

      // Before the BedrockExtractor existed this pair degraded asymmetrically
      // to {input: "bedrock.converse", output: null} — the span name and the
      // HTTP-status fallback. The real content now reaches trace_summaries.
      expect(input).toBe("summarise this shipping manifest");
      expect(output).toBe("The shipment contains ...");
    });
  });

  describe("when such a span is the root of an HTTP-instrumented trace", () => {
    /** @scenario Mapped messages beat the HTTP fallback */
    it("prefers the mapped request messages over the HTTP fallback", () => {
      const { input, output } = computeTraceIO(
        makeSpan({
          spanAttributes: {
            "rpc.method": "Converse",
            "http.method": "POST",
            "http.target": "/model/anthropic.claude-3-5-sonnet/converse",
            "http.status_code": 200,
            "aws.bedrock.request.messages": JSON.stringify([
              {
                role: "user",
                content: [{ text: "summarise this shipping manifest" }],
              },
            ]),
          },
        }),
      );

      // Before the fix, the input read as plausible-but-wrong: the HTTP
      // method + target. The mapped request messages now win; the output
      // still falls back to the HTTP status because this span carries no
      // aws.bedrock.response.output.
      expect(input).toBe("summarise this shipping manifest");
      expect(output).toBe("200");
    });
  });

  describe("when a non-Bedrock span carries none of the Bedrock signals", () => {
    it("leaves the span alone (extractor does not fire)", () => {
      const { input, output, appliedRules } = computeTraceIO(
        makeSpan({
          spanAttributes: {
            "rpc.service": "DynamoDB",
            "http.method": "POST",
            "http.status_code": 200,
          },
        }),
      );

      expect(appliedRules.some((r) => r.startsWith("bedrock:"))).toBe(false);
      // Ordinary fallback behaviour, untouched: span name in, status out.
      expect(input).toBe("bedrock.converse");
      expect(output).toBe("200");
    });
  });
});
