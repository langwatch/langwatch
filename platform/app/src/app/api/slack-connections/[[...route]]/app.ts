import { createLogger } from "@langwatch/observability";
import { describeRoute, resolver } from "hono-openapi";
import { z } from "zod";
import { createProjectApp, requires } from "~/server/api/security";
import type { SlackConnectionView } from "~/server/app-layer/automations/slack-integration/slack-integration.service";
import { createSlackIntegrationService } from "~/server/app-layer/automations/slack-integration/slack-integration.wiring";
import { prisma } from "~/server/db";
import { patchZodOpenapi } from "~/utils/extend-zod-openapi";
import { baseResponses } from "../../shared/base-responses";

patchZodOpenapi();

const logger = createLogger("langwatch:api:slack-connections");

const slackConnectionSchema = z.object({
  id: z
    .string()
    .describe(
      "What an automation's `slackIntegrationId` names to post through this connection.",
    ),
  name: z.string(),
  kind: z
    .enum(["bot", "webhook"])
    .describe(
      "`bot` posts as the LangWatch Slack app and needs a `slackChannelId` on the automation; `webhook` posts to its incoming webhook's channel.",
    ),
  scopeType: z.enum(["ORGANIZATION", "PROJECT"]),
  scopeId: z.string(),
  scopeName: z.string(),
  slackTeamName: z
    .string()
    .nullable()
    .describe("The Slack workspace a bot connection posts into."),
  createdAt: z.string(),
});

/** Fields picked one by one, so no secret-bearing field can ride along. */
const toSlackConnectionResponse = (
  connection: SlackConnectionView,
): z.infer<typeof slackConnectionSchema> => ({
  id: connection.id,
  name: connection.name,
  kind: connection.kind === "BOT" ? "bot" : "webhook",
  scopeType: connection.scopeType,
  scopeId: connection.scopeId,
  scopeName: connection.scopeName,
  slackTeamName: connection.slackTeamName,
  createdAt: connection.createdAt.toISOString(),
});

const secured = createProjectApp({ basePath: "/api/slack-connections" });

secured.access(requires("project:view")).get(
  "/",
  describeRoute({
    description:
      "List the Slack connections this project can deliver through: its own and its organization's, by name. Never returns a token or webhook URL.",
    responses: {
      ...baseResponses,
      200: {
        description: "Success",
        content: {
          "application/json": {
            schema: resolver(z.array(slackConnectionSchema)),
          },
        },
      },
    },
  }),
  async (c) => {
    const project = c.get("project");
    logger.info({ projectId: project.id }, "Listing Slack connections");
    const { connections } = await createSlackIntegrationService({
      prisma,
    }).listForProject({ projectId: project.id });
    return c.json(connections.map(toSlackConnectionResponse));
  },
);

export const app = secured.hono;
