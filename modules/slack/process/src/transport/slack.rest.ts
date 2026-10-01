/**
 * `GET /api/slack-connections`: the connections a project can deliver through,
 * over an API key. The framework answers `/api/v1/slack-connections` too
 * (`packages/api/src/rest/addressing.ts`). Never returns a token or webhook URL.
 */
import {
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  type RestTransportDeclaration,
} from "@langwatch/api/rest";
import { createLogger } from "@langwatch/observability";
import {
  SlackApi,
  slackConnectionRestResponseSchema,
  type SlackConnectionRestResponse,
  type SlackConnectionView,
} from "@langwatch/slack-contract";
import { z } from "zod";

const logger = createLogger("langwatch:api:slack-connections");

/** Fields picked one by one, so no secret-bearing field can ride along. */
function slackConnectionWire(connection: SlackConnectionView): SlackConnectionRestResponse {
  return {
    id: connection.id,
    name: connection.name,
    kind: connection.kind === "BOT" ? "bot" : "webhook",
    scopeType: connection.scopeType,
    scopeId: connection.scopeId,
    scopeName: connection.scopeName,
    slackTeamName: connection.slackTeamName,
    createdAt: connection.createdAt.toISOString(),
  };
}

export const slackRest: Readonly<{
  protocol: "rest";
  namespace: string;
  router: () => RestTransportDeclaration<SlackApi>;
}> = defineRestRouter(SlackApi)
  .withNamespace("slack-connections")
  .withVersion(MANAGEMENT_API_VERSION)

  .get("/", "getApiSlackConnections")
  .withPermission("project:view")
  .withOutput(z.array(slackConnectionRestResponseSchema))
  .withDocs({
    tags: ["Slack connections"],
    description:
      "List the Slack connections this project can deliver through: its own and its organization's, by name. Never returns a token or webhook URL.",
  })
  .handle(async ({ app, scope }) => {
    logger.info({ projectId: scope.id }, "Listing Slack connections");
    const { connections } = await app.listSlackConnections({ projectId: scope.id });
    return connections.map(slackConnectionWire);
  })
  .build();
