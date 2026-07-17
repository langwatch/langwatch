import { describe, expect, it, vi } from "vitest";

import type { EvaluationRunData } from "~/server/app-layer/evaluations/types";
import { createTenantId } from "../../../domain/tenantId";
import type { FoldProjectionStore } from "../../../projections/foldProjection.types";
import type { EventSourcedQueueProcessor } from "../../../queues";
import { EventSourcingService } from "../../../services/eventSourcingService";
import {
  type JobRegistryEntry,
  QueueManager,
} from "../../../services/queues/queueManager";
import { EventStoreMemory } from "../../../stores/eventStoreMemory";
import { EventRepositoryMemory } from "../../../stores/repositories/eventRepositoryMemory";
import { CompleteEvaluationCommand, StartEvaluationCommand } from "../commands";
import { createEvaluationProcessingPipeline } from "../pipeline";
import {
  EvaluationAnalyticsFoldProjection,
  type EvaluationAnalyticsData,
} from "../projections/evaluationAnalytics.foldProjection";
import { EvaluationRunFoldProjection } from "../projections/evaluationRun.foldProjection";
import type {
  EvaluationCompletedEvent,
  EvaluationProcessingEvent,
  EvaluationStartedEvent,
} from "../schemas/events";

const tenantId = createTenantId("project-1");

function foldStore<State>(): FoldProjectionStore<State> {
  return {
    get: vi.fn().mockResolvedValue(null),
    store: vi.fn().mockResolvedValue(undefined),
  };
}

function sharedQueue(): EventSourcedQueueProcessor<Record<string, unknown>> {
  return {
    send: vi.fn().mockResolvedValue(undefined),
    sendBatch: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    waitUntilReady: vi.fn().mockResolvedValue(undefined),
  };
}

function startedEvent(params: {
  evaluationId: string;
  id: string;
  createdAt: number;
  occurredAt: number;
}): EvaluationStartedEvent {
  return {
    id: params.id,
    aggregateId: params.evaluationId,
    aggregateType: "evaluation",
    tenantId,
    createdAt: params.createdAt,
    occurredAt: params.occurredAt,
    type: "lw.evaluation.started",
    version: "2025-01-14",
    data: {
      evaluationId: params.evaluationId,
      evaluatorId: "evaluator-1",
      evaluatorType: "custom",
    },
  };
}

function completedEvent(params: {
  evaluationId: string;
  id: string;
  createdAt: number;
  occurredAt: number;
}): EvaluationCompletedEvent {
  return {
    id: params.id,
    aggregateId: params.evaluationId,
    aggregateType: "evaluation",
    tenantId,
    createdAt: params.createdAt,
    occurredAt: params.occurredAt,
    type: "lw.evaluation.completed",
    version: "2025-01-14",
    data: {
      evaluationId: params.evaluationId,
      status: "processed",
    },
  };
}

describe("evaluation processing live FIFO", () => {
  it("uses evaluationId as the aggregate identity for every lifecycle command", () => {
    expect(
      StartEvaluationCommand.getAggregateId({
        tenantId,
        evaluationId: "random-evaluation-id",
        evaluatorId: "evaluator-1",
        evaluatorType: "custom",
        occurredAt: 1_000,
      }),
    ).toBe("random-evaluation-id");
    expect(
      CompleteEvaluationCommand.getAggregateId({
        tenantId,
        evaluationId: "random-evaluation-id",
        status: "processed",
        occurredAt: 2_000,
      }),
    ).toBe("random-evaluation-id");
  });

  it("groups one evaluation together, separates other evaluations, and scores by accepted order", () => {
    const registry = new Map<string, JobRegistryEntry>();
    new EventSourcingService<EvaluationProcessingEvent>({
      pipelineName: "evaluation_processing",
      aggregateType: "evaluation",
      eventStore: new EventStoreMemory(new EventRepositoryMemory()),
      foldProjections: [
        new EvaluationRunFoldProjection({
          store: foldStore<EvaluationRunData>(),
        }),
        new EvaluationAnalyticsFoldProjection({
          store: foldStore<EvaluationAnalyticsData>(),
        }),
      ],
      globalQueue: sharedQueue(),
      globalJobRegistry: registry,
    });

    const runEntry = registry.get(
      "evaluation_processing:projection:evaluationRun",
    );
    const analyticsEntry = registry.get(
      "evaluation_processing:projection:evaluationAnalytics",
    );
    expect(runEntry).toBeDefined();
    expect(analyticsEntry).toBeDefined();

    const firstAccepted = startedEvent({
      evaluationId: "eval-random-a",
      id: "evt-a",
      createdAt: 1_000,
      occurredAt: 9_000,
    });
    const laterAcceptedButBackdated = completedEvent({
      evaluationId: "eval-random-a",
      id: "evt-b",
      createdAt: 2_000,
      occurredAt: 500,
    });
    const otherEvaluation = startedEvent({
      evaluationId: "eval-random-b",
      id: "evt-c",
      createdAt: 1_500,
      occurredAt: 9_500,
    });

    expect(runEntry?.groupKeyFn(firstAccepted)).toBe(
      runEntry?.groupKeyFn(laterAcceptedButBackdated),
    );
    expect(runEntry?.groupKeyFn(firstAccepted)).not.toBe(
      runEntry?.groupKeyFn(otherEvaluation),
    );
    expect(runEntry?.scoreFn(firstAccepted)).toBe(1_000);
    expect(runEntry?.scoreFn(laterAcceptedButBackdated)).toBe(2_000);
    expect(analyticsEntry?.scoreFn(laterAcceptedButBackdated)).toBe(2_000);
  });

  it("serializes different lifecycle commands for one evaluation while leaving other evaluations independent", () => {
    const registry = new Map<string, JobRegistryEntry>();
    const manager = new QueueManager<EvaluationProcessingEvent>({
      aggregateType: "evaluation",
      pipelineName: "evaluation_processing",
      globalQueue: sharedQueue(),
      globalJobRegistry: registry,
    });

    manager.initializeCommandQueues(
      [
        {
          name: "startEvaluation",
          handlerClass: StartEvaluationCommand as never,
          options: { serializeByAggregate: true },
        },
        {
          name: "completeEvaluation",
          handlerClass: CompleteEvaluationCommand as never,
          options: { serializeByAggregate: true },
        },
      ],
      vi.fn(),
      "evaluation_processing",
    );

    const startEntry = registry.get(
      "evaluation_processing:command:startEvaluation",
    );
    const completeEntry = registry.get(
      "evaluation_processing:command:completeEvaluation",
    );
    const commandPayload = (evaluationId: string) => ({
      tenantId,
      evaluationId,
      occurredAt: 1_000,
    });

    expect(startEntry?.groupKeyFn(commandPayload("eval-random-a"))).toBe(
      completeEntry?.groupKeyFn(commandPayload("eval-random-a")),
    );
    expect(startEntry?.groupKeyFn(commandPayload("eval-random-a"))).not.toBe(
      completeEntry?.groupKeyFn(commandPayload("eval-random-b")),
    );

    const now = vi
      .spyOn(Date, "now")
      .mockReturnValueOnce(10_000)
      .mockReturnValueOnce(20_000);
    expect(
      startEntry?.scoreFn({
        ...commandPayload("eval-random-a"),
        occurredAt: 99_000,
      }),
    ).toBe(10_000);
    expect(
      completeEntry?.scoreFn({
        ...commandPayload("eval-random-a"),
        occurredAt: 500,
      }),
    ).toBe(20_000);
    now.mockRestore();
  });

  it("opts every evaluation-processing command into aggregate serialization", () => {
    const pipeline = createEvaluationProcessingPipeline({
      evalRunStore: foldStore<EvaluationRunData>(),
      evaluationAnalyticsStore: foldStore<EvaluationAnalyticsData>(),
      evaluationAnalyticsRollupAppendStore: {
        append: vi.fn().mockResolvedValue(undefined),
      },
      executeEvaluationCommand: {} as never,
      evaluationAlertTriggerReactor: {
        name: "evaluationAlertTrigger",
      } as never,
      evaluationAlertTriggerNotifyOutboxReactor: {
        name: "evaluationAlertTriggerNotifyOutbox",
      } as never,
      graphTriggerEvaluationOutboxReactor: {
        name: "graphTriggerEvaluation",
      } as never,
    });

    expect(
      pipeline.commands.map(({ name, options }) => [
        name,
        options?.serializeByAggregate,
      ]),
    ).toEqual([
      ["executeEvaluation", true],
      ["startEvaluation", true],
      ["completeEvaluation", true],
      ["reportEvaluation", true],
    ]);
  });
});
