import {
  CONNECT_SERVICE_SWITCHED_EVENT_TYPE,
  connectServiceSwitchedEventDataSchema,
  type ConnectServiceSwitchedEventData,
  LICENSE_SYNC_FINISHED_EVENT_TYPE,
  licenseSyncFinishedEventDataSchema,
  type LicenseSyncFinishedEventData,
  LICENSING_CUSTOMER_AGGREGATE_TYPE,
  LICENSING_CUSTOMER_EVENT_VERSION,
  SELF_HOSTED_CUSTOMER_LICENSED_EVENT_TYPE,
  selfHostedCustomerLicensedEventDataSchema,
  type SelfHostedCustomerLicensedEventData,
} from "@langwatch/enterprise-licensing-contract";
import type { Command, CommandHandler } from "@langwatch/eventing";
import { createTenantId, defineCommandSchema, EventSchema, EventUtils } from "@langwatch/eventing";
import { z } from "zod";

export const RECORD_SELF_HOSTED_CUSTOMER_LICENSED_COMMAND_TYPE =
  "lw.licensing.record_self_hosted_customer_licensed" as const;

export const selfHostedCustomerLicensedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(SELF_HOSTED_CUSTOMER_LICENSED_EVENT_TYPE),
  version: z.literal(LICENSING_CUSTOMER_EVENT_VERSION),
  data: selfHostedCustomerLicensedEventDataSchema,
});
export type SelfHostedCustomerLicensedEvent = z.infer<typeof selfHostedCustomerLicensedEventSchema>;

/** Records that an operator licensed a new self-hosted customer under a minted organisation id. */
export class RecordSelfHostedCustomerLicensedCommand implements CommandHandler<
  Command<SelfHostedCustomerLicensedEventData>,
  SelfHostedCustomerLicensedEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_SELF_HOSTED_CUSTOMER_LICENSED_COMMAND_TYPE,
    selfHostedCustomerLicensedEventDataSchema,
    "Record that licensing licensed a new self-hosted customer",
  );

  handle(command: Command<SelfHostedCustomerLicensedEventData>): SelfHostedCustomerLicensedEvent[] {
    const data = command.data;
    return [
      EventUtils.createEvent<SelfHostedCustomerLicensedEvent>({
        aggregateType: LICENSING_CUSTOMER_AGGREGATE_TYPE,
        aggregateId: data.organizationId,
        tenantId: createTenantId(command.tenantId),
        type: SELF_HOSTED_CUSTOMER_LICENSED_EVENT_TYPE,
        version: LICENSING_CUSTOMER_EVENT_VERSION,
        data,
        metadata: {},
        occurredAt: data.occurredAt,
        idempotencyKey: `${data.organizationId}:self_hosted_customer_licensed`,
      }),
    ];
  }

  static getAggregateId(payload: SelfHostedCustomerLicensedEventData): string {
    return payload.organizationId;
  }
}

export const RECORD_CONNECT_SERVICE_SWITCHED_COMMAND_TYPE =
  "lw.licensing.record_connect_service_switched" as const;
export const RECORD_LICENSE_SYNC_FINISHED_COMMAND_TYPE =
  "lw.licensing.record_license_sync_finished" as const;

export const connectServiceSwitchedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(CONNECT_SERVICE_SWITCHED_EVENT_TYPE),
  version: z.literal(LICENSING_CUSTOMER_EVENT_VERSION),
  data: connectServiceSwitchedEventDataSchema,
});
export type ConnectServiceSwitchedEvent = z.infer<typeof connectServiceSwitchedEventSchema>;

export const licenseSyncFinishedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(LICENSE_SYNC_FINISHED_EVENT_TYPE),
  version: z.literal(LICENSING_CUSTOMER_EVENT_VERSION),
  data: licenseSyncFinishedEventDataSchema,
});
export type LicenseSyncFinishedEvent = z.infer<typeof licenseSyncFinishedEventSchema>;

/** Records that an administrator switched one hosted service on or off for an organization. */
export class RecordConnectServiceSwitchedCommand implements CommandHandler<
  Command<ConnectServiceSwitchedEventData>,
  ConnectServiceSwitchedEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_CONNECT_SERVICE_SWITCHED_COMMAND_TYPE,
    connectServiceSwitchedEventDataSchema,
    "Record that an administrator switched a hosted Connect service",
  );

  handle(command: Command<ConnectServiceSwitchedEventData>): ConnectServiceSwitchedEvent[] {
    const data = command.data;
    return [
      EventUtils.createEvent<ConnectServiceSwitchedEvent>({
        aggregateType: LICENSING_CUSTOMER_AGGREGATE_TYPE,
        aggregateId: data.organizationId,
        tenantId: createTenantId(command.tenantId),
        type: CONNECT_SERVICE_SWITCHED_EVENT_TYPE,
        version: LICENSING_CUSTOMER_EVENT_VERSION,
        data,
        metadata: {},
        occurredAt: data.occurredAt,
        idempotencyKey: `${data.organizationId}:connect_service_switched:${data.service}:${data.enabled}:${data.occurredAt}`,
      }),
    ];
  }

  static getAggregateId(payload: ConnectServiceSwitchedEventData): string {
    return payload.organizationId;
  }
}

/** Records how one license sync for an organization ended. */
export class RecordLicenseSyncFinishedCommand implements CommandHandler<
  Command<LicenseSyncFinishedEventData>,
  LicenseSyncFinishedEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_LICENSE_SYNC_FINISHED_COMMAND_TYPE,
    licenseSyncFinishedEventDataSchema,
    "Record how a license sync ended",
  );

  handle(command: Command<LicenseSyncFinishedEventData>): LicenseSyncFinishedEvent[] {
    const data = command.data;
    return [
      EventUtils.createEvent<LicenseSyncFinishedEvent>({
        aggregateType: LICENSING_CUSTOMER_AGGREGATE_TYPE,
        aggregateId: data.organizationId,
        tenantId: createTenantId(command.tenantId),
        type: LICENSE_SYNC_FINISHED_EVENT_TYPE,
        version: LICENSING_CUSTOMER_EVENT_VERSION,
        data,
        metadata: {},
        occurredAt: data.occurredAt,
        idempotencyKey: `${data.organizationId}:license_sync_finished:${data.occurredAt}`,
      }),
    ];
  }

  static getAggregateId(payload: LicenseSyncFinishedEventData): string {
    return payload.organizationId;
  }
}
