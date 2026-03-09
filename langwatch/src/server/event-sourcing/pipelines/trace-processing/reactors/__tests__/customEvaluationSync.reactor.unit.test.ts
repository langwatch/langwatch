import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { ReactorContext } from "../../../../reactors/reactor.types";
import type { TraceProcessingEvent } from "../../schemas/events";
import {
  createCustomEvaluationSyncReactor,
  type CustomEvaluationSyncReactorDeps,
} from "../customEvaluationSync.reactor";

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
    satisfactionScore: null,
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

describe("customEvaluationSync reactor", () => {
  let deps: CustomEvaluationSyncReactorDeps;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.now());
    deps = {
      startEvaluation: vi.fn().mockResolvedValue(undefined),
      completeEvaluation: vi.fn().mockResolvedValue(undefined),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("when no evaluations are present", () => {
    it("does not dispatch any commands", async () => {
      const reactor = createCustomEvaluationSyncReactor(deps);
      const state = createFoldState({ attributes: {} });

      await reactor.handle(createEvent(), createContext(state));

      expect(deps.startEvaluation).not.toHaveBeenCalled();
      expect(deps.completeEvaluation).not.toHaveBeenCalled();
    });
  });

  describe("when evaluations are present in attributes", () => {
    it("dispatches startEvaluation and completeEvaluation for each evaluation", async () => {
      const reactor = createCustomEvaluationSyncReactor(deps);
      const evaluations = [
        { name: "toxicity", score: 0.1, passed: true },
        { name: "relevance", score: 0.9, passed: true, label: "good" },
      ];
      const state = createFoldState({
        attributes: {
          "langwatch.reserved.evaluations": JSON.stringify(evaluations),
        },
      });

      await reactor.handle(createEvent(), createContext(state));

      expect(deps.startEvaluation).toHaveBeenCalledTimes(2);
      expect(deps.completeEvaluation).toHaveBeenCalledTimes(2);
    });

    it("uses deterministic evaluation IDs based on MD5 hash", async () => {
      const reactor = createCustomEvaluationSyncReactor(deps);
      const evaluations = [{ name: "toxicity", score: 0.1 }];
      const state = createFoldState({
        attributes: {
          "langwatch.reserved.evaluations": JSON.stringify(evaluations),
        },
      });

      await reactor.handle(createEvent(), createContext(state));

      const startCall = vi.mocked(deps.startEvaluation).mock.calls[0]![0];
      expect(startCall.evaluationId).toMatch(/^eval_md5_[a-f0-9]{32}$/);
    });

    it("uses evaluationNameAutoslug for evaluator ID", async () => {
      const reactor = createCustomEvaluationSyncReactor(deps);
      const evaluations = [{ name: "My Custom Eval", score: 0.5 }];
      const state = createFoldState({
        attributes: {
          "langwatch.reserved.evaluations": JSON.stringify(evaluations),
        },
      });

      await reactor.handle(createEvent(), createContext(state));

      const startCall = vi.mocked(deps.startEvaluation).mock.calls[0]![0];
      expect(startCall.evaluatorId).toMatch(/^customeval_/);
    });

    it("sets evaluatorType to 'custom'", async () => {
      const reactor = createCustomEvaluationSyncReactor(deps);
      const evaluations = [{ name: "toxicity", score: 0.1 }];
      const state = createFoldState({
        attributes: {
          "langwatch.reserved.evaluations": JSON.stringify(evaluations),
        },
      });

      await reactor.handle(createEvent(), createContext(state));

      const startCall = vi.mocked(deps.startEvaluation).mock.calls[0]![0];
      expect(startCall.evaluatorType).toBe("custom");
    });

    it("sets traceId from the aggregate ID", async () => {
      const reactor = createCustomEvaluationSyncReactor(deps);
      const evaluations = [{ name: "toxicity", score: 0.1 }];
      const state = createFoldState({
        attributes: {
          "langwatch.reserved.evaluations": JSON.stringify(evaluations),
        },
      });

      await reactor.handle(createEvent(), createContext(state));

      const startCall = vi.mocked(deps.startEvaluation).mock.calls[0]![0];
      expect(startCall.traceId).toBe("trace-1");
    });

    it("passes score, passed, label, details to completeEvaluation", async () => {
      const reactor = createCustomEvaluationSyncReactor(deps);
      const evaluations = [
        {
          name: "toxicity",
          score: 0.1,
          passed: true,
          label: "safe",
          details: "No toxic content found",
          status: "processed" as const,
        },
      ];
      const state = createFoldState({
        attributes: {
          "langwatch.reserved.evaluations": JSON.stringify(evaluations),
        },
      });

      await reactor.handle(createEvent(), createContext(state));

      const completeCall = vi.mocked(deps.completeEvaluation).mock
        .calls[0]![0];
      expect(completeCall.score).toBe(0.1);
      expect(completeCall.passed).toBe(true);
      expect(completeCall.label).toBe("safe");
      expect(completeCall.details).toBe("No toxic content found");
      expect(completeCall.status).toBe("processed");
    });

    it("defaults status to 'processed' when not provided and no error", async () => {
      const reactor = createCustomEvaluationSyncReactor(deps);
      const evaluations = [{ name: "toxicity", score: 0.1 }];
      const state = createFoldState({
        attributes: {
          "langwatch.reserved.evaluations": JSON.stringify(evaluations),
        },
      });

      await reactor.handle(createEvent(), createContext(state));

      const completeCall = vi.mocked(deps.completeEvaluation).mock
        .calls[0]![0];
      expect(completeCall.status).toBe("processed");
    });

    it("uses provided evaluation_id when present", async () => {
      const reactor = createCustomEvaluationSyncReactor(deps);
      const evaluations = [
        { evaluation_id: "my-eval-1", name: "toxicity", score: 0.1 },
      ];
      const state = createFoldState({
        attributes: {
          "langwatch.reserved.evaluations": JSON.stringify(evaluations),
        },
      });

      await reactor.handle(createEvent(), createContext(state));

      const startCall = vi.mocked(deps.startEvaluation).mock.calls[0]![0];
      expect(startCall.evaluationId).toBe("my-eval-1");
    });

    it("uses provided evaluator_id when present", async () => {
      const reactor = createCustomEvaluationSyncReactor(deps);
      const evaluations = [
        { evaluator_id: "my-evaluator", name: "toxicity", score: 0.1 },
      ];
      const state = createFoldState({
        attributes: {
          "langwatch.reserved.evaluations": JSON.stringify(evaluations),
        },
      });

      await reactor.handle(createEvent(), createContext(state));

      const startCall = vi.mocked(deps.startEvaluation).mock.calls[0]![0];
      expect(startCall.evaluatorId).toBe("my-evaluator");
    });
  });

  describe("when event is too old", () => {
    it("skips processing", async () => {
      const reactor = createCustomEvaluationSyncReactor(deps);
      const evaluations = [{ name: "toxicity", score: 0.1 }];
      const state = createFoldState({
        attributes: {
          "langwatch.reserved.evaluations": JSON.stringify(evaluations),
        },
      });
      const oldEvent = createEvent({
        occurredAt: Date.now() - 2 * 60 * 60 * 1000,
      });

      await reactor.handle(oldEvent, createContext(state));

      expect(deps.startEvaluation).not.toHaveBeenCalled();
      expect(deps.completeEvaluation).not.toHaveBeenCalled();
    });
  });

  describe("when evaluation has error info", () => {
    it("sets status to 'error' and passes error message", async () => {
      const reactor = createCustomEvaluationSyncReactor(deps);
      const evaluations = [
        {
          name: "toxicity",
          status: "error" as const,
          error: { message: "Evaluation failed" },
        },
      ];
      const state = createFoldState({
        attributes: {
          "langwatch.reserved.evaluations": JSON.stringify(evaluations),
        },
      });

      await reactor.handle(createEvent(), createContext(state));

      const completeCall = vi.mocked(deps.completeEvaluation).mock
        .calls[0]![0];
      expect(completeCall.status).toBe("error");
      expect(completeCall.error).toBe("Evaluation failed");
    });
  });

  describe("when a single evaluation command fails", () => {
    it("continues processing remaining evaluations", async () => {
      deps.startEvaluation = vi
        .fn()
        .mockRejectedValueOnce(new Error("network error"))
        .mockResolvedValueOnce(undefined);
      deps.completeEvaluation = vi.fn().mockResolvedValue(undefined);

      const reactor = createCustomEvaluationSyncReactor(deps);
      const evaluations = [
        { name: "toxicity", score: 0.1 },
        { name: "relevance", score: 0.9 },
      ];
      const state = createFoldState({
        attributes: {
          "langwatch.reserved.evaluations": JSON.stringify(evaluations),
        },
      });

      await reactor.handle(createEvent(), createContext(state));

      // Second evaluation should still be attempted
      expect(deps.startEvaluation).toHaveBeenCalledTimes(2);
    });
  });

  describe("when evaluations attribute is invalid JSON", () => {
    it("does not dispatch any commands", async () => {
      const reactor = createCustomEvaluationSyncReactor(deps);
      const state = createFoldState({
        attributes: {
          "langwatch.reserved.evaluations": "not-valid-json",
        },
      });

      await reactor.handle(createEvent(), createContext(state));

      expect(deps.startEvaluation).not.toHaveBeenCalled();
      expect(deps.completeEvaluation).not.toHaveBeenCalled();
    });
  });

  describe("when evaluations array contains entries without name field", () => {
    it("filters out invalid entries and processes valid ones", async () => {
      const reactor = createCustomEvaluationSyncReactor(deps);
      const evaluations = [
        { score: 0.5 }, // missing name -- should be filtered
        { name: "toxicity", score: 0.1 },
      ];
      const state = createFoldState({
        attributes: {
          "langwatch.reserved.evaluations": JSON.stringify(evaluations),
        },
      });

      await reactor.handle(createEvent(), createContext(state));

      expect(deps.startEvaluation).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the same evaluation is processed twice", () => {
    it("produces the same evaluation ID both times", async () => {
      const reactor = createCustomEvaluationSyncReactor(deps);
      const evaluations = [{ name: "toxicity", score: 0.1 }];
      const state = createFoldState({
        attributes: {
          "langwatch.reserved.evaluations": JSON.stringify(evaluations),
        },
      });

      await reactor.handle(createEvent(), createContext(state));
      await reactor.handle(createEvent(), createContext(state));

      const id1 = vi.mocked(deps.startEvaluation).mock.calls[0]![0].evaluationId;
      const id2 = vi.mocked(deps.startEvaluation).mock.calls[1]![0].evaluationId;
      expect(id1).toBe(id2);
    });
  });

  describe("when evaluation has is_guardrail flag", () => {
    it("passes isGuardrail to startEvaluation command", async () => {
      const reactor = createCustomEvaluationSyncReactor(deps);
      const evaluations = [
        { name: "content filter", score: 1.0, is_guardrail: true },
      ];
      const state = createFoldState({
        attributes: {
          "langwatch.reserved.evaluations": JSON.stringify(evaluations),
        },
      });

      await reactor.handle(createEvent(), createContext(state));

      const startCall = vi.mocked(deps.startEvaluation).mock.calls[0]![0];
      expect(startCall.isGuardrail).toBe(true);
    });
  });
});
