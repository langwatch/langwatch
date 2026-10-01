/**
 * The words the settings list, the connection drawer and the automation's Slack step share.
 * Spec: specs/automations/slack-connections.feature.
 */
import type { SlackConnectionKind, SlackConnectionScopeType } from "@langwatch/slack-contract";

export const SLACK_CONNECTION_KINDS: readonly {
  value: SlackConnectionKind;
  title: string;
  description: string;
}[] = [
  {
    value: "BOT",
    title: "Bot token",
    description: "Posts to any channel the app can reach, with charts, tables and status banners.",
  },
  {
    value: "INCOMING_WEBHOOK",
    title: "Incoming webhook",
    description:
      "Posts to the one channel the webhook was created for. Charts and tables are sent as text.",
  },
];

/** The short name of a connection's kind, for its badge. */
export function slackConnectionKindLabel(kind: SlackConnectionKind): string {
  return kind === "BOT" ? "Bot" : "Webhook";
}

/** A PROJECT connection lists only in its own project, so "This project" tells it apart
 *  from an organization connection with the same name. */
export function slackConnectionScopeLabel(scopeType: SlackConnectionScopeType): string {
  return scopeType === "PROJECT" ? "This project" : "Organization";
}

/** Only the last four characters of a secret ever reach the browser. */
export function maskedSecret(secretHint: string): string {
  return `••••${secretHint}`;
}

/** How many automations deliver through a connection, as a sentence. */
export function usedByLabel(count: number): string {
  if (count === 0) return "Not used by any automation";
  return count === 1 ? "Used by 1 automation" : `Used by ${count} automations`;
}

/** Deleting a connection nothing uses still asks first: its secret goes too. */
export function unusedDeleteConfirmation({ name }: { name: string }): {
  title: string;
  message: string;
  confirmLabel: string;
} {
  return {
    title: `Delete "${name}"?`,
    message: "Nothing uses it; its saved secret is removed.",
    confirmLabel: "Delete connection",
  };
}

/** What narrowing an organization connection to one project costs. */
export function narrowingConfirmation({ name, count }: { name: string; count: number }): {
  title: string;
  message: string;
  confirmLabel: string;
} {
  return {
    title: `Limit "${name}" to this project?`,
    message:
      count === 1
        ? "1 automation in another project stops delivering until it picks another connection."
        : `${count} automations in other projects stop delivering until they pick another connection.`,
    confirmLabel: "Limit to this project",
  };
}
