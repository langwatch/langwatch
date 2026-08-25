/**
 * Private service seam for graph evaluation. The implementation and its
 * transport-neutral technical types live in the private evaluator module; the
 * singular AutomationService is the only public capability that calls it.
 */
export {
  GraphTriggerEvaluatorService,
  GRAPH_TRIGGER_MAX_RESULT_ROWS,
  graphAlertFireDigest,
} from "./graph-trigger-evaluator.service";
export type {
  GraphSeries,
  GraphTriggerEvaluationDeps,
  ProjectIdentity,
  StoredGraphConfig,
  TimeseriesInputType,
  TimeseriesReadOptions,
  TimeseriesResult,
} from "./graph-trigger-evaluator.service";
export type {
  GraphAlertDispatchInput,
  GraphAlertDispatchResult,
} from "../ports/automation-graph.port";

import { GraphTriggerEvaluatorService } from "./graph-trigger-evaluator.service";
import type { GraphTriggerEvaluationDeps } from "./graph-trigger-evaluator.service";
import type {
  GraphTriggerEvaluationReason,
  GraphTriggerEvaluationResult,
} from "@langwatch/automation-contract";

export class GraphTriggerEvaluationService {
  private constructor(
    private readonly deps: GraphTriggerEvaluationDeps,
    private readonly evaluator: GraphTriggerEvaluatorService,
  ) {}

  static create(deps: GraphTriggerEvaluationDeps): GraphTriggerEvaluationService {
    return new GraphTriggerEvaluationService(deps, GraphTriggerEvaluatorService.create());
  }

  evaluate(input: {
    triggerId: string;
    projectId: string;
    reason: GraphTriggerEvaluationReason;
  }): Promise<GraphTriggerEvaluationResult> {
    return this.evaluator.evaluate({ ...input, deps: this.deps });
  }

  /** Test seam for characterisation coverage of the evaluator itself. */
  static evaluate(input: {
    deps: GraphTriggerEvaluationDeps;
    triggerId: string;
    projectId: string;
    reason: GraphTriggerEvaluationReason;
  }): Promise<GraphTriggerEvaluationResult> {
    return GraphTriggerEvaluatorService.create().evaluate(input);
  }
}
