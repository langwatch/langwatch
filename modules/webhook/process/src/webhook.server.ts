import { defineServerModule } from "@langwatch/kernel";
import type { WebhookEnvelope, WebhookSpendEventRow } from "@langwatch/webhook-contract";

import { WebhookApp } from "./app/webhook.app.ts";
import { webhookDeliveryEventing } from "./eventing/webhook-delivery.pipeline.ts";
import { webhookRepositories } from "./repositories/webhook-repositories.registry.ts";
import { WebhookEnvelopeService } from "./services/webhook-envelope.service.ts";
import { webhookEndpointTrpcTransport } from "./transport/webhook-endpoint.trpc.ts";
import { webhookRest } from "./transport/webhook.rest.ts";

export type { WebhookAppDependencies, WebhookTestDispatch } from "./app/webhook.app.ts";
export type { WebhookLiveDatabase } from "./repositories/prisma/prisma.webhook.repositories.ts";

/** The canonical outbound-webhook feature declaration. */
export const webhookServer = defineServerModule("webhook")
  .withRepositories(webhookRepositories)
  .withApp(WebhookApp)
  .withTransports(webhookEndpointTrpcTransport, webhookRest)
  .withEventing(webhookDeliveryEventing);

/**
 * How another package composes this feature: the envelope a spend row is
 * rendered through. What the row is built from stays inside the feature.
 */

/** One spend row as the canonical billing envelope every destination receives. */
export interface WebhookEnvelopes {
  fromSpendRow(row: WebhookSpendEventRow): WebhookEnvelope;
}

export function createWebhookEnvelopes(): WebhookEnvelopes {
  return WebhookEnvelopeService.create();
}
