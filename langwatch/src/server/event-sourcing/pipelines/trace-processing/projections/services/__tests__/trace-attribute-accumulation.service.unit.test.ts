/**
 * @vitest-environment node
 *
 * Pins the labels contract of attribute accumulation: `tag.tags` (the
 * legacy OTLP reserved key, and what the Langy worker emits via
 * OPENCODE_RESOURCE_ATTRIBUTES) must fold into `langwatch.labels` — that's
 * the only key the trace filters/UI read. Regression: worker traces carried
 * tag.tags=langy in their attribute map but never showed the tag, because
 * this pipeline only honored langwatch.labels.
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

  describe("when neither labels key is present", () => {
    it("leaves langwatch.labels unset", () => {
      const result = makeService().extractAttributes(makeSpan());
      expect(result["langwatch.labels"]).toBeUndefined();
    });
  });
});
