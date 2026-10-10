import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type LaneAlias,
  type ProcessManagerApplier,
  type Projection,
  type RegisteredCommand,
  type RetentionPolicyResolver,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";
import {
  GATEWAY_BUDGET_CROSSING_EVENT_TYPE,
  GATEWAY_SPEND_ADMITTED_EVENT_TYPE,
  GATEWAY_SPEND_CONFIRMED_EVENT_TYPE,
  GATEWAY_SPEND_FAILED_EVENT_TYPE,
  GATEWAY_SPEND_SETTLED_EVENT_TYPE,
  GATEWAY_VK_LIFECYCLE_EVENT_TYPE,
} from "@langwatch/gateway-contract";
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
  runWebhookDeliveryPrune,
  WEBHOOK_DELIVERY_PRUNE_INITIAL_STATE,
  WEBHOOK_DELIVERY_PRUNE_INTERVAL_MS,
  WEBHOOK_DELIVERY_PRUNE_PROCESS_NAME,
  type WebhookDeliveryPruneDeps,
  webhookDeliveryPruneSchema,
  webhookDeliveryPruneStateSchema,
  webhookDeliveryPruneWake,
} from "./webhook-delivery-prune.process.ts";
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
  prune?: WebhookDeliveryPruneDeps;
  /** Each tenant's retention, stamped on the delivery event rows. */
  retention?: RetentionPolicyResolver | undefined;
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
  if (input.retention) pipeline.withRetention(input.retention);
  if (!input.deliveryProcess || !input.governanceProcess || !input.gatewayEvents || !input.prune) {
    return pipeline.build();
  }
  const gateway = webhookGatewayEventSubscribers(input.gatewayEvents);
  const prune = input.prune;
  return pipeline
    .withProcessManager(WEBHOOK_DELIVERY_PROCESS_NAME, input.deliveryProcess)
    .withProcessManager(GOVERNANCE_EVENTS_PROCESS_NAME, input.governanceProcess)
    .withProcessManager(WEBHOOK_DELIVERY_PRUNE_PROCESS_NAME, (pm) =>
      pm
        .state(webhookDeliveryPruneStateSchema, WEBHOOK_DELIVERY_PRUNE_INITIAL_STATE)
        .schedule({ everyMs: WEBHOOK_DELIVERY_PRUNE_INTERVAL_MS })
        .onWake(webhookDeliveryPruneWake)
        .intent("prune", webhookDeliveryPruneSchema, runWebhookDeliveryPrune(prune)),
    )
    .withPeerSubscriber("gatewaySpendAdmittedDelivery", gateway.gatewaySpendAdmittedDelivery)
    .withPeerSubscriber("gatewaySpendConfirmedDelivery", gateway.gatewaySpendConfirmedDelivery)
    .withPeerSubscriber("gatewaySpendFailedDelivery", gateway.gatewaySpendFailedDelivery)
    .withPeerSubscriber("gatewaySpendSettledDelivery", gateway.gatewaySpendSettledDelivery)
    .withPeerSubscriber("gatewayBudgetCrossingDelivery", gateway.gatewayBudgetCrossingDelivery)
    .withPeerSubscriber("gatewayVkLifecycleDelivery", gateway.gatewayVkLifecycleDelivery)
    .withLaneAliases(MAIN_DELIVERY_MANAGER_ALIASES)
    .build();
}

/**
 * Main's two delivery managers ran on the spend and governance pipelines and read the gateway
 * event itself. Here the same event reaches the peer subscriber that queues its delivery.
 */
const MAIN_DELIVERY_MANAGER_ALIASES: readonly LaneAlias[] = [
  ...deliveryAliases({
    from: "gateway_spend_processing:subscriber:pm:webhookDelivery",
    successors: {
      [GATEWAY_SPEND_ADMITTED_EVENT_TYPE]: "gatewaySpendAdmittedDelivery",
      [GATEWAY_SPEND_CONFIRMED_EVENT_TYPE]: "gatewaySpendConfirmedDelivery",
      [GATEWAY_SPEND_FAILED_EVENT_TYPE]: "gatewaySpendFailedDelivery",
      [GATEWAY_SPEND_SETTLED_EVENT_TYPE]: "gatewaySpendSettledDelivery",
    },
  }),
  ...deliveryAliases({
    from: "governance_events_processing:subscriber:pm:governanceEventsDelivery",
    successors: {
      [GATEWAY_BUDGET_CROSSING_EVENT_TYPE]: "gatewayBudgetCrossingDelivery",
      [GATEWAY_VK_LIFECYCLE_EVENT_TYPE]: "gatewayVkLifecycleDelivery",
    },
  }),
];

function deliveryAliases({
  from,
  successors,
}: {
  from: string;
  successors: Readonly<Record<string, string>>;
}): readonly LaneAlias[] {
  return Object.entries(successors).map(([eventType, lane]) => ({
    from,
    to: { jobType: "subscriber", lane },
    eventTypes: [eventType],
    removeAfter: "3.21.0",
  }));
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
