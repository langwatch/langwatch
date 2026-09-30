import { createHash } from "node:crypto";

import {
  buildGraphAlertTemplateContext,
  type GraphTriggerEvaluationResult,
  isNoDataPredicate,
} from "@langwatch/automation-contract";

import type {
  GraphAlertDispatchResult,
  GraphEvaluationPlan,
  GraphSeriesEvaluation,
} from "../app/automation.members.ts";
import { skippedGraphEvaluation } from "../rules/trigger-evaluator.rules.ts";

/**
 * Identity for one firing, derived from the trigger, the graph and the fire it
 * follows — so a re-evaluation of the same unbroken incident derives the same
 * digest and does not alert twice.
 */
function graphAlertFireDigest(input: {
  triggerId: string;
  customGraphId: string;
  previousFireId: string | null;
}): string {
  return createHash("sha256")
    .update(`${input.triggerId}:${input.customGraphId}:${input.previousFireId ?? "genesis"}`)
    .digest("hex")
    .slice(0, 16);
}

/**
 * Why an evaluation was skipped, when the predicate is one that cannot fire on an empty result.
 */
function findNoDataDetail(operator: string, threshold: number): string | undefined {
  return isNoDataPredicate({ operator, threshold }) ? "no-data predicate" : undefined;
}

export class GraphTriggerAlertDeliveryService {
  private constructor() {}

  static create(): GraphTriggerAlertDeliveryService {
    return new GraphTriggerAlertDeliveryService();
  }

  async deliver(
    plan: GraphEvaluationPlan,
    values: GraphSeriesEvaluation,
  ): Promise<GraphTriggerEvaluationResult> {
    const project = await plan.request.deps.projects.findById(plan.request.projectId);
    if (!project) {
      return skippedGraphEvaluation({
        ...plan.request,
        detail: "project not found",
      });
    }

    const { botDestination, slackWebhook } = await this.slackDestination(plan);
    const previousFire = await plan.request.deps.triggerSent.findLatestForGraphAlert({
      triggerId: plan.request.triggerId,
      projectId: plan.request.projectId,
      customGraphId: plan.customGraphId,
    });
    const claim = await plan.request.deps.triggerSent.claimOpenForGraphAlert({
      triggerId: plan.request.triggerId,
      projectId: plan.request.projectId,
      customGraphId: plan.customGraphId,
    });
    if (claim === "already-claimed") {
      return this.alreadyFiring(plan, values.currentValue);
    }

    return this.dispatch({
      plan,
      values,
      project,
      botDestination,
      slackWebhook,
      previousFireId: previousFire?.id ?? null,
      claimId: claim.id,
    });
  }

  /**
   * Where a Slack alert posts, resolved through its connection (ARCHITECTURE.md
   * §3). A Slack alert with nowhere to post dead-letters: no retry can fix it.
   */
  private async slackDestination(plan: GraphEvaluationPlan): Promise<{
    botDestination: { token: string; channel: string } | null;
    slackWebhook: string | null;
  }> {
    if (plan.trigger.action !== "SEND_SLACK_MESSAGE") {
      return { botDestination: null, slackWebhook: plan.params.slackWebhook ?? null };
    }
    const [destination] = await plan.request.deps.slackDestinations.findSlackDestination({
      projectId: plan.request.projectId,
      actionParams: plan.trigger.actionParams,
    });
    if (destination?.kind === "webhook")
      return { botDestination: null, slackWebhook: destination.url };
    if (destination?.kind === "bot" && destination.channel) {
      return {
        botDestination: { token: destination.token, channel: destination.channel },
        slackWebhook: null,
      };
    }
    throw plan.request.deps.dispatchErrors.createTerminal(
      `Slack delivery for alert "${plan.trigger.name}" has no usable connection: it is missing its token or channel, so the alert cannot be delivered.`,
    );
  }

  private async dispatch({
    plan,
    values,
    project,
    botDestination,
    slackWebhook,
    previousFireId,
    claimId,
  }: {
    plan: GraphEvaluationPlan;
    values: GraphSeriesEvaluation;
    project: { id: string; name: string; slug: string };
    botDestination: { token: string; channel: string } | null;
    slackWebhook: string | null;
    previousFireId: string | null;
    claimId: string;
  }): Promise<GraphTriggerEvaluationResult> {
    let result: GraphAlertDispatchResult;
    try {
      result = await plan.request.deps.notifier.dispatch({
        trigger: plan.trigger,
        project,
        context: this.context(plan, values, project),
        recipients: plan.params.members ?? [],
        slackWebhook,
        botDestination,
        fireDigest: graphAlertFireDigest({
          triggerId: plan.request.triggerId,
          customGraphId: plan.customGraphId,
          previousFireId,
        }),
      });
    } catch (error) {
      await this.rollbackRetryableClaim(plan, claimId, error);

      throw error;
    }

    return this.finish({ plan, value: values.currentValue, result, claimId });
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

  private async rollbackRetryableClaim(plan: GraphEvaluationPlan, claimId: string, error: unknown) {
    const { dispatchErrors } = plan.request.deps;
    if (dispatchErrors.isTerminal(error)) {
      return;
    }

    try {
      await plan.request.deps.triggerSent.deleteOpenClaim({
        id: claimId,
        projectId: plan.request.projectId,
      });
    } catch (cleanupError) {
      plan.request.deps.logger.error(
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

  private async finish({
    plan,
    value,
    result,
    claimId,
  }: {
    plan: GraphEvaluationPlan;
    value: number;
    result: GraphAlertDispatchResult;
    claimId: string;
  }): Promise<GraphTriggerEvaluationResult> {
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
      detail: findNoDataDetail(plan.operator, plan.threshold),
      didSend: true,
      renderErrors: result.renderErrors,
      missingVariables: result.missingVariables,
    };
  }

  private async alreadyFiring(
    plan: GraphEvaluationPlan,
    value: number,
  ): Promise<GraphTriggerEvaluationResult> {
    plan.request.deps.logger.debug(
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
