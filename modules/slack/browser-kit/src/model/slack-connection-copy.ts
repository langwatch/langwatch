/**
 * The words the settings list, the connection drawer and the automation's Slack step share.
 * Spec: specs/automations/slack-connections.feature.
 */
import { readHandledError } from "@langwatch/error-presentation/read-handled-error";
import {
  type SlackConnectionClaimant,
  slackConnectionClaimantSchema,
  type SlackConnectionKind,
  type SlackConnectionScopeType,
} from "@langwatch/slack-contract";
import { z } from "zod";

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

/** A refusal because automations still claim the connection (ARCHITECTURE.md §3). */
export interface SlackConnectionInUse {
  count: number;
  claimants: SlackConnectionClaimant[];
}

const inUseMetaSchema = z.object({
  dependentAutomations: z.number().int().optional(),
  claimants: slackConnectionClaimantSchema.array().optional(),
});

/**
 * The in-use refusal an error carries, or none when it is some other failure. `fallback` is
 * the list's count, for a meta without one.
 */
export function readInUseRefusal({
  error,
  fallback,
}: {
  error: unknown;
  fallback: number;
}): SlackConnectionInUse[] {
  const handled = readHandledError(error);
  if (handled?.code !== "slack_connection_in_use") return [];
  const meta = inUseMetaSchema.safeParse(handled.meta);
  const claimants = meta.success ? (meta.data.claimants ?? []) : [];
  const count = meta.success ? meta.data.dependentAutomations : void 0;
  return [{ count: count ?? (claimants.length || fallback), claimants }];
}

/** "Used by 2 automations: Errors to ops, Daily digest", naming each claimant it knows. */
export function inUseRefusalLabel({ count, claimants }: SlackConnectionInUse): string {
  if (claimants.length === 0) return usedByLabel(count);
  return `${usedByLabel(count)}: ${claimants.map((claimant) => claimant.label).join(", ")}`;
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

/** A save refused on one field, worded for that field. */
export interface SlackFieldRefusal {
  scope?: string;
  secret?: string;
}

/** The field a refused save names (`invalid_action_params` with `meta.field`), or none. */
export function readFieldRefusal(error: unknown): SlackFieldRefusal {
  const handled = readHandledError(error);
  if (handled?.code !== "invalid_action_params") return {};
  if (handled.meta.field === "scopeId") {
    return { scope: "A connection belongs to this project or to its organization." };
  }
  if (handled.meta.field === "secret") {
    return {
      secret:
        "That isn't a Slack incoming webhook URL. It starts with https://hooks.slack.com/services/.",
    };
  }
  return {};
}
