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

import type { WebhookModule } from "../app/webhook.app.ts";
import type { WebhookRepositories } from "../repositories/webhook.repositories.ts";
import {
  GOVERNANCE_EVENTS_PROCESS_NAME,
  WEBHOOK_DELIVERY_PROCESS_NAME,
} from "../rules/webhook-delivery-contract.rules.ts";
import {
  type WebhookGatewayEventDelivery,
  webhookGatewayEventSubscribers,
} from "./webhook-gateway-events.subscriber.ts";
import {
  RequestGovernanceDeliveryCommand,
  type WebhookDeliveryEvent,
  webhookGovernanceDeliveryRequestedEventSchema,
} from "./webhook-governance-delivery.intent.ts";
import {
  RequestSpendDeliveryCommand,
  webhookSpendDeliveryRequestedEventSchema,
} from "./webhook-spend-delivery.intent.ts";

export type WebhookDeliveryDefinition = StaticPipelineDefinition<
  WebhookDeliveryEvent,
  Record<string, Projection>,
  RegisteredCommand
>;

/**
 * webhook_delivery: the api only sends; the worker also hosts main's two delivery managers
 * and the peer subscribers that queue gateway's spend and governance facts for delivery.
 */
export function buildWebhookDeliveryPipeline(input: {
  deliveryProcess?: ProcessManagerApplier<WebhookDeliveryEvent>;
  governanceProcess?: ProcessManagerApplier<WebhookDeliveryEvent>;
  gatewayEvents?: WebhookGatewayEventDelivery;
}): WebhookDeliveryDefinition {
  const pipeline = definePipeline({
    name: WEBHOOK_DELIVERY_PIPELINE_NAME,
    aggregate: defineAggregate({ type: WEBHOOK_SPEND_DELIVERY_AGGREGATE_TYPE }),
  })
    .withEvents([
      webhookSpendDeliveryRequestedEventSchema,
      webhookGovernanceDeliveryRequestedEventSchema,
    ])
    .withCommand("requestSpendDelivery", RequestSpendDeliveryCommand)
    .withCommand("requestGovernanceDelivery", RequestGovernanceDeliveryCommand);
  if (!input.deliveryProcess || !input.governanceProcess || !input.gatewayEvents) {
    return pipeline.build();
  }
  const gateway = webhookGatewayEventSubscribers(input.gatewayEvents);
  return pipeline
    .withProcessManager(WEBHOOK_DELIVERY_PROCESS_NAME, input.deliveryProcess)
    .withProcessManager(GOVERNANCE_EVENTS_PROCESS_NAME, input.governanceProcess)
    .withPeerSubscriber("gatewaySpendAdmittedDelivery", gateway.gatewaySpendAdmittedDelivery)
    .withPeerSubscriber("gatewaySpendConfirmedDelivery", gateway.gatewaySpendConfirmedDelivery)
    .withPeerSubscriber("gatewaySpendFailedDelivery", gateway.gatewaySpendFailedDelivery)
    .withPeerSubscriber("gatewaySpendSettledDelivery", gateway.gatewaySpendSettledDelivery)
    .withPeerSubscriber("gatewayBudgetCrossingDelivery", gateway.gatewayBudgetCrossingDelivery)
    .withPeerSubscriber("gatewayVkLifecycleDelivery", gateway.gatewayVkLifecycleDelivery)
    .build();
}

export const webhookDeliveryEventing = defineEventingModule({
  pipeline: WEBHOOK_DELIVERY_PIPELINE_NAME,
  build: ({
    app,
    participation,
    processStore,
  }: EventingSetup<WebhookRepositories, WebhookModule>) =>
    app.deliveryPipeline({ participation, processStore }),
  connect: ({ app, commands }) => app.connectDelivery(commands),
});
