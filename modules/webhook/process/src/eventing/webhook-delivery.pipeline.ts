import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type ProcessManagerApplier,
  type Projection,
  type RegisteredCommand,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";
import {
  WEBHOOK_DELIVERY_PIPELINE_NAME,
  WEBHOOK_SPEND_DELIVERY_AGGREGATE_TYPE,
} from "@langwatch/webhook-contract";

import type { WebhookApp } from "../app/webhook.app.ts";
import type { WebhookRepositories } from "../repositories/webhook.repositories.ts";
import { WEBHOOK_DELIVERY_PROCESS_NAME } from "../rules/webhook-delivery-contract.rules.ts";
import {
  RequestSpendDeliveryCommand,
  webhookSpendDeliveryRequestedEventSchema,
  type WebhookSpendDeliveryRequestedEvent,
} from "./webhook-spend-delivery.intent.ts";

export type WebhookDeliveryDefinition = StaticPipelineDefinition<
  WebhookSpendDeliveryRequestedEvent,
  Record<string, Projection>,
  RegisteredCommand
>;

/** webhook_delivery: the api only sends; the worker also hosts main's delivery process manager. */
export function buildWebhookDeliveryPipeline(input: {
  deliveryProcess?: ProcessManagerApplier<WebhookSpendDeliveryRequestedEvent>;
}): WebhookDeliveryDefinition {
  const pipeline = definePipeline({
    name: WEBHOOK_DELIVERY_PIPELINE_NAME,
    aggregate: defineAggregate({ type: WEBHOOK_SPEND_DELIVERY_AGGREGATE_TYPE }),
  })
    .withEvents([webhookSpendDeliveryRequestedEventSchema])
    .withCommand("requestSpendDelivery", RequestSpendDeliveryCommand);
  if (!input.deliveryProcess) return pipeline.build();
  return pipeline.withProcessManager(WEBHOOK_DELIVERY_PROCESS_NAME, input.deliveryProcess).build();
}

export const webhookDeliveryEventing = defineEventingModule({
  pipeline: WEBHOOK_DELIVERY_PIPELINE_NAME,
  build: ({ app, participation }: EventingSetup<WebhookRepositories, WebhookApp>) =>
    app.deliveryPipeline({ participation }),
  connect: ({ app, commands }) => app.connectDelivery(commands),
});
