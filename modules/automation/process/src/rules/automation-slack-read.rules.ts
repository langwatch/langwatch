import { slackActionParamsSchema } from "@langwatch/automation-contract";

/** Every field the Slack schema declares; a read keeps only the three below. */
const SLACK_FIELDS = new Set(Object.keys(slackActionParamsSchema.shape));
const READABLE_SLACK_FIELDS = new Set(["slackIntegrationId", "slackDelivery", "slackChannelId"]);

/**
 * The read projection: of the Slack fields only the connection, the method and
 * a bot's channel leave the server, so a row not yet migrated returns no token
 * or URL. Other keys are the rule a graph alert or report fires by.
 */
export function readableSlackActionParams(params: unknown): Record<string, unknown> {
  if (typeof params !== "object" || params === null || Array.isArray(params)) return {};
  const read = Object.fromEntries(
    Object.entries(params).filter(
      ([key]) => !SLACK_FIELDS.has(key) || READABLE_SLACK_FIELDS.has(key),
    ),
  );
  const hasSlackField = Object.keys(params).some((key) => SLACK_FIELDS.has(key));
  // A legacy row saved before the method existed still reads as a webhook.
  return hasSlackField && !("slackDelivery" in read) ? { ...read, slackDelivery: "webhook" } : read;
}
