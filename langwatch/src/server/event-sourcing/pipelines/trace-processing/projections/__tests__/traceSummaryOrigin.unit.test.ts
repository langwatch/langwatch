import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TraceIOExtractionService } from "~/server/app-layer/traces/trace-io-extraction.service";
import { applySpanToSummary } from "../traceSummary.foldProjection";
import { createInitState, createTestSpan } from "./fixtures/trace-summary-test.fixtures";

describe("applySpanToSummary() langwatch.origin hoisting", () => {
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

  describe("when root span has langwatch.origin", () => {
    /** @scenario "Origin is hoisted from root span to trace summary" */
    it("hoists origin to trace summary attributes", () => {
      const span = createTestSpan({
        parentSpanId: null, // root span
        spanAttributes: {
          "langwatch.origin": "evaluation",
        },
      });

      const state = applySpanToSummary({ state: createInitState(), span: span });

      expect(state.attributes["langwatch.origin"]).toBe("evaluation");
    });
  });

  describe("when the ingest-key provenance puts langwatch.origin on the resource", () => {
    it("hoists the resource-level origin (claude code's coding_agent rides the resource, not the span)", () => {
      const span = createTestSpan({
        parentSpanId: null, // root agent span
        spanAttributes: {}, // claude log-derived spans carry no span-level origin
        resourceAttributes: {
          "langwatch.origin": "coding_agent",
          "langwatch.source": "claude_code",
        },
      });

      const state = applySpanToSummary({ state: createInitState(), span });

      expect(state.attributes["langwatch.origin"]).toBe("coding_agent");
    });

    it("prefers a span-level origin over the resource-level one when both exist", () => {
      const span = createTestSpan({
        parentSpanId: null,
        spanAttributes: { "langwatch.origin": "simulation" },
        resourceAttributes: { "langwatch.origin": "coding_agent" },
      });

      const state = applySpanToSummary({ state: createInitState(), span });

      expect(state.attributes["langwatch.origin"]).toBe("simulation");
    });
  });

  describe("when child span has langwatch.origin and root span does not", () => {
    /** @scenario "Root span without origin preserves child span origin" */
    it("preserves child span origin value", () => {
      // Child span arrives first with origin
      const childSpan = createTestSpan({
        id: "child-1",
        spanId: "child-1",
        parentSpanId: "root-1",
        spanAttributes: {
          "langwatch.origin": "evaluation",
        },
      });

      // Root span arrives later without origin
      const rootSpan = createTestSpan({
        id: "root-1",
        spanId: "root-1",
        parentSpanId: null, // root
        spanAttributes: {},
      });

      let state = applySpanToSummary({ state: createInitState(), span: childSpan });
      state = applySpanToSummary({ state, span: rootSpan });

      expect(state.attributes["langwatch.origin"]).toBe("evaluation");
    });
  });

  describe("when root span overrides child span origin", () => {
    /** @scenario "Root span overrides child span origin when it has an opinion" */
    it("uses root span origin value", () => {
      // Child span arrives first with origin
      const childSpan = createTestSpan({
        id: "child-1",
        spanId: "child-1",
        parentSpanId: "root-1",
        spanAttributes: {
          "langwatch.origin": "evaluation",
        },
      });

      // Root span arrives later with different origin
      const rootSpan = createTestSpan({
        id: "root-1",
        spanId: "root-1",
        parentSpanId: null, // root
        spanAttributes: {
          "langwatch.origin": "simulation",
        },
      });

      let state = applySpanToSummary({ state: createInitState(), span: childSpan });
      state = applySpanToSummary({ state, span: rootSpan });

      expect(state.attributes["langwatch.origin"]).toBe("simulation");
    });
  });

  describe("when an evaluator workflow emits child spans on a customer's trace", () => {
    // 2026-05-14 prod regression. Loop-prevention PR #4048 made eval
    // workflow spans (running in nlpgo) continue the parent trace via
    // W3C traceparent. Those spans land on the customer's trace as
    // children with langwatch.origin="evaluation" + causality_depth=1.
    // The previous "explicit origin on any span always wins" rule then
    // overwrote the customer's resolved origin (playground, application,
    // etc.) on the trace summary as the eval spans arrived.
    /** @scenario Eval-emitted child span does not flip the customer trace's origin */
    it("preserves the customer trace's origin once the root span has resolved it", () => {
      const rootSpan = createTestSpan({
        id: "root-1",
        spanId: "root-1",
        parentSpanId: null,
        spanAttributes: {
          "langwatch.origin": "playground",
        },
      });

      // Eval workflow's first span: child of customer's root, carrying
      // depth=1 + explicit origin=evaluation (stamped by nlpgo's
      // BaggageAttributeProcessor + startStudioSpan attrs).
      const evalChildSpan = createTestSpan({
        id: "eval-child-1",
        spanId: "eval-child-1",
        parentSpanId: "root-1",
        spanAttributes: {
          "langwatch.origin": "evaluation",
          "langwatch.reserved.causality_depth": "1",
        },
      });

      let state = applySpanToSummary({ state: createInitState(), span: rootSpan });
      state = applySpanToSummary({ state, span: evalChildSpan });

      expect(state.attributes["langwatch.origin"]).toBe("playground");
    });

    /** @scenario Standalone eval trace still resolves to evaluation */
    it("still resolves origin=evaluation when the eval IS the top-level trace", () => {
      // Standalone eval trace — no inbound traceparent, eval workflow
      // creates its own root span with origin=evaluation. The trace
      // summary must NOT mistakenly classify this as a customer trace.
      const evalRootSpan = createTestSpan({
        id: "eval-root",
        spanId: "eval-root",
        parentSpanId: null,
        spanAttributes: {
          "langwatch.origin": "evaluation",
          "langwatch.reserved.causality_depth": "1",
        },
      });

      const state = applySpanToSummary({
        state: createInitState(),
        span: evalRootSpan,
      });

      expect(state.attributes["langwatch.origin"]).toBe("evaluation");
    });
  });

  describe("when no span sets langwatch.origin", () => {
    /** @scenario "Traces without any origin attribute remain unset" */
    it("does not set langwatch.origin in summary attributes", () => {
      const span = createTestSpan({
        parentSpanId: null,
        spanAttributes: {},
      });

      const state = applySpanToSummary({ state: createInitState(), span: span });

      expect(state.attributes["langwatch.origin"]).toBeUndefined();
    });
  });

  describe("when black-box scenario trace propagates origin through traceparent", () => {
    /** @scenario "Black-box scenario trace propagates origin through traceparent" */
    it("preserves root span origin through child spans", () => {
      // Root span with simulation origin
      const rootSpan = createTestSpan({
        id: "root-1",
        spanId: "root-1",
        parentSpanId: null,
        spanAttributes: {
          "langwatch.origin": "simulation",
        },
      });

      // Remote child span without origin
      const childSpan = createTestSpan({
        id: "child-1",
        spanId: "child-1",
        parentSpanId: "root-1",
        spanAttributes: {},
      });

      let state = applySpanToSummary({ state: createInitState(), span: rootSpan });
      state = applySpanToSummary({ state, span: childSpan });

      expect(state.attributes["langwatch.origin"]).toBe("simulation");
    });
  });

  describe("when span has metadata.platform = 'optimization_studio'", () => {
    /** @scenario Projection strips metadata.platform "optimization_studio" on new traces */
    it("strips metadata.platform from hoisting", () => {
      const span = createTestSpan({
        spanAttributes: {
          "metadata.platform": "optimization_studio",
          "langwatch.origin": "workflow",
        },
      });

      const state = applySpanToSummary({ state: createInitState(), span: span });

      expect(state.attributes["langwatch.origin"]).toBe("workflow");
      expect(state.attributes["metadata.platform"]).toBeUndefined();
    });
  });

  describe("when span has metadata.platform = 'my-custom-platform'", () => {
    /** @scenario "Projection preserves user-set metadata.platform values" */
    it("preserves user-set metadata.platform", () => {
      const span = createTestSpan({
        spanAttributes: {
          "metadata.platform": "my-custom-platform",
        },
      });

      const state = applySpanToSummary({ state: createInitState(), span: span });

      expect(state.attributes["metadata.platform"]).toBe("my-custom-platform");
    });
  });

  describe("when span has metadata.labels containing 'scenario-runner'", () => {
    /** @scenario Projection strips metadata.labels "scenario-runner" on new traces */
    it("strips scenario-runner from labels", () => {
      const span = createTestSpan({
        spanAttributes: {
          "langwatch.origin": "simulation",
          "langwatch.labels": JSON.stringify(["scenario-runner", "regression"]),
        },
      });

      const state = applySpanToSummary({ state: createInitState(), span: span });

      expect(state.attributes["langwatch.origin"]).toBe("simulation");
      const labels = JSON.parse(
        state.attributes["langwatch.labels"] ?? "[]",
      ) as string[];
      expect(labels).not.toContain("scenario-runner");
      expect(labels).toContain("regression");
    });
  });

  describe("when span has metadata.labels with only 'scenario-runner'", () => {
    it("removes the labels attribute entirely if empty after stripping", () => {
      const span = createTestSpan({
        spanAttributes: {
          "langwatch.origin": "simulation",
          "langwatch.labels": JSON.stringify(["scenario-runner"]),
        },
      });

      const state = applySpanToSummary({ state: createInitState(), span: span });

      expect(state.attributes["langwatch.labels"]).toBeUndefined();
    });
  });

  describe("when span has metadata.environment = 'production'", () => {
    /** @scenario "Projection preserves generic metadata keys like environment" */
    it("preserves generic metadata keys", () => {
      const span = createTestSpan({
        spanAttributes: {
          "metadata.environment": "production",
          "langwatch.origin": "workflow",
        },
      });

      const state = applySpanToSummary({ state: createInitState(), span: span });

      expect(state.attributes["metadata.environment"]).toBe("production");
      expect(state.attributes["langwatch.origin"]).toBe("workflow");
    });
  });

  describe("when span has instrumentationScope.name = 'langwatch-evaluation'", () => {
    /** @scenario Infer origin from instrumentationScope.name "langwatch-evaluation" */
    it("infers langwatch.origin = 'evaluation'", () => {
      const span = createTestSpan({
        instrumentationScope: { name: "langwatch-evaluation", version: null },
        spanAttributes: {},
      });

      const state = applySpanToSummary({ state: createInitState(), span: span });

      expect(state.attributes["langwatch.origin"]).toBe("evaluation");
    });
  });

  describe("when span has instrumentationScope.name = '@langwatch/scenario'", () => {
    /** @scenario Infer origin from instrumentationScope.name "@langwatch/scenario" */
    it("infers langwatch.origin = 'simulation'", () => {
      const span = createTestSpan({
        instrumentationScope: { name: "@langwatch/scenario", version: null },
        spanAttributes: {},
      });

      const state = applySpanToSummary({ state: createInitState(), span: span });

      expect(state.attributes["langwatch.origin"]).toBe("simulation");
    });
  });

  describe("when span has metadata.platform = 'optimization_studio' without langwatch.origin", () => {
    /** @scenario Infer origin from metadata.platform "optimization_studio" */
    it("infers langwatch.origin = 'workflow'", () => {
      const span = createTestSpan({
        spanAttributes: {
          "metadata.platform": "optimization_studio",
        },
      });

      const state = applySpanToSummary({ state: createInitState(), span: span });

      expect(state.attributes["langwatch.origin"]).toBe("workflow");
    });
  });

  describe("when span has metadata.labels containing 'scenario-runner' without langwatch.origin", () => {
    /** @scenario Infer origin from metadata.labels containing "scenario-runner" */
    it("infers langwatch.origin = 'simulation'", () => {
      const span = createTestSpan({
        spanAttributes: {
          "langwatch.labels": JSON.stringify(["scenario-runner", "other"]),
        },
      });

      const state = applySpanToSummary({ state: createInitState(), span: span });

      expect(state.attributes["langwatch.origin"]).toBe("simulation");
    });
  });

  describe("when span has resource attribute scenario.labels without langwatch.origin", () => {
    /** @scenario "Infer origin from resource attribute scenario.labels" */
    it("infers langwatch.origin = 'simulation'", () => {
      const span = createTestSpan({
        resourceAttributes: {
          "scenario.labels": "support,billing",
        },
        spanAttributes: {},
      });

      const state = applySpanToSummary({ state: createInitState(), span: span });

      expect(state.attributes["langwatch.origin"]).toBe("simulation");
    });
  });

  describe("when span has evaluation.run_id without langwatch.origin", () => {
    /** @scenario "Infer origin from span attribute evaluation.run_id" */
    it("infers langwatch.origin = 'evaluation'", () => {
      const span = createTestSpan({
        spanAttributes: {
          "evaluation.run_id": "run-123",
        },
      });

      const state = applySpanToSummary({ state: createInitState(), span: span });

      expect(state.attributes["langwatch.origin"]).toBe("evaluation");
    });
  });

  describe("when explicit langwatch.origin is set alongside legacy markers", () => {
    /** @scenario "Explicit langwatch.origin takes precedence over all inferred signals" */
    it("uses explicit origin over all inferred signals", () => {
      const span = createTestSpan({
        instrumentationScope: { name: "langwatch-evaluation", version: null },
        spanAttributes: {
          "langwatch.origin": "evaluation",
          "metadata.platform": "optimization_studio",
        },
      });

      const state = applySpanToSummary({ state: createInitState(), span: span });

      expect(state.attributes["langwatch.origin"]).toBe("evaluation");
    });
  });

  describe("when no origin signal exists at all", () => {
    it("does not set langwatch.origin", () => {
      const span = createTestSpan({
        spanAttributes: {},
      });

      const state = applySpanToSummary({ state: createInitState(), span: span });

      expect(state.attributes["langwatch.origin"]).toBeUndefined();
    });
  });

  describe("when sdk.name is present but no explicit origin or legacy markers (old SDK heuristic)", () => {
    it("infers langwatch.origin = 'application' on root span", () => {
      const span = createTestSpan({
        parentSpanId: null, // root span — heuristic only fires here
        resourceAttributes: {
          "telemetry.sdk.name": "langwatch",
        },
        spanAttributes: {},
      });

      const state = applySpanToSummary({ state: createInitState(), span: span });

      expect(state.attributes["langwatch.origin"]).toBe("application");
    });

    it("does not infer origin on child span (prevents race with explicit platform origin)", () => {
      const span = createTestSpan({
        parentSpanId: "root-1", // child span — heuristic must not fire
        resourceAttributes: {
          "telemetry.sdk.name": "langwatch",
        },
        spanAttributes: {},
      });

      const state = applySpanToSummary({ state: createInitState(), span: span });

      expect(state.attributes["langwatch.origin"]).toBeUndefined();
    });

    it("does not override legacy-inferred origin with SDK heuristic", () => {
      const span = createTestSpan({
        parentSpanId: null, // root span
        resourceAttributes: {
          "telemetry.sdk.name": "langwatch",
        },
        instrumentationScope: { name: "langwatch-evaluation", version: null },
        spanAttributes: {},
      });

      const state = applySpanToSummary({ state: createInitState(), span: span });

      expect(state.attributes["langwatch.origin"]).toBe("evaluation");
    });

    it("does not override explicit origin with SDK heuristic", () => {
      const span = createTestSpan({
        resourceAttributes: {
          "telemetry.sdk.name": "langwatch",
        },
        spanAttributes: {
          "langwatch.origin": "simulation",
        },
      });

      const state = applySpanToSummary({ state: createInitState(), span: span });

      expect(state.attributes["langwatch.origin"]).toBe("simulation");
    });

    it("does not infer origin when sdk.name is absent (pure OTEL)", () => {
      const span = createTestSpan({
        parentSpanId: null,
        resourceAttributes: {},
        spanAttributes: {},
      });

      const state = applySpanToSummary({ state: createInitState(), span: span });

      expect(state.attributes["langwatch.origin"]).toBeUndefined();
    });
  });
});

describe("applySpanToSummary() langwatch.source hoisting", () => {
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

  describe("when span has langwatch.origin.source as span attribute", () => {
    it("hoists source to trace summary attributes", () => {
      const span = createTestSpan({
        parentSpanId: null,
        spanAttributes: {
          "langwatch.origin.source": "platform",
        },
      });

      const state = applySpanToSummary({ state: createInitState(), span: span });

      expect(state.attributes["langwatch.origin.source"]).toBe("platform");
    });
  });

  describe("when span has langwatch.origin.source as resource attribute", () => {
    it("hoists source from resource attributes", () => {
      const span = createTestSpan({
        parentSpanId: null,
        resourceAttributes: {
          "langwatch.origin.source": "platform",
        },
        spanAttributes: {},
      });

      const state = applySpanToSummary({ state: createInitState(), span: span });

      expect(state.attributes["langwatch.origin.source"]).toBe("platform");
    });
  });

  describe("when root span overrides child span source", () => {
    it("uses root span source value", () => {
      const childSpan = createTestSpan({
        id: "child-1",
        spanId: "child-1",
        parentSpanId: "root-1",
        spanAttributes: {
          "langwatch.origin.source": "sdk",
        },
      });

      const rootSpan = createTestSpan({
        id: "root-1",
        spanId: "root-1",
        parentSpanId: null,
        spanAttributes: {
          "langwatch.origin.source": "platform",
        },
      });

      let state = applySpanToSummary({ state: createInitState(), span: childSpan });
      state = applySpanToSummary({ state, span: rootSpan });

      expect(state.attributes["langwatch.origin.source"]).toBe("platform");
    });
  });

  describe("when no span sets langwatch.origin.source", () => {
    it("does not set langwatch.origin.source in summary attributes", () => {
      const span = createTestSpan({
        parentSpanId: null,
        spanAttributes: {},
      });

      const state = applySpanToSummary({ state: createInitState(), span: span });

      expect(state.attributes["langwatch.origin.source"]).toBeUndefined();
    });
  });

  describe("when child span has source and root span does not", () => {
    it("preserves child span source value", () => {
      const childSpan = createTestSpan({
        id: "child-1",
        spanId: "child-1",
        parentSpanId: "root-1",
        spanAttributes: {
          "langwatch.origin.source": "platform",
        },
      });

      const rootSpan = createTestSpan({
        id: "root-1",
        spanId: "root-1",
        parentSpanId: null,
        spanAttributes: {},
      });

      let state = applySpanToSummary({ state: createInitState(), span: childSpan });
      state = applySpanToSummary({ state, span: rootSpan });

      expect(state.attributes["langwatch.origin.source"]).toBe("platform");
    });
  });

  describe("when child with sdk.name arrives before root with legacy marker", () => {
    it("overrides provisional 'application' origin with root's inferred origin", () => {
      // Child arrives first — sdk.name heuristic does NOT fire (child span)
      const childSpan = createTestSpan({
        id: "child-1",
        spanId: "child-1",
        parentSpanId: "root-1",
        resourceAttributes: {
          "telemetry.sdk.name": "@langwatch/scenario",
        },
        spanAttributes: {},
      });

      // Root arrives later — has legacy marker for simulation
      const rootSpan = createTestSpan({
        id: "root-1",
        spanId: "root-1",
        parentSpanId: null,
        instrumentationScope: { name: "@langwatch/scenario", version: null },
        spanAttributes: {},
      });

      let state = applySpanToSummary({ state: createInitState(), span: childSpan });
      // SDK heuristic no longer fires on child spans — origin stays unset
      expect(state.attributes["langwatch.origin"]).toBeUndefined();

      state = applySpanToSummary({ state, span: rootSpan });
      expect(state.attributes["langwatch.origin"]).toBe("simulation");
    });
  });

  describe("when child span arrives before non-root span with explicit platform origin (distributed trace)", () => {
    it("explicit origin wins over heuristic-inferred origin", () => {
      // Child span arrives first — no explicit origin, sdk.name present
      // but SDK heuristic does not fire on child spans
      const childSpan = createTestSpan({
        id: "child-1",
        spanId: "child-1",
        parentSpanId: "platform-root",
        resourceAttributes: {
          "telemetry.sdk.name": "opentelemetry",
        },
        spanAttributes: {},
      });

      // Platform span arrives — has explicit origin but is NOT a root span
      // (parent comes from distributed trace context / HTTP propagation)
      const platformSpan = createTestSpan({
        id: "platform-root",
        spanId: "platform-root",
        parentSpanId: "external-parent", // NOT null — distributed trace
        spanAttributes: {
          "langwatch.origin": "playground",
          "langwatch.origin.source": "platform",
        },
      });

      let state = applySpanToSummary({ state: createInitState(), span: childSpan });
      expect(state.attributes["langwatch.origin"]).toBeUndefined();

      state = applySpanToSummary({ state, span: platformSpan });
      expect(state.attributes["langwatch.origin"]).toBe("playground");
    });

    it("explicit origin overrides previously heuristic-inferred 'application'", () => {
      // Root span arrives first with sdk.name — heuristic fires
      const rootSpan = createTestSpan({
        id: "root-1",
        spanId: "root-1",
        parentSpanId: null,
        resourceAttributes: {
          "telemetry.sdk.name": "langwatch",
        },
        spanAttributes: {},
      });

      // Platform child span arrives with explicit origin
      const platformSpan = createTestSpan({
        id: "platform-1",
        spanId: "platform-1",
        parentSpanId: "root-1",
        spanAttributes: {
          "langwatch.origin": "playground",
          "langwatch.origin.source": "platform",
        },
      });

      let state = applySpanToSummary({ state: createInitState(), span: rootSpan });
      expect(state.attributes["langwatch.origin"]).toBe("application");

      state = applySpanToSummary({ state, span: platformSpan });
      expect(state.attributes["langwatch.origin"]).toBe("playground");
    });
  });
});
