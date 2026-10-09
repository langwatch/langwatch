import type { Evaluator } from "@langwatch/evaluator-contract";
import type { EvaluationV3Event } from "@langwatch/experiment-contract";
import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

import type {
  CellScope,
  ExperimentCellRequest,
  ExperimentCellResult,
} from "../features/run/services/experiment-run-cell.service.ts";
import { keptAsEvaluatorError } from "../rules/experiment-cell-evaluator-error.rules.ts";
import type { ExperimentRunCollaborators } from "../rules/experiment-run-input.rules.ts";
import { planDatasetRows, runCellKey } from "../rules/experiment-run-plan.rules.ts";
import { ExperimentResultDispatchService } from "./experiment-result-dispatch.service.ts";

const logger = createLogger("langwatch:experiment:run-cell");

const EVALUATION_KSUID_RESOURCE = "eval";

type ExperimentCellRecordDeps = { collaborators: ExperimentRunCollaborators };

/** Turns what a cell's executor produced into the results the cell appends. */
export class ExperimentCellRecordService {
  static create(deps: ExperimentCellRecordDeps): ExperimentCellRecordService {
    return new ExperimentCellRecordService(deps);
  }

  private readonly resultDispatches = ExperimentResultDispatchService.create();

  private constructor(private readonly deps: ExperimentCellRecordDeps) {}

  /** One event as the results it appends, with a verdict reported as an evaluation as main did. */
  async record({
    scope,
    event: produced,
    loadedEvaluators,
  }: {
    scope: CellScope;
    event: EvaluationV3Event;
    loadedEvaluators: Map<string, Evaluator>;
  }): Promise<ExperimentCellResult[]> {
    const { request, plan, traceIds } = scope;
    const event = keptAsEvaluatorError(produced);
    const envelope = {
      tenantId: request.projectId,
      runId: request.runId,
      experimentId: request.experimentId,
      occurredAt: nowInstant().epochMilliseconds,
    };

    if (event.type === "target_result" || event.type === "error") {
      if (event.type === "target_result" && event.traceId) {
        traceIds.set(runCellKey(event), event.traceId);
      }
      const rows = planDatasetRows(plan);
      const data = this.resultDispatches.findTargetResultDispatch({
        ...envelope,
        event,
        datasetEntry: event.rowIndex !== undefined ? (rows[event.rowIndex] ?? {}) : {},
      });
      return data ? [{ kind: "target", data }] : [];
    }

    if (event.type !== "evaluator_result") return [];

    const evaluator = plan.evaluators.find((candidate) => candidate.id === event.evaluatorId);
    const dbEvaluator = evaluator?.dbEvaluatorId
      ? loadedEvaluators.get(evaluator.dbEvaluatorId)
      : undefined;
    await this.reportEvaluation({
      request,
      event,
      evaluatorType: evaluator?.evaluatorType ?? "unknown",
      evaluatorName: dbEvaluator?.name,
      traceId: traceIds.get(runCellKey(event)),
    });

    return [
      {
        kind: "evaluator",
        data: this.resultDispatches.buildEvaluatorResultDispatch({
          ...envelope,
          event,
          result: event.result,
          evaluatorName: dbEvaluator?.name ?? event.evaluatorName ?? null,
        }),
      },
    ];
  }

  /** Reported to the evaluation pipeline, best-effort: a failed report never fails the cell. */
  private async reportEvaluation({
    request,
    event,
    evaluatorType,
    evaluatorName,
    traceId,
  }: {
    request: ExperimentCellRequest;
    event: Extract<EvaluationV3Event, { type: "evaluator_result" }>;
    evaluatorType: string;
    evaluatorName: string | undefined;
    traceId: string | undefined;
  }): Promise<void> {
    const result = event.result;
    const processed = result.status === "processed" ? result : undefined;
    const evaluationId = generate(EVALUATION_KSUID_RESOURCE).toString();
    try {
      await this.deps.collaborators.evaluationReporting.reportEvaluation({
        tenantId: request.projectId,
        evaluationId,
        evaluatorId: event.evaluatorId,
        evaluatorType,
        evaluatorName,
        traceId,
        status: result.status,
        score: processed?.score ?? undefined,
        passed: processed?.passed ?? undefined,
        label: processed?.label ?? undefined,
        details: processed?.details ?? undefined,
        error: result.status === "error" ? result.details : undefined,
        occurredAt: nowInstant().epochMilliseconds,
      });
    } catch (error) {
      logger.error(
        { error, evaluationId, evaluatorId: event.evaluatorId },
        "Failed to dispatch evaluator result to evaluation processing pipeline",
      );
    }
  }
}
