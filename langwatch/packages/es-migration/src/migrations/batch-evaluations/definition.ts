import type { Event } from "~/server/event-sourcing/domain/types.js";
import { ExperimentRunStateFoldProjection } from "~/server/event-sourcing/pipelines/experiment-run-processing/projections/experimentRunState.foldProjection.js";
import type { ExperimentRunStateData } from "~/server/event-sourcing/pipelines/experiment-run-processing/projections/experimentRunState.foldProjection.js";
import { ExperimentRunResultStorageMapProjection } from "~/server/event-sourcing/pipelines/experiment-run-processing/projections/experimentRunResultStorage.mapProjection.js";
import type { ClickHouseExperimentRunResultRecord } from "~/server/event-sourcing/pipelines/experiment-run-processing/projections/experimentRunResultStorage.mapProjection.js";
import {
  EXPERIMENT_RUN_EVENT_TYPES,
  EXPERIMENT_RUN_EVENT_VERSIONS,
} from "~/server/event-sourcing/pipelines/experiment-run-processing/schemas/constants.js";
import type {
  ExperimentRunStartedEvent,
  TargetResultEvent,
  EvaluatorResultEvent,
  ExperimentRunCompletedEvent,
  ExperimentRunProcessingEvent,
} from "~/server/event-sourcing/pipelines/experiment-run-processing/schemas/events.js";
import { EventUtils } from "~/server/event-sourcing/utils/event.utils.js";
import { eventToRecord } from "~/server/event-sourcing/stores/eventStoreUtils.js";
import type { FoldProjectionStore } from "~/server/event-sourcing/projections/foldProjection.types.js";
import type { AppendStore } from "~/server/event-sourcing/projections/mapProjection.types.js";
import type { ESBatchEvaluation } from "~/server/experiments/types.js";
import type { EsHit, MigrationDefinition, DirectWriteResult } from "../../lib/types.js";

/** Normalize timestamp to milliseconds. Handles string and number inputs. */
function toEpochMs(ts: number | string): number {
  const n = typeof ts === "string" ? Number(ts) : ts;
  if (Number.isNaN(n)) return Date.now();
  return n < 1e12 ? n * 1000 : n;
}

type EsBatchEvaluationDoc = ESBatchEvaluation & EsHit;

interface EvaluationMigrationDeps {
  experimentRunStateFoldStore: FoldProjectionStore<ExperimentRunStateData>;
  experimentRunItemAppendStore: AppendStore<ClickHouseExperimentRunResultRecord>;
}

export function createEvaluationMigrationDefinition(
  deps: EvaluationMigrationDeps,
): MigrationDefinition<EsBatchEvaluationDoc> {
  const noopStore = {
    get: async () => null,
    store: async () => {},
  };
  const noopAppendStore = { append: async () => {} };

  // Create projection definitions to reuse their pure init/apply/map functions
  const foldProjection = new ExperimentRunStateFoldProjection({
    store: noopStore as any,
  });
  const mapProjection = new ExperimentRunResultStorageMapProjection({
    store: noopAppendStore as any,
  });

  return {
    name: "evaluations",
    esIndex: "search-batch-evaluations-alias",
    esSort: [{ "timestamps.created_at": "asc" }, { run_id: "asc" }],
    aggregateType: "experiment_run",
    timestampField: "timestamps.created_at",
    statsField: "timestamps.created_at",

    getTenantAggregates(events: EsHit[]): Map<string, Set<string>> {
      const map = new Map<string, Set<string>>();
      for (const raw of events) {
        const doc = raw as unknown as EsBatchEvaluationDoc;
        const aggId = `${doc.experiment_id}:${doc.run_id}`;
        let ids = map.get(doc.project_id);
        if (!ids) {
          ids = new Set();
          map.set(doc.project_id, ids);
        }
        ids.add(aggId);
      }
      return map;
    },

    aggregate(events: EsHit[]): Map<string, EsBatchEvaluationDoc> {
      const aggregates = new Map<string, EsBatchEvaluationDoc>();
      for (const raw of events) {
        const doc = raw as unknown as EsBatchEvaluationDoc;
        const key = `${doc.experiment_id}:${doc.run_id}`;
        aggregates.set(key, doc);
      }
      return aggregates;
    },

    buildCommands() {
      // Not used — processAggregate is used instead
      return [];
    },

    processAggregate(
      doc: EsBatchEvaluationDoc,
      _aggregateId: string,
    ): DirectWriteResult {
      const tenantId = doc.project_id;
      const runId = doc.run_id;
      const experimentId = doc.experiment_id;
      const aggregateId = `${experimentId}:${runId}`;
      const occurredAt = toEpochMs(doc.timestamps.created_at);

      const allEvents: Event[] = [];

      // 1. ExperimentRunStartedEvent
      const targets = (doc.targets ?? []).map((t) => ({
        id: t.id,
        name: t.name,
        type: t.type,
        promptId: t.prompt_id ?? null,
        promptVersion: t.prompt_version ?? null,
        agentId: t.agent_id ?? null,
        evaluatorId: t.evaluator_id ?? null,
        model: t.model ?? null,
        metadata: t.metadata ?? null,
      }));

      allEvents.push(
        EventUtils.createEvent<ExperimentRunStartedEvent>({
          aggregateType: "experiment_run" as any,
          aggregateId,
          tenantId: tenantId as any,
          type: EXPERIMENT_RUN_EVENT_TYPES.STARTED,
          version: EXPERIMENT_RUN_EVENT_VERSIONS.STARTED,
          data: {
            runId,
            experimentId,
            workflowVersionId: doc.workflow_version_id ?? null,
            total: doc.total ?? doc.dataset.length,
            targets,
          },
          occurredAt,
          idempotencyKey: `${tenantId}:${runId}:start`,
        }),
      );

      // 2. TargetResultEvent × N (one per dataset entry)
      for (const entry of doc.dataset) {
        const targetId = entry.target_id ?? "default";
        allEvents.push(
          EventUtils.createEvent<TargetResultEvent>({
            aggregateType: "experiment_run" as any,
            aggregateId,
            tenantId: tenantId as any,
            type: EXPERIMENT_RUN_EVENT_TYPES.TARGET_RESULT,
            version: EXPERIMENT_RUN_EVENT_VERSIONS.TARGET_RESULT,
            data: {
              runId,
              experimentId,
              index: entry.index,
              targetId,
              entry: entry.entry,
              predicted: entry.predicted ?? null,
              cost: entry.cost ?? null,
              duration: entry.duration ?? null,
              error: entry.error ?? null,
              traceId: entry.trace_id ?? null,
            },
            occurredAt,
            idempotencyKey: `${tenantId}:${runId}:target:${entry.index}:${targetId}`,
          }),
        );
      }

      // 3. EvaluatorResultEvent × N (one per evaluation)
      for (const evaluation of doc.evaluations) {
        const targetId = evaluation.target_id ?? "default";
        allEvents.push(
          EventUtils.createEvent<EvaluatorResultEvent>({
            aggregateType: "experiment_run" as any,
            aggregateId,
            tenantId: tenantId as any,
            type: EXPERIMENT_RUN_EVENT_TYPES.EVALUATOR_RESULT,
            version: EXPERIMENT_RUN_EVENT_VERSIONS.EVALUATOR_RESULT,
            data: {
              runId,
              experimentId,
              index: evaluation.index,
              targetId,
              evaluatorId: evaluation.evaluator,
              evaluatorName: evaluation.name ?? null,
              status: evaluation.status,
              score:
                typeof evaluation.score === "number" ? evaluation.score : null,
              label: evaluation.label ?? null,
              passed: evaluation.passed ?? null,
              details: evaluation.details ?? null,
              cost: evaluation.cost ?? null,
              inputs: evaluation.inputs ?? null,
              duration: evaluation.duration ?? null,
            },
            occurredAt,
            idempotencyKey: `${tenantId}:${runId}:eval:${evaluation.index}:${targetId}:${evaluation.evaluator}`,
          }),
        );
      }

      // 4. ExperimentRunCompletedEvent
      allEvents.push(
        EventUtils.createEvent<ExperimentRunCompletedEvent>({
          aggregateType: "experiment_run" as any,
          aggregateId,
          tenantId: tenantId as any,
          type: EXPERIMENT_RUN_EVENT_TYPES.COMPLETED,
          version: EXPERIMENT_RUN_EVENT_VERSIONS.COMPLETED,
          data: {
            runId,
            experimentId,
            finishedAt: doc.timestamps.finished_at
              ? toEpochMs(doc.timestamps.finished_at)
              : null,
            stoppedAt: doc.timestamps.stopped_at
              ? toEpochMs(doc.timestamps.stopped_at)
              : null,
          },
          occurredAt,
          idempotencyKey: `${tenantId}:${runId}:complete`,
        }),
      );

      // Compute fold projection (experiment_runs) in memory
      let state = foldProjection.init();
      state = { ...state, CreatedAt: occurredAt };
      for (const event of allEvents) {
        state = foldProjection.apply(
          state,
          event as ExperimentRunProcessingEvent,
        );
      }

      // Compute map projection (experiment_run_items) for target + evaluator events
      const itemRecords: ClickHouseExperimentRunResultRecord[] = [];
      for (const event of allEvents) {
        if (
          event.type === EXPERIMENT_RUN_EVENT_TYPES.TARGET_RESULT ||
          event.type === EXPERIMENT_RUN_EVENT_TYPES.EVALUATOR_RESULT
        ) {
          const record = mapProjection.map(event as any);
          if (record) {
            itemRecords.push(record);
          }
        }
      }

      // Convert domain events to event records
      const eventRecords = allEvents.map(eventToRecord);

      // Build projection write closures
      const storeContext = { aggregateId, tenantId: tenantId as any };

      const projectionWrites: Array<() => Promise<void>> = [];

      // Fold: experiment_runs
      projectionWrites.push(() =>
        deps.experimentRunStateFoldStore.store(state, storeContext),
      );

      // Map: experiment_run_items
      for (const record of itemRecords) {
        projectionWrites.push(() =>
          deps.experimentRunItemAppendStore.append(record, storeContext),
        );
      }

      return {
        eventRecords,
        projectionWrites,
        commandCount: allEvents.length,
        projectionState: state,
      };
    },
  };
}
