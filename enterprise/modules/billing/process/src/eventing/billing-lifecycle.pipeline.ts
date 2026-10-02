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
  RecordCheckoutCompletedCommand,
  RecordSubscriptionChangedCommand,
} from "./billing-lifecycle.commands.ts";
import {
  checkoutCompletedEventSchema,
  subscriptionChangedEventSchema,
  type BillingLifecycleEvent,
  type RecordCheckoutCompletedCommandData,
  type RecordSubscriptionChangedCommandData,
} from "./billing-lifecycle.events.ts";

export type BillingLifecyclePipeline = StaticPipelineDefinition<
  BillingLifecycleEvent,
  Record<string, Projection>,
  | { name: "recordSubscriptionChanged"; payload: RecordSubscriptionChangedCommandData }
  | { name: "recordCheckoutCompleted"; payload: RecordCheckoutCompletedCommandData }
>;

/** billing_lifecycle: billing records its facts; peers react from their own side (§9). */
export function buildBillingLifecyclePipeline(): BillingLifecyclePipeline {
  return definePipeline({
    name: BILLING_LIFECYCLE_PIPELINE_NAME,
    aggregate: defineAggregate({ type: BILLING_LIFECYCLE_AGGREGATE_TYPE }),
  })
    .withEvents([subscriptionChangedEventSchema, checkoutCompletedEventSchema])
    .withCommand("recordSubscriptionChanged", RecordSubscriptionChangedCommand)
    .withCommand("recordCheckoutCompleted", RecordCheckoutCompletedCommand)
    .build();
}

export const billingLifecycleEventing = defineEventingModule({
  pipeline: BILLING_LIFECYCLE_PIPELINE_NAME,
  build: ({ app }: EventingSetup<never, BillingModule>) => app.lifecyclePipeline(),
  connect: ({ app, commands }) => app.connectLifecycleCommands(commands),
});
