// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Connected customers' billing (ADR-156 section 7): the daily tick, the seat invoicing pass every
 * minute, and the onboarding and renewal facts connect moves the contract budget on (C3a). Keyed
 * by organization; the two scheduled processes still walk every customer.
 */
import {
  CONNECTED_BILLING_AGGREGATE_TYPE,
  type BillingApi,
  type ConnectedCustomerOnboardedEventData,
  type ConnectedTermRenewedEventData,
} from "@langwatch/enterprise-billing-contract";
import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type Projection,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";
import { nowInstant } from "@langwatch/time";

import type { BillingModule } from "../app/billing.app.ts";
import type { BillingRepositories } from "../repositories/billing.repositories.ts";
import {
  type ConnectedBillingEvent,
  connectedCustomerOnboardedEventSchema,
  connectedTermRenewedEventSchema,
  RecordConnectedCustomerOnboardedCommand,
  RecordConnectedTermRenewedCommand,
} from "./connected-billing.commands.ts";
import {
  CONNECTED_BILLING_PROCESS_NAME,
  runConnectedBillingTick,
} from "./connected-billing.intent.ts";
import {
  CONNECTED_BILLING_FIRST_DELAY_MS,
  CONNECTED_BILLING_INITIAL_STATE,
  connectedBillingTickStateSchema,
  connectedBillingTickSchema,
  connectedBillingWake,
} from "./connected-billing.process.ts";
import { runSeatInvoicingPass } from "./seat-invoicing.intent.ts";
import {
  SEAT_INVOICING_INITIAL_STATE,
  SEAT_INVOICING_INTERVAL_MS,
  SEAT_INVOICING_PROCESS_NAME,
  seatInvoicingPassSchema,
  seatInvoicingStateSchema,
  seatInvoicingWake,
} from "./seat-invoicing.process.ts";

export const CONNECTED_BILLING_PIPELINE_NAME = "connected_billing";

export type ConnectedBillingPipeline = StaticPipelineDefinition<
  ConnectedBillingEvent,
  Record<string, Projection>,
  | { name: "recordConnectedCustomerOnboarded"; payload: ConnectedCustomerOnboardedEventData }
  | { name: "recordConnectedTermRenewed"; payload: ConnectedTermRenewedEventData }
>;

/** The pipeline, over only the app operations it calls. */
function buildConnectedBilling({
  app,
  processStore,
  bootedAt = nowInstant().epochMilliseconds,
}: EventingSetup<
  unknown,
  Pick<BillingApi, "runConnectedBillingTick" | "invoicePendingSeatChanges">
> & {
  bootedAt?: number;
}): ConnectedBillingPipeline {
  return definePipeline({
    name: CONNECTED_BILLING_PIPELINE_NAME,
    aggregate: defineAggregate({ type: CONNECTED_BILLING_AGGREGATE_TYPE }),
  })
    .withEvents([connectedCustomerOnboardedEventSchema, connectedTermRenewedEventSchema])
    .withCommand("recordConnectedCustomerOnboarded", RecordConnectedCustomerOnboardedCommand)
    .withCommand("recordConnectedTermRenewed", RecordConnectedTermRenewedCommand)
    .withProcessManager(CONNECTED_BILLING_PROCESS_NAME, (pm) =>
      pm
        .state(connectedBillingTickStateSchema, CONNECTED_BILLING_INITIAL_STATE)
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
    .withProcessManager(SEAT_INVOICING_PROCESS_NAME, (pm) =>
      pm
        .state(seatInvoicingStateSchema, SEAT_INVOICING_INITIAL_STATE)
        .schedule({ everyMs: SEAT_INVOICING_INTERVAL_MS })
        .onWake(seatInvoicingWake)
        .intent(
          "pass",
          seatInvoicingPassSchema,
          runSeatInvoicingPass({
            pass: () => app.invoicePendingSeatChanges(),
            deleteDispatchedBefore: (params) => processStore.deleteDispatchedBefore(params),
            now: () => nowInstant().epochMilliseconds,
          }),
        )
        // One pass at a time: a pass invoices at the payment provider.
        .outbox({ maxAttempts: 3, concurrency: 1, batchSize: 1, leaseDurationMs: 5 * 60 * 1000 }),
    )
    .build();
}

export const connectedBillingEventing = defineEventingModule({
  pipeline: CONNECTED_BILLING_PIPELINE_NAME,
  build: (setup: EventingSetup<BillingRepositories, BillingModule>) => buildConnectedBilling(setup),
  connect: ({ app, commands }) => app.connectConnectedBillingCommands(commands),
});
