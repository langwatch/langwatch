import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TraceIOExtractionService } from "~/server/app-layer/traces/trace-io-extraction.service";
import { createTenantId } from "~/server/event-sourcing";
import {
  TRACE_NAME_CHANGED_EVENT_TYPE,
  TRACE_NAME_CHANGED_EVENT_VERSION_LATEST,
} from "../../schemas/constants";
import type { TraceNameChangedEvent } from "../../schemas/events";
import {
  applySpanToSummary,
  TraceSummaryFoldProjection,
} from "../traceSummary.foldProjection";
import { createInitState, createTestSpan } from "./fixtures/trace-summary-test.fixtures";

function makeTraceNameChangedEvent({
  newName,
  changedByUserId = null,
}: {
  newName: string;
  changedByUserId?: string | null;
}): TraceNameChangedEvent {
  return {
    id: `evt-rename-${newName}`,
    type: TRACE_NAME_CHANGED_EVENT_TYPE,
    version: TRACE_NAME_CHANGED_EVENT_VERSION_LATEST,
    aggregateType: "trace",
    aggregateId: "trace-1",
    tenantId: createTenantId("tenant-1"),
    createdAt: Date.now(),
    occurredAt: Date.now(),
    data: { traceId: "trace-1", newName, changedByUserId },
    metadata: {},
  };
}

function makeProjection() {
  const store = {
    store: async () => {},
    get: async () => null,
  };
  return new TraceSummaryFoldProjection({ store });
}

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
    /** @scenario Trace projection populates TraceName from root span */
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
    /** @scenario Trace projection defaults TraceName when root span has no name */
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
    /** @scenario TraceName is preserved when child spans arrive after root */
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
    /** @scenario Multiple root spans use earliest start time */
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

    it("lets a named later root upgrade an empty-named earlier root", () => {
      const emptyNameRoot = createTestSpan({
        id: "root-1",
        spanId: "root-1",
        parentSpanId: null,
        name: "",
        startTimeUnixMs: 1000,
      });

      const namedRoot = createTestSpan({
        id: "root-2",
        spanId: "root-2",
        parentSpanId: null,
        name: "OrderAgent",
        startTimeUnixMs: 2000,
      });

      // Empty-name root arrives first
      let state = applySpanToSummary({ state: createInitState(), span: emptyNameRoot });
      expect(state.traceName).toBe("");

      // Named root arrives later — should upgrade from empty
      state = applySpanToSummary({ state, span: namedRoot });
      expect(state.traceName).toBe("OrderAgent");
    });

    it("does not let a later empty-named root overwrite an earlier named root", () => {
      const namedRoot = createTestSpan({
        id: "root-1",
        spanId: "root-1",
        parentSpanId: null,
        name: "OrderAgent",
        startTimeUnixMs: 1000,
      });

      const emptyNameRoot = createTestSpan({
        id: "root-2",
        spanId: "root-2",
        parentSpanId: null,
        name: "",
        startTimeUnixMs: 2000,
      });

      let state = applySpanToSummary({ state: createInitState(), span: namedRoot });
      expect(state.traceName).toBe("OrderAgent");

      // Later empty-named root should NOT overwrite
      state = applySpanToSummary({ state, span: emptyNameRoot });
      expect(state.traceName).toBe("OrderAgent");
    });
  });

  describe("when the user emits a TraceNameChanged event", () => {
    it("overrides the existing trace name", () => {
      const projection = makeProjection();
      const root = createTestSpan({
        id: "root-1",
        spanId: "root-1",
        parentSpanId: null,
        name: "OrderAgent",
        startTimeUnixMs: 1000,
      });
      let state = applySpanToSummary({ state: createInitState(), span: root });
      expect(state.traceName).toBe("OrderAgent");

      state = projection.apply(
        state,
        makeTraceNameChangedEvent({ newName: "Customer support — high priority" }),
      );

      expect(state.traceName).toBe("Customer support — high priority");
      expect(state.traceNameUserOverridden).toBe(true);
    });

    it("survives a later root-span arrival that would otherwise overwrite the name", () => {
      // The original bug: a delayed earlier root span landing post-rename
      // wiped the user's edit because the projection unconditionally
      // overwrote `traceName` whenever a "better" root span arrived. Pin
      // the latch so the rename sticks.
      const projection = makeProjection();
      const lateRoot = createTestSpan({
        id: "root-1",
        spanId: "root-1",
        parentSpanId: null,
        name: "auto-instrumented-GET",
        startTimeUnixMs: 2000,
      });
      let state = applySpanToSummary({ state: createInitState(), span: lateRoot });
      expect(state.traceName).toBe("auto-instrumented-GET");

      state = projection.apply(
        state,
        makeTraceNameChangedEvent({ newName: "Manually labelled trace" }),
      );
      expect(state.traceName).toBe("Manually labelled trace");

      // Earlier-named root span shows up after the rename — without the
      // override latch, this would silently revert the user's edit.
      const earlierRoot = createTestSpan({
        id: "root-2",
        spanId: "root-2",
        parentSpanId: null,
        name: "auto-instrumented-POST",
        startTimeUnixMs: 1000,
      });
      state = applySpanToSummary({ state, span: earlierRoot });

      expect(state.traceName).toBe("Manually labelled trace");
      expect(state.traceNameUserOverridden).toBe(true);
      // rootSpanType still updates from the discovered span — the latch
      // only protects the user-facing name.
      expect(state.rootSpanStartTimeMs).toBe(1000);
    });

    it("can be replayed multiple times with the latest value winning", () => {
      const projection = makeProjection();
      let state = createInitState();

      state = projection.apply(
        state,
        makeTraceNameChangedEvent({ newName: "First rename" }),
      );
      state = projection.apply(
        state,
        makeTraceNameChangedEvent({ newName: "Second rename" }),
      );

      expect(state.traceName).toBe("Second rename");
      expect(state.traceNameUserOverridden).toBe(true);
    });
  });
});
