import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type Projection,
  type RegisteredCommand,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";
import type { WebhookApi } from "@langwatch/webhook-contract";

import type { GatewayApp } from "../app/gateway.app.ts";
import {
  GATEWAY_GOVERNANCE_EVENTS_AGGREGATE_TYPE,
  GATEWAY_GOVERNANCE_EVENTS_PIPELINE_NAME,
  gatewayBudgetCrossingEventSchema,
  type GatewayGovernanceProcessingEvent,
  gatewayVkLifecycleEventSchema,
  RecordBudgetCrossingCommand,
  RecordVkLifecycleCommand,
} from "./gateway-governance-events.intent.ts";
import {
  GATEWAY_GOVERNANCE_WEBHOOK_SUBSCRIBER_NAME,
  gatewayGovernanceWebhookSubscriber,
} from "./gateway-governance-webhook.subscriber.ts";

export type GatewayGovernanceEventsDefinition = StaticPipelineDefinition<
  GatewayGovernanceProcessingEvent,
  Record<string, Projection>,
  RegisteredCommand
>;

/**
 * Gateway's governance facts, ordered per governed subject. The api only records them;
 * the worker also hands each one to webhook delivery.
 */
export function buildGatewayGovernanceEventsPipeline(input: {
  webhooks?: Pick<WebhookApi, "requestGatewayEventDelivery">;
}): GatewayGovernanceEventsDefinition {
  const pipeline = definePipeline({
    name: GATEWAY_GOVERNANCE_EVENTS_PIPELINE_NAME,
    aggregate: defineAggregate({ type: GATEWAY_GOVERNANCE_EVENTS_AGGREGATE_TYPE }),
  })
    .withEvents([gatewayVkLifecycleEventSchema, gatewayBudgetCrossingEventSchema])
    .withCommand("recordVkLifecycle", RecordVkLifecycleCommand)
    .withCommand("recordBudgetCrossing", RecordBudgetCrossingCommand);
  if (!input.webhooks) return pipeline.build();
  return pipeline
    .withEventSubscriber(
      GATEWAY_GOVERNANCE_WEBHOOK_SUBSCRIBER_NAME,
      gatewayGovernanceWebhookSubscriber(input.webhooks),
    )
    .build();
}

/** Declared before gateway_spend, so the debit writer's crossing sender is bound first. */
export const gatewayGovernanceEventsEventing = defineEventingModule({
  pipeline: GATEWAY_GOVERNANCE_EVENTS_PIPELINE_NAME,
  build: ({ app, participation }: EventingSetup<undefined, GatewayApp>) =>
    app.governanceEventsPipeline({ participation }),
  connect: ({ app, commands }) => app.connectGovernanceEvents(commands),
});
