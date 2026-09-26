/**
 * @vitest-environment node
 *
 * Pins the labels contract of attribute accumulation: `tag.tags` (the
 * legacy OTLP reserved key, and what the Langy worker emits via
 * OPENCODE_RESOURCE_ATTRIBUTES) must fold into `langwatch.labels` — that's
 * the only key the trace filters/UI read. Regression: worker traces carried
 * tag.tags=langy in their attribute map but never showed the tag, because
 * this pipeline only honored langwatch.labels.
 *
 * Also pins that `langwatch.labels` arriving on RESOURCE attributes (the
 * shape produced by POST /api/collector and PATCH /api/traces/{id}/metadata,
 * where buildResource writes JSON.stringify(labels)) survives accumulation.
 * Regression: traces sent via those REST endpoints silently lost their
 * labels because extractAttributes only consulted spanAttrs for the key.
 */
import { describe, expect, it } from "vitest";

import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { NormalizedSpan } from "../../../schemas/spans";
import { TraceAttributeAccumulationService } from "../trace-attribute-accumulation.service";
import { TraceOriginService } from "../trace-origin.service";

function makeService() {
  return new TraceAttributeAccumulationService(
    // extractAttributes never touches the origin service.
    {} as TraceOriginService,
  );
}

function makeAccumulationService() {
  // accumulateAttributes does reach the origin service, so use the real one.
  return new TraceAttributeAccumulationService(new TraceOriginService());
}

function makeSpan(
  overrides: Partial<
    Pick<NormalizedSpan, "spanAttributes" | "resourceAttributes">
  > = {},
): NormalizedSpan {
  return {
    spanAttributes: {},
    resourceAttributes: {},
    ...overrides,
  } as NormalizedSpan;
}

describe("TraceAttributeAccumulationService.extractAttributes", () => {
  describe("when the resource carries tag.tags (Langy worker shape)", () => {
    it("folds it into langwatch.labels", () => {
      const result = makeService().extractAttributes(
        makeSpan({ resourceAttributes: { "tag.tags": "langy" } }),
      );
      expect(JSON.parse(result["langwatch.labels"]!)).toEqual(["langy"]);
    });
  });

  describe("when tag.tags is a comma-separated list", () => {
    it("splits and trims into individual labels", () => {
      const result = makeService().extractAttributes(
        makeSpan({ spanAttributes: { "tag.tags": "langy, prod , beta" } }),
      );
      expect(JSON.parse(result["langwatch.labels"]!)).toEqual([
        "langy",
        "prod",
        "beta",
      ]);
    });
  });

  describe("when both langwatch.labels and tag.tags are present", () => {
    it("unions them without duplicates", () => {
      const result = makeService().extractAttributes(
        makeSpan({
          spanAttributes: {
            "langwatch.labels": JSON.stringify(["langy", "manual"]),
            "tag.tags": "langy,extra",
          },
        }),
      );
      expect(JSON.parse(result["langwatch.labels"]!).sort()).toEqual(
        ["extra", "langy", "manual"].sort(),
      );
    });
  });

  describe("when langwatch.labels arrives as a resource attribute (REST /api/collector and PATCH /api/traces/{id}/metadata path)", () => {
    // buildResource writes JSON.stringify(labels) as a RESOURCE attribute
    // (string form); SpanNormalizationPipelineService.decodeOtlpSpan then
    // runs resourceAttributes through normalizeOtlpAttributes →
    // parseJsonStringValues, which decodes the JSON string back to an
    // array. extractAttributes must honor BOTH the array form and the
    // raw string form on resourceAttrs — see issue #5317.
    it("hoists a JSON-parsed array to langwatch.labels", () => {
      const result = makeService().extractAttributes(
        makeSpan({
          resourceAttributes: {
            "langwatch.labels": ["env:prod", "version:1.0"],
          },
        }),
      );
      expect(JSON.parse(result["langwatch.labels"]!)).toEqual([
        "env:prod",
        "version:1.0",
      ]);
    });

    it("hoists a JSON string label (pre-parseJsonStringValues shape)", () => {
      // Mirrors what buildResource emits before normalization decodes it.
      const result = makeService().extractAttributes(
        makeSpan({
          resourceAttributes: {
            "langwatch.labels": '["foo","bar"]',
          },
        }),
      );
      expect(result["langwatch.labels"]).toBe('["foo","bar"]');
    });

    it("hoists a plain string label", () => {
      const result = makeService().extractAttributes(
        makeSpan({
          resourceAttributes: { "langwatch.labels": "single-label" },
        }),
      );
      expect(result["langwatch.labels"]).toBe("single-label");
    });
  });

  describe("when langwatch.labels is present on both span and resource attrs", () => {
    it("prefers the span-level value", () => {
      const result = makeService().extractAttributes(
        makeSpan({
          spanAttributes: { "langwatch.labels": ["span-label"] },
          resourceAttributes: { "langwatch.labels": ["resource-label"] },
        }),
      );
      expect(JSON.parse(result["langwatch.labels"]!)).toEqual(["span-label"]);
    });
  });

  describe("when resource-level langwatch.labels and tag.tags both exist", () => {
    it("unions them without duplicates", () => {
      const result = makeService().extractAttributes(
        makeSpan({
          resourceAttributes: {
            "langwatch.labels": ["a"],
            "tag.tags": "b",
          },
        }),
      );
      expect(JSON.parse(result["langwatch.labels"]!).sort()).toEqual(
        ["a", "b"].sort(),
      );
    });
  });

  describe("when neither labels key is present", () => {
    it("leaves langwatch.labels unset", () => {
      const result = makeService().extractAttributes(makeSpan());
      expect(result["langwatch.labels"]).toBeUndefined();
    });
  });
});

/**
 * The Vercel AI SDK flattens `experimental_telemetry.metadata` onto every span
 * it emits as `ai.telemetry.metadata.<key>`. The trace summary read
 * `langwatch.*`, `gen_ai.*` and `tag.tags` only, so a Vercel AI call tagged
 * through the SDK's own metadata channel reached the product with no labels,
 * no user, no conversation and no custom keys.
 */
describe("TraceAttributeAccumulationService and the Vercel AI SDK metadata channel", () => {
  describe("when a span carries ai.telemetry.metadata.labels", () => {
    /** @scenario "Labels passed to experimental_telemetry reach the trace" */
    it("folds them into langwatch.labels", () => {
      const result = makeService().extractAttributes(
        makeSpan({
          spanAttributes: {
            "ai.telemetry.metadata.labels": ["checkout", "beta"],
          },
        }),
      );
      expect(JSON.parse(result["langwatch.labels"]!)).toEqual([
        "checkout",
        "beta",
      ]);
    });

    /** @scenario "Vercel labels join labels sent by another span of the same trace" */
    it("unions them with langwatch.labels without duplicates", () => {
      const result = makeService().extractAttributes(
        makeSpan({
          spanAttributes: {
            "langwatch.labels": ["prod", "checkout"],
            "ai.telemetry.metadata.labels": ["checkout"],
          },
        }),
      );
      expect(JSON.parse(result["langwatch.labels"]!).sort()).toEqual([
        "checkout",
        "prod",
      ]);
    });
  });

  describe("when a span carries the identity metadata keys", () => {
    /** @scenario "A user id passed to experimental_telemetry identifies the trace" */
    it("fills the trace user id", () => {
      const result = makeService().extractAttributes(
        makeSpan({
          spanAttributes: { "ai.telemetry.metadata.user_id": "user-42" },
        }),
      );
      expect(result["langwatch.user_id"]).toBe("user-42");
    });

    /** @scenario "A thread id passed to experimental_telemetry groups the conversation" */
    it("fills the conversation id", () => {
      const result = makeService().extractAttributes(
        makeSpan({
          spanAttributes: { "ai.telemetry.metadata.thread_id": "thread-9" },
        }),
      );
      expect(result["gen_ai.conversation.id"]).toBe("thread-9");
    });

    /** @scenario "A customer id passed to experimental_telemetry reaches the trace" */
    it("fills the customer id", () => {
      const result = makeService().extractAttributes(
        makeSpan({
          spanAttributes: { "ai.telemetry.metadata.customer_id": "acme" },
        }),
      );
      expect(result["langwatch.customer_id"]).toBe("acme");
    });

    /** @scenario "The camelCase spelling of an identity key is accepted" */
    it("accepts the camelCase spelling", () => {
      const result = makeService().extractAttributes(
        makeSpan({
          spanAttributes: { "ai.telemetry.metadata.threadId": "thread-9" },
        }),
      );
      expect(result["gen_ai.conversation.id"]).toBe("thread-9");
    });
  });

  describe("when a span carries a metadata key that is not reserved", () => {
    /** @scenario "A key that is not reserved becomes custom trace metadata" */
    it("keeps it as custom trace metadata", () => {
      const result = makeService().extractAttributes(
        makeSpan({
          spanAttributes: { "ai.telemetry.metadata.tenant": "eu-west" },
        }),
      );
      expect(result["metadata.tenant"]).toBe("eu-west");
    });

    /** @scenario "A non-string value keeps its own shape in custom metadata" */
    it("writes a number as its own text", () => {
      const result = makeService().extractAttributes(
        makeSpan({
          spanAttributes: { "ai.telemetry.metadata.retry_count": 3 },
        }),
      );
      expect(result["metadata.retry_count"]).toBe("3");
    });
  });

  describe("when the same value arrives on both channels", () => {
    /** @scenario "An explicit LangWatch attribute wins over the Vercel channel" */
    it("keeps the explicit LangWatch value", () => {
      const result = makeService().extractAttributes(
        makeSpan({
          spanAttributes: {
            "langwatch.user.id": "explicit-user",
            "ai.telemetry.metadata.user_id": "vercel-user",
          },
        }),
      );
      expect(result["langwatch.user_id"]).toBe("explicit-user");
    });

    /** @scenario "An explicit custom metadata attribute wins over the Vercel channel" */
    it("keeps the explicit custom metadata value", () => {
      const result = makeService().extractAttributes(
        makeSpan({
          spanAttributes: {
            "metadata.tenant": "explicit",
            "ai.telemetry.metadata.tenant": "vercel",
          },
        }),
      );
      expect(result["metadata.tenant"]).toBe("explicit");
    });
  });

  describe("when a span carries Vercel telemetry keys that are not metadata", () => {
    /** @scenario "The Vercel telemetry keys that are not metadata are left alone" */
    it("leaves them out of trace metadata", () => {
      const result = makeService().extractAttributes(
        makeSpan({
          spanAttributes: {
            "ai.telemetry.functionId": "checkout-flow",
            "ai.model.id": "gpt-5-mini",
          },
        }),
      );
      expect(result["metadata.functionId"]).toBeUndefined();
      expect(
        Object.keys(result).filter((key) => key.startsWith("metadata.")),
      ).toEqual([]);
    });
  });

  describe("when a span carries a causality depth", () => {
    /**
     * The evaluation-trigger loop guard reads this key off the fold state on
     * events that carry no span payload (origin_resolved). If accumulation
     * drops it, evaluator-emitted traces dispatch unguarded and evaluate
     * their own output.
     */
    it("folds an integer depth into the trace attributes", () => {
      const result = makeService().extractAttributes(
        makeSpan({
          spanAttributes: { "langwatch.reserved.causality_depth": 1 },
        }),
      );
      expect(result["langwatch.reserved.causality_depth"]).toBe("1");
    });

    it("folds a string depth into the trace attributes", () => {
      const result = makeService().extractAttributes(
        makeSpan({
          spanAttributes: { "langwatch.reserved.causality_depth": "2" },
        }),
      );
      expect(result["langwatch.reserved.causality_depth"]).toBe("2");
    });

    it("drops a non-numeric depth", () => {
      const result = makeService().extractAttributes(
        makeSpan({
          spanAttributes: { "langwatch.reserved.causality_depth": "deep" },
        }),
      );
      expect(result["langwatch.reserved.causality_depth"]).toBeUndefined();
    });

    /**
     * Number("") and Number("  ") are both a finite 0, so a blank attribute
     * would otherwise be stored as a real depth of zero — metadata the span
     * never carried.
     */
    it.each([
      ["empty", ""],
      ["whitespace", "   "],
    ])("drops a %s depth rather than reading it as zero", (_label, value) => {
      const result = makeService().extractAttributes(
        makeSpan({
          spanAttributes: { "langwatch.reserved.causality_depth": value },
        }),
      );
      expect(result["langwatch.reserved.causality_depth"]).toBeUndefined();
    });

    it("drops a fractional depth, which is not a count of hops", () => {
      const result = makeService().extractAttributes(
        makeSpan({
          spanAttributes: { "langwatch.reserved.causality_depth": "1.5" },
        }),
      );
      expect(result["langwatch.reserved.causality_depth"]).toBeUndefined();
    });
  });
});

/**
 * A trace can carry both application spans (depth 0) and evaluator-emitted
 * spans (depth >= 1). The ordinary attribute merge is existing-wins, which
 * would let whichever span folded first pin the depth for the whole trace —
 * so an application span arriving before the evaluator's would hold the
 * trace at "0" and the loop guard would never fire on it. Depth answers
 * "has this trace been through the evaluator", so it only climbs.
 */
describe("TraceAttributeAccumulationService.accumulateAttributes", () => {
  function accumulate(
    existingDepth: string | undefined,
    incomingDepth: number | string | undefined,
  ): Record<string, string> {
    const attributes: Record<string, string> = {};
    if (existingDepth !== void 0) {
      attributes["langwatch.reserved.causality_depth"] = existingDepth;
    }
    const spanAttributes: Record<string, unknown> = {};
    if (incomingDepth !== void 0) {
      spanAttributes["langwatch.reserved.causality_depth"] = incomingDepth;
    }
    return makeAccumulationService().accumulateAttributes({
      state: { attributes } as unknown as TraceSummaryData,
      span: makeSpan({
        spanAttributes: spanAttributes as NormalizedSpan["spanAttributes"],
      }),
      outputSource: "span",
      inputIsFallback: false,
      outputIsFallback: false,
      inputMediaRefs: null,
      outputMediaRefs: null,
    });
  }

  describe("when a depth-0 span folded before the evaluator's depth-1 span", () => {
    /** @scenario "A trace keeps the highest evaluator depth any of its spans carried" */
    it("raises the trace to the evaluator depth", () => {
      const result = accumulate("0", 1);
      expect(result["langwatch.reserved.causality_depth"]).toBe("1");
    });
  });

  describe("when a depth-1 span folded before a later depth-0 span", () => {
    it("keeps the evaluator depth", () => {
      const result = accumulate("1", 0);
      expect(result["langwatch.reserved.causality_depth"]).toBe("1");
    });
  });

  describe("when only one side carries a depth", () => {
    it("takes the incoming depth when the trace has none", () => {
      expect(accumulate(void 0, 2)["langwatch.reserved.causality_depth"]).toBe(
        "2",
      );
    });

    it("keeps the trace depth when the span has none", () => {
      expect(
        accumulate("3", void 0)["langwatch.reserved.causality_depth"],
      ).toBe("3");
    });
  });

  describe("when neither side carries a depth", () => {
    it("leaves the key off the trace", () => {
      expect(
        accumulate(void 0, void 0)["langwatch.reserved.causality_depth"],
      ).toBeUndefined();
    });
  });
});
