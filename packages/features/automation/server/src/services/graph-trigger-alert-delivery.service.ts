import {
  buildGraphAlertTemplateContext,
  type GraphTriggerEvaluationResult,
  type SlackActionParams,
  slackDeliveryMethodOf,
} from "@langwatch/automation-contract";
import type { GraphAlertDispatchResult } from "../ports/automation-graph.port";
import {
  graphAlertFireDigest,
  noDataDetail,
  skippedGraphEvaluation,
} from "./graph-trigger-evaluator.helpers";
import type {
  GraphEvaluationPlan,
  GraphSeriesEvaluation,
} from "./graph-trigger-evaluator.types";

export class GraphTriggerAlertDeliveryService {
  private constructor() {}

  static create(): GraphTriggerAlertDeliveryService {
    return new GraphTriggerAlertDeliveryService();
  }

  async deliver(
    plan: GraphEvaluationPlan,
    values: GraphSeriesEvaluation,
  ): Promise<GraphTriggerEvaluationResult> {
    const project = await plan.request.deps.projects.tryGetById(plan.request.projectId);
    if (!project) {
      return skippedGraphEvaluation({ ...plan.request, detail: "project not found" });
    }
    const botDestination = this.botDestination(plan);
    const previousFire = await plan.request.deps.triggerSent.tryFindLatestForGraphAlert({
      triggerId: plan.request.triggerId,
      projectId: plan.request.projectId,
      customGraphId: plan.customGraphId,
    });
    const claim = await plan.request.deps.triggerSent.tryClaimOpenForGraphAlert({
      triggerId: plan.request.triggerId,
      projectId: plan.request.projectId,
      customGraphId: plan.customGraphId,
    });
    if (!claim) {
      return this.alreadyFiring(plan, values.currentValue);
    }
    return this.dispatch(
      plan,
      values,
      project,
      botDestination,
      previousFire?.id ?? null,
      claim.id,
    );
  }

  private botDestination(
    plan: GraphEvaluationPlan,
  ): { token: string; channel: string } | null {
    if (plan.trigger.action !== "SEND_SLACK_MESSAGE") {
      return null;
    }
    const params = (plan.trigger.actionParams ?? {}) as SlackActionParams;
    if (slackDeliveryMethodOf(params) !== "bot") {
      return null;
    }
    const token = plan.request.deps.slackTokens.tryDecrypt(params);
    const channel = params.slackChannelId?.trim();
    if (!token || !channel) {
      throw plan.request.deps.dispatchErrors.createTerminal(
        `Slack bot connection for alert "${plan.trigger.name}" is missing its token or channel — the alert cannot be delivered.`,
      );
    }
    return { token, channel };
  }

  private async dispatch(
    plan: GraphEvaluationPlan,
    values: GraphSeriesEvaluation,
    project: { id: string; name: string; slug: string },
    botDestination: { token: string; channel: string } | null,
    previousFireId: string | null,
    claimId: string,
  ): Promise<GraphTriggerEvaluationResult> {
    try {
      const result = await plan.request.deps.notifier.dispatch({
        trigger: plan.trigger,
        project,
        context: this.context(plan, values, project),
        recipients: plan.params.members ?? [],
        slackWebhook: plan.params.slackWebhook ?? null,
        botDestination,
        fireDigest: graphAlertFireDigest({
          triggerId: plan.request.triggerId,
          customGraphId: plan.customGraphId,
          previousFireId,
        }),
      });
      return this.finish(plan, values.currentValue, result, claimId);
    } catch (error) {
      await this.rollbackRetryableClaim(plan, claimId, error);
      throw error;
    }
  }

  private context(
    plan: GraphEvaluationPlan,
    values: GraphSeriesEvaluation,
    project: { id: string; name: string; slug: string },
  ) {
    return buildGraphAlertTemplateContext({
      trigger: {
        id: plan.trigger.id,
        name: plan.trigger.name,
        alertType: plan.trigger.alertType,
      },
      graph: { id: plan.customGraphId, name: plan.customGraph.name },
      metric: { label: plan.series.name ?? plan.seriesName, seriesName: plan.seriesName },
      condition: {
        operator: plan.operator,
        threshold: plan.threshold,
        timePeriodMinutes: plan.timePeriod,
      },
      currentValue: values.currentValue,
      previousValue: values.previousValue,
      history: [...values.previousPoints, ...values.currentPoints],
      window: { start: plan.startDate, end: plan.now },
      occurredAt: plan.now,
      reason: plan.request.reason,
      project,
      baseHost: plan.request.deps.baseHost,
    });
  }

  private async rollbackRetryableClaim(
    plan: GraphEvaluationPlan,
    claimId: string,
    error: unknown,
  ) {
    if (plan.request.deps.dispatchErrors.isTerminal(error)) {
      return;
    }
    try {
      await plan.request.deps.triggerSent.deleteOpenClaim({
        id: claimId,
        projectId: plan.request.projectId,
      });
    } catch (cleanupError) {
      plan.request.deps.telemetry.error(
        {
          triggerId: plan.request.triggerId,
          projectId: plan.request.projectId,
          customGraphId: plan.customGraphId,
          error: cleanupError,
        },
        "Failed to roll back the open graph-alert claim after a dispatch failure — the alert may stay suppressed until the metric recovers",
      );
    }
  }

  private async finish(
    plan: GraphEvaluationPlan,
    value: number,
    result: GraphAlertDispatchResult,
    claimId: string,
  ): Promise<GraphTriggerEvaluationResult> {
    if (!result.didSend) {
      await plan.request.deps.triggerSent.deleteOpenClaim({
        id: claimId,
        projectId: plan.request.projectId,
      });
      await plan.request.deps.triggers.updateLastRunAt({
        triggerId: plan.request.triggerId,
        projectId: plan.request.projectId,
      });
      return {
        ...plan.request,
        status: "not_delivered",
        value,
        detail: `threshold crossed but nothing was delivered on the ${result.channel} channel`,
        didSend: false,
        renderErrors: result.renderErrors,
        missingVariables: result.missingVariables,
      };
    }
    await plan.request.deps.triggers.updateLastRunAt({
      triggerId: plan.request.triggerId,
      projectId: plan.request.projectId,
    });
    return {
      ...plan.request,
      status: "fired",
      value,
      detail: noDataDetail(plan.operator, plan.threshold),
      didSend: true,
      renderErrors: result.renderErrors,
      missingVariables: result.missingVariables,
    };
  }

  private async alreadyFiring(
    plan: GraphEvaluationPlan,
    value: number,
  ): Promise<GraphTriggerEvaluationResult> {
    plan.request.deps.telemetry.debug(
      {
        triggerId: plan.request.triggerId,
        projectId: plan.request.projectId,
        customGraphId: plan.customGraphId,
      },
      "Another evaluator already claimed this graph-alert fire — backing off without dispatching",
    );
    await plan.request.deps.triggers.updateLastRunAt({
      triggerId: plan.request.triggerId,
      projectId: plan.request.projectId,
    });
    return { ...plan.request, status: "already_firing", value };
  }
}
