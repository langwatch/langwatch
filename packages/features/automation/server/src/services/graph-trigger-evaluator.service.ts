import type {
  GraphTriggerEvaluationReason,
  GraphTriggerEvaluationResult,
} from "@langwatch/automation-contract";
import { GraphTriggerIncidentService } from "./graph-trigger-incident.service";
import { GraphTriggerEvaluationPlanService } from "./graph-trigger-evaluation-plan.service";
import { GraphTriggerSeriesEvaluationService } from "./graph-trigger-series-evaluation.service";
import type { GraphTriggerEvaluationDeps } from "./trigger-evaluator.service";

/** Public private-automation evaluator that composes focused graph collaborators. */
export class GraphTriggerEvaluatorService {
  private constructor(
    private readonly deps: GraphTriggerEvaluationDeps,
    private readonly plans: GraphTriggerEvaluationPlanService,
    private readonly series: GraphTriggerSeriesEvaluationService,
    private readonly incidents: GraphTriggerIncidentService,
  ) {}

  static create(deps: GraphTriggerEvaluationDeps): GraphTriggerEvaluatorService {
    return new GraphTriggerEvaluatorService(
      deps,
      GraphTriggerEvaluationPlanService.create(),
      GraphTriggerSeriesEvaluationService.create(),
      GraphTriggerIncidentService.create(),
    );
  }

  async evaluate(input: {
    triggerId: string;
    projectId: string;
    reason: GraphTriggerEvaluationReason;
  }): Promise<GraphTriggerEvaluationResult> {
    const plan = await this.plans.createPlan({ ...input, deps: this.deps });
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
