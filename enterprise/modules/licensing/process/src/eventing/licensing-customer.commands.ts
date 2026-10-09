import {
  CONNECT_SERVICE_SWITCHED_EVENT_TYPE,
  connectServiceSwitchedEventDataSchema,
  type ConnectServiceSwitchedEventData,
  LICENSE_CLEARED_EVENT_TYPE,
  licenseClearedEventDataSchema,
  type LicenseClearedEventData,
  LICENSE_STORED_EVENT_TYPE,
  licenseStoredEventDataSchema,
  type LicenseStoredEventData,
  LICENSE_SYNC_FINISHED_EVENT_TYPE,
  licenseSyncFinishedEventDataSchema,
  type LicenseSyncFinishedEventData,
  LICENSING_CUSTOMER_AGGREGATE_TYPE,
  LICENSING_CUSTOMER_EVENT_VERSION,
  MANAGED_KEY_INVALIDATED_EVENT_TYPE,
  MANAGED_KEY_RETIRED_EVENT_TYPE,
  managedKeyInvalidatedEventDataSchema,
  type ManagedKeyInvalidatedEventData,
  managedKeyRetiredEventDataSchema,
  type ManagedKeyRetiredEventData,
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

export const RECORD_LICENSE_STORED_COMMAND_TYPE = "lw.licensing.record_license_stored" as const;
export const RECORD_LICENSE_CLEARED_COMMAND_TYPE = "lw.licensing.record_license_cleared" as const;

export const licenseStoredEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(LICENSE_STORED_EVENT_TYPE),
  version: z.literal(LICENSING_CUSTOMER_EVENT_VERSION),
  data: licenseStoredEventDataSchema,
});
export type LicenseStoredEvent = z.infer<typeof licenseStoredEventSchema>;

export const licenseClearedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(LICENSE_CLEARED_EVENT_TYPE),
  version: z.literal(LICENSING_CUSTOMER_EVENT_VERSION),
  data: licenseClearedEventDataSchema,
});
export type LicenseClearedEvent = z.infer<typeof licenseClearedEventSchema>;

/** Records that licensing stored an organization's licence and its dates. */
export class RecordLicenseStoredCommand implements CommandHandler<
  Command<LicenseStoredEventData>,
  LicenseStoredEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_LICENSE_STORED_COMMAND_TYPE,
    licenseStoredEventDataSchema,
    "Record that licensing stored an organization's licence",
  );

  handle(command: Command<LicenseStoredEventData>): LicenseStoredEvent[] {
    const data = command.data;
    return [
      EventUtils.createEvent<LicenseStoredEvent>({
        aggregateType: LICENSING_CUSTOMER_AGGREGATE_TYPE,
        aggregateId: data.organizationId,
        tenantId: createTenantId(command.tenantId),
        type: LICENSE_STORED_EVENT_TYPE,
        version: LICENSING_CUSTOMER_EVENT_VERSION,
        data,
        metadata: {},
        occurredAt: data.occurredAt,
      }),
    ];
  }

  static getAggregateId(payload: LicenseStoredEventData): string {
    return payload.organizationId;
  }
}

/** Records that licensing cleared an organization's licence. */
export class RecordLicenseClearedCommand implements CommandHandler<
  Command<LicenseClearedEventData>,
  LicenseClearedEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_LICENSE_CLEARED_COMMAND_TYPE,
    licenseClearedEventDataSchema,
    "Record that licensing cleared an organization's licence",
  );

  handle(command: Command<LicenseClearedEventData>): LicenseClearedEvent[] {
    const data = command.data;
    return [
      EventUtils.createEvent<LicenseClearedEvent>({
        aggregateType: LICENSING_CUSTOMER_AGGREGATE_TYPE,
        aggregateId: data.organizationId,
        tenantId: createTenantId(command.tenantId),
        type: LICENSE_CLEARED_EVENT_TYPE,
        version: LICENSING_CUSTOMER_EVENT_VERSION,
        data,
        metadata: {},
        occurredAt: data.occurredAt,
      }),
    ];
  }

  static getAggregateId(payload: LicenseClearedEventData): string {
    return payload.organizationId;
  }
}

export const RECORD_MANAGED_KEY_RETIRED_COMMAND_TYPE =
  "lw.licensing.record_managed_key_retired" as const;
export const RECORD_MANAGED_KEY_INVALIDATED_COMMAND_TYPE =
  "lw.licensing.record_managed_key_invalidated" as const;

export const managedKeyRetiredEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(MANAGED_KEY_RETIRED_EVENT_TYPE),
  version: z.literal(LICENSING_CUSTOMER_EVENT_VERSION),
  data: managedKeyRetiredEventDataSchema,
});
export type ManagedKeyRetiredEvent = z.infer<typeof managedKeyRetiredEventSchema>;

export const managedKeyInvalidatedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(MANAGED_KEY_INVALIDATED_EVENT_TYPE),
  version: z.literal(LICENSING_CUSTOMER_EVENT_VERSION),
  data: managedKeyInvalidatedEventDataSchema,
});
export type ManagedKeyInvalidatedEvent = z.infer<typeof managedKeyInvalidatedEventSchema>;

/** Records that licensing ended a licence's managed key; gateway revokes it from the fact. */
export class RecordManagedKeyRetiredCommand implements CommandHandler<
  Command<ManagedKeyRetiredEventData>,
  ManagedKeyRetiredEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_MANAGED_KEY_RETIRED_COMMAND_TYPE,
    managedKeyRetiredEventDataSchema,
    "Record that licensing ended a licence's managed key",
  );

  handle(command: Command<ManagedKeyRetiredEventData>): ManagedKeyRetiredEvent[] {
    const data = command.data;
    return [
      EventUtils.createEvent<ManagedKeyRetiredEvent>({
        aggregateType: LICENSING_CUSTOMER_AGGREGATE_TYPE,
        aggregateId: data.organizationId,
        tenantId: createTenantId(command.tenantId),
        type: MANAGED_KEY_RETIRED_EVENT_TYPE,
        version: LICENSING_CUSTOMER_EVENT_VERSION,
        data,
        metadata: {},
        occurredAt: data.occurredAt,
        idempotencyKey: `${data.organizationId}:managed_key_retired:${data.virtualKeyId}:${data.occurredAt}`,
      }),
    ];
  }

  static getAggregateId(payload: ManagedKeyRetiredEventData): string {
    return payload.organizationId;
  }
}

/** Records that a managed key's licence resolves differently; gateway invalidates from the fact. */
export class RecordManagedKeyInvalidatedCommand implements CommandHandler<
  Command<ManagedKeyInvalidatedEventData>,
  ManagedKeyInvalidatedEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_MANAGED_KEY_INVALIDATED_COMMAND_TYPE,
    managedKeyInvalidatedEventDataSchema,
    "Record that a managed key's licence must be resolved again",
  );

  handle(command: Command<ManagedKeyInvalidatedEventData>): ManagedKeyInvalidatedEvent[] {
    const data = command.data;
    return [
      EventUtils.createEvent<ManagedKeyInvalidatedEvent>({
        aggregateType: LICENSING_CUSTOMER_AGGREGATE_TYPE,
        aggregateId: data.organizationId,
        tenantId: createTenantId(command.tenantId),
        type: MANAGED_KEY_INVALIDATED_EVENT_TYPE,
        version: LICENSING_CUSTOMER_EVENT_VERSION,
        data,
        metadata: {},
        occurredAt: data.occurredAt,
        idempotencyKey: `${data.organizationId}:managed_key_invalidated:${data.virtualKeyId}:${data.occurredAt}`,
      }),
    ];
  }

  static getAggregateId(payload: ManagedKeyInvalidatedEventData): string {
    return payload.organizationId;
  }
}
