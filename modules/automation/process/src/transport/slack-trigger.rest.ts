/**
 * `POST /api/trigger/slack` -- the narrow, one-action ancestor of
 * `/api/triggers`, kept at its own path and body shape since callers
 * were written against them. Both dispatch through the SAME {@link AutomationApi}.
 */
import { defineRestRouter, MANAGEMENT_API_VERSION } from "@langwatch/api/rest";
import {
  AutomationApi,
  slackAutomationRestCreatedSchema,
  slackAutomationRestInputSchema,
} from "@langwatch/automation-contract";

/**
 * `/api/trigger/slack`, at exactly the address it has always answered. Literal
 * because the path is the SINGULAR namespace, which the plural `/api/triggers`
 * family does not claim, and this one route is the whole of it.
 */
export const slackAutomationRest = defineRestRouter(AutomationApi)
  .withNamespace("trigger-slack")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: true })

  .post("/api/trigger/slack", "postApiTriggerSlack")
  .withInput(slackAutomationRestInputSchema)
  .withPermission("triggers:manage")
  .withOutput(slackAutomationRestCreatedSchema)
  .withDocs({
    summary: "Create a Slack alert trigger",
    description:
      "Create a trigger that posts to Slack when traces match its filters, through a Slack " +
      "connection (`slack_connection_id`, plus `slack_channel_id` for a bot) or an incoming " +
      "webhook URL (`slack_webhook`), which is stored as a connection. The trigger stores no " +
      "secret of its own. " +
      "The `/api/triggers` family supersedes this narrower form, which stays for callers " +
      "written against it.",
    tags: ["Triggers"],
    errors: [
      { status: 400, description: "The body was not valid JSON" },
      { status: 401, description: "Missing or invalid API key" },
      { status: 403, description: "The API key lacks triggers:manage" },
      {
        status: 422,
        description:
          "The body failed validation, the connection is not one this project can use (`slack_integration_missing`), or a bot connection was named without `slack_channel_id` (`invalid_action_params`)",
      },
    ],
  })
  .handle(async ({ app, input, scope, actor }) => {
    await app.create({
      projectId: scope.id,
      // A connection typed here is stored for the caller; a key names no user, so the service.
      actorId: actor?.type === "user" ? actor.id : `svc_${scope.id}`,
      action: "SEND_SLACK_MESSAGE",
      name: input.name,
      message: input.message,
      filters: input.filters,
      actionParams: input.slack_connection_id
        ? {
            slackIntegrationId: input.slack_connection_id,
            ...(input.slack_channel_id ? { slackChannelId: input.slack_channel_id } : {}),
          }
        : { slackWebhook: input.slack_webhook ?? "" },
      alertType: input.alert_type,
    });

    return { message: "Slack trigger created successfully" };
  })
  .build();
