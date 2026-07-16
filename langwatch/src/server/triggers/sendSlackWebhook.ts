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

/**
 * Trace content is unbounded customer data, but Slack rejects oversized
 * webhook payloads with a terminal 400, which would dead-letter the alert.
 * Bounding happens in two layers (see
 * specs/triggers/slack-webhook-dispatch.feature): per-field caps keep any one
 * value readable, and `boundTextBytes` below is the guarantee that the payload
 * fits at all.
 *
 * Truncate before escaping so the cut never lands mid-entity.
 */
const MAX_FIELD_LENGTH = 500;

/** Metric and detail keys are customer-authored too, and far shorter in any
 *  legitimate trace than the values they label. */
const MAX_KEY_LENGTH = 100;

/** A trace can carry any number of events, each with any number of metric and
 *  detail entries. Bound both so the message stays proportional to a trace
 *  rather than to its cardinality. */
const MAX_EVENTS_PER_TRACE = 10;
const MAX_ENTRIES_PER_EVENT = 20;

/**
 * Final backstop on the assembled message. Per-field caps alone cannot bound
 * it: escaping runs after truncation and multiplies a field up to 5x (`&` ->
 * `&amp;`), and traces, events, and entries each multiply the field count.
 * Slack's practical `text` ceiling is ~40000 characters, so budget in bytes —
 * always >= the character count — and leave headroom for the rest of the
 * payload.
 */
export const MAX_TEXT_BYTES = 39_000;
const TEXT_TRUNCATION_MARKER = "\n…[truncated]";

const truncate = (value: unknown, maxLength: number): string => {
  const text = String(value ?? "");
  return text.length > maxLength ? text.slice(0, maxLength) + "…" : text;
};

const formatField = (value: unknown): string =>
  escapeMrkdwn(truncate(value, MAX_FIELD_LENGTH));

const formatKey = (value: unknown): string =>
  escapeMrkdwn(truncate(value, MAX_KEY_LENGTH));

/**
 * Caps the fully-built, escaped text at the byte budget. Cuts on a UTF-8
 * character boundary so a truncated emoji or multi-byte character can never
 * leave an invalid sequence in the payload.
 */
const boundTextBytes = (text: string): string => {
  const buffer = Buffer.from(text, "utf8");
  if (buffer.length <= MAX_TEXT_BYTES) return text;

  let end = MAX_TEXT_BYTES - Buffer.byteLength(TEXT_TRUNCATION_MARKER, "utf8");
  // 0b10xxxxxx is a UTF-8 continuation byte; walk back off any of them to land
  // on the start of a character.
  while (end > 0 && ((buffer[end] ?? 0) & 0xc0) === 0x80) end--;
  return buffer.toString("utf8", 0, end) + TEXT_TRUNCATION_MARKER;
};

const formatEntries = (entries: Record<string, unknown> | undefined): string =>
  Object.entries(entries ?? {})
    .slice(0, MAX_ENTRIES_PER_EVENT)
    .map(([key, value]) => `\n*${formatKey(key)}:* ${formatField(value)}`)
    .join("");

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
      return `${env.BASE_HOST}/${projectSlug}/traces/${data.traceId}`;
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
        ? ` \n*Input:* ${formatField(trace.input)}
    \n*Output:* ${formatField(trace.output)}\n`
        : ""
    }
      ${
        !isCustomGraph &&
        (trace.events ?? [])
          .slice(0, MAX_EVENTS_PER_TRACE)
          .map((event) => {
            return `\n*Event Type:* ${formatField(event.event_type)}
          ${formatEntries(event.metrics)}
          ${formatEntries(event.event_details)}
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

  // The trigger name and message are customer-authored and unbounded too, so
  // they are formatted like any other interpolated field rather than trusted.
  const text = boundTextBytes(
    `${alertIcon(triggerType)} LangWatch Trigger - *${formatField(triggerName)}*
       ${triggerMessage ? `\n\n*Msg:* ${formatField(triggerMessage)}` : ""}
      \n${traceLinks.join("")}`,
  );

  try {
    await webhook.send({
      text,
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
    });
  }
};
