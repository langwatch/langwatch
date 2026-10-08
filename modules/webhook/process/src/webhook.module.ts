import { defineProcessModule, type PublishedProcessModule } from "@langwatch/process";
import type { WebhookApi, WebhookServerConfig } from "@langwatch/webhook-contract";

import { WebhookModule } from "./app/webhook.app.ts";
import { webhookChannels } from "./channels/webhook-channels.registry.ts";
import { webhookDeliveryEventing } from "./eventing/webhook-delivery.pipeline.ts";
import { webhookRepositories } from "./repositories/webhook-repositories.registry.ts";
import { webhookEndpointTrpcTransport } from "./transport/webhook-endpoint.trpc.ts";
import { webhookSpendReplayRest } from "./transport/webhook-spend-replay.rest.ts";
import { webhookRest } from "./transport/webhook.rest.ts";

/** The canonical outbound-webhook feature declaration. */
export const webhookProcessModule: PublishedProcessModule<
  "webhook",
  WebhookApi,
  WebhookServerConfig
> = defineProcessModule("webhook")
  .withRepositories(webhookRepositories)
  .withChannels(webhookChannels)
  .withApi(WebhookModule)
  .withTransports(webhookEndpointTrpcTransport, webhookRest, webhookSpendReplayRest)
  .withEventing(webhookDeliveryEventing);
