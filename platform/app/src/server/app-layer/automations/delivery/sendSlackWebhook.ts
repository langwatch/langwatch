import type { SlackPayload } from "@langwatch/automations/templating/renderSlack";
import {
  IncomingWebhook,
  type IncomingWebhookSendArguments,
} from "@slack/webhook";
import { z } from "zod";
import { tracePlatformUrl } from "~/app/api/shared/trace-platform-url";
import { env } from "~/env.mjs";
import {
  type AlertType,
  AlertType as AlertTypeEnum,
} from "~/generated/prisma/client";
import { toDispatchError } from "~/server/event-sourcing/queues/dispatchError";
import type { Trace } from "~/server/tracer/types";
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

const REVOKED_WEBHOOK =
  "Slack no longer accepts this webhook: it was revoked or its app was removed. Create a new incoming webhook in Slack and paste its URL here.";

const SLACK_WEBHOOK_REFUSALS: Record<string, string> = {
  invalid_token: REVOKED_WEBHOOK,
  no_service: REVOKED_WEBHOOK,
  no_active_hooks: REVOKED_WEBHOOK,
  no_team: REVOKED_WEBHOOK,
  team_disabled: REVOKED_WEBHOOK,
  channel_not_found:
    "The channel this webhook posts to no longer exists. Create a new incoming webhook for an active channel.",
  channel_is_archived:
    "The channel this webhook posts to is archived. Create a new incoming webhook for an active channel.",
  action_prohibited: "A Slack admin has blocked this webhook from posting.",
  posting_to_general_channel_denied:
    "Only Slack admins can post to this channel. Create the webhook for another channel.",
};

const slackWebhookErrorSchema = z.object({
  code: z.string(),
  original: z
    .object({
      response: z.object({ status: z.number(), data: z.unknown() }).optional(),
    })
    .optional(),
});

/** What the author can do about an incoming-webhook failure, when Slack says. */
export function explainSlackWebhookError(error: unknown): string | undefined {
  const parsed = slackWebhookErrorSchema.safeParse(error);
  if (!parsed.success) return undefined;
  if (parsed.data.code === "slack_webhook_request_error") {
    return "Slack could not be reached. Try again in a moment.";
  }
  const response = parsed.data.original?.response;
  if (!response) return undefined;
  const refusal =
    typeof response.data === "string"
      ? SLACK_WEBHOOK_REFUSALS[response.data.trim()]
      : undefined;
  if (refusal) return refusal;
  if ([403, 404, 410].includes(response.status)) return REVOKED_WEBHOOK;
  if (response.status === 429) {
    return "Slack is rate limiting this webhook. Try again in a minute.";
  }
  if (response.status >= 500) {
    return "Slack is having trouble right now. Try again shortly.";
  }
  return undefined;
}

interface TriggerData {
  traceId?: string;
  graphId?: string;
  input: string;
  output: string;
  fullTrace: Trace;
}

interface LinkedTrace {
  traceId?: string;
  graphId?: string;
  occurredAtMs?: number | null;
}

/** The link a trigger row points at: the custom graph, else the trace with its partition hint. */
const linkFor = ({
  projectSlug,
  trace,
}: {
  projectSlug: string;
  trace: LinkedTrace;
}): string => {
  if (trace.graphId) {
    return `${env.BASE_HOST}/${projectSlug}/analytics/custom/${trace.graphId}`;
  }
  if (trace.traceId) {
    return tracePlatformUrl({
      projectSlug,
      traceId: trace.traceId,
      occurredAtMs: trace.occurredAtMs,
    });
  }
  return "#";
};

const displayTextFor = (trace: LinkedTrace): string =>
  trace.graphId ? "View Graph" : (trace.traceId ?? "View");

const alertIcon = (alertType: AlertType | null): string => {
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
        occurredAtMs: data.fullTrace?.timestamps?.started_at,
      };
    })
    .slice(0, 10);

  const traceLinks = traceIds.map((trace) => {
    const isCustomGraph = !!trace.graphId;

    return `\n<${linkFor({ projectSlug, trace })}|${displayTextFor(trace)}>
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
      customerMessage: explainSlackWebhookError(err),
    });
  }
};

/**
 * Sends a pre-rendered (customer-authored, ADR-036) Slack payload. Mirrors the
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
      customerMessage: explainSlackWebhookError(err),
    });
  }
};
