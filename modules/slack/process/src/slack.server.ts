import { defineServerModule } from "@langwatch/kernel";

import { SlackApp } from "./app/slack.app.ts";
import { slackRepositories } from "./repositories/slack-repositories.registry.ts";
import { slackRest } from "./transport/slack.rest.ts";
import { slackIntegrationTrpcTransport } from "./transport/slack.trpc.ts";

export const slackServer = defineServerModule("slack")
  .withRepositories(slackRepositories)
  .withApp(SlackApp)
  .withTransports(slackIntegrationTrpcTransport, slackRest);
