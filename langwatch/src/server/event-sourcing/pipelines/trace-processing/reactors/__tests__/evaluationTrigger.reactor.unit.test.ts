import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { ReactorContext } from "../../../../reactors/reactor.types";
import type { TraceProcessingEvent } from "../../schemas/events";
import {
  createEvaluationTriggerReactor,
  createDeferredEvaluationHandler,
  resolveOrigin,
  type EvaluationTriggerReactorDeps,
  type DeferredEvaluationPayload,
} from "../evaluationTrigger.reactor";

function createFoldState(
  overrides: Partial<TraceSummaryData> = {},
): TraceSummaryData {
  return {
    traceId: "trace-1",
    spanCount: 1,
    totalDurationMs: 100,
    computedIOSchemaVersion: "2025-12-18",
    computedInput: "hello",
    computedOutput: "world",
    timeToFirstTokenMs: null,
    timeToLastTokenMs: null,
    tokensPerSecond: null,
    containsErrorStatus: false,
    containsOKStatus: true,
    errorMessage: null,
    models: [],
    totalCost: null,
    tokensEstimated: false,
    totalPromptTokenCount: null,
    totalCompletionTokenCount: null,
    outputFromRootSpan: false,
    outputSpanEndTimeMs: 0,
    blockedByGuardrail: false,
    topicId: null,
    subTopicId: null,
    hasAnnotation: null,
    occurredAt: Date.now(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    attributes: {},
    ...overrides,
  };
}

function createEvent(
  overrides: Partial<TraceProcessingEvent> = {},
): TraceProcessingEvent {
  return {
    id: "event-1",
    aggregateId: "trace-1",
    aggregateType: "trace",
    tenantId: "tenant-1",
    createdAt: Date.now(),
    occurredAt: Date.now(),
    type: "lw.obs.trace.span_received",
    version: 1,
    data: {},
    metadata: { spanId: "span-1", traceId: "trace-1" },
    ...overrides,
  } as TraceProcessingEvent;
}

function createContext(
  foldState: TraceSummaryData,
): ReactorContext<TraceSummaryData> {
  return {
    tenantId: "tenant-1",
    aggregateId: "trace-1",
    foldState,
  };
}

function createDeps(
  overrides: Partial<EvaluationTriggerReactorDeps> = {},
): EvaluationTriggerReactorDeps {
  return {
    monitors: {
      getEnabledOnMessageMonitors: vi.fn().mockResolvedValue([
        { id: "mon-1", checkType: "llm/boolean", name: "Test Monitor" },
      ]),
    } as unknown as EvaluationTriggerReactorDeps["monitors"],
    evaluation: vi.fn().mockResolvedValue(undefined),
    traceSummaryStore: {
      get: vi.fn().mockResolvedValue(null),
      store: vi.fn().mockResolvedValue(undefined),
    },
    scheduleDeferred: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("resolveOrigin()", () => {
  describe("when langwatch.origin is set", () => {
    it("returns the explicit origin", () => {
      expect(resolveOrigin({ "langwatch.origin": "application" })).toBe("application");
      expect(resolveOrigin({ "langwatch.origin": "evaluation" })).toBe("evaluation");
      expect(resolveOrigin({ "langwatch.origin": "simulation" })).toBe("simulation");
    });
  });

  describe("when langwatch.origin is absent but sdk.name is present", () => {
    it("infers 'application' from old SDK heuristic", () => {
      expect(resolveOrigin({ "sdk.name": "langwatch" })).toBe("application");
    });
  });

  describe("when both langwatch.origin and sdk.name are absent", () => {
    it("returns null (undetermined)", () => {
      expect(resolveOrigin({})).toBeNull();
    });
  });

  describe("when langwatch.origin is set and sdk.name is also present", () => {
    it("returns the explicit origin (origin takes precedence)", () => {
      expect(
        resolveOrigin({ "langwatch.origin": "evaluation", "sdk.name": "langwatch" }),
      ).toBe("evaluation");
    });
  });
});

describe("evaluationTrigger reactor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.now());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("when trace has explicit application origin", () => {
    it("dispatches evaluation commands", async () => {
      const deps = createDeps();
      const reactor = createEvaluationTriggerReactor(deps);
      const state = createFoldState({
        attributes: { "langwatch.origin": "application" },
      });

      await reactor.handle(createEvent(), createContext(state));

      expect(deps.monitors.getEnabledOnMessageMonitors).toHaveBeenCalledWith("tenant-1");
      expect(deps.evaluation).toHaveBeenCalledTimes(1);
      expect(deps.scheduleDeferred).not.toHaveBeenCalled();
    });
  });

  describe("when trace has non-application origin", () => {
    it("dispatches for origin 'simulation' (preconditions handle filtering)", async () => {
      const deps = createDeps();
      const reactor = createEvaluationTriggerReactor(deps);
      const state = createFoldState({
        attributes: { "langwatch.origin": "simulation" },
      });

      await reactor.handle(createEvent(), createContext(state));

      expect(deps.monitors.getEnabledOnMessageMonitors).toHaveBeenCalledWith("tenant-1");
      expect(deps.evaluation).toHaveBeenCalledTimes(1);
      expect(deps.scheduleDeferred).not.toHaveBeenCalled();
    });

    it("dispatches for origin 'evaluation' (preconditions handle filtering)", async () => {
      const deps = createDeps();
      const reactor = createEvaluationTriggerReactor(deps);
      const state = createFoldState({
        attributes: { "langwatch.origin": "evaluation" },
      });

      await reactor.handle(createEvent(), createContext(state));

      expect(deps.monitors.getEnabledOnMessageMonitors).toHaveBeenCalledWith("tenant-1");
      expect(deps.evaluation).toHaveBeenCalledTimes(1);
      expect(deps.scheduleDeferred).not.toHaveBeenCalled();
    });

    it("dispatches for origin 'workflow' (preconditions handle filtering)", async () => {
      const deps = createDeps();
      const reactor = createEvaluationTriggerReactor(deps);
      const state = createFoldState({
        attributes: { "langwatch.origin": "workflow" },
      });

      await reactor.handle(createEvent(), createContext(state));

      expect(deps.monitors.getEnabledOnMessageMonitors).toHaveBeenCalledWith("tenant-1");
      expect(deps.evaluation).toHaveBeenCalledTimes(1);
      expect(deps.scheduleDeferred).not.toHaveBeenCalled();
    });
  });

  describe("when trace has no origin but sdk.name is present (old SDK)", () => {
    it("infers application and dispatches evaluation commands", async () => {
      const deps = createDeps();
      const reactor = createEvaluationTriggerReactor(deps);
      const state = createFoldState({
        attributes: { "sdk.name": "langwatch" },
      });

      await reactor.handle(createEvent(), createContext(state));

      expect(deps.monitors.getEnabledOnMessageMonitors).toHaveBeenCalledWith("tenant-1");
      expect(deps.evaluation).toHaveBeenCalledTimes(1);
      expect(deps.scheduleDeferred).not.toHaveBeenCalled();
    });
  });

  describe("when trace has no origin and no sdk.name (pure OTEL)", () => {
    it("schedules a deferred check and does not dispatch evaluations", async () => {
      const deps = createDeps();
      const reactor = createEvaluationTriggerReactor(deps);
      const state = createFoldState({ attributes: {} });

      await reactor.handle(createEvent(), createContext(state));

      expect(deps.monitors.getEnabledOnMessageMonitors).not.toHaveBeenCalled();
      expect(deps.evaluation).not.toHaveBeenCalled();
      expect(deps.scheduleDeferred).toHaveBeenCalledWith({
        tenantId: "tenant-1",
        traceId: "trace-1",
        occurredAt: expect.any(Number),
      });
    });
  });

  describe("when old SDK evaluation trace is tagged by legacy inference", () => {
    it("dispatches with evaluation origin (preconditions handle filtering)", async () => {
      const deps = createDeps();
      const reactor = createEvaluationTriggerReactor(deps);
      const state = createFoldState({
        attributes: {
          "sdk.name": "langwatch",
          "langwatch.origin": "evaluation",
        },
      });

      await reactor.handle(createEvent(), createContext(state));

      expect(deps.monitors.getEnabledOnMessageMonitors).toHaveBeenCalledWith("tenant-1");
      expect(deps.evaluation).toHaveBeenCalledTimes(1);
      expect(deps.scheduleDeferred).not.toHaveBeenCalled();
    });
  });
});

describe("createDeferredEvaluationHandler()", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.now());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("when fold state still has no origin after 5 minutes", () => {
    it("stamps origin as 'application', persists to store, and dispatches evaluations", async () => {
      const deps = createDeps();
      const foldState = createFoldState({ attributes: {} });
      vi.mocked(deps.traceSummaryStore.get).mockResolvedValue(foldState);

      const handler = createDeferredEvaluationHandler(deps);
      const payload: DeferredEvaluationPayload = {
        tenantId: "tenant-1",
        traceId: "trace-1",
        occurredAt: Date.now(),
      };

      await handler(payload);

      expect(deps.traceSummaryStore.get).toHaveBeenCalledWith(
        "trace-1",
        { tenantId: "tenant-1", aggregateId: "trace-1" },
      );
      // Verify origin was persisted to the store
      expect(deps.traceSummaryStore.store).toHaveBeenCalledWith(
        expect.objectContaining({
          attributes: expect.objectContaining({ "langwatch.origin": "application" }),
        }),
        { tenantId: "tenant-1", aggregateId: "trace-1" },
      );
      expect(deps.monitors.getEnabledOnMessageMonitors).toHaveBeenCalledWith("tenant-1");
      expect(deps.evaluation).toHaveBeenCalledTimes(1);
      // Verify the evaluation payload has origin stamped as "application"
      const callArgs = vi.mocked(deps.evaluation).mock.calls[0]!;
      expect(callArgs[0]).toMatchObject({ origin: "application" });
    });
  });

  describe("when fold state acquired non-application origin", () => {
    it("dispatches with the acquired origin (preconditions handle filtering)", async () => {
      const deps = createDeps();
      const foldState = createFoldState({
        attributes: { "langwatch.origin": "evaluation" },
      });
      vi.mocked(deps.traceSummaryStore.get).mockResolvedValue(foldState);

      const handler = createDeferredEvaluationHandler(deps);
      const payload: DeferredEvaluationPayload = {
        tenantId: "tenant-1",
        traceId: "trace-1",
        occurredAt: Date.now(),
      };

      await handler(payload);

      expect(deps.traceSummaryStore.get).toHaveBeenCalled();
      // Should NOT re-persist — origin was already set
      expect(deps.traceSummaryStore.store).not.toHaveBeenCalled();
      expect(deps.monitors.getEnabledOnMessageMonitors).toHaveBeenCalledWith("tenant-1");
      expect(deps.evaluation).toHaveBeenCalledTimes(1);
    });
  });

  describe("when fold state acquired explicit application origin", () => {
    it("dispatches evaluations", async () => {
      const deps = createDeps();
      const foldState = createFoldState({
        attributes: { "langwatch.origin": "application" },
      });
      vi.mocked(deps.traceSummaryStore.get).mockResolvedValue(foldState);

      const handler = createDeferredEvaluationHandler(deps);
      const payload: DeferredEvaluationPayload = {
        tenantId: "tenant-1",
        traceId: "trace-1",
        occurredAt: Date.now(),
      };

      await handler(payload);

      expect(deps.monitors.getEnabledOnMessageMonitors).toHaveBeenCalledWith("tenant-1");
      expect(deps.evaluation).toHaveBeenCalledTimes(1);
    });
  });

  describe("when fold state is not found", () => {
    it("skips silently", async () => {
      const deps = createDeps();
      vi.mocked(deps.traceSummaryStore.get).mockResolvedValue(null);

      const handler = createDeferredEvaluationHandler(deps);
      const payload: DeferredEvaluationPayload = {
        tenantId: "tenant-1",
        traceId: "trace-1",
        occurredAt: Date.now(),
      };

      await handler(payload);

      expect(deps.monitors.getEnabledOnMessageMonitors).not.toHaveBeenCalled();
      expect(deps.evaluation).not.toHaveBeenCalled();
    });
  });
});
