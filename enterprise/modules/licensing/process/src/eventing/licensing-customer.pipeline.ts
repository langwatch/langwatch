import type {
  ConnectServiceSwitchedEventData,
  LicenseClearedEventData,
  LicenseStoredEventData,
  LicenseSyncFinishedEventData,
  ManagedKeyInvalidatedEventData,
  ManagedKeyRetiredEventData,
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
  type ManagedKeyInvalidatedEvent,
  managedKeyInvalidatedEventSchema,
  type ManagedKeyRetiredEvent,
  managedKeyRetiredEventSchema,
  RecordConnectServiceSwitchedCommand,
  RecordLicenseClearedCommand,
  RecordLicenseStoredCommand,
  RecordLicenseSyncFinishedCommand,
  RecordManagedKeyInvalidatedCommand,
  RecordManagedKeyRetiredCommand,
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
  | LicenseClearedEvent
  | ManagedKeyRetiredEvent
  | ManagedKeyInvalidatedEvent,
  Record<string, Projection>,
  | { name: "recordSelfHostedCustomerLicensed"; payload: SelfHostedCustomerLicensedEventData }
  | { name: "recordConnectServiceSwitched"; payload: ConnectServiceSwitchedEventData }
  | { name: "recordLicenseSyncFinished"; payload: LicenseSyncFinishedEventData }
  | { name: "recordLicenseStored"; payload: LicenseStoredEventData }
  | { name: "recordLicenseCleared"; payload: LicenseClearedEventData }
  | { name: "recordManagedKeyRetired"; payload: ManagedKeyRetiredEventData }
  | { name: "recordManagedKeyInvalidated"; payload: ManagedKeyInvalidatedEventData }
>;

/** licensing_customer: facts about licensing's customers; organization and gateway apply them. */
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
      managedKeyRetiredEventSchema,
      managedKeyInvalidatedEventSchema,
    ])
    .withCommand("recordSelfHostedCustomerLicensed", RecordSelfHostedCustomerLicensedCommand)
    .withCommand("recordConnectServiceSwitched", RecordConnectServiceSwitchedCommand)
    .withCommand("recordLicenseSyncFinished", RecordLicenseSyncFinishedCommand)
    .withCommand("recordLicenseStored", RecordLicenseStoredCommand)
    .withCommand("recordLicenseCleared", RecordLicenseClearedCommand)
    .withCommand("recordManagedKeyRetired", RecordManagedKeyRetiredCommand)
    .withCommand("recordManagedKeyInvalidated", RecordManagedKeyInvalidatedCommand)
    .build();
}

export const licensingCustomerEventing = defineEventingModule({
  pipeline: LICENSING_CUSTOMER_PIPELINE_NAME,
  build: ({ app }: EventingSetup<never, LicensingModule>) => app.customerPipeline(),
  connect: ({ app, commands }) => app.connectCustomerCommands(commands),
});
