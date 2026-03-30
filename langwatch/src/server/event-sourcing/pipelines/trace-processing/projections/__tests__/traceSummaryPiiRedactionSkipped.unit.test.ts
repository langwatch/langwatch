import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { TraceIOExtractionService } from "~/server/app-layer/traces/trace-io-extraction.service";
import { ATTR_KEYS } from "~/server/app-layer/traces/canonicalisation/extractors/_constants";
import { applySpanToSummary } from "../traceSummary.foldProjection";
import { createInitState, createTestSpan } from "./fixtures/trace-summary-test.fixtures";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";

const PARTIAL_KEY = ATTR_KEYS.LANGWATCH_RESERVED_PII_REDACTION_PARTIAL_SPAN_IDS;
const SKIPPED_KEY = ATTR_KEYS.LANGWATCH_RESERVED_PII_REDACTION_SKIPPED_SPAN_IDS;

function getPartialSpanIds(state: TraceSummaryData): string[] {
  const raw = state.attributes[PARTIAL_KEY];
  return raw ? (JSON.parse(raw) as string[]) : [];
}

function getSkippedSpanIds(state: TraceSummaryData): string[] {
  const raw = state.attributes[SKIPPED_KEY];
  return raw ? (JSON.parse(raw) as string[]) : [];
}

describe("applySpanToSummary PII redaction status tracking", () => {
  let extractSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    extractSpy = vi.spyOn(
      TraceIOExtractionService.prototype,
      "extractRichIOFromSpan",
    );
    extractSpy.mockReturnValue(null);
  });

  afterEach(() => {
    extractSpy.mockRestore();
  });

  describe("when span has pii_redaction_status = 'partial'", () => {
    it("collects the span ID in partial span IDs", () => {
      const span = createTestSpan({
        spanId: "partial-span-1",
        spanAttributes: {
          [ATTR_KEYS.LANGWATCH_RESERVED_PII_REDACTION_STATUS]: "partial",
        },
      });

      const result = applySpanToSummary({ state: createInitState(), span: span });

      expect(getPartialSpanIds(result)).toEqual(["partial-span-1"]);
      expect(getSkippedSpanIds(result)).toEqual([]);
    });
  });

  describe("when span has pii_redaction_status = 'none'", () => {
    it("collects the span ID in skipped span IDs", () => {
      const span = createTestSpan({
        spanId: "skipped-span-1",
        spanAttributes: {
          [ATTR_KEYS.LANGWATCH_RESERVED_PII_REDACTION_STATUS]: "none",
        },
      });

      const result = applySpanToSummary({ state: createInitState(), span: span });

      expect(getSkippedSpanIds(result)).toEqual(["skipped-span-1"]);
      expect(getPartialSpanIds(result)).toEqual([]);
    });
  });

  describe("when span does not have pii_redaction_status", () => {
    it("does not set either attribute", () => {
      const span = createTestSpan({
        spanId: "normal-span-1",
        spanAttributes: {},
      });

      const result = applySpanToSummary({ state: createInitState(), span: span });

      expect(result.attributes[PARTIAL_KEY]).toBeUndefined();
      expect(result.attributes[SKIPPED_KEY]).toBeUndefined();
    });
  });

  describe("when multiple spans are applied", () => {
    it("accumulates partial span IDs correctly", () => {
      const span1 = createTestSpan({
        spanId: "partial-1",
        spanAttributes: {
          [ATTR_KEYS.LANGWATCH_RESERVED_PII_REDACTION_STATUS]: "partial",
        },
      });
      const span2 = createTestSpan({
        spanId: "partial-2",
        spanAttributes: {
          [ATTR_KEYS.LANGWATCH_RESERVED_PII_REDACTION_STATUS]: "partial",
        },
      });

      let state = createInitState();
      state = applySpanToSummary({ state, span: span1 });
      state = applySpanToSummary({ state, span: span2 });

      expect(getPartialSpanIds(state)).toEqual(["partial-1", "partial-2"]);
    });

    it("accumulates skipped span IDs correctly", () => {
      const span1 = createTestSpan({
        spanId: "skipped-1",
        spanAttributes: {
          [ATTR_KEYS.LANGWATCH_RESERVED_PII_REDACTION_STATUS]: "none",
        },
      });
      const span2 = createTestSpan({
        spanId: "skipped-2",
        spanAttributes: {
          [ATTR_KEYS.LANGWATCH_RESERVED_PII_REDACTION_STATUS]: "none",
        },
      });

      let state = createInitState();
      state = applySpanToSummary({ state, span: span1 });
      state = applySpanToSummary({ state, span: span2 });

      expect(getSkippedSpanIds(state)).toEqual(["skipped-1", "skipped-2"]);
    });

    it("separates partial and fully-skipped spans in a mixed trace", () => {
      const partialSpan = createTestSpan({
        spanId: "partial-span",
        spanAttributes: {
          [ATTR_KEYS.LANGWATCH_RESERVED_PII_REDACTION_STATUS]: "partial",
        },
      });
      const skippedSpan = createTestSpan({
        spanId: "skipped-span",
        spanAttributes: {
          [ATTR_KEYS.LANGWATCH_RESERVED_PII_REDACTION_STATUS]: "none",
        },
      });
      const normalSpan = createTestSpan({
        spanId: "normal-span",
        spanAttributes: {},
      });

      let state = createInitState();
      state = applySpanToSummary({ state, span: partialSpan });
      state = applySpanToSummary({ state, span: skippedSpan });
      state = applySpanToSummary({ state, span: normalSpan });

      expect(getPartialSpanIds(state)).toEqual(["partial-span"]);
      expect(getSkippedSpanIds(state)).toEqual(["skipped-span"]);
    });
  });

  describe("when init state is created", () => {
    it("does not have either pii redaction attribute", () => {
      const state = createInitState();

      expect(state.attributes[PARTIAL_KEY]).toBeUndefined();
      expect(state.attributes[SKIPPED_KEY]).toBeUndefined();
    });
  });
});
