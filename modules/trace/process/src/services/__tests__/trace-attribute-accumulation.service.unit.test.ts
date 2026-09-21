import { ATTR_KEYS } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import {
  createInitState,
  createTestSpan,
} from "../../eventing/__tests__/trace-summary-test.fixtures.ts";
import { TraceAttributeAccumulationService } from "../trace-attribute-accumulation.service.ts";
import { TraceOriginService } from "../trace-origin.service.ts";

describe("TraceAttributeAccumulationService", () => {
  describe("given spans marked partial and fully-skipped by PII redaction", () => {
    /** @scenario "Trace summary separates partial and fully-skipped span IDs" */
    it("separates partial and fully-skipped span ids in the trace summary attributes", () => {
      const service = TraceAttributeAccumulationService.create(TraceOriginService.create());
      const state = createInitState();

      const partialSpan = createTestSpan({
        spanId: "span-1",
        spanAttributes: { [ATTR_KEYS.LANGWATCH_RESERVED_PII_REDACTION_STATUS]: "partial" },
      });
      state.attributes = service.accumulateAttributes({
        state,
        span: partialSpan,
        outputSource: "test",
        inputIsFallback: false,
        outputIsFallback: false,
        inputMediaRefs: null,
        outputMediaRefs: null,
      });

      const noneSpan = createTestSpan({
        spanId: "span-2",
        spanAttributes: { [ATTR_KEYS.LANGWATCH_RESERVED_PII_REDACTION_STATUS]: "none" },
      });
      state.attributes = service.accumulateAttributes({
        state,
        span: noneSpan,
        outputSource: "test",
        inputIsFallback: false,
        outputIsFallback: false,
        inputMediaRefs: null,
        outputMediaRefs: null,
      });

      const untouchedSpan = createTestSpan({ spanId: "span-3" });
      state.attributes = service.accumulateAttributes({
        state,
        span: untouchedSpan,
        outputSource: "test",
        inputIsFallback: false,
        outputIsFallback: false,
        inputMediaRefs: null,
        outputMediaRefs: null,
      });

      expect(
        JSON.parse(state.attributes[ATTR_KEYS.LANGWATCH_RESERVED_PII_REDACTION_PARTIAL_SPAN_IDS]!),
      ).toEqual(["span-1"]);
      expect(
        JSON.parse(state.attributes[ATTR_KEYS.LANGWATCH_RESERVED_PII_REDACTION_SKIPPED_SPAN_IDS]!),
      ).toEqual(["span-2"]);
    });
  });

  describe("given spans mixing application and evaluator-emitted causality depths", () => {
    /** @scenario "A trace keeps the highest evaluator depth any of its spans carried" */
    it("keeps the highest depth regardless of which span folds first", () => {
      const service = TraceAttributeAccumulationService.create(TraceOriginService.create());
      const state = createInitState();

      const applicationSpan = createTestSpan({
        spanId: "span-1",
        spanAttributes: { "langwatch.reserved.causality_depth": 0 },
      });
      state.attributes = service.accumulateAttributes({
        state,
        span: applicationSpan,
        outputSource: "test",
        inputIsFallback: false,
        outputIsFallback: false,
        inputMediaRefs: null,
        outputMediaRefs: null,
      });

      const evaluatorSpan = createTestSpan({
        spanId: "span-2",
        spanAttributes: { "langwatch.reserved.causality_depth": 1 },
      });
      state.attributes = service.accumulateAttributes({
        state,
        span: evaluatorSpan,
        outputSource: "test",
        inputIsFallback: false,
        outputIsFallback: false,
        inputMediaRefs: null,
        outputMediaRefs: null,
      });

      expect(state.attributes["langwatch.reserved.causality_depth"]).toBe("1");
    });
  });
});
