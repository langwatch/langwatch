import { describe, expect, it } from "vitest";
import {
  NormalizedSpanKind,
  NormalizedStatusCode,
  EVENTREF_ATTR_PREFIX,
  COMMAND_INLINE_THRESHOLD,
  LOG_RECORD_RECEIVED_EVENT_TYPE,
  type NormalizedSpan,
} from "@langwatch/trace-contract";
import { TraceCanonicalisationService } from "../../services/trace-canonicalisation.service";
import { TraceIoExtractionAdapter } from "../trace-io-extraction.adapter";
import { TraceMediaReferenceAdapter } from "../trace-media-reference.adapter";
import { ModelCatalogTraceModelCostAdapter } from "../model-catalog.trace-model-cost.adapter";
import { SpanCostService } from "../../services/span-cost.service";
import {
  IO_ATTR_KEYS,
  IO_PREVIEW_BYTES,
  leanForProjection,
} from "../../services/trace-projection-lean.service";

/**
 * The four collaborators the trace pipeline definition is built from, harvested
 * from the application in step (g1). Everything asserted here is a literal, not
 * a read of the application's source.
 */

const canonicalisation = TraceCanonicalisationService.create();

function createTestSpan(overrides: Partial<NormalizedSpan> = {}): NormalizedSpan {
  return {
    id: "span-1",
    traceId: "trace-1",
    spanId: "span-1",
    tenantId: "tenant-1",
    parentSpanId: null,
    parentTraceId: null,
    parentIsRemote: null,
    sampled: true,
    startTimeUnixMs: 1000,
    endTimeUnixMs: 2000,
    durationMs: 1000,
    name: "test-span",
    kind: NormalizedSpanKind.INTERNAL,
    resourceAttributes: {},
    spanAttributes: {},
    events: [],
    links: [],
    statusMessage: null,
    statusCode: NormalizedStatusCode.UNSET,
    instrumentationScope: { name: "test", version: null },
    droppedAttributesCount: 0 as const,
    droppedEventsCount: 0 as const,
    droppedLinksCount: 0 as const,
    cost: null,
    nonBilledCost: null,
    ...overrides,
  };
}

describe("given a span carrying semantic input and output attributes", () => {
  const extraction = TraceIoExtractionAdapter.create(canonicalisation);

  describe("when the packaged extraction is asked for each side through its port", () => {
    /** @scenario "the packaged extraction reads the same semantic attributes" */
    it("reads the GenAI messages as the input and names its source", () => {
      const messages = [{ role: "user", content: "how much is it" }];
      const span = createTestSpan({
        spanAttributes: { "gen_ai.input.messages": messages },
      });

      expect(extraction.tryExtractRichIOFromSpan(span, "input")).toEqual({
        raw: messages,
        text: "how much is it",
        source: "gen_ai",
      });
    });

    /** @scenario "the packaged extraction reads the same semantic attributes" */
    it("reads the LangWatch value as the output and names its source", () => {
      const span = createTestSpan({
        spanAttributes: { "langwatch.output": "nine euro" },
      });

      expect(extraction.tryExtractRichIOFromSpan(span, "output")).toEqual({
        raw: "nine euro",
        text: "nine euro",
        source: "langwatch",
      });
    });
  });

  describe("when a span's payload defeats every semantic heuristic", () => {
    /** @scenario "a span with no semantic attributes falls back rather than reporting nothing" */
    it("reports no rich value and falls back to the payload's text", () => {
      const span = createTestSpan({
        spanAttributes: { "langwatch.input": { unrecognised_wrapper: { depth: 3 } } },
      });

      expect(extraction.tryExtractRichIOFromSpan(span, "input")).toBeNull();
      expect(extraction.tryExtractFallbackIOFromSpan(span, "input")?.text).toContain(
        "unrecognised_wrapper",
      );
    });

    /** @scenario "a span with no semantic attributes falls back rather than reporting nothing" */
    it("reports nothing at all when the span carries no LangWatch attribute", () => {
      const span = createTestSpan({ spanAttributes: { "http.method": "POST" } });

      expect(extraction.tryExtractRichIOFromSpan(span, "input")).toBeNull();
      expect(extraction.tryExtractFallbackIOFromSpan(span, "input")).toBeNull();
    });
  });
});

describe("given the media reference port over the contract's format", () => {
  const media = TraceMediaReferenceAdapter.create();

  describe("when references are collected, serialised, parsed and merged", () => {
    /** @scenario "a reference the projection wrote is read back whole" */
    it("answers all four port methods off one format", () => {
      const refs = media.collect([
        {
          role: "assistant",
          content: [{ type: "image_url", image_url: { url: "/api/files/p/a" } }],
        },
      ]);

      expect(refs).toEqual([{ kind: "image", url: "/api/files/p/a", role: "assistant" }]);

      const serialized = media.trySerialize(refs);
      expect(serialized).toBe('[{"kind":"image","url":"/api/files/p/a","role":"assistant"}]');
      expect(media.parse(serialized)).toEqual(refs);
      expect(
        media.merge({
          existing: refs,
          incoming: [{ kind: "image", url: "/api/files/p/b" }],
          precedence: "prepend",
        }),
      ).toEqual([
        { kind: "image", url: "/api/files/p/b" },
        { kind: "image", url: "/api/files/p/a", role: "assistant" },
      ]);
    });

    /** @scenario "a reference to anywhere but our own file route is refused" */
    it("refuses an external address through the port as well", () => {
      expect(media.parse('[{"kind":"image","url":"https://evil.test/p.png"}]')).toEqual([]);
    });
  });
});

describe("given the fold-time cost estimate over the platform's model catalog", () => {
  const modelCosts = ModelCatalogTraceModelCostAdapter.create();
  const spanCost = SpanCostService.create({ modelCosts });

  describe("when a span names one model on its request and another on its response", () => {
    /** @scenario "a span is priced from the model the provider answered with" */
    it("prices it from the response model, which is the fold's own order", () => {
      const span = createTestSpan({
        spanAttributes: {
          "gen_ai.request.model": "openai/gpt-4o-mini",
          "gen_ai.response.model": "openai/gpt-4o",
          "gen_ai.usage.input_tokens": 1000,
          "gen_ai.usage.output_tokens": 1000,
        },
      });

      expect(spanCost.extractModelsFromSpan(span)).toEqual(["openai/gpt-4o", "openai/gpt-4o-mini"]);

      const responsePriced = spanCost.extractTokenMetrics(span).cost;
      const requestPriced = spanCost.extractTokenMetrics(
        createTestSpan({
          spanAttributes: {
            "gen_ai.request.model": "openai/gpt-4o-mini",
            "gen_ai.usage.input_tokens": 1000,
            "gen_ai.usage.output_tokens": 1000,
          },
        }),
      ).cost;

      expect(responsePriced).toBeGreaterThan(0);
      expect(requestPriced).toBeGreaterThan(0);
      // gpt-4o is the dearer model; pricing from the request model would be
      // the record-time order, and that is deliberately NOT this one.
      expect(responsePriced).toBeGreaterThan(requestPriced);
    });
  });

  describe("when a span carries the customer's own per-token rates", () => {
    /** @scenario "a customer's own rates on the span still win" */
    it("prices from the override rather than the catalog", () => {
      const cost = modelCosts.estimate({
        attributes: {
          "langwatch.model.inputCostPerToken": 0.5,
          "langwatch.model.outputCostPerToken": 0.25,
        },
        model: "openai/gpt-4o",
        promptTokens: 2,
        completionTokens: 4,
      });

      expect(cost).toBeCloseTo(2, 10);
    });
  });

  describe("when nothing prices the span", () => {
    /** @scenario "a span is priced from the model the provider answered with" */
    it("reports no cost rather than guessing one", () => {
      expect(
        modelCosts.estimate({
          attributes: {},
          model: "a-model-nobody-published",
          promptTokens: 10,
          completionTokens: 10,
        }),
      ).toBe(0);
    });
  });
});

describe("given the lean projection payload transform", () => {
  const overBudget = "x".repeat(IO_PREVIEW_BYTES + 1024);

  function spanReceivedEvent(attributes: Array<{ key: string; value: { stringValue: string } }>) {
    return {
      id: "evt_1",
      type: "lw.obs.trace.span_received",
      tenantId: "tenant-1",
      aggregateId: "trace-1",
      data: {
        span: { attributes, events: [], links: [] },
        resource: null,
      },
    } as never;
  }

  describe("when the attribute keys that earn the wide budget are read", () => {
    /** @scenario "an oversized input is previewed and left a pointer" */
    it("names exactly the four input/output keys and the two budgets", () => {
      expect([...IO_ATTR_KEYS].sort()).toEqual([
        "gen_ai.input.messages",
        "gen_ai.output.messages",
        "langwatch.input",
        "langwatch.output",
      ]);
      expect(IO_PREVIEW_BYTES).toBe(64 * 1024);
      expect(COMMAND_INLINE_THRESHOLD).toBe(256 * 1024);
    });
  });

  describe("when an oversized input is prepared for projection", () => {
    /** @scenario "an oversized input is previewed and left a pointer" */
    it("previews the value within the budget and leaves a pointer to the whole one", () => {
      const event = spanReceivedEvent([
        { key: "langwatch.input", value: { stringValue: overBudget } },
      ]);

      const leaned = leanForProjection(event) as unknown as {
        data: { span: { attributes: Array<{ key: string; value: { stringValue: string } }> } };
      };
      const attrs = Object.fromEntries(
        leaned.data.span.attributes.map((a) => [a.key, a.value.stringValue]),
      );

      // The byte cut backs off to a codepoint boundary and then appends the
      // ellipsis, so a preview is at most the budget plus that character.
      expect(Buffer.byteLength(attrs["langwatch.input"]!, "utf8")).toBe(IO_PREVIEW_BYTES + 3);
      expect(attrs["langwatch.input"]!.endsWith("\u2026")).toBe(true);
      expect(EVENTREF_ATTR_PREFIX).toBe("langwatch.reserved.eventref.");
      expect(attrs["langwatch.reserved.eventref.langwatch.input"]).toBe(
        '{"field":"langwatch.input","eventId":"evt_1"}',
      );
    });

    /** @scenario "the event the pipeline was handed is never altered" */
    it("leaves the original event carrying its full value", () => {
      const event = spanReceivedEvent([
        { key: "langwatch.input", value: { stringValue: overBudget } },
      ]);

      leanForProjection(event);

      const original = event as unknown as {
        data: { span: { attributes: Array<{ value: { stringValue: string } }> } };
      };
      expect(original.data.span.attributes[0]!.value.stringValue).toBe(overBudget);
      expect(original.data.span.attributes).toHaveLength(1);
    });
  });

  describe("when every attribute is inside the budget", () => {
    /** @scenario "a small event is passed straight through" */
    it("returns the very same event", () => {
      const event = spanReceivedEvent([
        { key: "langwatch.input", value: { stringValue: "small" } },
      ]);

      expect(leanForProjection(event)).toBe(event);
    });
  });

  describe("when an oversized log record body is prepared for projection", () => {
    /** @scenario "an oversized input is previewed and left a pointer" */
    it("previews the body and points at the event carrying it", () => {
      const event = {
        id: "evt_2",
        type: LOG_RECORD_RECEIVED_EVENT_TYPE,
        tenantId: "tenant-1",
        aggregateId: "trace-1",
        data: { body: overBudget, attributes: {} },
      } as never;

      const leaned = leanForProjection(event) as unknown as {
        data: { body: string; attributes: Record<string, string> };
      };

      expect(Buffer.byteLength(leaned.data.body, "utf8")).toBe(IO_PREVIEW_BYTES + 3);
      expect(leaned.data.attributes["langwatch.reserved.eventref.body"]).toBe(
        '{"field":"body","eventId":"evt_2"}',
      );
    });
  });
});
