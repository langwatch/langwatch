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
      "Create a trigger that posts to a Slack incoming webhook when traces match its filters. " +
      "The `/api/triggers` family supersedes this narrower form, which stays for callers " +
      "written against it.",
    tags: ["Triggers"],
    errors: [
      { status: 400, description: "The body was not valid JSON" },
      { status: 401, description: "Missing or invalid API key" },
      { status: 403, description: "The API key lacks triggers:manage" },
      { status: 422, description: "The body failed validation" },
    ],
  })
  .handle(async ({ app, input, scope }) => {
    await app.create({
      projectId: scope.id,
      action: "SEND_SLACK_MESSAGE",
      name: input.name,
      message: input.message,
      filters: input.filters,
      actionParams: { slackWebhook: input.slack_webhook },
      alertType: input.alert_type,
    });

    return { message: "Slack trigger created successfully" };
  })
  .build();
