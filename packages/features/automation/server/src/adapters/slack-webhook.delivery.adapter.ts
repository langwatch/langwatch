import {
  isSlackWebhookUrl,
  type AlertType,
  type SlackPayload,
} from "@langwatch/automation-contract";
import { DispatchError, toDispatchError } from "@langwatch/eventing";
import type { TraceRecord } from "@langwatch/trace-contract";

function assertSlackWebhookUrl(url: string, triggerName: string): void {
  if (isSlackWebhookUrl(url)) return;
  throw new DispatchError({
    message: `Refusing to dispatch Slack webhook for trigger "${triggerName}": URL is not a genuine https://hooks.slack.com/services/ endpoint`,
    retryable: false,
  });
}

export interface SlackWebhookTransport {
  send(payload: SlackPayload & { username?: string; icon_emoji?: string }): Promise<void>;
}

export interface SlackWebhookRequest {
  triggerWebhook: string;
  triggerData: TriggerData[];
  triggerName: string;
  projectSlug: string;
  triggerType: AlertType | null;
  triggerMessage: string;
  /** External app origin supplied by process configuration. */
  baseHost: string;
}

export interface RenderedSlackMessageRequest {
  triggerWebhook: string;
  triggerName: string;
  payload: SlackPayload;
}

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
  fullTrace: TraceRecord;
}

async function deliverSlackWebhook(
  {
    triggerWebhook,
    triggerData,
    triggerName,
    projectSlug,
    triggerType,
    triggerMessage,
    baseHost,
  }: SlackWebhookRequest,
  transport: SlackWebhookTransport,
): Promise<void> {
  // Defense-in-depth: never dispatch to anything that is not a genuine Slack
  // incoming-webhook endpoint, even if an older trigger stored an arbitrary
  // URL before the slackActionParamsSchema check landed. A bad URL can never
  // become valid on retry, so the shared guard classifies this non-retryable.
  assertSlackWebhookUrl(triggerWebhook, triggerName);

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
      return `${baseHost}/${projectSlug}/analytics/custom/${data.graphId}`;
    }
    // Regular trace link
    if (data.traceId) {
      return `${baseHost}/${projectSlug}/traces/${data.traceId}`;
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
          .map((event) => {
            return `\n*Event Type:* ${escapeMrkdwn(event.event_type)}
          ${Object.entries(event.metrics || {})
            .map(([key, value]) => `\n*${escapeMrkdwn(key)}:* ${escapeMrkdwn(value)}`)
            .join("")}
          ${Object.entries(event.event_details || {})
            .map(([key, value]) => `\n*${escapeMrkdwn(key)}:* ${escapeMrkdwn(value)}`)
            .join("")}
          \n-------------------`;
          })
          .join("")
      }
     `;
  });

  const alertIcon = (alertType: AlertType | null) => {
    switch (alertType) {
      case "INFO":
        return "ℹ️";
      case "WARNING":
        return "⚠️";
      case "CRITICAL":
        return "🔴";
      default:
        return "🔔";
    }
  };

  try {
    await transport.send({
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
}

/**
 * Sends a pre-rendered (customer-authored, ADR-036) Slack payload. Mirrors the
 * guards and DispatchError classification of `sendSlackWebhook` exactly — same
 * non-retryable host guard (`assertSlackWebhookUrl`) and the same
 * toDispatchError wrap around the send — but takes the Block Kit / text payload
 * already rendered.
 */
async function deliverRenderedSlackMessage(
  { triggerWebhook, triggerName, payload }: RenderedSlackMessageRequest,
  transport: SlackWebhookTransport,
): Promise<void> {
  assertSlackWebhookUrl(triggerWebhook, triggerName);

  try {
    await transport.send(payload);
  } catch (err) {
    throw toDispatchError(err, {
      message: `Slack webhook dispatch failed for trigger "${triggerName}"`,
    });
  }
}

/** Process-owned Slack webhook adapter. The host supplies the destination
 * transport factory once at composition time; delivery policy remains in the
 * Automation package. */
export class SlackWebhookDeliveryAdapter {
  private constructor(private readonly transportFor: (webhook: string) => SlackWebhookTransport) {}

  static create(
    transportFor: (webhook: string) => SlackWebhookTransport,
  ): SlackWebhookDeliveryAdapter {
    return new SlackWebhookDeliveryAdapter(transportFor);
  }

  deliver(input: SlackWebhookRequest): Promise<void> {
    return deliverSlackWebhook(input, this.transportFor(input.triggerWebhook));
  }

  deliverRendered(input: RenderedSlackMessageRequest): Promise<void> {
    return deliverRenderedSlackMessage(input, this.transportFor(input.triggerWebhook));
  }
}
