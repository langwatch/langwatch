/**
 * What kind of delivery a `SEND_SLACK_MESSAGE` row is, which connection it goes through, and
 * what is safe to show for it. Pure, so automation's view drawer and list render the same
 * call (#6244, ADR-093 §5a).
 */
import type { SlackDeliveryMethod, slackActionParamsSchema } from "@langwatch/automation-contract";
import { findSlackConnection, type NamedSlackConnection } from "@langwatch/slack-browser-kit";
import type { z } from "zod";

type SlackActionParams = z.infer<typeof slackActionParamsSchema>;

export type SlackDestinationPresentation =
  | {
      kind: "bot";
      /** The connection's name, or `null` for a row on its own secret or a gone connection. */
      connectionName: string | null;
      /** The channel's raw Slack id (e.g. `C0123456`), or `null` when none was chosen. */
      channelId: string | null;
    }
  | {
      kind: "webhook";
      connectionName: string | null;
      /** The webhook URL only when safe to show on hover: a real Slack incoming webhook on a
       *  row that stores its own. `null` for a connection or a placeholder. */
      tooltipUrl: string | null;
    };

/** The value only when it parses as a real Slack incoming-webhook URL. */
function safeSlackWebhookUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "hooks.slack.com" ? value : null;
  } catch {
    return null;
  }
}

/** How a Slack automation's destination is shown: its connection and, for a bot, the
 *  channel; for a webhook, the URL safe to show in a tooltip. */
export function slackDestinationPresentation({
  actionParams,
  connections,
}: {
  actionParams: Pick<
    SlackActionParams,
    "slackDelivery" | "slackChannelId" | "slackWebhook" | "slackIntegrationId"
  >;
  /** The connections the project can use, to name the row's one. */
  connections: readonly NamedSlackConnection[] | undefined;
}): SlackDestinationPresentation {
  const [connection] = findSlackConnection({
    connectionId: actionParams.slackIntegrationId,
    connections,
  });
  const connectionName = connection?.name ?? null;
  // Absent `slackDelivery` is a legacy row saved before bot delivery existed.
  const delivery: SlackDeliveryMethod = actionParams.slackDelivery ?? "webhook";
  switch (delivery) {
    case "bot":
      return { kind: "bot", connectionName, channelId: actionParams.slackChannelId ?? null };
    case "webhook":
      return {
        kind: "webhook",
        connectionName,
        tooltipUrl: safeSlackWebhookUrl(actionParams.slackWebhook),
      };
    default: {
      const exhaustive: never = delivery;
      return exhaustive;
    }
  }
}

/** One line for the destination: the connection's name (or the delivery kind when there is
 *  none) and, for a bot, the channel. */
export function slackDestinationLabel(destination: SlackDestinationPresentation): string {
  if (destination.kind === "webhook") return destination.connectionName ?? "Slack webhook";
  const name = destination.connectionName ?? "Slack app";
  return destination.channelId ? `${name} · channel ${destination.channelId}` : name;
}
