import {
  type SlackActionParams,
  slackActionParamsSchema,
  slackDeliveryMethodOf,
} from "@langwatch/automations/providers/slack";
import { TriggerAction } from "~/generated/prisma/client";
import { decrypt } from "~/utils/encryption";
import type { ServerDef } from "../types";

/**
 * Server half of the Slack provider (ADR-093 §5a). The secret lives on a Slack
 * connection, never on the automation: a save keeps only the connection, the
 * method and a bot's channel, and a read returns nothing else.
 */

/** Every field the Slack schema declares; a read keeps only the three below. */
const SLACK_FIELDS = new Set(
  Object.keys(slackActionParamsSchema.innerType().shape),
);
const READABLE_SLACK_FIELDS = new Set([
  "slackIntegrationId",
  "slackDelivery",
  "slackChannelId",
]);

/**
 * Prepare Slack actionParams for persistence. The save path has already
 * pointed them at a connection (`SlackIntegrationService.connectActionParams`);
 * whatever it could not, stores no secret either way.
 */
export function persistSlackActionParams({
  incoming,
}: {
  incoming: SlackActionParams;
}): SlackActionParams {
  const slackDelivery = slackDeliveryMethodOf(incoming);
  const channel = incoming.slackChannelId?.trim();
  return {
    ...(incoming.slackIntegrationId
      ? { slackIntegrationId: incoming.slackIntegrationId }
      : {}),
    slackDelivery,
    ...(slackDelivery === "bot" && channel ? { slackChannelId: channel } : {}),
  };
}

/**
 * The read projection: of the Slack fields only the connection, the method and
 * a bot's channel leave the server, so a row not yet migrated returns no token
 * or URL. Other keys are the rule a graph alert or report fires by.
 */
export function readableSlackActionParams(
  params: unknown,
): Record<string, unknown> {
  if (typeof params !== "object" || params === null || Array.isArray(params)) {
    return {};
  }
  const read = Object.fromEntries(
    Object.entries(params).filter(
      ([key]) => !SLACK_FIELDS.has(key) || READABLE_SLACK_FIELDS.has(key),
    ),
  );
  const hasSlackField = Object.keys(params).some((key) =>
    SLACK_FIELDS.has(key),
  );
  // A legacy row saved before the method existed still reads as a webhook.
  return hasSlackField && !("slackDelivery" in read)
    ? { ...read, slackDelivery: "webhook" }
    : read;
}

/** Decrypt the stored bot token for a Web API dispatch. Null when absent. */
export function decryptSlackBotToken(
  params: Pick<SlackActionParams, "slackBotToken">,
): string | null {
  if (!params.slackBotToken) return null;
  return decrypt(params.slackBotToken);
}

const def: ServerDef = {
  action: TriggerAction.SEND_SLACK_MESSAGE,
  persistActionParams: async ({ incoming }) => {
    // Every caller has already held the payload to the full schema.
    const params = slackActionParamsSchema.innerType().parse(incoming);
    return persistSlackActionParams({ incoming: params });
  },
  redactActionParams: readableSlackActionParams,
};

export default def;
