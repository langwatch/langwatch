import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TraceIOExtractionService } from "~/server/app-layer/traces/trace-io-extraction.service";
import type { NormalizedSpan } from "../../schemas/spans";
import { NormalizedSpanKind, NormalizedStatusCode } from "../../schemas/spans";
import {
  applySpanToSummary,
  createTraceSummaryFoldProjection,
  type TraceSummaryData,
} from "../traceSummary.foldProjection";

const traceSummaryProjection = createTraceSummaryFoldProjection({
  store: { store: async () => {}, get: async () => null },
});

function createInitState(): TraceSummaryData {
  return traceSummaryProjection.init();
}

function createTestSpan(
  overrides: Partial<NormalizedSpan> = {},
): NormalizedSpan {
  return {
    id: "span-1",
    traceId: "trace-1",
    spanId: "span-1",
    tenantId: "tenant-1",
    parentSpanId: "parent-1",
    parentTraceId: null,
    parentIsRemote: null,
    sampled: true,
    startTimeUnixMs: 1000,
    endTimeUnixMs: 2000,
    durationMs: 1000,
    name: "test-span",
    kind: NormalizedSpanKind.INTERNAL,
    resourceAttributes: {},
    spanAttributes: {},
    events: [],
    links: [],
    statusMessage: null,
    statusCode: NormalizedStatusCode.UNSET,
    instrumentationScope: { name: "test", version: null },
    droppedAttributesCount: 0 as const,
    droppedEventsCount: 0 as const,
    droppedLinksCount: 0 as const,
    ...overrides,
  };
}

describe("applySpanToSummary() langwatch.origin hoisting", () => {
  let extractSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    extractSpy = vi.spyOn(
      TraceIOExtractionService.prototype,
      "extractRichIOFromSpan",
    );
    extractSpy.mockReturnValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---- Step 2: Hoisting langwatch.origin ----

  describe("when root span has langwatch.origin", () => {
    it("hoists scope to trace summary attributes", () => {
      const span = createTestSpan({
        parentSpanId: null, // root span
        spanAttributes: {
          "langwatch.origin": "evaluation",
        },
      });

      const state = applySpanToSummary(createInitState(), span);

      expect(state.attributes["langwatch.origin"]).toBe("evaluation");
    });
  });

  describe("when child span has langwatch.origin and root span does not", () => {
    it("preserves child span scope value", () => {
      // Child span arrives first with scope
      const childSpan = createTestSpan({
        id: "child-1",
        spanId: "child-1",
        parentSpanId: "root-1",
        spanAttributes: {
          "langwatch.origin": "evaluation",
        },
      });

      // Root span arrives later without scope
      const rootSpan = createTestSpan({
        id: "root-1",
        spanId: "root-1",
        parentSpanId: null, // root
        spanAttributes: {},
      });

      let state = applySpanToSummary(createInitState(), childSpan);
      state = applySpanToSummary(state, rootSpan);

      expect(state.attributes["langwatch.origin"]).toBe("evaluation");
    });
  });

  describe("when root span overrides child span scope", () => {
    it("uses root span scope value", () => {
      // Child span arrives first with scope
      const childSpan = createTestSpan({
        id: "child-1",
        spanId: "child-1",
        parentSpanId: "root-1",
        spanAttributes: {
          "langwatch.origin": "evaluation",
        },
      });

      // Root span arrives later with different scope
      const rootSpan = createTestSpan({
        id: "root-1",
        spanId: "root-1",
        parentSpanId: null, // root
        spanAttributes: {
          "langwatch.origin": "simulation",
        },
      });

      let state = applySpanToSummary(createInitState(), childSpan);
      state = applySpanToSummary(state, rootSpan);

      expect(state.attributes["langwatch.origin"]).toBe("simulation");
    });
  });

  describe("when no span sets langwatch.origin", () => {
    it("does not set langwatch.origin in summary attributes", () => {
      const span = createTestSpan({
        parentSpanId: null,
        spanAttributes: {},
      });

      const state = applySpanToSummary(createInitState(), span);

      expect(state.attributes["langwatch.origin"]).toBeUndefined();
    });
  });

  describe("when black-box scenario trace propagates scope through traceparent", () => {
    it("preserves root span scope through child spans", () => {
      // Root span with simulation scope
      const rootSpan = createTestSpan({
        id: "root-1",
        spanId: "root-1",
        parentSpanId: null,
        spanAttributes: {
          "langwatch.origin": "simulation",
        },
      });

      // Remote child span without scope
      const childSpan = createTestSpan({
        id: "child-1",
        spanId: "child-1",
        parentSpanId: "root-1",
        spanAttributes: {},
      });

      let state = applySpanToSummary(createInitState(), rootSpan);
      state = applySpanToSummary(state, childSpan);

      expect(state.attributes["langwatch.origin"]).toBe("simulation");
    });
  });

  // ---- Step 1d: Strip legacy markers ----

  describe("when span has metadata.platform = 'optimization_studio'", () => {
    it("strips metadata.platform from hoisting", () => {
      const span = createTestSpan({
        spanAttributes: {
          "metadata.platform": "optimization_studio",
          "langwatch.origin": "workflow",
        },
      });

      const state = applySpanToSummary(createInitState(), span);

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

      const state = applySpanToSummary(createInitState(), span);

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

      const state = applySpanToSummary(createInitState(), span);

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

      const state = applySpanToSummary(createInitState(), span);

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

      const state = applySpanToSummary(createInitState(), span);

      expect(state.attributes["metadata.environment"]).toBe("production");
      expect(state.attributes["langwatch.origin"]).toBe("workflow");
    });
  });

  // ---- Step 3: Legacy inference ----

  describe("when span has instrumentationScope.name = 'langwatch-evaluation'", () => {
    it("infers langwatch.origin = 'evaluation'", () => {
      const span = createTestSpan({
        instrumentationScope: { name: "langwatch-evaluation", version: null },
        spanAttributes: {},
      });

      const state = applySpanToSummary(createInitState(), span);

      expect(state.attributes["langwatch.origin"]).toBe("evaluation");
    });
  });

  describe("when span has instrumentationScope.name = '@langwatch/scenario'", () => {
    it("infers langwatch.origin = 'simulation'", () => {
      const span = createTestSpan({
        instrumentationScope: { name: "@langwatch/scenario", version: null },
        spanAttributes: {},
      });

      const state = applySpanToSummary(createInitState(), span);

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

      const state = applySpanToSummary(createInitState(), span);

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

      const state = applySpanToSummary(createInitState(), span);

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

      const state = applySpanToSummary(createInitState(), span);

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

      const state = applySpanToSummary(createInitState(), span);

      expect(state.attributes["langwatch.origin"]).toBe("evaluation");
    });
  });

  describe("when explicit langwatch.origin is set alongside legacy markers", () => {
    it("uses explicit scope over all inferred signals", () => {
      const span = createTestSpan({
        instrumentationScope: { name: "langwatch-evaluation", version: null },
        spanAttributes: {
          "langwatch.origin": "evaluation",
          "metadata.platform": "optimization_studio",
        },
      });

      const state = applySpanToSummary(createInitState(), span);

      expect(state.attributes["langwatch.origin"]).toBe("evaluation");
    });
  });

  describe("when no scope signal exists at all", () => {
    it("does not set langwatch.origin", () => {
      const span = createTestSpan({
        spanAttributes: {},
      });

      const state = applySpanToSummary(createInitState(), span);

      expect(state.attributes["langwatch.origin"]).toBeUndefined();
    });
  });
});
