import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ATTR_KEYS } from "~/server/app-layer/traces/canonicalisation/extractors/_constants";
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
    it("uses the child span as a fallback name, then upgrades when the real root arrives", () => {
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

      // First span has a (currently-unresolvable) parent; fall back to
      // its name immediately rather than leaving the trace anonymous.
      // The fold projection is incremental so a later real root can
      // still take over.
      let state = applySpanToSummary({ state: createInitState(), span: childSpan });
      expect(state.traceName).toBe("child-operation");
      expect(state.traceNameFromFallback).toBe(true);

      state = applySpanToSummary({ state, span: rootSpan });
      expect(state.traceName).toBe("OrderAgent");
      expect(state.traceNameFromFallback).toBe(false);
    });
  });

  describe("when multiple root spans exist", () => {
    /** @scenario Trace name is sticky once set */
    it("keeps the first set trace name even when an earlier root arrives later", () => {
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

      // Earlier root arrives second — trace name is sticky, but the
      // canonical-root metadata still rotates to the truly earlier one.
      state = applySpanToSummary({ state, span: earlierRoot });
      expect(state.traceName).toBe("manual-handler");
      expect(state.rootSpanStartTimeMs).toBe(1000);
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

    it("still records rootSpanType/StartTimeMs when the rename arrives before any root span", () => {
      // Regression: the canonical-root gate used to be `traceName !== ""`,
      // which a TraceNameChanged event could trip before any root span
      // existed — freezing out later root-span discoveries entirely. The
      // gate is now anchored on `rootSpanStartTimeMs` so root metadata
      // still populates even when the name is latched.
      const projection = makeProjection();
      let state = createInitState();

      state = projection.apply(
        state,
        makeTraceNameChangedEvent({ newName: "Manually labelled trace" }),
      );
      expect(state.traceName).toBe("Manually labelled trace");
      expect(state.rootSpanStartTimeMs).toBeUndefined();

      const root = createTestSpan({
        id: "root-1",
        spanId: "root-1",
        parentSpanId: null,
        name: "auto-instrumented-GET",
        startTimeUnixMs: 1500,
      });
      state = applySpanToSummary({ state, span: root });

      expect(state.traceName).toBe("Manually labelled trace");
      expect(state.traceNameUserOverridden).toBe(true);
      expect(state.rootSpanStartTimeMs).toBe(1500);
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

  // Customers regularly emit the first span with a `parent_span_id` that
  // points to nothing in the trace (auto-instrumentation handoff bugs,
  // SDK propagation glitches, etc.). Without the fallback, no span would
  // ever satisfy `parentSpanId === null` and the trace would render with
  // an empty name forever.
  describe("when no real root span ever arrives (bogus parent_span_id)", () => {
    /** @scenario Trace name falls back to root-most span when no real parent resolves */
    it("uses the only span as the fallback trace name", () => {
      const onlySpan = createTestSpan({
        id: "child-1",
        spanId: "child-1",
        parentSpanId: "phantom-parent-id",
        name: "RequirementsShredding",
        startTimeUnixMs: 1000,
      });

      const state = applySpanToSummary({ state: createInitState(), span: onlySpan });

      expect(state.traceName).toBe("RequirementsShredding");
      expect(state.traceNameFromFallback).toBe(true);
      expect(state.rootSpanStartTimeMs).toBe(1000);
    });

    /** @scenario Trace name falls back to earliest-starting span across multiple unparented spans */
    it("prefers the earliest-starting span when multiple unparented spans arrive", () => {
      const laterSpan = createTestSpan({
        id: "later",
        spanId: "later",
        parentSpanId: "phantom-1",
        name: "LangGraph",
        startTimeUnixMs: 2000,
      });
      const earlierSpan = createTestSpan({
        id: "earlier",
        spanId: "earlier",
        parentSpanId: "phantom-2",
        name: "RequirementsShredding",
        startTimeUnixMs: 1000,
      });

      // Later span lands first, claims the fallback.
      let state = applySpanToSummary({ state: createInitState(), span: laterSpan });
      expect(state.traceName).toBe("LangGraph");
      expect(state.traceNameFromFallback).toBe(true);

      // Earlier span shows up second and dethrones the previous fallback —
      // it's a better candidate for "root" because it started first.
      state = applySpanToSummary({ state, span: earlierSpan });
      expect(state.traceName).toBe("RequirementsShredding");
      expect(state.traceNameFromFallback).toBe(true);
      expect(state.rootSpanStartTimeMs).toBe(1000);
    });

    it("keeps the existing fallback when a later non-root span arrives", () => {
      const earlySpan = createTestSpan({
        id: "early",
        spanId: "early",
        parentSpanId: "phantom-1",
        name: "RootIsh",
        startTimeUnixMs: 1000,
      });
      const lateSpan = createTestSpan({
        id: "late",
        spanId: "late",
        parentSpanId: "phantom-2",
        name: "SomethingElse",
        startTimeUnixMs: 5000,
      });

      let state = applySpanToSummary({ state: createInitState(), span: earlySpan });
      state = applySpanToSummary({ state, span: lateSpan });

      // The earlier span stays the fallback — newer non-root span can't
      // displace an earlier one.
      expect(state.traceName).toBe("RootIsh");
      expect(state.rootSpanStartTimeMs).toBe(1000);
    });
  });

  describe("when a real root arrives after a fallback name was already claimed", () => {
    it("upgrades the trace name to the real root and clears the fallback flag", () => {
      const fallbackSpan = createTestSpan({
        id: "child-1",
        spanId: "child-1",
        parentSpanId: "phantom",
        name: "TentativeName",
        startTimeUnixMs: 1500,
      });
      const realRoot = createTestSpan({
        id: "root-1",
        spanId: "root-1",
        parentSpanId: null,
        name: "RealRootName",
        startTimeUnixMs: 2000,
      });

      let state = applySpanToSummary({ state: createInitState(), span: fallbackSpan });
      expect(state.traceNameFromFallback).toBe(true);

      // A real root arrives *later in time* than the fallback span, but
      // it's still the truth — `parentSpanId === null` beats "first
      // span we saw" every time.
      state = applySpanToSummary({ state, span: realRoot });
      expect(state.traceName).toBe("RealRootName");
      expect(state.traceNameFromFallback).toBe(false);
      expect(state.rootSpanStartTimeMs).toBe(2000);
    });

    it("does not overwrite a user-overridden name even when no real root ever arrives", () => {
      const projection = makeProjection();
      let state = createInitState();

      // User renames first, before any spans show up.
      state = projection.apply(
        state,
        makeTraceNameChangedEvent({ newName: "Operator-picked label" }),
      );

      // Then a non-root span lands. The fallback path would normally
      // claim the trace name from this span — but a user override is
      // final.
      const span = createTestSpan({
        id: "child-1",
        spanId: "child-1",
        parentSpanId: "phantom",
        name: "AutomaticDiscovery",
        startTimeUnixMs: 1000,
      });
      state = applySpanToSummary({ state, span });

      expect(state.traceName).toBe("Operator-picked label");
      expect(state.traceNameUserOverridden).toBe(true);
      expect(state.traceNameFromFallback).toBe(false);
    });

    /** @scenario Real root metadata upgrades after a user rename clears the name fallback flag */
    it("still lets a real root upgrade rootSpanStartTimeMs/Type even after a user rename disowned the fallback name", () => {
      const projection = makeProjection();
      let state = createInitState();

      // 1) Fallback span claims rootSpanStartTimeMs + rootSpanType
      //    along with the trace name. Both fallback flags latch true.
      const fallbackSpan = createTestSpan({
        id: "child-1",
        spanId: "child-1",
        parentSpanId: "phantom",
        name: "TentativeName",
        startTimeUnixMs: 1000,
        spanAttributes: { [ATTR_KEYS.SPAN_TYPE]: "agent" },
      });
      state = applySpanToSummary({ state, span: fallbackSpan });
      expect(state.traceNameFromFallback).toBe(true);
      expect(state.rootMetadataFromFallback).toBe(true);
      expect(state.rootSpanStartTimeMs).toBe(1000);
      expect(state.rootSpanType).toBe("agent");

      // 2) User renames. The name flag clears (the name is no longer
      //    fallback-sourced) but the metadata flag stays — the root
      //    metadata is still a stand-in.
      state = projection.apply(
        state,
        makeTraceNameChangedEvent({ newName: "Operator-picked label" }),
      );
      expect(state.traceNameFromFallback).toBe(false);
      expect(state.rootMetadataFromFallback).toBe(true);
      expect(state.traceName).toBe("Operator-picked label");

      // 3) Real root arrives later in time than the fallback span.
      //    Pre-fix, the metadata stayed pinned to the fallback span
      //    because the only "is this still fallback?" signal had been
      //    cleared by the rename. Now: the metadata upgrades to the
      //    real root, the user's name survives.
      const realRoot = createTestSpan({
        id: "root-1",
        spanId: "root-1",
        parentSpanId: null,
        name: "RealRootName",
        startTimeUnixMs: 2000,
        spanAttributes: { [ATTR_KEYS.SPAN_TYPE]: "workflow" },
      });
      state = applySpanToSummary({ state, span: realRoot });

      expect(state.traceName).toBe("Operator-picked label");
      expect(state.traceNameUserOverridden).toBe(true);
      expect(state.traceNameFromFallback).toBe(false);
      expect(state.rootMetadataFromFallback).toBe(false);
      expect(state.rootSpanStartTimeMs).toBe(2000);
      expect(state.rootSpanType).toBe("workflow");
    });
  });
});
