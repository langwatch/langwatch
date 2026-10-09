import type {
  ConnectCredentialIssuedEventData,
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
import {
  GATEWAY_MANAGED_KEY_PROVISIONED_EVENT_TYPE,
  gatewayManagedKeyProvisionedEventDataSchema,
  type GatewayManagedKeyProvisionedEventData,
} from "@langwatch/gateway-contract";

import type { LicensingModule } from "../app/licensing.app.ts";
import {
  type ConnectCredentialIssuedEvent,
  connectCredentialIssuedEventSchema,
  RecordConnectCredentialIssuedCommand,
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

const LICENSING_CUSTOMER_PIPELINE_NAME = "licensing_customer";

export type LicensingCustomerPipeline = StaticPipelineDefinition<
  | SelfHostedCustomerLicensedEvent
  | ConnectServiceSwitchedEvent
  | LicenseSyncFinishedEvent
  | LicenseStoredEvent
  | LicenseClearedEvent
  | ManagedKeyRetiredEvent
  | ManagedKeyInvalidatedEvent
  | ConnectCredentialIssuedEvent,
  Record<string, Projection>,
  | { name: "recordSelfHostedCustomerLicensed"; payload: SelfHostedCustomerLicensedEventData }
  | { name: "recordConnectServiceSwitched"; payload: ConnectServiceSwitchedEventData }
  | { name: "recordLicenseSyncFinished"; payload: LicenseSyncFinishedEventData }
  | { name: "recordLicenseStored"; payload: LicenseStoredEventData }
  | { name: "recordLicenseCleared"; payload: LicenseClearedEventData }
  | { name: "recordManagedKeyRetired"; payload: ManagedKeyRetiredEventData }
  | { name: "recordManagedKeyInvalidated"; payload: ManagedKeyInvalidatedEventData }
  | { name: "recordConnectCredentialIssued"; payload: ConnectCredentialIssuedEventData }
>;

/** licensing_customer: facts about licensing's customers; organization and gateway apply them. */
export function buildLicensingCustomerPipeline({
  attachManagedKey,
}: {
  attachManagedKey: (provisioned: GatewayManagedKeyProvisionedEventData) => Promise<void>;
}): LicensingCustomerPipeline {
  return (
    definePipeline({
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
        connectCredentialIssuedEventSchema,
      ])
      .withCommand("recordSelfHostedCustomerLicensed", RecordSelfHostedCustomerLicensedCommand)
      .withCommand("recordConnectServiceSwitched", RecordConnectServiceSwitchedCommand)
      .withCommand("recordLicenseSyncFinished", RecordLicenseSyncFinishedCommand)
      .withCommand("recordLicenseStored", RecordLicenseStoredCommand)
      .withCommand("recordLicenseCleared", RecordLicenseClearedCommand)
      .withCommand("recordManagedKeyRetired", RecordManagedKeyRetiredCommand)
      .withCommand("recordManagedKeyInvalidated", RecordManagedKeyInvalidatedCommand)
      .withCommand("recordConnectCredentialIssued", RecordConnectCredentialIssuedCommand)
      // C3B-ORDER: attaches under the row's guard; a redelivery finds the key already attached.
      .withPeerSubscriber("licensingManagedKeyProvisioned", {
        eventType: GATEWAY_MANAGED_KEY_PROVISIONED_EVENT_TYPE,
        data: gatewayManagedKeyProvisionedEventDataSchema,
        handle: (provisioned) => attachManagedKey(provisioned),
      })
      .build()
  );
}

export const licensingCustomerEventing = defineEventingModule({
  pipeline: LICENSING_CUSTOMER_PIPELINE_NAME,
  build: ({ app }: EventingSetup<never, LicensingModule>) => app.customerPipeline(),
  connect: ({ app, commands }) => app.connectCustomerCommands(commands),
});
