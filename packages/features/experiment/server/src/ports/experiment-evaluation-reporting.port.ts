import type { ReportEvaluationCommandData } from "@langwatch/evaluation-contract";

/**
 * Where a workbench cell's evaluator result is reported as an evaluation.
 *
 * The Evaluation feature owns the command and its pipeline; a core feature
 * server may not import another feature's server, so the run dispatches
 * through here and the process binds it to the Evaluation application.
 */
export abstract class ExperimentEvaluationReportingPort {
  abstract reportEvaluation(data: ReportEvaluationCommandData): Promise<unknown>;
}
