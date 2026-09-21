/**
 * AWS Bedrock **Converse** content blocks are a union discriminated by which
 * key is present ({text}, {toolUse}, {toolResult}) rather than by a `type`
 * field. These tests run the real canonicaliser + trace-I/O extraction pair
 * and assert each Converse shape reaches `trace_summaries` as non-empty
 * ComputedInput / ComputedOutput.
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
    /** @scenario Converse typeless text block survives extraction */
    it("extracts the typeless block on both sides", () => {
      const { input, output } = computeTraceIO(
        makeSpan({
          spanAttributes: {
            "gen_ai.system": "aws.bedrock",
            "gen_ai.request.model": "anthropic.claude-3-5-sonnet",
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

  describe("when a Converse toolUse block carries no input", () => {
    /** @scenario Converse toolUse block without input leaks nothing */
    it("does not leak the tool identifiers into the output text", () => {
      const { output } = computeTraceIO(
        makeSpan({
          spanAttributes: {
            "gen_ai.system": "aws.bedrock",
            "gen_ai.completion": JSON.stringify([
              {
                role: "assistant",
                content: [
                  { toolUse: { toolUseId: "tool-1", name: "lookup_order" } },
                ],
              },
            ]),
          },
        }),
      );

      expect(output ?? "").not.toContain("tool-1");
      expect(output ?? "").not.toContain("lookup_order");
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

  describe("when a Converse toolResult block carries structured json content", () => {
    /** @scenario Converse toolResult json block survives extraction */
    it("extracts the stringified json as the input", () => {
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
                      content: [{ json: { ok: true, items: 3 } }],
                    },
                  },
                ],
              },
            ]),
          },
        }),
      );

      expect(input).toBe('{"ok":true,"items":3}');
    });
  });

  describe("when a Converse toolResult json block carries a null value", () => {
    /** @scenario Converse toolResult json:null block is preserved, not dropped */
    it("extracts the literal null rather than dropping the block", () => {
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
                      content: [{ json: null }],
                    },
                  },
                ],
              },
            ]),
          },
        }),
      );

      expect(input).toBe("null");
    });
  });

  describe("when a Converse toolResult block has empty content", () => {
    /** @scenario Converse toolResult block with empty content contributes nothing */
    it("contributes no text and falls back to the span name", () => {
      const { input } = computeTraceIO(
        makeSpan({
          spanAttributes: {
            "gen_ai.system": "aws.bedrock",
            "gen_ai.prompt": JSON.stringify([
              {
                role: "user",
                content: [{ toolResult: { toolUseId: "tool-1", content: [] } }],
              },
            ]),
          },
        }),
      );

      expect(input).toBe("bedrock.converse");
    });
  });
});
