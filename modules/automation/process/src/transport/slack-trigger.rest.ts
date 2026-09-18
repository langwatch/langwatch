/**
 * `POST /api/trigger/slack` -- the narrow, one-action ancestor of
 * `/api/triggers`, kept at its own path and body shape since callers
 * were written against them. Both dispatch through the SAME {@link AutomationApi}.
 */
import {
  defineRestRouter,
  documentedResponses,
  MANAGEMENT_API_VERSION,
  type RestErrorHandler,
} from "@langwatch/api/rest";
import {
  AutomationApi,
  slackAutomationRestCreatedSchema,
  slackAutomationRestInputSchema,
  slackAutomationRestRefusalSchema,
} from "@langwatch/automation-contract";
import { HandledError, isZodLikeError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import { HTTPException } from "hono/http-exception";

const logger = createLogger("langwatch:api:triggers:slack");

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
    responses: documentedResponses({
      400: slackAutomationRestRefusalSchema,
      401: slackAutomationRestRefusalSchema,
    }),
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

/**
 * The three bodies this door has always answered: non-JSON and
 * schema-rejected bodies are both the CALLER's mistake and both 400s;
 * everything else is one 500, with the detail in this process's log.
 */
export const slackAutomationRestErrors: RestErrorHandler = (error, c) => {
  if (error instanceof HTTPException && error.status === 400) {
    return c.json({ message: "Bad request" }, 400);
  }

  if (HandledError.isHandled(error) && error.code === "malformed_request") {
    return c.json({ message: "Bad request" }, 400);
  }

  if (HandledError.isHandled(error) && error.code === "validation_error") {
    return c.json({ message: "Invalid request data", errors: fieldFailuresOf(error) }, 400);
  }

  if (isZodLikeError(error)) {
    return c.json({ message: "Invalid request data", errors: error.issues }, 400);
  }

  logger.error({ error }, "Error creating trigger");

  return c.json({ message: "Error creating trigger" }, 500);
};

/**
 * The offending fields a `validation_error` carries, one entry each, in the
 * `errors` array this route has always published them in.
 */
function fieldFailuresOf(error: { reasons: readonly Error[] }): Record<string, unknown>[] {
  return error.reasons.flatMap((reason) =>
    HandledError.isHandled(reason) ? [{ ...reason.meta, message: reason.message }] : [],
  );
}
