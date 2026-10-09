import { slackDeliveryMethodOf } from "@langwatch/automations/providers/slack";
import { z } from "zod";
import { DispatchError } from "~/server/event-sourcing/queues/dispatchError";
import { SlackIntegrationMissingError } from "../errors";
import { decryptSlackBotToken } from "../providers/slack/server";

/** A connection's decrypted secret, for dispatch and channel discovery only. */
export type SlackConnectionSecret =
  | { kind: "BOT"; token: string }
  | { kind: "INCOMING_WEBHOOK"; url: string };

/** Where one Slack delivery goes. A bot posts to the automation's channel. */
export type SlackDestination =
  | { kind: "bot"; token: string; channel: string | null }
  | { kind: "webhook"; url: string };

/** The connection half of the resolution, as a port so tests need no database. */
export interface SlackConnectionReader {
  findUsableSecret(params: {
    id: string;
    projectId: string;
  }): Promise<SlackConnectionSecret | null>;
}

export type SlackDestinationResolver = (params: {
  projectId: string;
  actionParams: unknown;
}) => Promise<SlackDestination | null>;

/** Stored Slack params, read leniently: a row is data, not a wire payload. */
const storedSlackParamsSchema = z.object({
  slackIntegrationId: z.string().nullish().catch(undefined),
  slackDelivery: z.enum(["webhook", "bot"]).nullish().catch(undefined),
  slackWebhook: z.string().nullish().catch(undefined),
  slackBotToken: z.string().nullish().catch(undefined),
  slackChannelId: z.string().nullish().catch(undefined),
});

const readStoredSlackParams = (actionParams: unknown) => {
  const read = storedSlackParamsSchema.safeParse(actionParams ?? {});
  return read.success ? read.data : {};
};

/**
 * Where a Slack delivery goes (ADR-093 §5a):
 *
 *   1. `slackIntegrationId` set → that connection, if the project may use it;
 *      otherwise nothing (never the legacy secret: deletion must stop delivery)
 *   2. else the automation's own legacy bot token or webhook URL
 *   3. else nothing, which callers turn into `slack_integration_missing`
 */
export async function findSlackDestination({
  actionParams,
  projectId,
  connections,
}: {
  actionParams: unknown;
  projectId: string;
  connections: SlackConnectionReader;
}): Promise<SlackDestination | null> {
  const params = readStoredSlackParams(actionParams);
  const channel = params.slackChannelId?.trim() || null;

  if (params.slackIntegrationId) {
    const secret = await connections.findUsableSecret({
      id: params.slackIntegrationId,
      projectId,
    });
    if (!secret) return null;
    return secret.kind === "BOT"
      ? { kind: "bot", token: secret.token, channel }
      : { kind: "webhook", url: secret.url };
  }

  return legacyDestination({ params, channel });
}

/** An automation not yet migrated: its own bot token or webhook URL. */
function legacyDestination({
  params,
  channel,
}: {
  params: ReturnType<typeof readStoredSlackParams>;
  channel: string | null;
}): SlackDestination | null {
  const method = slackDeliveryMethodOf({
    slackDelivery: params.slackDelivery ?? undefined,
  });
  if (method === "bot") {
    const token = decryptSlackBotToken({
      slackBotToken: params.slackBotToken ?? undefined,
    });
    return token ? { kind: "bot", token, channel } : null;
  }
  const url = params.slackWebhook?.trim();
  return url ? { kind: "webhook", url } : null;
}

/** {@link findSlackDestination}, refusing instead of returning null. */
export async function resolveSlackDestination(params: {
  actionParams: unknown;
  projectId: string;
  connections: SlackConnectionReader;
}): Promise<SlackDestination> {
  const destination = await findSlackDestination(params);
  if (!destination) throw new SlackIntegrationMissingError();
  return destination;
}

/** The resolver every composition root hands down, bound to one reader. */
export function slackDestinationResolver({
  connections,
}: {
  connections: SlackConnectionReader;
}): SlackDestinationResolver {
  return ({ projectId, actionParams }) =>
    findSlackDestination({ projectId, actionParams, connections });
}

/**
 * The missing-connection refusal shaped for the outbox: no retry can fix it,
 * so it dead-letters (ADR-027), carrying the handled error as its cause.
 */
export function slackConnectionMissingDispatchError({
  triggerName,
}: {
  triggerName: string;
}): DispatchError {
  const missing = new SlackIntegrationMissingError();
  return new DispatchError({
    message: `Slack delivery for "${triggerName}" has no usable connection: ${missing.message}`,
    retryable: false,
    cause: missing,
    customerMessage:
      "Pick a Slack connection in this automation's delivery settings, then try again.",
  });
}
