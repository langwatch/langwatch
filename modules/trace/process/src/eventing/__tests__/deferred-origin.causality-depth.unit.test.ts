import { describe, expect, it } from "vitest";

import { TraceAttributeAccumulationService } from "../../services/trace-attribute-accumulation.service.ts";
import { TraceOriginService } from "../../services/trace-origin.service.ts";
import { needsOriginResolution } from "../deferred-origin.subscriber.ts";
import { createOtlpSpan, createSpanReceivedEvent } from "./trace-subscriber.fixtures.ts";
import { createInitState, createTestSpan } from "./trace-summary-test.fixtures.ts";

/** The trace's attributes after one span, through the real accumulation and origin services. */
function foldedAfter(spanAttributes: Record<string, string | number>): Record<string, string> {
  return TraceAttributeAccumulationService.create(TraceOriginService.create()).accumulateAttributes(
    {
      state: createInitState(),
      span: createTestSpan({ spanAttributes }),
      outputSource: "span",
      inputIsFallback: false,
      outputIsFallback: false,
      inputMediaRefs: null,
      outputMediaRefs: null,
    },
  );
}

/** Evaluation's loop guard reads the folded depth on origin_resolved; the fold must carry it. */
describe("the causality depth, as the summary fold carries it", () => {
  describe("given an evaluator's span with an origin", () => {
    it("folds the depth into the trace's attributes", () => {
      const attributes = foldedAfter({
        "langwatch.origin": "evaluation",
        "langwatch.reserved.causality_depth": 1,
      });

      expect(attributes["langwatch.reserved.causality_depth"]).toBe("1");
    });
  });

  describe("given a span another library started inside an evaluator run", () => {
    it("folds the depth with no origin, so origin resolution runs", () => {
      const attributes = foldedAfter({ "langwatch.reserved.causality_depth": 1 });

      expect(attributes["langwatch.origin"]).toBeUndefined();
      expect(attributes["langwatch.reserved.causality_depth"]).toBe("1");
      const state = { ...createInitState(), attributes };
      expect(
        needsOriginResolution({
          event: createSpanReceivedEvent(createOtlpSpan(), { occurredAt: Date.now() }),
          foldState: state,
        }),
      ).toBe(true);
    });
  });
});
