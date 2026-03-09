import type { Event } from "~/server/event-sourcing/domain/types.js";
import type { EvaluationRunData } from "~/server/app-layer/evaluations/types.js";
import type { FoldProjectionStore } from "~/server/event-sourcing/projections/foldProjection.types.js";
import type {
  EvaluationScheduledEvent,
  EvaluationStartedEvent,
  EvaluationCompletedEvent,
  EvaluationProcessingEvent,
} from "~/server/event-sourcing/pipelines/evaluation-processing/schemas/events.js";
import {
  EVALUATION_SCHEDULED_EVENT_TYPE,
  EVALUATION_STARTED_EVENT_TYPE,
  EVALUATION_COMPLETED_EVENT_TYPE,
  EVALUATION_SCHEDULED_EVENT_VERSION_LATEST,
  EVALUATION_STARTED_EVENT_VERSION_LATEST,
  EVALUATION_COMPLETED_EVENT_VERSION_LATEST,
} from "~/server/event-sourcing/pipelines/evaluation-processing/schemas/constants.js";
import { createEvaluationRunFoldProjection } from "~/server/event-sourcing/pipelines/evaluation-processing/projections/evaluationRun.foldProjection.js";
import { EventUtils } from "~/server/event-sourcing/utils/event.utils.js";
import { eventToRecord } from "~/server/event-sourcing/stores/eventStoreUtils.js";
import type {
  ElasticSearchTrace,
  ElasticSearchEvaluation,
} from "~/server/tracer/types.js";
import type { EsHit, MigrationDefinition, DirectWriteResult } from "../../lib/types.js";

/** An evaluation extracted from an ES trace doc, with trace context. */
interface EvaluationWithContext {
  evaluation: ElasticSearchEvaluation;
  traceId: string;
  projectId: string;
  esDocId: string;
  traceStartedAt: number;
}

interface TraceEvaluationMigrationDeps {
  evaluationRunStore: FoldProjectionStore<EvaluationRunData>;
}

type EsTraceDoc = ElasticSearchTrace & EsHit;

export function createTraceEvaluationMigrationDefinition(
  deps: TraceEvaluationMigrationDeps,
): MigrationDefinition<EvaluationWithContext> {
  const noopStore = {
    get: async () => null,
    store: async () => {},
  };

  // Create projection definition to reuse init/apply pure functions
  const foldProjection = createEvaluationRunFoldProjection({
    store: noopStore as any,
  });

  return {
    name: "trace-evaluations",
    esIndex: "search-traces-alias",
    esQuery: {
      nested: {
        path: "evaluations",
        query: { exists: { field: "evaluations.evaluation_id" } },
      },
    },
    esSort: [{ "timestamps.started_at": "asc" }, { trace_id: "asc" }],
    aggregateType: "evaluation",
    timestampField: "timestamps.started_at",
    statsField: "timestamps.started_at",

    getTenantAggregates(events: EsHit[]): Map<string, Set<string>> {
      const map = new Map<string, Set<string>>();
      for (const raw of events) {
        const doc = raw as unknown as EsTraceDoc;
        const tenantId = doc.project_id;
        let ids = map.get(tenantId);
        if (!ids) {
          ids = new Set();
          map.set(tenantId, ids);
        }
        for (const evaluation of doc.evaluations ?? []) {
          // Must match what processAggregate stores as aggregateId (evaluation_id only)
          ids.add(evaluation.evaluation_id);
        }
      }
      return map;
    },

    aggregate(events: EsHit[]): Map<string, EvaluationWithContext> {
      const aggregates = new Map<string, EvaluationWithContext>();
      for (const raw of events) {
        const doc = raw as unknown as EsTraceDoc;
        for (const evaluation of doc.evaluations ?? []) {
          // Key by trace+eval to avoid collisions when the same monitor evaluates multiple traces
          const key = `${doc.trace_id}:${evaluation.evaluation_id}`;
          aggregates.set(key, {
            evaluation,
            traceId: doc.trace_id,
            projectId: doc.project_id,
            esDocId: doc._id,
            traceStartedAt: doc.timestamps.started_at,
          });
        }
      }
      return aggregates;
    },

    buildCommands() {
      // Not used — processAggregate is used instead
      return [];
    },

    processAggregate(
      doc: EvaluationWithContext,
      aggregateId: string,
    ): DirectWriteResult {
      const { evaluation, traceId, projectId, traceStartedAt } = doc;
      const tenantId = projectId;
      const evaluationId = evaluation.evaluation_id;

      // Skip incomplete evaluations — they don't have final results
      if (evaluation.status === "scheduled" || evaluation.status === "in_progress") {
        return {
          eventRecords: [],
          projectionWrites: [],
          commandCount: 0,
          projectionState: null,
        };
      }

      // Use the evaluation's own timestamp, falling back to the trace's business timestamp — never Date.now()
      const occurredAt = evaluation.timestamps.started_at ?? evaluation.timestamps.inserted_at ?? traceStartedAt;
      const allEvents: Event[] = [];

      // 1. EvaluationScheduledEvent
      const scheduledEvent = EventUtils.createEvent<EvaluationScheduledEvent>({
        aggregateType: "evaluation" as any,
        aggregateId: evaluationId,
        tenantId: tenantId as any,
        type: EVALUATION_SCHEDULED_EVENT_TYPE,
        version: EVALUATION_SCHEDULED_EVENT_VERSION_LATEST,
        data: {
          evaluationId,
          evaluatorId: evaluation.evaluator_id,
          evaluatorType: evaluation.type ?? "unknown",
          evaluatorName: evaluation.name,
          traceId,
          isGuardrail: evaluation.is_guardrail ?? false,
        },
        occurredAt,
        idempotencyKey: `${tenantId}:${evaluationId}:scheduled`,
      });
      allEvents.push(scheduledEvent);

      // 2. EvaluationStartedEvent
      const startedEvent = EventUtils.createEvent<EvaluationStartedEvent>({
        aggregateType: "evaluation" as any,
        aggregateId: evaluationId,
        tenantId: tenantId as any,
        type: EVALUATION_STARTED_EVENT_TYPE,
        version: EVALUATION_STARTED_EVENT_VERSION_LATEST,
        data: {
          evaluationId,
          evaluatorId: evaluation.evaluator_id,
          evaluatorType: evaluation.type ?? "unknown",
          evaluatorName: evaluation.name,
          traceId,
          isGuardrail: evaluation.is_guardrail ?? false,
        },
        occurredAt,
        idempotencyKey: `${tenantId}:${evaluationId}:started`,
      });
      allEvents.push(startedEvent);

      // 3. EvaluationCompletedEvent
      const completedOccurredAt = evaluation.timestamps.finished_at ?? occurredAt;
      const errorMessage = evaluation.error?.message ?? null;
      const errorDetails = evaluation.error?.stacktrace?.join("\n") ?? null;
      const completedEvent = EventUtils.createEvent<EvaluationCompletedEvent>({
        aggregateType: "evaluation" as any,
        aggregateId: evaluationId,
        tenantId: tenantId as any,
        type: EVALUATION_COMPLETED_EVENT_TYPE,
        version: EVALUATION_COMPLETED_EVENT_VERSION_LATEST,
        data: {
          evaluationId,
          status: evaluation.status as "processed" | "error" | "skipped",
          score: typeof evaluation.score === "number" ? evaluation.score : null,
          passed: evaluation.passed ?? null,
          label: evaluation.label ?? null,
          details: evaluation.details ?? null,
          error: errorMessage,
          errorDetails,
        },
        occurredAt: completedOccurredAt,
        idempotencyKey: `${tenantId}:${evaluationId}:completed`,
      });
      allEvents.push(completedEvent);

      // Compute fold projection (EvaluationRun) in memory
      let evalRunState = foldProjection.init();
      for (const event of allEvents) {
        evalRunState = foldProjection.apply(
          evalRunState,
          event as EvaluationProcessingEvent,
        );
      }

      // Convert to event records
      const eventRecords = allEvents.map(eventToRecord);

      // Build projection write
      const storeContext = { aggregateId: evaluationId, tenantId: tenantId as any };
      const projectionWrites: Array<() => Promise<void>> = [
        () => deps.evaluationRunStore.store(evalRunState, storeContext),
      ];

      return {
        eventRecords,
        projectionWrites,
        commandCount: 3,
        projectionState: evalRunState,
      };
    },
  };
}
