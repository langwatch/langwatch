import { defineProcessModule } from "@langwatch/process";

import { SlackModule } from "./app/slack.app.ts";
import { slackRepositories } from "./repositories/slack-repositories.registry.ts";
import { slackRest } from "./transport/slack.rest.ts";
import { slackIntegrationTrpcTransport } from "./transport/slack.trpc.ts";

export const slackProcessModule = defineProcessModule("slack")
  .withRepositories(slackRepositories)
  .withApi(SlackModule)
  .withTransports(slackIntegrationTrpcTransport, slackRest);
