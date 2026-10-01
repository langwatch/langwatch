/**
 * The refusals a save or a delete of a connection can carry, read off the handled error.
 * Spec: specs/automations/slack-connections.feature.
 */
import { readHandledError } from "@langwatch/error-presentation/read-handled-error";
import { usedByLabel } from "@langwatch/slack-browser-kit";
import {
  type SlackConnectionClaimant,
  slackConnectionClaimantSchema,
} from "@langwatch/slack-contract";
import { z } from "zod";

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
