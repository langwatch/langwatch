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
  RecordSupersededPlansFoundCommand,
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
  supersededPlansFoundEventSchema,
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
  type RecordSupersededPlansFoundCommandData,
} from "./billing-lifecycle.events.ts";
import {
  BILLING_PLAN_LIMIT_REACHED_SUBSCRIBER_NAME,
  planLimitReachedSubscriber,
} from "./plan-limit-reached.subscriber.ts";
import {
  BILLING_SEAT_LIMIT_REACHED_SUBSCRIBER_NAME,
  seatLimitReachedSubscriber,
} from "./seat-limit-reached.subscriber.ts";
import {
  retireTieredPlansIntentSchema,
  TIERED_PLAN_RETIREMENT_INITIAL_STATE,
  TIERED_PLAN_RETIREMENT_PROCESS_NAME,
  tieredPlanRetirementStateSchema,
  tieredPlanRetirementSupersededPlansFound,
  type RetireTieredPlansIntent,
} from "./tiered-plan-retirement.process.ts";

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
  | { name: "recordSupersededPlansFound"; payload: RecordSupersededPlansFoundCommandData }
>;

/** billing_lifecycle: billing records its facts; peers react from their own side (§9). */
export type BuildBillingLifecyclePipelineInput = Readonly<{
  alerts: Parameters<typeof seatLimitReachedSubscriber>[0]["alerts"];
  planLimitAlerts: Parameters<typeof planLimitReachedSubscriber>[0]["alerts"];
  /** Retires the tiered plans a Growth seat subscription supersedes; throws to be retried. */
  retireTieredPlans: (input: RetireTieredPlansIntent) => Promise<void>;
}>;

export function buildBillingLifecyclePipeline({
  alerts,
  planLimitAlerts,
  retireTieredPlans,
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
      supersededPlansFoundEventSchema,
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
    .withCommand("recordSupersededPlansFound", RecordSupersededPlansFoundCommand)
    .withPeerSubscriber(
      BILLING_SEAT_LIMIT_REACHED_SUBSCRIBER_NAME,
      seatLimitReachedSubscriber({ alerts }),
    )
    .withPeerSubscriber(
      BILLING_PLAN_LIMIT_REACHED_SUBSCRIBER_NAME,
      planLimitReachedSubscriber({ alerts: planLimitAlerts }),
    )
    .withProcessManager(TIERED_PLAN_RETIREMENT_PROCESS_NAME, (pm) =>
      pm
        .state(tieredPlanRetirementStateSchema, TIERED_PLAN_RETIREMENT_INITIAL_STATE)
        // The aggregate is the organization, so one organization's retirements run in order.
        .keyBy((event) => event.aggregateId)
        .intent("retireTieredPlans", retireTieredPlansIntentSchema, (input) =>
          retireTieredPlans(input),
        )
        .on(supersededPlansFoundEventSchema, tieredPlanRetirementSupersededPlansFound)
        // A retirement cancels at the payment provider; each retry skips what is already done.
        .outbox({ maxAttempts: 8, leaseDurationMs: 2 * 60 * 1000 }),
    )
    .build();
}

export const billingLifecycleEventing = defineEventingModule({
  pipeline: BILLING_LIFECYCLE_PIPELINE_NAME,
  build: ({ app }: EventingSetup<never, BillingModule>) => app.lifecyclePipeline(),
  connect: ({ app, commands }) => app.connectLifecycleCommands(commands),
});
