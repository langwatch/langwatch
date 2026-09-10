import { defineModule } from "@langwatch/runtime-composition";
import { WebhookApp } from "./app/webhook.app.ts";
import { webhookRepositories } from "./repositories/webhook-repositories.registry.ts";
import { webhookEndpointTrpcTransport } from "./transport/webhook-endpoint.trpc.ts";
import { webhookRest } from "./transport/webhook.rest.ts";

export type { WebhookAppDependencies, WebhookTestDispatch } from "./app/webhook.app.ts";

/** The canonical outbound-webhook feature declaration. */
export const webhookServer = defineModule("webhook")
  .withRepositories(webhookRepositories)
  .withApp(WebhookApp)
  .withTransports(webhookEndpointTrpcTransport, webhookRest)
  .build();
