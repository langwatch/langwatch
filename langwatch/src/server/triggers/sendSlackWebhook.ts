import { type AlertType, AlertType as AlertTypeEnum } from "@prisma/client";
import {
  IncomingWebhook,
  type IncomingWebhookSendArguments,
} from "@slack/webhook";
import { toDispatchError } from "~/server/event-sourcing/outbox/dispatchError";
import type { Trace } from "~/server/tracer/types";
import type { SlackPayload } from "~/shared/templating/renderSlack";
import { env } from "../../env.mjs";
import { assertSlackWebhookUrl } from "./slackWebhookGuard";

/**
 * Minimal Slack mrkdwn escaping. Slack only requires the three HTML-ish
 * control characters to be escaped in message text; everything else is
 * literal. Escaping these stops user-authored trace content from forging
 * links/formatting or breaking the message structure.
 * See https://api.slack.com/reference/surfaces/formatting#escaping
 */
const escapeMrkdwn = (value: unknown): string =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

interface TriggerData {
  traceId?: string;
  graphId?: string;
  input: string;
  output: string;
  fullTrace: Trace;
}

export const sendSlackWebhook = async ({
  triggerWebhook,
  triggerData,
  triggerName,
  projectSlug,
  triggerType,
  triggerMessage,
}: {
  triggerWebhook: string;
  triggerData: TriggerData[];
  triggerName: string;
  projectSlug: string;
  triggerType: AlertType | null;
  triggerMessage: string;
}) => {
  // Defense-in-depth: never dispatch to anything that is not a genuine Slack
  // incoming-webhook endpoint, even if an older trigger stored an arbitrary
  // URL before the slackActionParamsSchema check landed. A bad URL can never
  // become valid on retry, so the shared guard classifies this non-retryable.
  assertSlackWebhookUrl(triggerWebhook, triggerName);

  const webhook = new IncomingWebhook(triggerWebhook);

  const traceIds = triggerData
    .map((data) => {
      return {
        traceId: data.traceId,
        graphId: data.graphId,
        input: data.input,
        output: data.output,
        events: data.fullTrace?.events ?? [],
      };
    })
    .slice(0, 10);

  const getLink = (data: { traceId?: string; graphId?: string }) => {
    // Check if this is a custom graph trigger
    if (data.graphId) {
      return `${env.BASE_HOST}/${projectSlug}/analytics/custom/${data.graphId}`;
    }
    // Regular trace link
    if (data.traceId) {
      return `${env.BASE_HOST}/${projectSlug}/messages/${data.traceId}`;
    }
    return "#";
  };

  const getDisplayText = (data: { traceId?: string; graphId?: string }) => {
    // For custom graphs, show a more user-friendly text
    if (data.graphId) {
      return "View Graph";
    }
    return data.traceId ?? "View";
  };

  const traceLinks = traceIds.map((trace) => {
    const isCustomGraph = !!trace.graphId;

    return `\n<${getLink(trace)}|${getDisplayText(trace)}>
    ${
      !triggerMessage && !isCustomGraph
        ? ` \n*Input:* ${escapeMrkdwn(trace.input)}
    \n*Output:* ${escapeMrkdwn(trace.output)}\n`
        : ""
    }
      ${
        !isCustomGraph &&
        (trace.events ?? [])
          .map((event: any) => {
            return `\n*Event Type:* ${escapeMrkdwn(event.event_type)}
          ${Object.entries(event.metrics || {})
            .map(
              ([key, value]) =>
                `\n*${escapeMrkdwn(key)}:* ${escapeMrkdwn(value)}`,
            )
            .join("")}
          ${Object.entries(event.event_details || {})
            .map(
              ([key, value]) =>
                `\n*${escapeMrkdwn(key)}:* ${escapeMrkdwn(value)}`,
            )
            .join("")}
          \n-------------------`;
          })
          .join("")
      }
     `;
  });

  const alertIcon = (alertType: AlertType | null) => {
    switch (alertType) {
      case AlertTypeEnum.INFO:
        return "ℹ️";
      case AlertTypeEnum.WARNING:
        return "⚠️";
      case AlertTypeEnum.CRITICAL:
        return "🔴";
      default:
        return "🔔";
    }
  };

  try {
    await webhook.send({
      text: `${alertIcon(triggerType)} LangWatch Trigger - *${triggerName}*
       ${triggerMessage ? `\n\n*Msg:* ${triggerMessage}` : ""}
      \n${traceLinks.join("")}`,
      username: "LangWatch",
      icon_emoji: ":robot_face:",
    });
  } catch (err) {
    throw toDispatchError(err, {
      message: `Slack webhook dispatch failed for trigger "${triggerName}"`,
    });
  }
};

/**
 * Sends a pre-rendered (customer-authored, ADR-028) Slack payload. Mirrors the
 * guards and DispatchError classification of `sendSlackWebhook` exactly — same
 * non-retryable host guard (`assertSlackWebhookUrl`) and the same
 * toDispatchError wrap around the send — but takes the Block Kit / text payload
 * already rendered.
 */
export const sendRenderedSlackMessage = async ({
  triggerWebhook,
  triggerName,
  payload,
}: {
  triggerWebhook: string;
  triggerName: string;
  /** Rendered text/Block-Kit payload from the templating layer. Slack's
   *  `IncomingWebhook.send` accepts a looser shape than its typed
   *  `IncomingWebhookSendArguments`, so we cast at the send boundary. */
  payload: SlackPayload;
}) => {
  assertSlackWebhookUrl(triggerWebhook, triggerName);

  try {
    await new IncomingWebhook(triggerWebhook).send(
      payload as IncomingWebhookSendArguments,
    );
  } catch (err) {
    throw toDispatchError(err, {
      message: `Slack webhook dispatch failed for trigger "${triggerName}"`,
    });
  }
};
