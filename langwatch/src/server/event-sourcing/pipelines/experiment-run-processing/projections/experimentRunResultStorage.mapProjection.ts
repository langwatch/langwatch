import { AbstractMapProjection, type MapEventHandlers } from "../../../projections/abstractMapProjection";
import type { AppendStore } from "../../../projections/mapProjection.types";
import {
  targetResultEventSchema,
  evaluatorResultEventSchema,
  type TargetResultEvent,
  type EvaluatorResultEvent,
} from "../schemas/events";
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

const resultEvents = [targetResultEventSchema, evaluatorResultEventSchema] as const;

/**
 * Map projection that transforms TargetResultEvent and EvaluatorResultEvent
 * into ClickHouse records for storage in the experiment_run_items table.
 */
export class ExperimentRunResultStorageMapProjection
  extends AbstractMapProjection<ClickHouseExperimentRunResultRecord, typeof resultEvents>
  implements MapEventHandlers<typeof resultEvents, ClickHouseExperimentRunResultRecord>
{
  readonly name = "experimentRunResultStorage";
  readonly store: AppendStore<ClickHouseExperimentRunResultRecord>;
  protected readonly events = resultEvents;

  override options = {
    groupKeyFn: (event: { data: { experimentId: string; runId: string; index: number } }) =>
      `experiment:${event.data.experimentId}:result:${event.data.runId}:item:${event.data.index}`,
  };

  constructor(deps: { store: AppendStore<ClickHouseExperimentRunResultRecord> }) {
    super();
    this.store = deps.store;
  }

  mapExperimentRunTargetResult(event: TargetResultEvent): ClickHouseExperimentRunResultRecord {
    const id = IdUtils.generateDeterministicResultId({
      tenantId: event.tenantId,
      runId: event.data.runId,
      index: event.data.index,
      targetId: event.data.targetId,
      resultType: "target",
      evaluatorId: null,
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
      TargetDurationMs: event.data.duration != null ? Math.max(0, event.data.duration) : null,
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

  mapExperimentRunEvaluatorResult(event: EvaluatorResultEvent): ClickHouseExperimentRunResultRecord {
    const id = IdUtils.generateDeterministicResultId({
      tenantId: event.tenantId,
      runId: event.data.runId,
      index: event.data.index,
      targetId: event.data.targetId,
      resultType: "evaluator",
      evaluatorId: event.data.evaluatorId,
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
      EvaluationDurationMs: event.data.duration != null ? Math.max(0, event.data.duration) : null,
      OccurredAt: new Date(event.occurredAt),
    };
  }
}
