import type { SelfHostedCustomerLicensedEventData } from "@langwatch/enterprise-licensing-contract";
import { LICENSING_CUSTOMER_AGGREGATE_TYPE } from "@langwatch/enterprise-licensing-contract";
import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type Projection,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";

import type { LicensingModule } from "../app/licensing.app.ts";
import {
  RecordSelfHostedCustomerLicensedCommand,
  selfHostedCustomerLicensedEventSchema,
  type SelfHostedCustomerLicensedEvent,
} from "./licensing-customer.commands.ts";

export const LICENSING_CUSTOMER_PIPELINE_NAME = "licensing_customer";

export type LicensingCustomerPipeline = StaticPipelineDefinition<
  SelfHostedCustomerLicensedEvent,
  Record<string, Projection>,
  { name: "recordSelfHostedCustomerLicensed"; payload: SelfHostedCustomerLicensedEventData }
>;

/** licensing_customer: facts about licensing's customers that organization applies (R42). */
export function buildLicensingCustomerPipeline(): LicensingCustomerPipeline {
  return definePipeline({
    name: LICENSING_CUSTOMER_PIPELINE_NAME,
    aggregate: defineAggregate({ type: LICENSING_CUSTOMER_AGGREGATE_TYPE }),
  })
    .withEvents([selfHostedCustomerLicensedEventSchema])
    .withCommand("recordSelfHostedCustomerLicensed", RecordSelfHostedCustomerLicensedCommand)
    .build();
}

export const licensingCustomerEventing = defineEventingModule({
  pipeline: LICENSING_CUSTOMER_PIPELINE_NAME,
  build: ({ app }: EventingSetup<never, LicensingModule>) => app.customerPipeline(),
  connect: ({ app, commands }) => app.connectCustomerCommands(commands),
});
