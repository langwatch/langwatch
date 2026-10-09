import type {
  ConnectServiceSwitchedEventData,
  LicenseClearedEventData,
  LicenseStoredEventData,
  LicenseSyncFinishedEventData,
  SelfHostedCustomerLicensedEventData,
} from "@langwatch/enterprise-licensing-contract";
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
  type ConnectServiceSwitchedEvent,
  connectServiceSwitchedEventSchema,
  type LicenseClearedEvent,
  licenseClearedEventSchema,
  type LicenseStoredEvent,
  licenseStoredEventSchema,
  type LicenseSyncFinishedEvent,
  licenseSyncFinishedEventSchema,
  RecordConnectServiceSwitchedCommand,
  RecordLicenseClearedCommand,
  RecordLicenseStoredCommand,
  RecordLicenseSyncFinishedCommand,
  RecordSelfHostedCustomerLicensedCommand,
  selfHostedCustomerLicensedEventSchema,
  type SelfHostedCustomerLicensedEvent,
} from "./licensing-customer.commands.ts";

export const LICENSING_CUSTOMER_PIPELINE_NAME = "licensing_customer";

export type LicensingCustomerPipeline = StaticPipelineDefinition<
  | SelfHostedCustomerLicensedEvent
  | ConnectServiceSwitchedEvent
  | LicenseSyncFinishedEvent
  | LicenseStoredEvent
  | LicenseClearedEvent,
  Record<string, Projection>,
  | { name: "recordSelfHostedCustomerLicensed"; payload: SelfHostedCustomerLicensedEventData }
  | { name: "recordConnectServiceSwitched"; payload: ConnectServiceSwitchedEventData }
  | { name: "recordLicenseSyncFinished"; payload: LicenseSyncFinishedEventData }
  | { name: "recordLicenseStored"; payload: LicenseStoredEventData }
  | { name: "recordLicenseCleared"; payload: LicenseClearedEventData }
>;

/** licensing_customer: facts about licensing's customers that organization applies (R42). */
export function buildLicensingCustomerPipeline(): LicensingCustomerPipeline {
  return definePipeline({
    name: LICENSING_CUSTOMER_PIPELINE_NAME,
    aggregate: defineAggregate({ type: LICENSING_CUSTOMER_AGGREGATE_TYPE }),
  })
    .withEvents([
      selfHostedCustomerLicensedEventSchema,
      connectServiceSwitchedEventSchema,
      licenseSyncFinishedEventSchema,
      licenseStoredEventSchema,
      licenseClearedEventSchema,
    ])
    .withCommand("recordSelfHostedCustomerLicensed", RecordSelfHostedCustomerLicensedCommand)
    .withCommand("recordConnectServiceSwitched", RecordConnectServiceSwitchedCommand)
    .withCommand("recordLicenseSyncFinished", RecordLicenseSyncFinishedCommand)
    .withCommand("recordLicenseStored", RecordLicenseStoredCommand)
    .withCommand("recordLicenseCleared", RecordLicenseClearedCommand)
    .build();
}

export const licensingCustomerEventing = defineEventingModule({
  pipeline: LICENSING_CUSTOMER_PIPELINE_NAME,
  build: ({ app }: EventingSetup<never, LicensingModule>) => app.customerPipeline(),
  connect: ({ app, commands }) => app.connectCustomerCommands(commands),
});
