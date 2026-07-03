import type { Project, Trigger } from "@prisma/client";
import { DispatchError } from "~/server/event-sourcing/outbox/dispatchError";
import { sendRenderedTriggerEmail } from "~/server/mailer/triggerEmail";
import { sendRenderedSlackMessage } from "~/server/triggers/sendSlackWebhook";
import { ALERT_TRIGGER_DEFAULTS } from "~/shared/templating/defaults";
import { renderTriggerEmail } from "~/shared/templating/renderEmail";
import {
  renderTriggerSlack,
  type SlackTemplateType,
} from "~/shared/templating/renderSlack";
import type { GraphAlertTemplateContext } from "~/shared/templating/templateContext";
import { createLogger } from "~/utils/logger/server";

const logger = createLogger("langwatch:graph-alert-action-dispatch");

/**
 * Inputs the graph-trigger evaluator hands the dispatch helper. This is
 * the seam between the evaluator (which knows the metric value + the
 * threshold + the trigger) and the rendering pipeline (which knows how
 * to invoke Liquid + the senders).
 *
 * `recipients` (email) and `slackWebhook` are pre-extracted from
 * `trigger.actionParams` by the evaluator, so this module stays free of
 * the cron-page `ActionParams` type import.
 */
export interface GraphAlertDispatchInput {
  trigger: Trigger;
  project: Project;
  /** ADR-034 Phase 8.1 template-variable context. The evaluator builds
   *  it via `buildGraphAlertTemplateContext` and hands it in. */
  context: GraphAlertTemplateContext;
  /** Email-recipient list and Slack webhook URL — read from
   *  `trigger.actionParams`. */
  recipients: string[];
  slackWebhook: string | null;
}

export interface GraphAlertDispatchDeps {
  /**
   * Per-recipient email sender — same `sendRenderedTriggerEmail` the
   * trace cadence dispatcher uses. Injected so this module is free of
   * mailer dependencies and easy to unit-test.
   */
  sendEmail: typeof sendRenderedTriggerEmail;
  /** Slack sender — same `sendRenderedSlackMessage` the trace cadence
   *  dispatcher uses. */
  sendSlack: typeof sendRenderedSlackMessage;
}

export interface GraphAlertDispatchResult {
  channel: "email" | "slack" | "none";
  /** True when a provider call was actually made. False on a config-only
   *  drop (no recipients, no webhook), which the caller logs but does
   *  NOT treat as an error. */
  didSend: boolean;
  /** Variables a custom template referenced but the render context did
   *  not supply (ADR-028 / ADR-029). Aggregated across whichever
   *  channel rendered. */
  missingVariables: string[];
  /** Render errors from custom templates that fell back, for operator
   *  visibility. */
  renderErrors: string[];
}

/**
 * ADR-034 Phase 8.1 dispatch helper for custom-graph threshold alerts.
 *
 * Parallel to `dispatchTriggerAction` (the trace-shape persist
 * dispatcher) — kept separate because the alert path:
 *
 *   - renders against `GraphAlertTemplateContext` (no `matches[]`);
 *   - owns its own TriggerSent dedup at the evaluator layer;
 *   - never participates in the outbox digest / cap / suppression
 *     coordination the trace notify path needs;
 *   - and the existing `dispatchTriggerAction` only handles persist
 *     actions inline (it explicitly throws for SEND_EMAIL /
 *     SEND_SLACK_MESSAGE).
 *
 * Squeezing this into the existing helper would require a kind-
 * discriminated branch whose two arms share no logic.
 *
 * Picks `ALERT_TRIGGER_DEFAULTS` via `pickTriggerDefaults({
 * hasCustomGraph: true })`, then defers to the same Liquid pipeline the
 * trace notify path uses (`renderTriggerEmail` / `renderTriggerSlack`)
 * so per-trigger custom templates (the four Trigger columns) override
 * the defaults uniformly. The senders are the rendered-form variants
 * (`sendRenderedTriggerEmail` / `sendRenderedSlackMessage`) — same ones
 * the trace cadence dispatcher uses; sender signatures are unchanged.
 */
export async function dispatchGraphAlertAction({
  deps,
  input,
}: {
  deps: GraphAlertDispatchDeps;
  input: GraphAlertDispatchInput;
}): Promise<GraphAlertDispatchResult> {
  const { trigger, project, context, recipients, slackWebhook } = input;
  const defaults = ALERT_TRIGGER_DEFAULTS;

  if (trigger.action === "SEND_EMAIL") {
    if (recipients.length === 0) {
      logger.info(
        { triggerId: trigger.id, projectId: project.id },
        "Graph alert has no email recipients — skipping send",
      );
      return {
        channel: "email",
        didSend: false,
        missingVariables: [],
        renderErrors: [],
      };
    }
    const rendered = await renderTriggerEmail({
      subjectTemplate: trigger.emailSubjectTemplate,
      bodyTemplate: trigger.emailBodyTemplate,
      context,
      defaults: {
        emailSubject: defaults.emailSubject,
        emailBody: defaults.emailBody,
      },
    });
    if (rendered.errors.length > 0) {
      logger.warn(
        {
          triggerId: trigger.id,
          projectId: project.id,
          errors: rendered.errors,
        },
        "Graph-alert email render errors — fell back to default for affected parts",
      );
    }
    await deps.sendEmail({
      triggerEmails: recipients,
      triggerId: trigger.id,
      projectId: project.id,
      subject: rendered.subject,
      html: rendered.html,
    });
    return {
      channel: "email",
      didSend: true,
      missingVariables: rendered.missingVariables,
      renderErrors: rendered.errors,
    };
  }

  if (trigger.action === "SEND_SLACK_MESSAGE") {
    if (!slackWebhook) {
      logger.info(
        { triggerId: trigger.id, projectId: project.id },
        "Graph alert has no Slack webhook configured — skipping send",
      );
      return {
        channel: "slack",
        didSend: false,
        missingVariables: [],
        renderErrors: [],
      };
    }
    const templateType: SlackTemplateType | null =
      trigger.slackTemplateType === "block_kit" ? "block_kit" : "string";
    const rendered = await renderTriggerSlack({
      templateType,
      template: trigger.slackTemplate,
      context,
      defaults: {
        slackString: defaults.slackString,
        slackBlockKit: defaults.slackBlockKit,
      },
    });
    if (rendered.errors.length > 0) {
      logger.warn(
        {
          triggerId: trigger.id,
          projectId: project.id,
          errors: rendered.errors,
        },
        "Graph-alert Slack render errors — fell back to default",
      );
    }
    await deps.sendSlack({
      triggerWebhook: slackWebhook,
      triggerName: trigger.name,
      payload: rendered.payload,
    });
    return {
      channel: "slack",
      didSend: true,
      missingVariables: rendered.missingVariables,
      renderErrors: rendered.errors,
    };
  }

  // Persist actions (ADD_TO_DATASET / ADD_TO_ANNOTATION_QUEUE) and any
  // future TriggerAction value never apply to graph alerts — the cron's
  // routing only ever dispatches email / Slack here. Fail loud so a
  // misconfigured trigger dead-letters with an actionable operator signal
  // rather than silently no-op every fire (dispatch5015-002).
  logger.error(
    {
      triggerId: trigger.id,
      projectId: project.id,
      action: trigger.action,
    },
    "Graph alert action is neither SEND_EMAIL nor SEND_SLACK_MESSAGE — dead-lettering",
  );
  throw new DispatchError({
    message: `Graph alert action "${trigger.action}" is not supported — only SEND_EMAIL and SEND_SLACK_MESSAGE apply to graph alerts.`,
    retryable: false,
  });
}
