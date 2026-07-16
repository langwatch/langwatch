/**
 * Regression tests for false-positive truncation flags (issue #5835).
 *
 * Bug: fold-excluded spans (tool/evaluation/guardrail) carrying eventrefs that
 * resolve successfully set `inputHadRef`/`outputHadRef`, but `recomputeTraceIO`
 * never considers them (fold's exclusion rules), so recomputedInput/Output = null.
 * The original logic flagged truncated = true despite stored preview being complete.
 *
 * Fix: gate each flag on BOTH conditions:
 * - eventref existed (inputHadRef/outputHadRef)
 * - AND stored preview for that direction was non-empty (stored.computedInput !== null)
 *
 * If stored.computedInput is null, there was NO preview content to complete — no
 * truncation to warn about.
 */
import { describe, expect, it } from "vitest";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { NormalizedSpan } from "~/server/event-sourcing/pipelines/trace-processing/schemas/spans";
import { ATTR_KEYS } from "~/server/app-layer/traces/canonicalisation/extractors/_constants";
import { EVENTREF_ATTR_PREFIX } from "~/server/app-layer/traces/lean-for-projection";
import { overlayResolvedIO } from "../offload-truncation-detection";
import type { ResolvedTraceSpans } from "../resolve-offloaded-traces";

describe("overlayResolvedIO", () => {
  describe("when fold-excluded span with eventref resolves successfully", () => {
    it("does not flag inputTruncated if stored.computedInput is non-null but recomputedInput is null", () => {
      const stored: TraceSummaryData = {
        traceId: "trace-1",
        computedInput: JSON.stringify({ message: "Complete input" }),
        computedOutput: null,
        inputTruncated: false,
        outputTruncated: false,
      } as TraceSummaryData;

      // Fold-excluded span (tool type) with eventref in input
      const originalSpans: NormalizedSpan[] = [
        {
          spanId: "span-tool-1",
          spanAttributes: {
            [ATTR_KEYS.LANGWATCH_INPUT]: JSON.stringify({ preview: "..." }),
            [`${EVENTREF_ATTR_PREFIX}${ATTR_KEYS.LANGWATCH_INPUT}`]: JSON.stringify({
              eventId: "evt-1",
            }),
          },
          spanKind: "tool",
        } as unknown as NormalizedSpan,
      ];

      // Eventref resolved but recomputeTraceIO returns null for input (fold excluded)
      const resolved: ResolvedTraceSpans = {
        resolvedSpans: [],
        anyResolved: true,
        recomputedInput: null, // fold-excluded span's result
        recomputedOutput: null,
      };

      const result = overlayResolvedIO(stored, originalSpans, resolved);

      // Should NOT flag inputTruncated — stored value is complete
      expect(result.inputTruncated).toBe(false);
      expect(result.outputTruncated).toBe(false);
      // Should preserve stored preview since recomputed is null
      expect(result.computedInput).toBe(stored.computedInput);
    });

    it("does not flag outputTruncated if stored.computedOutput is non-null but recomputedOutput is null", () => {
      const stored: TraceSummaryData = {
        traceId: "trace-2",
        computedInput: null,
        computedOutput: JSON.stringify({ result: "Complete output" }),
        inputTruncated: false,
        outputTruncated: false,
      } as TraceSummaryData;

      // Fold-excluded span (evaluation type) with eventref in output
      const originalSpans: NormalizedSpan[] = [
        {
          spanId: "span-eval-1",
          spanAttributes: {
            [ATTR_KEYS.LANGWATCH_OUTPUT]: JSON.stringify({ preview: "..." }),
            [`${EVENTREF_ATTR_PREFIX}${ATTR_KEYS.LANGWATCH_OUTPUT}`]: JSON.stringify({
              eventId: "evt-2",
            }),
          },
          spanKind: "evaluation",
        } as unknown as NormalizedSpan,
      ];

      const resolved: ResolvedTraceSpans = {
        resolvedSpans: [],
        anyResolved: true,
        recomputedInput: null,
        recomputedOutput: null, // fold-excluded span's result
      };

      const result = overlayResolvedIO(stored, originalSpans, resolved);

      expect(result.inputTruncated).toBe(false);
      expect(result.outputTruncated).toBe(false);
      expect(result.computedOutput).toBe(stored.computedOutput);
    });
  });

  describe("when all eventrefs fail to resolve", () => {
    it("flags inputTruncated when stored preview exists and no resolution succeeded", () => {
      const stored: TraceSummaryData = {
        traceId: "trace-3",
        computedInput: JSON.stringify({ preview: "Truncated..." }),
        computedOutput: null,
        inputTruncated: false,
        outputTruncated: false,
      } as TraceSummaryData;

      // Fold-winner span (llm type) with eventref that fails to resolve
      const originalSpans: NormalizedSpan[] = [
        {
          spanId: "span-llm-1",
          spanAttributes: {
            [ATTR_KEYS.GEN_AI_INPUT_MESSAGES]: JSON.stringify({ preview: "..." }),
            [`${EVENTREF_ATTR_PREFIX}${ATTR_KEYS.GEN_AI_INPUT_MESSAGES}`]: JSON.stringify({
              eventId: "evt-missing",
            }),
          },
          spanKind: "llm",
        } as unknown as NormalizedSpan,
      ];

      // Resolution failed (anyResolved = false or recomputedInput = null)
      const resolved: ResolvedTraceSpans = {
        resolvedSpans: [],
        anyResolved: false,
        recomputedInput: null,
        recomputedOutput: null,
      };

      const result = overlayResolvedIO(stored, originalSpans, resolved);

      // SHOULD flag inputTruncated — stored preview incomplete, resolution failed
      expect(result.inputTruncated).toBe(true);
      expect(result.outputTruncated).toBe(false);
      // Should preserve stored preview since resolution failed
      expect(result.computedInput).toBe(stored.computedInput);
    });

    it("flags outputTruncated when stored preview exists and no resolution succeeded", () => {
      const stored: TraceSummaryData = {
        traceId: "trace-4",
        computedInput: null,
        computedOutput: JSON.stringify({ preview: "Truncated result..." }),
        inputTruncated: false,
        outputTruncated: false,
      } as TraceSummaryData;

      const originalSpans: NormalizedSpan[] = [
        {
          spanId: "span-llm-2",
          spanAttributes: {
            [ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES]: JSON.stringify({ preview: "..." }),
            [`${EVENTREF_ATTR_PREFIX}${ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES}`]: JSON.stringify({
              eventId: "evt-missing-2",
            }),
          },
          spanKind: "llm",
        } as unknown as NormalizedSpan,
      ];

      const resolved: ResolvedTraceSpans = {
        resolvedSpans: [],
        anyResolved: false, // no resolution succeeded
        recomputedInput: null,
        recomputedOutput: null,
      };

      const result = overlayResolvedIO(stored, originalSpans, resolved);

      expect(result.inputTruncated).toBe(false);
      expect(result.outputTruncated).toBe(true);
      expect(result.computedOutput).toBe(stored.computedOutput);
    });
  });

  describe("when no stored preview exists", () => {
    it("does not flag inputTruncated if stored.computedInput is null even when eventref fails", () => {
      const stored: TraceSummaryData = {
        traceId: "trace-5",
        computedInput: null, // No stored preview
        computedOutput: null,
        inputTruncated: false,
        outputTruncated: false,
      } as TraceSummaryData;

      // Span with eventref that fails to resolve
      const originalSpans: NormalizedSpan[] = [
        {
          spanId: "span-6",
          spanAttributes: {
            [`${EVENTREF_ATTR_PREFIX}${ATTR_KEYS.LANGWATCH_INPUT}`]: JSON.stringify({
              eventId: "evt-missing-3",
            }),
          },
          spanKind: "llm",
        } as unknown as NormalizedSpan,
      ];

      const resolved: ResolvedTraceSpans = {
        resolvedSpans: [],
        anyResolved: false,
        recomputedInput: null,
        recomputedOutput: null,
      };

      const result = overlayResolvedIO(stored, originalSpans, resolved);

      // Should NOT flag inputTruncated — no preview to complete
      expect(result.inputTruncated).toBe(false);
      expect(result.outputTruncated).toBe(false);
      expect(result.computedInput).toBeNull();
    });

    it("does not flag outputTruncated if stored.computedOutput is null even when eventref fails", () => {
      const stored: TraceSummaryData = {
        traceId: "trace-6",
        computedInput: null,
        computedOutput: null, // No stored preview
        inputTruncated: false,
        outputTruncated: false,
      } as TraceSummaryData;

      const originalSpans: NormalizedSpan[] = [
        {
          spanId: "span-7",
          spanAttributes: {
            [`${EVENTREF_ATTR_PREFIX}${ATTR_KEYS.LANGWATCH_OUTPUT}`]: JSON.stringify({
              eventId: "evt-missing-4",
            }),
          },
          spanKind: "llm",
        } as unknown as NormalizedSpan,
      ];

      const resolved: ResolvedTraceSpans = {
        resolvedSpans: [],
        anyResolved: false,
        recomputedInput: null,
        recomputedOutput: null,
      };

      const result = overlayResolvedIO(stored, originalSpans, resolved);

      expect(result.inputTruncated).toBe(false);
      expect(result.outputTruncated).toBe(false);
      expect(result.computedOutput).toBeNull();
    });
  });

  describe("when eventref resolves successfully and recomputed value is available", () => {
    it("overlays recomputedInput and does not flag truncated", () => {
      const stored: TraceSummaryData = {
        traceId: "trace-7",
        computedInput: JSON.stringify({ preview: "Truncated..." }),
        computedOutput: null,
        inputTruncated: false,
        outputTruncated: false,
      } as TraceSummaryData;

      const originalSpans: NormalizedSpan[] = [
        {
          spanId: "span-8",
          spanAttributes: {
            [ATTR_KEYS.LANGWATCH_INPUT]: JSON.stringify({ preview: "..." }),
            [`${EVENTREF_ATTR_PREFIX}${ATTR_KEYS.LANGWATCH_INPUT}`]: JSON.stringify({
              eventId: "evt-success",
            }),
          },
          spanKind: "llm",
        } as unknown as NormalizedSpan,
      ];

      const fullInput = JSON.stringify({ full: "Complete input content" });
      const resolved: ResolvedTraceSpans = {
        resolvedSpans: [],
        anyResolved: true,
        recomputedInput: { raw: fullInput, text: fullInput, source: "langwatch" },
        recomputedOutput: null,
      };

      const result = overlayResolvedIO(stored, originalSpans, resolved);

      // Should overlay the full content and NOT flag truncated
      expect(result.inputTruncated).toBe(false);
      expect(result.outputTruncated).toBe(false);
      expect(result.computedInput).toBe(fullInput);
    });

    it("overlays recomputedOutput and does not flag truncated", () => {
      const stored: TraceSummaryData = {
        traceId: "trace-8",
        computedInput: null,
        computedOutput: JSON.stringify({ preview: "Truncated..." }),
        inputTruncated: false,
        outputTruncated: false,
      } as TraceSummaryData;

      const originalSpans: NormalizedSpan[] = [
        {
          spanId: "span-9",
          spanAttributes: {
            [ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES]: JSON.stringify({ preview: "..." }),
            [`${EVENTREF_ATTR_PREFIX}${ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES}`]: JSON.stringify({
              eventId: "evt-success-2",
            }),
          },
          spanKind: "llm",
        } as unknown as NormalizedSpan,
      ];

      const fullOutput = JSON.stringify({ full: "Complete output content" });
      const resolved: ResolvedTraceSpans = {
        resolvedSpans: [],
        anyResolved: true,
        recomputedInput: null,
        recomputedOutput: { raw: fullOutput, text: fullOutput, source: "langwatch" },
      };

      const result = overlayResolvedIO(stored, originalSpans, resolved);

      expect(result.inputTruncated).toBe(false);
      expect(result.outputTruncated).toBe(false);
      expect(result.computedOutput).toBe(fullOutput);
    });
  });
});
