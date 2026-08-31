import {
  evaluateCustomGraphThreshold,
  type GraphTriggerEvaluationResult,
} from "@langwatch/automation-contract";
import type { GraphEvaluationPlan, GraphSeriesEvaluation } from "./trigger-evaluator.service";
import { GraphTriggerAlertDeliveryService } from "./graph-trigger-alert-delivery.service";

export class GraphTriggerIncidentService {
  private constructor(private readonly delivery: GraphTriggerAlertDeliveryService) {}

  static create(): GraphTriggerIncidentService {
    return new GraphTriggerIncidentService(GraphTriggerAlertDeliveryService.create());
  }

  async decide(
    plan: GraphEvaluationPlan,
    values: GraphSeriesEvaluation,
  ): Promise<GraphTriggerEvaluationResult> {
    const breached = evaluateCustomGraphThreshold({
      value: values.currentValue,
      threshold: plan.threshold,
      operator: plan.operator,
    }).breached;
    const open = await plan.request.deps.triggerSent.tryFindOpenForGraphAlert({
      triggerId: plan.request.triggerId,
      projectId: plan.request.projectId,
      customGraphId: plan.customGraphId,
    });
    if (breached) {
      return open
        ? this.alreadyFiring(plan, values.currentValue)
        : this.delivery.deliver(plan, values);
    }

    return open
      ? this.resolve(plan, values.currentValue, open)
      : this.notBreached(plan, values.currentValue);
  }

  private async alreadyFiring(
    plan: GraphEvaluationPlan,
    value: number,
  ): Promise<GraphTriggerEvaluationResult> {
    await plan.request.deps.triggers.updateLastRunAt({
      triggerId: plan.request.triggerId,
      projectId: plan.request.projectId,
    });

    return { ...plan.request, status: "already_firing", value };
  }

  private async resolve(
    plan: GraphEvaluationPlan,
    value: number,
    open: { id: string; triggerId: string; projectId: string; customGraphId: string },
  ): Promise<GraphTriggerEvaluationResult> {
    await plan.request.deps.triggerSent.markResolvedById({
      id: open.id,
      projectId: plan.request.projectId,
      now: plan.now,
    });
    await plan.request.deps.triggers.updateLastRunAt({
      triggerId: plan.request.triggerId,
      projectId: plan.request.projectId,
    });

    return { ...plan.request, status: "resolved", value };
  }

  private async notBreached(
    plan: GraphEvaluationPlan,
    value: number,
  ): Promise<GraphTriggerEvaluationResult> {
    await plan.request.deps.triggers.updateLastRunAt({
      triggerId: plan.request.triggerId,
      projectId: plan.request.projectId,
    });

    return { ...plan.request, status: "not_breached", value };
  }
}
