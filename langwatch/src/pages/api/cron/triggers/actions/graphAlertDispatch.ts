import { TriggerAction } from "@prisma/client";
import { decryptSlackBotToken } from "~/automations/providers/definitions/slack/secret";
import {
  type SlackActionParams,
  slackDeliveryMethodOf,
} from "~/automations/providers/definitions/slack/shared";
import { env } from "~/env.mjs";
import { getApp } from "~/server/app-layer/app";
import { DispatchError } from "~/server/event-sourcing/outbox/dispatchError";
import {
  consumeEmailCapSlot,
  consumeTenantEmailCapSlot,
} from "~/server/event-sourcing/outbox/emailHourlyCap";
import {
  graphAlertFireDigest,
  type GraphAlertDispatchDeps,
  type GraphAlertDispatchInput,
} from "~/server/event-sourcing/pipelines/shared/graphAlertActionDispatch";
import { sendRenderedTriggerEmail } from "~/server/mailer/triggerEmail";
import { sendRenderedSlackMessage } from "~/server/triggers/sendSlackWebhook";
import { sendWebhook } from "~/server/triggers/sendWebhook";
import { postSlackChatMessage } from "~/server/triggers/slackWebApi";
import { WebhookDeliveryService } from "~/server/app-layer/triggers/webhook-delivery.service";
import { prisma } from "~/server/db";
import { buildGraphAlertTemplateContext } from "~/shared/templating/templateContext";
import type { ActionParams, TriggerContext } from "../types";

/**
 * The cron's wiring for the shared graph-alert dispatcher.
 *
 * The cron and the event-sourced evaluator hand the SAME input to the SAME
 * `dispatchGraphAlertAction`, so an alert renders and delivers identically
 * whichever path is live — `release_es_graph_triggers_firing` only decides who
 * calls it. Before this the cron had its own hardcoded notify hop, which could
 * only POST to a webhook (so bot-delivery alerts, the default for every new
 * Slack automation, silently delivered nothing) and only render the legacy
 * React email (so an author's saved Liquid templates were dropped at send time).
 */

/**
 * Translate the cron's `TriggerContext` into the dispatcher's input.
 *
 * Throws a non-retryable `DispatchError` when the trigger cannot possibly be
 * delivered — an unknown project, or a Slack bot connection whose token or
 * channel won't resolve. Failing loud beats falling through to the webhook
 * branch, which would report "no Slack webhook configured" and leave the
 * operator with no signal at all.
 */
export function buildCronGraphAlertInput(
  context: TriggerContext,
): GraphAlertDispatchInput {
  const { trigger, graphAlert, projects } = context;

  const project = projects.find((p) => p.id === trigger.projectId);
  if (!project) {
    throw new DispatchError({
      message: `Project ${trigger.projectId} not found for graph alert "${trigger.name}"`,
      retryable: false,
    });
  }

  const params = (trigger.actionParams ?? {}) as unknown as ActionParams;

  let botDestination: { token: string; channel: string } | null = null;
  if (trigger.action === TriggerAction.SEND_SLACK_MESSAGE) {
    const slackParams = (trigger.actionParams ?? {}) as SlackActionParams;
    if (slackDeliveryMethodOf(slackParams) === "bot") {
      const token = decryptSlackBotToken(slackParams);
      const channel = slackParams.slackChannelId?.trim();
      if (!token || !channel) {
        throw new DispatchError({
          message: `Slack bot connection for alert "${trigger.name}" is missing its token or channel — the alert cannot be delivered.`,
          retryable: false,
        });
      }
      botDestination = { token, channel };
    }
  }

  return {
    trigger,
    project,
    context: buildTemplateContext({ context, project }),
    recipients: params.members ?? [],
    slackWebhook: params.slackWebhook ?? null,
    botDestination,
    fireDigest: graphAlertFireDigest({
      triggerId: trigger.id,
      customGraphId: graphAlert.graph.id,
      previousFireId: graphAlert.previousFireId,
    }),
  };
}

/**
 * Senders + gates for the cron. Identical to the outbox runtime's wiring in
 * `event-sourcing/outbox/setup.ts` — same mailer, same Slack clients, same
 * suppression list, same ADR-031 email caps, same `TriggerSent` at-most-once
 * ledger.
 */
export function cronGraphAlertDeps(): GraphAlertDispatchDeps {
  const app = getApp();
  return {
    sendEmail: sendRenderedTriggerEmail,
    sendSlack: sendRenderedSlackMessage,
    sendSlackBot: postSlackChatMessage,
    sendWebhook,
    recordWebhookDelivery: (input) =>
      WebhookDeliveryService.create(prisma).record(input),
    filterSuppressedRecipients: (params) =>
      app.emailSuppressions.filterSuppressed(params),
    // ADR-031: the two hard email caps, bound from env — the same consumers
    // the outbox runtime binds, so whichever path evaluates, the caps mean
    // the same thing. The dispatcher keys both claims on the fire digest, so
    // a cron re-tick of the same fire re-reads the count instead of burning
    // a second slot.
    consumeEmailCapSlot: ({ projectId, triggerId, now, dedupKey }) =>
      consumeEmailCapSlot({
        projectId,
        triggerId,
        now,
        cap: env.TRIGGER_EMAIL_HOURLY_CAP,
        dedupKey,
      }),
    emailHourlyCap: env.TRIGGER_EMAIL_HOURLY_CAP,
    consumeTenantEmailCapSlot: ({
      projectId,
      now,
      cap,
      recipientCount,
      dedupKey,
    }) =>
      consumeTenantEmailCapSlot({
        projectId,
        now,
        cap,
        recipientCount,
        dedupKey,
      }),
    tenantDailyCap: env.TRIGGER_EMAIL_TENANT_DAILY_CAP,
    isRecipientSent: (params) => app.triggers.isSendClaimed(params),
    recordRecipientSent: async (params) => {
      await app.triggers.claimSend(params);
    },
  };
}

function buildTemplateContext({
  context,
  project,
}: {
  context: TriggerContext;
  project: { id: string; name: string; slug: string };
}): GraphAlertDispatchInput["context"] {
  const { trigger, graphAlert } = context;
  return buildGraphAlertTemplateContext({
    trigger: {
      id: trigger.id,
      name: trigger.name,
      alertType: trigger.alertType,
    },
    graph: graphAlert.graph,
    metric: graphAlert.metric,
    condition: graphAlert.condition,
    currentValue: graphAlert.currentValue,
    window: graphAlert.window,
    occurredAt: graphAlert.occurredAt,
    // The cron reads the live metric the moment it evaluates, which is what
    // `real-time` means to the templates. The two `heartbeat-*` reasons are
    // absence checks only the event-sourced evaluator can make.
    reason: "real-time",
    project: { id: project.id, name: project.name, slug: project.slug },
    baseHost: env.BASE_HOST,
  });
}
