// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The billing-fixed notice every 15 minutes (specs/licensing/proration-preview.feature): an
 * admin whose seat change was refused for two live subscriptions hears once it can be finished.
 */
import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";

import type { BillingModule } from "../app/billing.app.ts";
import type { BillingRepositories } from "../repositories/billing.repositories.ts";
import {
  runBillingFixedNotice,
  type BillingFixedNoticeDeps,
} from "./billing-fixed-notice.intent.ts";
import {
  BILLING_FIXED_NOTICE_INITIAL_STATE,
  BILLING_FIXED_NOTICE_INTERVAL_MS,
  BILLING_FIXED_NOTICE_PIPELINE_NAME,
  BILLING_FIXED_NOTICE_PROCESS_NAME,
  billingFixedNoticeSchema,
  billingFixedNoticeStateSchema,
  billingFixedNoticeWake,
} from "./billing-fixed-notice.process.ts";

export const billingFixedNoticeEventing = defineEventingModule({
  pipeline: BILLING_FIXED_NOTICE_PIPELINE_NAME,
  build: ({ app, processStore }: EventingSetup<BillingRepositories, BillingModule>) =>
    buildBillingFixedNoticePipeline({
      notice: () => app.noticeFixedBilling(),
      deleteDispatchedBefore: (params) => processStore.deleteDispatchedBefore(params),
    }),
});

/** A scheduled sweep, no events: resolution is seen by the clock, not by a fact. */
export function buildBillingFixedNoticePipeline(
  deps: BillingFixedNoticeDeps,
): StaticPipelineDefinition<never> {
  return definePipeline({
    name: BILLING_FIXED_NOTICE_PIPELINE_NAME,
    // `global`: the sweep spans every tenant by design and appends nothing.
    aggregate: defineAggregate({ type: "global" }),
  })
    .withEvents([])
    .withProcessManager(BILLING_FIXED_NOTICE_PROCESS_NAME, (pm) =>
      pm
        .state(billingFixedNoticeStateSchema, BILLING_FIXED_NOTICE_INITIAL_STATE)
        .schedule({ everyMs: BILLING_FIXED_NOTICE_INTERVAL_MS })
        .onWake(billingFixedNoticeWake)
        .intent("notice", billingFixedNoticeSchema, runBillingFixedNotice(deps))
        // One pass at a time: two passes could email the same admin twice.
        .outbox({ maxAttempts: 3, concurrency: 1, batchSize: 1, leaseDurationMs: 5 * 60 * 1000 }),
    )
    .build();
}
