import type { GraphTriggerEvaluationResult } from "@langwatch/automation-contract";
import { GraphTriggerIncidentService } from "./graph-trigger-incident.service";
import { GraphTriggerEvaluationPlanService } from "./graph-trigger-evaluation-plan.service";
import { GraphTriggerSeriesEvaluationService } from "./graph-trigger-series-evaluation.service";
import { TriggerEvaluatorService, type GraphEvaluationRequest } from "./trigger-evaluator.service";

/** Public private-automation evaluator that composes focused graph collaborators. */
export class GraphTriggerEvaluatorService {
  private constructor(
    private readonly plans: GraphTriggerEvaluationPlanService,
    private readonly series: GraphTriggerSeriesEvaluationService,
    private readonly incidents: GraphTriggerIncidentService,
  ) {}

  static create(): GraphTriggerEvaluatorService {
    return new GraphTriggerEvaluatorService(
      GraphTriggerEvaluationPlanService.create(),
      GraphTriggerSeriesEvaluationService.create(),
      GraphTriggerIncidentService.create(),
    );
  }

  async evaluate(request: GraphEvaluationRequest): Promise<GraphTriggerEvaluationResult> {
    const plan = await this.plans.createPlan(request);
    if ("status" in plan) {
      return plan;
    }

    const values = await this.series.evaluate(plan);
    if ("status" in values) {
      return values;
    }

    return this.incidents.decide(plan, values);
  }
}

export const graphAlertFireDigest = TriggerEvaluatorService.graphAlertFireDigest;
export { GRAPH_TRIGGER_MAX_RESULT_ROWS } from "./trigger-evaluator.service";
export type {
  EvaluateGraphTriggerResult,
  GraphSeries,
  GraphTriggerEvaluationDeps,
  ProjectIdentity,
  StoredGraphConfig,
  TimeseriesInputType,
  TimeseriesReadOptions,
  TimeseriesResult,
} from "./trigger-evaluator.service";
