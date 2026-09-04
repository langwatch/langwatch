import type { SlackActionParams } from "@langwatch/automations/providers/slack";
import type { PrismaClient } from "~/generated/prisma/client";
import { DispatchError } from "~/server/event-sourcing/queues/dispatchError";
import { SlackIntegrationMissingError } from "../errors";
import { decryptSlackBotToken } from "../providers/slack/server";
import { createSlackIntegrationService } from "./slack-integration.wiring";

/** Where a resolved Slack bot token came from. */
export type SlackTokenSource = "automation" | "project_integration";

export interface ResolvedSlackToken {
  token: string;
  source: SlackTokenSource;
}

/**
 * The project half of the resolution order, as a port so dispatch keeps its
 * composition-root wiring and tests need no database.
 */
export interface SlackProjectTokenReader {
  getBotToken(params: { projectId: string }): Promise<string | null>;
}

/**
 * Resolve the bot token a Slack delivery should use, most-specific-first
 * (ADR-093 §5):
 *
 *   1. the automation's own stored token, if it has one
 *   2. the project's Slack integration
 *   3. neither — the caller has nothing to deliver with
 *
 * The order is the safety property, not a preference. An automation that
 * carries its own token may be pointed at a different workspace than the one
 * the project later connects, so connecting the integration must never
 * retarget it. The automation's token wins until it is explicitly cleared, and
 * the cost of that — rotation not reaching legacy rows — is paid in visibility
 * (the settings census and the per-automation nudge), never in silence.
 *
 * Returns null at step 3 rather than throwing, so a caller that degrades (a
 * channel picker with nothing to list) can say so in its own words. Callers
 * that must fail the delivery use {@link resolveSlackBotToken}.
 */
export async function findSlackBotToken({
  actionParams,
  projectId,
  projectIntegration,
}: {
  actionParams: Pick<SlackActionParams, "slackBotToken">;
  projectId: string;
  projectIntegration: SlackProjectTokenReader;
}): Promise<ResolvedSlackToken | null> {
  const own = decryptSlackBotToken(actionParams);
  if (own) return { token: own, source: "automation" };

  const project = await projectIntegration.getBotToken({ projectId });
  if (project) return { token: project, source: "project_integration" };

  return null;
}

/**
 * {@link findSlackBotToken}, refusing instead of returning null. Dispatch takes
 * this variant: a Slack delivery with no token anywhere is a named,
 * customer-actionable failure, not an empty result.
 */
export async function resolveSlackBotToken(params: {
  actionParams: Pick<SlackActionParams, "slackBotToken">;
  projectId: string;
  projectIntegration: SlackProjectTokenReader;
}): Promise<ResolvedSlackToken> {
  const resolved = await findSlackBotToken(params);
  if (!resolved) throw new SlackIntegrationMissingError();
  return resolved;
}

/**
 * The same refusal, shaped for the outbox drainer. A Slack delivery with no
 * token anywhere is a misconfiguration no retry can fix, so it dead-letters
 * rather than backing off — and an unclassified throw would be retried by
 * default (ADR-027). The handled error rides along as the cause so the code
 * survives the trip, and the remediation is the sentence the customer reads.
 */
export function slackTokenMissingDispatchError({
  triggerName,
}: {
  triggerName: string;
}): DispatchError {
  const missing = new SlackIntegrationMissingError();
  return new DispatchError({
    message: `Slack delivery for "${triggerName}" has no bot token: ${missing.message}`,
    retryable: false,
    cause: missing,
    customerMessage:
      "Connect Slack in this project's integration settings, then try again.",
  });
}

/**
 * The reader every composition root passes down. A thin alias over the service
 * so a wiring site names the port it is filling rather than the whole service.
 */
export function slackProjectTokenReader(
  prisma: PrismaClient,
): SlackProjectTokenReader {
  return createSlackIntegrationService({ prisma });
}
