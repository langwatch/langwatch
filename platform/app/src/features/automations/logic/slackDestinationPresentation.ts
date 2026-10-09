import type { SlackDeliveryMethod } from "@langwatch/automations/providers/slack";
import type { TriggerActionParams } from "./triggerActionParams";

/**
 * The one decision both Slack-destination display surfaces need: what kind
 * of delivery a `SEND_SLACK_MESSAGE` row actually is, which connection it
 * goes through, and what's safe to show for it. Pure, so the view drawer and
 * the automations list render the exact same call (#6244, ADR-093 §5a).
 */
export type SlackDestinationPresentation =
  | {
      kind: "bot";
      /** The name of the connection the row delivers through, or `null` for
       *  a row still on its own secret, or whose connection is gone. */
      connectionName: string | null;
      /** The destination channel's raw Slack id (e.g. `C0123456`), or `null`
       *  when none was chosen. Only the id is ever persisted. */
      channelId: string | null;
    }
  | {
      kind: "webhook";
      connectionName: string | null;
      /** The webhook URL, ONLY when it's safe to show on hover — a real
       *  Slack incoming webhook on a row that stores its own. `null` for a
       *  connection (its URL never reaches the browser) or a placeholder. */
      tooltipUrl: string | null;
    };

/** The value, only when it parses as a real Slack incoming-webhook URL —
 *  a bare "https://", a redaction placeholder wearing the prefix, or any
 *  non-Slack host is not a URL to show. */
function safeSlackWebhookUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "hooks.slack.com"
      ? value
      : null;
  } catch {
    return null;
  }
}

/** How a Slack automation's destination is shown: its connection and, for a
 *  bot, the channel; for a webhook, the URL safe to show in a tooltip. */
export function slackDestinationPresentation({
  actionParams,
  connections,
}: {
  actionParams: Pick<
    TriggerActionParams,
    "slackDelivery" | "slackChannelId" | "slackWebhook" | "slackIntegrationId"
  >;
  /** The connections the project can use, to name the row's one. */
  connections: ReadonlyArray<{ id: string; name: string }> | undefined;
}): SlackDestinationPresentation {
  const connectionName = actionParams.slackIntegrationId
    ? (connections?.find((c) => c.id === actionParams.slackIntegrationId)
        ?.name ?? null)
    : null;
  // Absent `slackDelivery` means a legacy row saved before bot delivery
  // existed. The switch is exhaustive, so a new method fails typecheck here.
  const delivery: SlackDeliveryMethod = actionParams.slackDelivery ?? "webhook";
  switch (delivery) {
    case "bot":
      return {
        kind: "bot",
        connectionName,
        channelId: actionParams.slackChannelId ?? null,
      };
    case "webhook":
      return {
        kind: "webhook",
        connectionName,
        tooltipUrl: safeSlackWebhookUrl(actionParams.slackWebhook),
      };
    default: {
      const _exhaustive: never = delivery;
      return _exhaustive;
    }
  }
}

/** One line for the destination: the connection's name (or the delivery
 *  kind when there is none) and, for a bot, the channel. */
export function slackDestinationLabel(
  destination: SlackDestinationPresentation,
): string {
  if (destination.kind === "webhook") {
    return destination.connectionName ?? "Slack webhook";
  }
  const name = destination.connectionName ?? "Slack app";
  return destination.channelId
    ? `${name} · channel ${destination.channelId}`
    : name;
}
