/**
 * `POST /api/trigger/slack` -- the narrow, one-action ancestor of
 * `/api/triggers`, kept at its own path, body shape and refusals since callers
 * were written against them. Both dispatch through the SAME {@link AutomationApi}.
 */
import {
  defineRestRouter,
  documentedResponses,
  isFrameworkRefusal,
  MANAGEMENT_API_VERSION,
  type RestProtocolRefusal,
} from "@langwatch/api/rest";
import {
  AutomationApi,
  slackAutomationRestCreatedSchema,
  slackAutomationRestInputSchema,
  slackAutomationRestRefusalSchema,
} from "@langwatch/automation-contract";
import { HandledError } from "@langwatch/handled-error";

const LEGACY_WIRE =
  "Callers of this door read its own flat bodies: `{ message }` for a body that is not JSON, `{ message, errors }` for one that fails validation, and `{ message }` for a failed create.";

/** Main's flat body for a handled refusal below 500: the credential sentence, or code and meta. */
function flatRefusalBody(failure: HandledError): object {
  if (failure.code === "malformed_request") return { message: "Bad request" };
  if (failure.code === "validation_error") {
    return {
      message: "Invalid request data",
      errors: failure.reasons.map((reason) =>
        HandledError.isHandled(reason) ? reason.meta : { message: reason.message },
      ),
    };
  }
  if (failure.httpStatus === 401) return { error: "Unauthorized", message: failure.message };

  return {
    error: failure.code,
    message: failure.message,
    ...failure.meta,
    ...(failure.tips.length > 0 ? { tips: failure.tips } : {}),
    ...(failure.docsUrl ? { docsUrl: failure.docsUrl } : {}),
    fault: failure.fault,
  };
}

/**
 * Main's refusals: a validation failure is its 400, not the family's 422, and
 * a failed create its one 500 sentence.
 */
const slackTriggerRefusal: RestProtocolRefusal = ({ failure, response }) => {
  if (isFrameworkRefusal(failure)) {
    return response.write({
      status: failure.status,
      mediaType: "text/plain",
      body: failure.message,
    });
  }

  if (!HandledError.isHandled(failure) || failure.httpStatus >= 500) {
    return response.write({
      status: 500,
      mediaType: "application/json",
      body: JSON.stringify({ message: "Error creating trigger" }),
    });
  }

  return response.write({
    status: failure.code === "validation_error" ? 400 : failure.httpStatus,
    mediaType: "application/json",
    body: JSON.stringify(flatRefusalBody(failure)),
  });
};

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
  .withResponse("protocol", {
    produces: "application/json",
    because: LEGACY_WIRE,
    refusal: slackTriggerRefusal,
  })
  .withDocs({
    summary: "Create a Slack alert trigger",
    description:
      "Create a trigger that posts to a Slack incoming webhook when traces match its filters. " +
      "The `/api/triggers` family supersedes this narrower form, which stays for callers " +
      "written against it.",
    tags: ["Triggers"],
    responses: documentedResponses({
      200: slackAutomationRestCreatedSchema,
      400: slackAutomationRestRefusalSchema,
      401: slackAutomationRestRefusalSchema,
    }),
  })
  .handle(async ({ app, input, response, scope }) => {
    await app.create({
      projectId: scope.id,
      action: "SEND_SLACK_MESSAGE",
      name: input.name,
      message: input.message,
      filters: input.filters,
      actionParams: { slackWebhook: input.slack_webhook },
      alertType: input.alert_type,
    });

    return response.write({
      status: 200,
      mediaType: "application/json",
      body: JSON.stringify({ message: "Slack trigger created successfully" }),
    });
  })
  .build();
