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
  type AppRestProjectVariables,
  type AppRestSecurity,
  type SecuredApp,
} from "@langwatch/api/rest";
import { createLogger } from "@langwatch/observability";
import { describeRoute, resolver } from "hono-openapi";
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
}): SecuredApp<{ Variables: AppRestProjectVariables }> {
  const { security, automation } = options;

  // The basePath is `/api` because the path is `/api/trigger/slack` — the
  // SINGULAR namespace, which the plural `/api/triggers` family does not claim.
  const secured = security.createProjectApp({ basePath: "/api" });

  secured.access(requires("triggers:manage")).post(
    "/trigger/slack",
    describeRoute({
      summary: "Create a Slack alert trigger",
      description:
        "Create a trigger that posts to a Slack incoming webhook when traces match its filters. The `/api/triggers` family supersedes this narrower form, which stays for callers written against it.",
      tags: ["Triggers"],
      responses: {
        200: {
          description: "The trigger was created",
          content: {
            "application/json": {
              schema: resolver(z.object({ message: z.string() })),
            },
          },
        },
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
    async (c) => {
      const project = c.get("project");

      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.json({ message: "Bad request" }, 400);
      }

      const parsed = slackTriggerBodySchema.safeParse(body);
      if (!parsed.success) {
        return c.json({ message: "Invalid request data", errors: parsed.error.issues }, 400);
      }

      try {
        await automation().create({
          projectId: project.id,
          action: "SEND_SLACK_MESSAGE",
          name: parsed.data.name,
          message: parsed.data.message,
          filters: parsed.data.filters,
          actionParams: { slackWebhook: parsed.data.slack_webhook },
          alertType: parsed.data.alert_type,
        });
      } catch (error) {
        // One 500 sentence, as this door has always answered: the caller has
        // no branch to take on which of the application's failures it was, and
        // the structured detail is in this process's log with a trace id.
        logger.error({ error }, "Error creating trigger");
        return c.json({ message: "Error creating trigger" }, 500);
      }

      return c.json({ message: "Slack trigger created successfully" });
    },
  );

  return secured;
}
