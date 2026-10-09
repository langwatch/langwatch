import { defineProcessModule, type PublishedProcessModule } from "@langwatch/process";
import type { SlackApi } from "@langwatch/slack-contract";

import { SlackModule } from "./app/slack.app.ts";
import { slackChannels } from "./channels/slack-channels.registry.ts";
import { slackRepositories } from "./repositories/slack-repositories.registry.ts";
import { slackRest } from "./transport/slack.rest.ts";
import { slackIntegrationTrpcTransport } from "./transport/slack.trpc.ts";

export const slackProcessModule: PublishedProcessModule<"slack", SlackApi> = defineProcessModule(
  "slack",
)
  .withRepositories(slackRepositories)
  .withChannels(slackChannels)
  .withApi(SlackModule)
  .withTransports(slackIntegrationTrpcTransport, slackRest);
