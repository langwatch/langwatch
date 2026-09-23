import type { BillingApi } from "@langwatch/enterprise-billing-contract";
// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The daily billing tick of connected customers (ADR-156 section 7): a
 * scheduled process with no events of its own. `global`, because one tick
 * walks every connected customer.
 */
import {
  defineAggregate,
  defineEvents,
  defineEventingModule,
  definePipeline,
  type Event,
  type EventingSetup,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";
import { nowInstant } from "@langwatch/time";

import type { BillingRepositories } from "../repositories/billing.repositories.ts";
import {
  CONNECTED_BILLING_PROCESS_NAME,
  runConnectedBillingTick,
} from "./connected-billing.intent.ts";
import {
  CONNECTED_BILLING_FIRST_DELAY_MS,
  CONNECTED_BILLING_INITIAL_STATE,
  type ConnectedBillingTickState,
  connectedBillingTickSchema,
  connectedBillingWake,
} from "./connected-billing.process.ts";

export const CONNECTED_BILLING_PIPELINE_NAME = "connected_billing";

/** The pipeline, over only the one app operation it calls. */
export function buildConnectedBilling({
  app,
  processStore,
  bootedAt = nowInstant().epochMilliseconds,
}: EventingSetup<unknown, Pick<BillingApi, "runConnectedBillingTick">> & {
  bootedAt?: number;
}): StaticPipelineDefinition<Event> {
  return definePipeline<Event>({
    name: CONNECTED_BILLING_PIPELINE_NAME,
    aggregate: defineAggregate({ type: "global", events: defineEvents([]) }),
  })
    .withProcessManager(CONNECTED_BILLING_PROCESS_NAME, (pm) =>
      pm
        .state<ConnectedBillingTickState>(CONNECTED_BILLING_INITIAL_STATE)
        .schedule({ everyMs: CONNECTED_BILLING_FIRST_DELAY_MS })
        .onWake(connectedBillingWake({ bootedAt }))
        .intent(
          "tick",
          connectedBillingTickSchema,
          runConnectedBillingTick({
            tick: () => app.runConnectedBillingTick(),
            deleteDispatchedBefore: (params) => processStore.deleteDispatchedBefore(params),
            now: () => nowInstant().epochMilliseconds,
          }),
        )
        // One tick invoices at the payment provider; a retry repeats only what is idempotent.
        .outbox({ maxAttempts: 3, concurrency: 1, batchSize: 1, leaseDurationMs: 10 * 60 * 1000 }),
    )
    .build();
}

export const connectedBillingEventing = defineEventingModule({
  pipeline: CONNECTED_BILLING_PIPELINE_NAME,
  build: (setup: EventingSetup<BillingRepositories, BillingApi>) => buildConnectedBilling(setup),
});
