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

import type { NormalizedSpan } from "../../../schemas/spans";
import { TraceAttributeAccumulationService } from "../trace-attribute-accumulation.service";
import type { TraceOriginService } from "../trace-origin.service";

function makeService() {
  return new TraceAttributeAccumulationService(
    // extractAttributes never touches the origin service.
    {} as TraceOriginService,
  );
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
