// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  BILLING_LIFECYCLE_AGGREGATE_TYPE,
  BILLING_LIFECYCLE_PIPELINE_NAME,
} from "@langwatch/enterprise-billing-contract";
import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type Projection,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";

import type { BillingModule } from "../app/billing.app.ts";
import {
  RecordBillingAuditCommand,
  RecordCheckoutCompletedCommand,
  RecordSubscriptionChangedCommand,
  RecordSubscriptionStartedCommand,
  RecordUsageBillingChangedCommand,
  RecordPlanLimitAlertSentCommand,
  RecordCheckoutCurrencySelectedCommand,
  RecordPricingModelChangedCommand,
  RecordSeatCheckoutPaidCommand,
  RecordSeatCheckoutsAbandonedCommand,
} from "./billing-lifecycle.commands.ts";
import {
  billingAuditRecordedEventSchema,
  checkoutCompletedEventSchema,
  subscriptionChangedEventSchema,
  subscriptionStartedEventSchema,
  usageBillingChangedEventSchema,
  planLimitAlertSentEventSchema,
  checkoutCurrencySelectedEventSchema,
  pricingModelChangedEventSchema,
  seatCheckoutPaidEventSchema,
  seatCheckoutsAbandonedEventSchema,
  type BillingLifecycleEvent,
  type RecordBillingAuditCommandData,
  type RecordCheckoutCompletedCommandData,
  type RecordSubscriptionChangedCommandData,
  type RecordSubscriptionStartedCommandData,
  type RecordUsageBillingChangedCommandData,
  type RecordPlanLimitAlertSentCommandData,
  type RecordCheckoutCurrencySelectedCommandData,
  type RecordPricingModelChangedCommandData,
  type RecordSeatCheckoutPaidCommandData,
  type RecordSeatCheckoutsAbandonedCommandData,
} from "./billing-lifecycle.events.ts";
import {
  BILLING_PLAN_LIMIT_REACHED_SUBSCRIBER_NAME,
  planLimitReachedSubscriber,
} from "./plan-limit-reached.subscriber.ts";
import {
  BILLING_SEAT_LIMIT_REACHED_SUBSCRIBER_NAME,
  seatLimitReachedSubscriber,
} from "./seat-limit-reached.subscriber.ts";

export type BillingLifecyclePipeline = StaticPipelineDefinition<
  BillingLifecycleEvent,
  Record<string, Projection>,
  | { name: "recordSubscriptionChanged"; payload: RecordSubscriptionChangedCommandData }
  | { name: "recordSubscriptionStarted"; payload: RecordSubscriptionStartedCommandData }
  | { name: "recordCheckoutCompleted"; payload: RecordCheckoutCompletedCommandData }
  | { name: "recordUsageBillingChanged"; payload: RecordUsageBillingChangedCommandData }
  | { name: "recordAudit"; payload: RecordBillingAuditCommandData }
  | { name: "recordPlanLimitAlertSent"; payload: RecordPlanLimitAlertSentCommandData }
  | { name: "recordCheckoutCurrencySelected"; payload: RecordCheckoutCurrencySelectedCommandData }
  | { name: "recordPricingModelChanged"; payload: RecordPricingModelChangedCommandData }
  | { name: "recordSeatCheckoutPaid"; payload: RecordSeatCheckoutPaidCommandData }
  | { name: "recordSeatCheckoutsAbandoned"; payload: RecordSeatCheckoutsAbandonedCommandData }
>;

/** billing_lifecycle: billing records its facts; peers react from their own side (§9). */
export type BuildBillingLifecyclePipelineInput = Readonly<{
  alerts: Parameters<typeof seatLimitReachedSubscriber>[0]["alerts"];
  planLimitAlerts: Parameters<typeof planLimitReachedSubscriber>[0]["alerts"];
}>;

export function buildBillingLifecyclePipeline({
  alerts,
  planLimitAlerts,
}: BuildBillingLifecyclePipelineInput): BillingLifecyclePipeline {
  return definePipeline({
    name: BILLING_LIFECYCLE_PIPELINE_NAME,
    aggregate: defineAggregate({ type: BILLING_LIFECYCLE_AGGREGATE_TYPE }),
  })
    .withEvents([
      subscriptionChangedEventSchema,
      subscriptionStartedEventSchema,
      checkoutCompletedEventSchema,
      usageBillingChangedEventSchema,
      billingAuditRecordedEventSchema,
      planLimitAlertSentEventSchema,
      checkoutCurrencySelectedEventSchema,
      pricingModelChangedEventSchema,
      seatCheckoutPaidEventSchema,
      seatCheckoutsAbandonedEventSchema,
    ])
    .withCommand("recordSubscriptionChanged", RecordSubscriptionChangedCommand)
    .withCommand("recordSubscriptionStarted", RecordSubscriptionStartedCommand)
    .withCommand("recordCheckoutCompleted", RecordCheckoutCompletedCommand)
    .withCommand("recordUsageBillingChanged", RecordUsageBillingChangedCommand)
    .withCommand("recordAudit", RecordBillingAuditCommand)
    .withCommand("recordPlanLimitAlertSent", RecordPlanLimitAlertSentCommand)
    .withCommand("recordCheckoutCurrencySelected", RecordCheckoutCurrencySelectedCommand)
    .withCommand("recordPricingModelChanged", RecordPricingModelChangedCommand)
    .withCommand("recordSeatCheckoutPaid", RecordSeatCheckoutPaidCommand)
    .withCommand("recordSeatCheckoutsAbandoned", RecordSeatCheckoutsAbandonedCommand)
    .withPeerSubscriber(
      BILLING_SEAT_LIMIT_REACHED_SUBSCRIBER_NAME,
      seatLimitReachedSubscriber({ alerts }),
    )
    .withPeerSubscriber(
      BILLING_PLAN_LIMIT_REACHED_SUBSCRIBER_NAME,
      planLimitReachedSubscriber({ alerts: planLimitAlerts }),
    )
    .build();
}

export const billingLifecycleEventing = defineEventingModule({
  pipeline: BILLING_LIFECYCLE_PIPELINE_NAME,
  build: ({ app }: EventingSetup<never, BillingModule>) => app.lifecyclePipeline(),
  connect: ({ app, commands }) => app.connectLifecycleCommands(commands),
});
