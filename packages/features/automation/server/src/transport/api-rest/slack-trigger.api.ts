/**
 * `POST /api/trigger/slack` — the narrow, one-action ancestor of
 * `/api/triggers`.
 *
 * The `/api/triggers` family supersedes it and creates any of the four
 * actions; this one only ever created a Slack alert, and it keeps its own path,
 * its own body spelling (`slack_webhook`, `alert_type`) and its own two refusal
 * bodies because callers were written against them. Both doors dispatch through
 * the SAME {@link AutomationApp}, so the condition rule and the persist ceiling
 * are decided once rather than once per door.
 *
 * The filter vocabulary is deliberately NOT re-enumerated here. The retired
 * route validated `filters` against the analytics filter-field enumeration; the
 * application's own create already refuses a condition it cannot evaluate, and
 * that refusal is where the vocabulary lives now — the same narrowing the
 * `/api/triggers` family settled on, so the two doors cannot accept different
 * conditions.
 */
import { requires } from "@langwatch/api";
import {
  type AppRestSecurity,
  MANAGEMENT_API_VERSION,
  type MountableRestApp,
  resolver,
} from "@langwatch/api/rest";
import { HandledError, isZodLikeError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import type { Context, ErrorHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import type { AutomationApp } from "#app/automation.app";

const logger = createLogger("langwatch:api:triggers:slack");

const slackTriggerBodySchema = z.object({
  slack_webhook: z.string().url().describe("Incoming webhook URL the alert is posted to"),
  name: z.string().describe("How the trigger is listed in the app"),
  message: z.string().optional().describe("Extra line included with each alert"),
  filters: z
    .record(z.string(), z.unknown())
    .default({})
    .describe("Which traces the trigger fires on. An empty object fires on all of them."),
  alert_type: z.enum(["CRITICAL", "WARNING", "INFO"]),
});

/** `POST /api/trigger/slack`, bound to one process's automation application. */
export function createSlackTriggerRestApp(options: {
  security: AppRestSecurity;
  automation: () => AutomationApp;
}): MountableRestApp {
  const { security, automation } = options;

  // The basePath is `/api` because the path is `/api/trigger/slack` — the
  // SINGULAR namespace, which the plural `/api/triggers` family does not claim.
  const { service, policy } = security.createProjectVersionedApp({
    name: "trigger-slack",
    basePath: "/api",
    errorEnvelope: "legacy",
    errorHandler: slackTriggerErrorHandler,
  });

  const createHandler = async (c: Context, input: z.infer<typeof slackTriggerBodySchema>) => {
    const project = c.get("project");

    await automation().create({
      projectId: project.id,
      action: "SEND_SLACK_MESSAGE",
      name: input.name,
      message: input.message,
      filters: input.filters,
      actionParams: { slackWebhook: input.slack_webhook },
      alertType: input.alert_type,
    });

    return { message: "Slack trigger created successfully" };
  };

  return service
    .registerRoute("post", "/trigger/slack", MANAGEMENT_API_VERSION, createHandler, (b) =>
      policy(requires("triggers:manage"))(b)
        .withInput(slackTriggerBodySchema)
        .withOutput(z.object({ message: z.string() }))
        .withDocs({
          operationId: "createSlackTrigger",
          summary: "Create a Slack alert trigger",
          description:
            "Create a trigger that posts to a Slack incoming webhook when traces match its filters. The `/api/triggers` family supersedes this narrower form, which stays for callers written against it.",
          tags: ["Triggers"],
          responses: {
            400: {
              description: "The body was not valid JSON, or failed validation",
              content: {
                "application/json": {
                  schema: resolver(
                    z.object({
                      message: z.string(),
                      errors: z
                        .array(z.record(z.string(), z.unknown()))
                        .optional()
                        .describe("The individual validation failures, when present"),
                    }),
                  ),
                },
              },
            },
            401: {
              description: "Missing or invalid API key",
              content: {
                "application/json": { schema: resolver(z.object({ message: z.string() })) },
              },
            },
          },
        }),
    )
    .build();
}

/**
 * The three bodies this door has always answered, and no others.
 *
 * A body that is not JSON, a body the schema rejects, and everything else —
 * which for this one-call route is the application refusing to create the
 * trigger. The caller has no branch to take on which application failure it
 * was, so it stays one 500 sentence and the structured detail goes to this
 * process's log with a trace id.
 *
 * A rejected body reaches here as the request pipeline's own refusal —
 * `malformed_request` for something that is not JSON, `validation_error` for
 * something the schema refused — rather than as the bare zod error the
 * retired door raised. Both are the CALLER's mistake and both belong in the
 * 400 this route documents; read as "everything else" they became a 500 that
 * told the caller to retry a body that will never be accepted.
 */
const slackTriggerErrorHandler =
  (_boundary: ErrorHandler): ErrorHandler =>
  (error, c) => {
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
