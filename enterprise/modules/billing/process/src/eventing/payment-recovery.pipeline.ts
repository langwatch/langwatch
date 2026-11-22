// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The hourly failed payment recovery sweep (specs/payment-recovery.feature): each open case
 * gets the latest notice its day has reached, and a case whose invoice was settled closes.
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
  runPaymentRecoverySweep,
  type PaymentRecoverySweepDeps,
} from "./payment-recovery.intent.ts";
import {
  PAYMENT_RECOVERY_INITIAL_STATE,
  PAYMENT_RECOVERY_INTERVAL_MS,
  PAYMENT_RECOVERY_PIPELINE_NAME,
  PAYMENT_RECOVERY_PROCESS_NAME,
  paymentRecoveryStateSchema,
  paymentRecoverySweepSchema,
  paymentRecoveryWake,
} from "./payment-recovery.process.ts";

export const paymentRecoveryEventing = defineEventingModule({
  pipeline: PAYMENT_RECOVERY_PIPELINE_NAME,
  build: ({ app, processStore }: EventingSetup<BillingRepositories, BillingModule>) =>
    buildPaymentRecoveryPipeline({
      sweep: () => app.sweepPaymentRecovery(),
      deleteDispatchedBefore: (params) => processStore.deleteDispatchedBefore(params),
    }),
});

/** A scheduled sweep, no events: a notice is due by the clock, not by a fact. */
export function buildPaymentRecoveryPipeline(
  deps: PaymentRecoverySweepDeps,
): StaticPipelineDefinition<never> {
  return definePipeline({
    name: PAYMENT_RECOVERY_PIPELINE_NAME,
    // `global`: the sweep spans every tenant by design and appends nothing.
    aggregate: defineAggregate({ type: "global" }),
  })
    .withEvents([])
    .withProcessManager(PAYMENT_RECOVERY_PROCESS_NAME, (pm) =>
      pm
        .state(paymentRecoveryStateSchema, PAYMENT_RECOVERY_INITIAL_STATE)
        .schedule({ everyMs: PAYMENT_RECOVERY_INTERVAL_MS })
        .onWake(paymentRecoveryWake)
        .intent("sweep", paymentRecoverySweepSchema, runPaymentRecoverySweep(deps))
        // One pass at a time: a pass sends mail, and the notice write is what stops a double.
        .outbox({ maxAttempts: 3, concurrency: 1, batchSize: 1, leaseDurationMs: 5 * 60 * 1000 }),
    )
    .build();
}
