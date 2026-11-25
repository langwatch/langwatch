import type {
  GraphTriggerEvaluationReason,
  GraphTriggerEvaluationResult,
  TriggerLatestEvaluation,
} from "@langwatch/automation-contract";
import { toDate } from "@langwatch/time";

import type {
  GraphEvaluationPlan,
  GraphTriggerEvaluationDeps,
} from "./graph-trigger-evaluation-plan.service.ts";
import { GraphTriggerEvaluationPlanService } from "./graph-trigger-evaluation-plan.service.ts";
import { GraphTriggerIncidentService } from "./graph-trigger-incident.service.ts";
import { GraphTriggerSeriesEvaluationService } from "./graph-trigger-series-evaluation.service.ts";

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

  /**
   * Evaluate one graph trigger and record what the check observed: one write site,
   * so no branch can forget it. A thrown evaluation records nothing; the outbox
   * redelivers it and the retry's outcome is the one worth showing.
   */
  async evaluate(input: {
    triggerId: string;
    projectId: string;
    reason: GraphTriggerEvaluationReason;
  }): Promise<GraphTriggerEvaluationResult> {
    const plan = await this.plans.createPlan({ ...input, deps: this.deps });
    if ("status" in plan) {
      await this.record(this.evaluationOf({ result: plan }));
      return plan;
    }

    const result = await this.decide(plan);
    await this.record(this.evaluationOf({ result, plan }));
    return result;
  }

  private async decide(plan: GraphEvaluationPlan): Promise<GraphTriggerEvaluationResult> {
    const values = await this.series.evaluate(plan);
    if ("status" in values) {
      return values;
    }

    return this.incidents.decide(plan, values);
  }

  /** The snapshot one check leaves behind; the condition is the one it ran against. */
  private evaluationOf({
    result,
    plan,
  }: {
    result: GraphTriggerEvaluationResult;
    plan?: GraphEvaluationPlan;
  }): TriggerLatestEvaluation {
    const condition =
      plan === void 0
        ? result.condition
        : {
            threshold: plan.threshold,
            operator: plan.operator,
            timePeriodMinutes: plan.timePeriod,
          };
    return {
      triggerId: result.triggerId,
      projectId: result.projectId,
      evaluatedAt: toDate(plan?.now ?? this.deps.clock.now()),
      verdict: result.status,
      observedValue: result.value ?? null,
      threshold: condition?.threshold ?? null,
      operator: condition?.operator ?? null,
      timePeriodMinutes: condition?.timePeriodMinutes ?? null,
      skipCode: result.skipCode ?? null,
    };
  }

  /** An observation must never break the alert: a throw here would redeliver a sent fire. */
  private async record(evaluation: TriggerLatestEvaluation): Promise<void> {
    try {
      await this.deps.latestEvaluations.record(evaluation);
    } catch (error) {
      this.deps.logger.warn(
        {
          projectId: evaluation.projectId,
          triggerId: evaluation.triggerId,
          status: evaluation.verdict,
          error: error instanceof Error ? error.message : String(error),
        },
        "failed to record the alert's latest evaluation — the evaluation itself is unaffected",
      );
    }
  }
}
