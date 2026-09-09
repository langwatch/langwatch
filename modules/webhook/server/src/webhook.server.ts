import { defineModule } from "@langwatch/runtime-composition";
import { WebhookApp } from "./app/webhook.app.ts";
import { webhookEndpointTrpcTransport } from "./transport/webhook-endpoint.trpc.ts";

export type { WebhookAppDependencies, WebhookTestDispatch } from "./app/webhook.app.ts";

/** The canonical outbound-webhook feature declaration. */
export const webhookServer = defineModule("webhook")
  .withApp(WebhookApp)
  .withTransports(webhookEndpointTrpcTransport)
  .build();
