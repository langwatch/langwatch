import {
  type AppendStore,
  defineAggregate,
  defineCommand,
  defineEvents,
  definePipeline,
  type FoldProjectionStore,
} from "@langwatch/eventing";
import {
  type ClickHouseExperimentRunResultRecord,
  ExperimentRunResultStorageMapProjection,
} from "../projections/experiment-run-result-storage.projection";
import {
  type ExperimentRunStateData,
  ExperimentRunStateFoldProjection,
} from "../projections/experiment-run-state.projection";
import { EXPERIMENT_RUN_PROCESSING_EVENT_TYPES } from "../rules/experiment-run-event-types.rules";
import {
  evaluatorResultEventDataSchema,
  experimentRunCompletedEventDataSchema,
  experimentRunStartedEventDataSchema,
  type ExperimentRunProcessingEvent,
  targetResultEventDataSchema,
  traceMetricsComputedEventDataSchema,
} from "../processes/experiment-run-events.process";
import { makeExperimentRunKey } from "../processes/experiment-run-key.process";
import type { ExperimentClickHousePort } from "../ports/experiment-clickhouse.port";
import {
  ExperimentClickHouseAdapter,
  type ExperimentEventingClickHouseResolver,
} from "./experiment-clickhouse.adapter";
import { ClickHouseExperimentIdLookupRepository } from "../repositories/clickhouse/clickhouse.experiment-id-lookup.repository";
import { MemoryExperimentIdLookupRepository } from "../repositories/memory/memory.experiment-id-lookup.repository";
import type { ExperimentIdLookupRepository } from "../repositories/experiment-id-lookup.repository";
import { ClickHouseExperimentRunStateRepository } from "../repositories/clickhouse/clickhouse.experiment-run-state.repository";
import { MemoryExperimentRunStateRepository } from "../repositories/memory/memory.experiment-run-state.repository";
import type { ExperimentRunStateRepository } from "../repositories/experiment-run-state.repository";
import { ExperimentRunItemStore } from "../stores/eventing/eventing.experiment-run-item.store";

/**
 * All experiment-run-processing commands defined from event data schemas.
 */

export const StartExperimentRunCommand = defineCommand({
  commandType: "lw.experiment_run.start",
  eventType: "lw.experiment_run.started",
  eventVersion: "2025-02-01",
  aggregateType: "experiment_run",
  schema: experimentRunStartedEventDataSchema,
  aggregateId: (d) => makeExperimentRunKey(d.experimentId, d.runId),
  idempotencyKey: (d) => `${d.tenantId}:${d.runId}:start`,
  spanAttributes: (d) => ({
    "payload.run.id": d.runId,
    "payload.experiment.id": d.experimentId,
    "payload.total": d.total,
  }),
  makeJobId: (d) => `${d.tenantId}:${d.runId}:start`,
});

/**
 * The identity of one cell result, used both to order the event and to name
 * its queue job.
 */
const targetResultIdentity = (d: {
  tenantId: string;
  runId: string;
  targetId: string;
  index: number;
}) => `${d.tenantId}:${d.runId}:target:${d.targetId}:${d.index}`;

const evaluatorResultIdentity = (d: {
  tenantId: string;
  runId: string;
  targetId: string;
  evaluatorId: string;
  index: number;
}) => `${d.tenantId}:${d.runId}:evaluator:${d.targetId}:${d.evaluatorId}:${d.index}`;

export const RecordTargetResultCommand = defineCommand({
  commandType: "lw.experiment_run.record_target_result",
  eventType: "lw.experiment_run.target_result",
  eventVersion: "2025-02-01",
  aggregateType: "experiment_run",
  schema: targetResultEventDataSchema,
  aggregateId: (d) => makeExperimentRunKey(d.experimentId, d.runId),
  groupKey: (d) => `${d.experimentId}:${d.runId}:item:${d.index}`,
  idempotencyKey: targetResultIdentity,
  spanAttributes: (d) => ({
    "payload.run.id": d.runId,
    "payload.experiment.id": d.experimentId,
    "payload.target.id": d.targetId,
    "payload.index": d.index,
  }),
  makeJobId: targetResultIdentity,
});

/**
 * A verdict is identified by its target as well as its evaluator and its row.
 */
export const RecordEvaluatorResultCommand = defineCommand({
  commandType: "lw.experiment_run.record_evaluator_result",
  eventType: "lw.experiment_run.evaluator_result",
  eventVersion: "2025-02-01",
  aggregateType: "experiment_run",
  schema: evaluatorResultEventDataSchema,
  aggregateId: (d) => makeExperimentRunKey(d.experimentId, d.runId),
  groupKey: (d) => `${d.experimentId}:${d.runId}:item:${d.index}`,
  idempotencyKey: evaluatorResultIdentity,
  spanAttributes: (d) => ({
    "payload.run.id": d.runId,
    "payload.experiment.id": d.experimentId,
    "payload.target.id": d.targetId,
    "payload.evaluator.id": d.evaluatorId,
    "payload.index": d.index,
  }),
  makeJobId: evaluatorResultIdentity,
});

export const ComputeExperimentRunMetricsCommand = defineCommand({
  commandType: "lw.experiment_run.compute_trace_metrics",
  eventType: "lw.experiment_run.trace_metrics_computed",
  eventVersion: "2026-04-15",
  aggregateType: "experiment_run",
  schema: traceMetricsComputedEventDataSchema,
  aggregateId: (d) => makeExperimentRunKey(d.experimentId, d.runId),
  idempotencyKey: (d) => `${d.tenantId}:${d.runId}:trace-metrics:${d.traceId}`,
  spanAttributes: (d) => ({
    "payload.run.id": d.runId,
    "payload.experiment.id": d.experimentId,
    "payload.trace.id": d.traceId,
    "payload.total_cost": d.totalCost,
  }),
  makeJobId: (d) => `${d.tenantId}:${d.runId}:trace-metrics:${d.traceId}`,
});

export const CompleteExperimentRunCommand = defineCommand({
  commandType: "lw.experiment_run.complete",
  eventType: "lw.experiment_run.completed",
  eventVersion: "2025-02-01",
  aggregateType: "experiment_run",
  schema: experimentRunCompletedEventDataSchema,
  aggregateId: (d) => makeExperimentRunKey(d.experimentId, d.runId),
  idempotencyKey: (d) => `${d.tenantId}:${d.runId}:complete`,
  spanAttributes: (d) => ({
    "payload.run.id": d.runId,
    "payload.experiment.id": d.experimentId,
  }),
  makeJobId: (d) => `${d.tenantId}:${d.runId}:complete`,
});

export type ExperimentRunEventingStateRepository = ExperimentRunStateRepository;
export type ExperimentRunEventingIdLookup = ExperimentIdLookupRepository;
export type ExperimentRunEventingResultRecord = ClickHouseExperimentRunResultRecord;
export type ExperimentRunEventingState = ExperimentRunStateData;

export interface ExperimentRunProcessingPipelineDeps {
  experimentRunStateFoldStore: FoldProjectionStore<ExperimentRunStateData>;
  experimentRunItemAppendStore: AppendStore<ClickHouseExperimentRunResultRecord>;
}

/**
 * The Eventing side of experiment run processing: the storage this feature's
 * pipeline reads and writes through, and the pipeline definition itself.
 */
export class ExperimentEventingAdapter {
  private constructor(private readonly clickhouse: ExperimentClickHousePort | null) {}

  static create(input: {
    resolveClient: ExperimentEventingClickHouseResolver;
    clickhouseEnabled: boolean;
  }): ExperimentEventingAdapter {
    return new ExperimentEventingAdapter(
      input.clickhouseEnabled ? ExperimentClickHouseAdapter.create(input.resolveClient) : null,
    );
  }

  stateRepository(input: { defaultRetentionDays: number }): ExperimentRunStateRepository {
    return this.clickhouse
      ? ClickHouseExperimentRunStateRepository.create({
          clickhouse: this.clickhouse,
          defaultRetentionDays: input.defaultRetentionDays,
        })
      : MemoryExperimentRunStateRepository.create();
  }

  idLookup(): ExperimentIdLookupRepository {
    return this.clickhouse
      ? ClickHouseExperimentIdLookupRepository.create({ clickhouse: this.clickhouse })
      : MemoryExperimentIdLookupRepository.create();
  }

  itemStore(input: {
    defaultRetentionDays: number;
  }): AppendStore<ClickHouseExperimentRunResultRecord> {
    return ExperimentRunItemStore.create({
      clickhouse: this.clickhouse,
      defaultRetentionDays: input.defaultRetentionDays,
    });
  }

  static pipeline(deps: ExperimentRunProcessingPipelineDeps) {
    const builder = definePipeline<ExperimentRunProcessingEvent>({
      name: "experiment_run_processing",
      aggregate: defineAggregate({
        type: "experiment_run",
        events: defineEvents(EXPERIMENT_RUN_PROCESSING_EVENT_TYPES),
      }),
    })
      .withClickHouseFoldProjection(
        ExperimentRunStateFoldProjection.create({
          store: deps.experimentRunStateFoldStore,
        }),
      )
      .withClickHouseMapProjection(
        ExperimentRunResultStorageMapProjection.create({
          store: deps.experimentRunItemAppendStore,
        }),
      );

    return builder
      .withCommand("startExperimentRun", StartExperimentRunCommand)
      .withCommand("recordTargetResult", RecordTargetResultCommand)
      .withCommand("recordEvaluatorResult", RecordEvaluatorResultCommand)
      .withCommand("computeExperimentRunMetrics", ComputeExperimentRunMetricsCommand)
      .withCommand("completeExperimentRun", CompleteExperimentRunCommand)
      .build();
  }
}

/**
 * The definition this feature registers, named so a composition root can hold
 * one without restating its shape.
 */
export type ExperimentRunProcessingPipeline = ReturnType<typeof ExperimentEventingAdapter.pipeline>;
