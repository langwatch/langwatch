import type {
  GraphTriggerEvaluationReason,
  GraphTriggerEvaluationResult,
} from "@langwatch/automation-contract";

import { GraphTriggerEvaluationPlanService } from "./graph-trigger-evaluation-plan.service.ts";
import { GraphTriggerIncidentService } from "./graph-trigger-incident.service.ts";
import { GraphTriggerSeriesEvaluationService } from "./graph-trigger-series-evaluation.service.ts";
import type { GraphTriggerEvaluationDeps } from "./trigger-evaluator.service.ts";

/** Public private-automation evaluator that composes focused graph collaborators. */
export class GraphTriggerEvaluatorService {
  private readonly deps: GraphTriggerEvaluationDeps;
  private readonly plans: GraphTriggerEvaluationPlanService;
  private readonly series: GraphTriggerSeriesEvaluationService;
  private readonly incidents: GraphTriggerIncidentService;

  private constructor({
    deps,
    plans,
    series,
    incidents,
  }: {
    deps: GraphTriggerEvaluationDeps;
    plans: GraphTriggerEvaluationPlanService;
    series: GraphTriggerSeriesEvaluationService;
    incidents: GraphTriggerIncidentService;
  }) {
    this.deps = deps;
    this.plans = plans;
    this.series = series;
    this.incidents = incidents;
  }

  static create(deps: GraphTriggerEvaluationDeps): GraphTriggerEvaluatorService {
    return new GraphTriggerEvaluatorService({
      deps,
      plans: GraphTriggerEvaluationPlanService.create(),
      series: GraphTriggerSeriesEvaluationService.create(),
      incidents: GraphTriggerIncidentService.create(),
    });
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
