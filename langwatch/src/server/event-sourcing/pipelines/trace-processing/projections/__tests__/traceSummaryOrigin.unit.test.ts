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

  describe("when child span has langwatch.origin and root span does not", () => {
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

  describe("when no span sets langwatch.origin", () => {
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
    it("infers langwatch.origin = 'application'", () => {
      const span = createTestSpan({
        resourceAttributes: {
          "telemetry.sdk.name": "langwatch",
        },
        spanAttributes: {},
      });

      const state = applySpanToSummary({ state: createInitState(), span: span });

      expect(state.attributes["langwatch.origin"]).toBe("application");
    });

    it("does not override legacy-inferred origin with SDK heuristic", () => {
      const span = createTestSpan({
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
});
