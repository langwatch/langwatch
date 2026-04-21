import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TraceIOExtractionService } from "~/server/app-layer/traces/trace-io-extraction.service";
import { applySpanToSummary } from "../traceSummary.foldProjection";
import { createInitState, createTestSpan } from "./fixtures/trace-summary-test.fixtures";

describe("applySpanToSummary() trace name extraction", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(99999);
    vi.spyOn(
      TraceIOExtractionService.prototype,
      "extractRichIOFromSpan",
    ).mockReturnValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("when root span has a name", () => {
    it("populates traceName from root span", () => {
      const span = createTestSpan({
        parentSpanId: null,
        name: "OrderProcessingAgent",
      });

      const state = applySpanToSummary({ state: createInitState(), span });

      expect(state.traceName).toBe("OrderProcessingAgent");
    });
  });

  describe("when root span has an empty name", () => {
    it("defaults traceName to empty string", () => {
      const span = createTestSpan({
        parentSpanId: null,
        name: "",
      });

      const state = applySpanToSummary({ state: createInitState(), span });

      expect(state.traceName).toBe("");
    });
  });

  describe("when child span arrives after root span", () => {
    it("preserves traceName from root span", () => {
      const rootSpan = createTestSpan({
        id: "root-1",
        spanId: "root-1",
        parentSpanId: null,
        name: "OrderAgent",
        startTimeUnixMs: 1000,
      });

      const childSpan = createTestSpan({
        id: "child-1",
        spanId: "child-1",
        parentSpanId: "root-1",
        name: "child-operation",
        startTimeUnixMs: 1500,
      });

      let state = applySpanToSummary({ state: createInitState(), span: rootSpan });
      state = applySpanToSummary({ state, span: childSpan });

      expect(state.traceName).toBe("OrderAgent");
    });
  });

  describe("when child span arrives before root span", () => {
    it("sets traceName when root span arrives later", () => {
      const childSpan = createTestSpan({
        id: "child-1",
        spanId: "child-1",
        parentSpanId: "root-1",
        name: "child-operation",
        startTimeUnixMs: 1500,
      });

      const rootSpan = createTestSpan({
        id: "root-1",
        spanId: "root-1",
        parentSpanId: null,
        name: "OrderAgent",
        startTimeUnixMs: 1000,
      });

      let state = applySpanToSummary({ state: createInitState(), span: childSpan });
      expect(state.traceName).toBe("");

      state = applySpanToSummary({ state, span: rootSpan });
      expect(state.traceName).toBe("OrderAgent");
    });
  });

  describe("when multiple root spans exist", () => {
    it("uses the root span with earliest start time", () => {
      const laterRoot = createTestSpan({
        id: "root-2",
        spanId: "root-2",
        parentSpanId: null,
        name: "manual-handler",
        startTimeUnixMs: 2000,
      });

      const earlierRoot = createTestSpan({
        id: "root-1",
        spanId: "root-1",
        parentSpanId: null,
        name: "auto-instrumented-GET",
        startTimeUnixMs: 1000,
      });

      // Process later root first
      let state = applySpanToSummary({ state: createInitState(), span: laterRoot });
      expect(state.traceName).toBe("manual-handler");

      // Earlier root arrives later — should overwrite
      state = applySpanToSummary({ state, span: earlierRoot });
      expect(state.traceName).toBe("auto-instrumented-GET");
    });

    it("keeps earlier root name when later root arrives second", () => {
      const earlierRoot = createTestSpan({
        id: "root-1",
        spanId: "root-1",
        parentSpanId: null,
        name: "auto-instrumented-GET",
        startTimeUnixMs: 1000,
      });

      const laterRoot = createTestSpan({
        id: "root-2",
        spanId: "root-2",
        parentSpanId: null,
        name: "manual-handler",
        startTimeUnixMs: 2000,
      });

      // Process earlier root first
      let state = applySpanToSummary({ state: createInitState(), span: earlierRoot });
      expect(state.traceName).toBe("auto-instrumented-GET");

      // Later root arrives — should NOT overwrite
      state = applySpanToSummary({ state, span: laterRoot });
      expect(state.traceName).toBe("auto-instrumented-GET");
    });
  });
});
