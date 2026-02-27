import type { AppendStore, MapProjectionDefinition } from "../../../projections/mapProjection.types";
import { EXPERIMENT_RUN_EVENT_TYPES } from "../schemas/constants";
import type { EvaluatorResultEvent, TargetResultEvent } from "../schemas/events";
import { isEvaluatorResultEvent, isTargetResultEvent } from "../schemas/typeGuards";
import { IdUtils } from "../utils/id.utils";

/**
 * Record type matching the experiment_run_items ClickHouse table schema.
 */
export interface ClickHouseExperimentRunResultRecord {
  ProjectionId: string;
  TenantId: string;
  RunId: string;
  ExperimentId: string;
  RowIndex: number;
  TargetId: string;
  ResultType: "target" | "evaluator";
  DatasetEntry: string;
  Predicted: string | null;
  TargetCost: number | null;
  TargetDurationMs: number | null;
  TargetError: string | null;
  TraceId: string | null;
  EvaluatorId: string | null;
  EvaluatorName: string | null;
  EvaluationStatus: string;
  Score: number | null;
  Label: string | null;
  Passed: number | null;
  EvaluationDetails: string | null;
  EvaluationCost: number | null;
  EvaluationInputs: string | null;
  EvaluationDurationMs: number | null;
  OccurredAt: Date;
}

type ExperimentRunResultEvent = TargetResultEvent | EvaluatorResultEvent;

/**
 * Maps a TargetResultEvent to a ClickHouse record.
 */
function mapTargetResultToRecord(
  event: TargetResultEvent,
): ClickHouseExperimentRunResultRecord {
  const id = IdUtils.generateDeterministicResultId({
    tenantId: event.tenantId,
    runId: event.data.runId,
    index: event.data.index,
    targetId: event.data.targetId,
    resultType: "target",
    evaluatorId: null,
    timestampMs: event.timestamp,
  });

  return {
    ProjectionId: id,
    TenantId: event.tenantId,
    RunId: event.data.runId,
    ExperimentId: event.data.experimentId,
    RowIndex: event.data.index,
    TargetId: event.data.targetId,
    ResultType: "target",
    DatasetEntry: JSON.stringify(event.data.entry),
    Predicted: event.data.predicted ? JSON.stringify(event.data.predicted) : null,
    TargetCost: event.data.cost ?? null,
    TargetDurationMs: event.data.duration ?? null,
    TargetError: event.data.error ?? null,
    TraceId: event.data.traceId ?? null,
    EvaluatorId: null,
    EvaluatorName: null,
    EvaluationStatus: "",
    Score: null,
    Label: null,
    Passed: null,
    EvaluationDetails: null,
    EvaluationCost: null,
    EvaluationInputs: null,
    EvaluationDurationMs: null,
    OccurredAt: new Date(event.occurredAt),
  };
}

/**
 * Maps an EvaluatorResultEvent to a ClickHouse record.
 */
function mapEvaluatorResultToRecord(
  event: EvaluatorResultEvent,
): ClickHouseExperimentRunResultRecord {
  const id = IdUtils.generateDeterministicResultId({
    tenantId: event.tenantId,
    runId: event.data.runId,
    index: event.data.index,
    targetId: event.data.targetId,
    resultType: "evaluator",
    evaluatorId: event.data.evaluatorId,
    timestampMs: event.timestamp,
  });

  return {
    ProjectionId: id,
    TenantId: event.tenantId,
    RunId: event.data.runId,
    ExperimentId: event.data.experimentId,
    RowIndex: event.data.index,
    TargetId: event.data.targetId,
    ResultType: "evaluator",
    DatasetEntry: "{}",
    Predicted: null,
    TargetCost: null,
    TargetDurationMs: null,
    TargetError: null,
    TraceId: null,
    EvaluatorId: event.data.evaluatorId,
    EvaluatorName: event.data.evaluatorName ?? null,
    EvaluationStatus: event.data.status,
    Score: event.data.score ?? null,
    Label: event.data.label ?? null,
    Passed:
      event.data.passed === undefined || event.data.passed === null
        ? null
        : event.data.passed
          ? 1
          : 0,
    EvaluationDetails: event.data.details ?? null,
    EvaluationCost: event.data.cost ?? null,
    EvaluationInputs: event.data.inputs ? JSON.stringify(event.data.inputs) : null,
    EvaluationDurationMs: event.data.duration ?? null,
    OccurredAt: new Date(event.occurredAt),
  };
}

function mapEvent(event: ExperimentRunResultEvent): ClickHouseExperimentRunResultRecord | null {
  if (isTargetResultEvent(event)) {
    return mapTargetResultToRecord(event);
  }
  if (isEvaluatorResultEvent(event)) {
    return mapEvaluatorResultToRecord(event);
  }
  return null;
}

/**
 * Creates MapProjection definition for experiment run result storage.
 *
 * Maps TargetResultEvent and EvaluatorResultEvent to ClickHouse records for storage
 * in the experiment_run_items table.
 */
export function createExperimentRunResultStorageMapProjection(deps: {
  store: AppendStore<ClickHouseExperimentRunResultRecord>;
}): MapProjectionDefinition<ClickHouseExperimentRunResultRecord, ExperimentRunResultEvent> {
  return {
    name: "experimentRunResultStorage",
    eventTypes: [
      EXPERIMENT_RUN_EVENT_TYPES.TARGET_RESULT,
      EXPERIMENT_RUN_EVENT_TYPES.EVALUATOR_RESULT,
    ],
    map: mapEvent,
    store: deps.store,
  };
}
