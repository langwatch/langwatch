import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { ReactorContext } from "../../../../reactors/reactor.types";
import type { SpanReceivedEvent, TraceProcessingEvent } from "../../schemas/events";
import type { OtlpSpan } from "../../schemas/otlp";
import {
  createCustomEvaluationSyncReactor,
  extractEvaluationsFromSpan,
  type CustomEvaluationSyncReactorDeps,
} from "../customEvaluationSync.reactor";

function makeOtlpSpan(evalPayloads: Record<string, unknown>[]): OtlpSpan {
  return {
    traceId: "aaaa0000000000000000000000000001",
    spanId: "bbbb000000000001",
    parentSpanId: null,
    name: "main",
    kind: 1,
    startTimeUnixNano: "1700000000000000000",
    endTimeUnixNano: "1700000001000000000",
    attributes: [],
    events: evalPayloads.map((payload) => ({
      timeUnixNano: "1700000000500000000",
      name: "langwatch.evaluation.custom",
      attributes: [
        {
          key: "json_encoded_event",
          value: { stringValue: JSON.stringify(payload) },
        },
      ],
    })),
    links: [],
    status: { code: null, message: null },
    flags: null,
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  } as unknown as OtlpSpan;
}

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
    annotationIds: [],
    occurredAt: Date.now(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    attributes: {},
    ...overrides,
  };
}

function createSpanReceivedEvent(
  span: OtlpSpan,
  overrides: Partial<SpanReceivedEvent> = {},
): SpanReceivedEvent {
  return {
    id: "event-1",
    aggregateId: "trace-1",
    aggregateType: "trace",
    tenantId: "tenant-1",
    createdAt: Date.now(),
    occurredAt: Date.now(),
    type: "lw.obs.trace.span_received",
    version: 1,
    data: {
      span,
      resource: null,
      instrumentationScope: null,
      piiRedactionLevel: "STRICT",
    },
    metadata: { spanId: "span-1", traceId: "trace-1" },
    ...overrides,
  } as unknown as SpanReceivedEvent;
}

function createNonSpanEvent(): TraceProcessingEvent {
  return {
    id: "event-1",
    aggregateId: "trace-1",
    aggregateType: "trace",
    tenantId: "tenant-1",
    createdAt: Date.now(),
    occurredAt: Date.now(),
    type: "lw.obs.trace.topic_assigned",
    version: 1,
    data: {},
    metadata: {},
  } as unknown as TraceProcessingEvent;
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

describe("extractEvaluationsFromSpan", () => {
  describe("when span has evaluation events", () => {
    it("extracts evaluation data from json_encoded_event attributes", () => {
      const span = makeOtlpSpan([
        { name: "toxicity", score: 0.1, passed: true },
      ]);

      const result = extractEvaluationsFromSpan(span);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        name: "toxicity",
        score: 0.1,
        passed: true,
      });
    });
  });

  describe("when span has no evaluation events", () => {
    it("returns empty array", () => {
      const span = makeOtlpSpan([]);
      span.events = [];

      expect(extractEvaluationsFromSpan(span)).toHaveLength(0);
    });
  });

  describe("when json_encoded_event is malformed", () => {
    it("skips the malformed event", () => {
      const span = {
        ...makeOtlpSpan([]),
        events: [
          {
            timeUnixNano: "1700000000500000000",
            name: "langwatch.evaluation.custom",
            attributes: [
              { key: "json_encoded_event", value: { stringValue: "not json" } },
            ],
          },
        ],
      } as unknown as OtlpSpan;

      expect(extractEvaluationsFromSpan(span)).toHaveLength(0);
    });
  });

  describe("when evaluation is missing name field", () => {
    it("filters it out", () => {
      const span = makeOtlpSpan([{ score: 0.5 }]);

      expect(extractEvaluationsFromSpan(span)).toHaveLength(0);
    });
  });
});

describe("customEvaluationSync reactor", () => {
  let deps: CustomEvaluationSyncReactorDeps;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.now());
    deps = {
      reportEvaluation: vi.fn().mockResolvedValue(undefined),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("when event is not a SpanReceivedEvent", () => {
    it("does not dispatch any commands", async () => {
      const reactor = createCustomEvaluationSyncReactor(deps);
      const state = createFoldState();

      await reactor.handle(createNonSpanEvent(), createContext(state));

      expect(deps.reportEvaluation).not.toHaveBeenCalled();
    });
  });

  describe("when span has no evaluation events", () => {
    it("does not dispatch any commands", async () => {
      const reactor = createCustomEvaluationSyncReactor(deps);
      const span = makeOtlpSpan([]);
      span.events = [];

      await reactor.handle(
        createSpanReceivedEvent(span),
        createContext(createFoldState()),
      );

      expect(deps.reportEvaluation).not.toHaveBeenCalled();
    });
  });

  describe("when span has evaluation events", () => {
    it("dispatches reportEvaluation for each evaluation", async () => {
      const reactor = createCustomEvaluationSyncReactor(deps);
      const span = makeOtlpSpan([
        { name: "toxicity", score: 0.1, passed: true },
        { name: "relevance", score: 0.9, passed: true, label: "good" },
      ]);

      await reactor.handle(
        createSpanReceivedEvent(span),
        createContext(createFoldState()),
      );

      expect(deps.reportEvaluation).toHaveBeenCalledTimes(2);
    });

    it("uses deterministic evaluation IDs based on MD5 hash", async () => {
      const reactor = createCustomEvaluationSyncReactor(deps);
      const span = makeOtlpSpan([{ name: "toxicity", score: 0.1 }]);

      await reactor.handle(
        createSpanReceivedEvent(span),
        createContext(createFoldState()),
      );

      const call = vi.mocked(deps.reportEvaluation).mock.calls[0]![0];
      expect(call.evaluationId).toMatch(/^eval_md5_[a-f0-9]{32}$/);
    });

    it("uses evaluationNameAutoslug for evaluator ID", async () => {
      const reactor = createCustomEvaluationSyncReactor(deps);
      const span = makeOtlpSpan([{ name: "My Custom Eval", score: 0.5 }]);

      await reactor.handle(
        createSpanReceivedEvent(span),
        createContext(createFoldState()),
      );

      const call = vi.mocked(deps.reportEvaluation).mock.calls[0]![0];
      expect(call.evaluatorId).toMatch(/^customeval_/);
    });

    it("sets evaluatorType to 'custom'", async () => {
      const reactor = createCustomEvaluationSyncReactor(deps);
      const span = makeOtlpSpan([{ name: "toxicity", score: 0.1 }]);

      await reactor.handle(
        createSpanReceivedEvent(span),
        createContext(createFoldState()),
      );

      const call = vi.mocked(deps.reportEvaluation).mock.calls[0]![0];
      expect(call.evaluatorType).toBe("custom");
    });

    it("sets traceId from the aggregate ID", async () => {
      const reactor = createCustomEvaluationSyncReactor(deps);
      const span = makeOtlpSpan([{ name: "toxicity", score: 0.1 }]);

      await reactor.handle(
        createSpanReceivedEvent(span),
        createContext(createFoldState()),
      );

      const call = vi.mocked(deps.reportEvaluation).mock.calls[0]![0];
      expect(call.traceId).toBe("trace-1");
    });

    it("passes score, passed, label, details, and status to reportEvaluation", async () => {
      const reactor = createCustomEvaluationSyncReactor(deps);
      const span = makeOtlpSpan([
        {
          name: "toxicity",
          score: 0.1,
          passed: true,
          label: "safe",
          details: "No toxic content found",
          status: "processed",
        },
      ]);

      await reactor.handle(
        createSpanReceivedEvent(span),
        createContext(createFoldState()),
      );

      const call = vi.mocked(deps.reportEvaluation).mock.calls[0]![0];
      expect(call.score).toBe(0.1);
      expect(call.passed).toBe(true);
      expect(call.label).toBe("safe");
      expect(call.details).toBe("No toxic content found");
      expect(call.status).toBe("processed");
    });

    it("defaults status to 'processed' when not provided and no error", async () => {
      const reactor = createCustomEvaluationSyncReactor(deps);
      const span = makeOtlpSpan([{ name: "toxicity", score: 0.1 }]);

      await reactor.handle(
        createSpanReceivedEvent(span),
        createContext(createFoldState()),
      );

      const call = vi.mocked(deps.reportEvaluation).mock.calls[0]![0];
      expect(call.status).toBe("processed");
    });

    it("uses provided evaluation_id when present", async () => {
      const reactor = createCustomEvaluationSyncReactor(deps);
      const span = makeOtlpSpan([
        { evaluation_id: "my-eval-1", name: "toxicity", score: 0.1 },
      ]);

      await reactor.handle(
        createSpanReceivedEvent(span),
        createContext(createFoldState()),
      );

      const call = vi.mocked(deps.reportEvaluation).mock.calls[0]![0];
      expect(call.evaluationId).toBe("my-eval-1");
    });

    it("uses provided evaluator_id when present", async () => {
      const reactor = createCustomEvaluationSyncReactor(deps);
      const span = makeOtlpSpan([
        { evaluator_id: "my-evaluator", name: "toxicity", score: 0.1 },
      ]);

      await reactor.handle(
        createSpanReceivedEvent(span),
        createContext(createFoldState()),
      );

      const call = vi.mocked(deps.reportEvaluation).mock.calls[0]![0];
      expect(call.evaluatorId).toBe("my-evaluator");
    });

    it("passes occurredAt from the event", async () => {
      const reactor = createCustomEvaluationSyncReactor(deps);
      const span = makeOtlpSpan([{ name: "toxicity", score: 0.1 }]);
      const eventOccurredAt = Date.now();
      const event = createSpanReceivedEvent(span, {
        occurredAt: eventOccurredAt,
      } as any);

      await reactor.handle(event, createContext(createFoldState()));

      const call = vi.mocked(deps.reportEvaluation).mock.calls[0]![0];
      expect(call.occurredAt).toBe(eventOccurredAt);
    });
  });

  describe("when event is too old", () => {
    it("skips processing", async () => {
      const reactor = createCustomEvaluationSyncReactor(deps);
      const span = makeOtlpSpan([{ name: "toxicity", score: 0.1 }]);
      const oldEvent = createSpanReceivedEvent(span, {
        occurredAt: Date.now() - 2 * 60 * 60 * 1000,
      } as any);

      await reactor.handle(oldEvent, createContext(createFoldState()));

      expect(deps.reportEvaluation).not.toHaveBeenCalled();
    });
  });

  describe("when evaluation has error info", () => {
    it("sets status to 'error' and passes error message", async () => {
      const reactor = createCustomEvaluationSyncReactor(deps);
      const span = makeOtlpSpan([
        {
          name: "toxicity",
          status: "error",
          error: { message: "Evaluation failed" },
        },
      ]);

      await reactor.handle(
        createSpanReceivedEvent(span),
        createContext(createFoldState()),
      );

      const call = vi.mocked(deps.reportEvaluation).mock.calls[0]![0];
      expect(call.status).toBe("error");
      expect(call.error).toBe("Evaluation failed");
    });
  });

  describe("when a single evaluation command fails", () => {
    it("continues processing remaining evaluations then re-throws", async () => {
      deps.reportEvaluation = vi
        .fn()
        .mockRejectedValueOnce(new Error("network error"))
        .mockResolvedValueOnce(undefined);

      const reactor = createCustomEvaluationSyncReactor(deps);
      const span = makeOtlpSpan([
        { name: "toxicity", score: 0.1 },
        { name: "relevance", score: 0.9 },
      ]);

      await expect(
        reactor.handle(
          createSpanReceivedEvent(span),
          createContext(createFoldState()),
        ),
      ).rejects.toThrow("network error");

      expect(deps.reportEvaluation).toHaveBeenCalledTimes(2);
    });
  });

  describe("when the same span is processed twice", () => {
    it("produces the same evaluation ID both times (idempotent)", async () => {
      const reactor = createCustomEvaluationSyncReactor(deps);
      const span = makeOtlpSpan([{ name: "toxicity", score: 0.1 }]);
      const event = createSpanReceivedEvent(span);

      await reactor.handle(event, createContext(createFoldState()));
      await reactor.handle(event, createContext(createFoldState()));

      const id1 = vi.mocked(deps.reportEvaluation).mock.calls[0]![0].evaluationId;
      const id2 = vi.mocked(deps.reportEvaluation).mock.calls[1]![0].evaluationId;
      expect(id1).toBe(id2);
    });
  });

  describe("when evaluation has is_guardrail flag", () => {
    it("passes isGuardrail to reportEvaluation command", async () => {
      const reactor = createCustomEvaluationSyncReactor(deps);
      const span = makeOtlpSpan([
        { name: "content filter", score: 1.0, is_guardrail: true },
      ]);

      await reactor.handle(
        createSpanReceivedEvent(span),
        createContext(createFoldState()),
      );

      const call = vi.mocked(deps.reportEvaluation).mock.calls[0]![0];
      expect(call.isGuardrail).toBe(true);
    });
  });
});
