// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  CONNECTED_BILLING_AGGREGATE_TYPE,
  CONNECTED_BILLING_EVENT_VERSION,
  CONNECTED_CUSTOMER_ONBOARDED_EVENT_TYPE,
  CONNECTED_TERM_RENEWED_EVENT_TYPE,
  connectedCustomerOnboardedEventDataSchema,
  type ConnectedCustomerOnboardedEventData,
  connectedTermRenewedEventDataSchema,
  type ConnectedTermRenewedEventData,
} from "@langwatch/enterprise-billing-contract";
import type { Command, CommandHandler } from "@langwatch/eventing";
import { createTenantId, defineCommandSchema, EventSchema, EventUtils } from "@langwatch/eventing";
import { z } from "zod";

const RECORD_CONNECTED_CUSTOMER_ONBOARDED_COMMAND_TYPE =
  "lw.billing.record_connected_customer_onboarded" as const;
const RECORD_CONNECTED_TERM_RENEWED_COMMAND_TYPE =
  "lw.billing.record_connected_term_renewed" as const;

export const connectedCustomerOnboardedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(CONNECTED_CUSTOMER_ONBOARDED_EVENT_TYPE),
  version: z.literal(CONNECTED_BILLING_EVENT_VERSION),
  data: connectedCustomerOnboardedEventDataSchema,
});
type ConnectedCustomerOnboardedEvent = z.infer<typeof connectedCustomerOnboardedEventSchema>;

export const connectedTermRenewedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(CONNECTED_TERM_RENEWED_EVENT_TYPE),
  version: z.literal(CONNECTED_BILLING_EVENT_VERSION),
  data: connectedTermRenewedEventDataSchema,
});
type ConnectedTermRenewedEvent = z.infer<typeof connectedTermRenewedEventSchema>;

export type ConnectedBillingEvent = ConnectedCustomerOnboardedEvent | ConnectedTermRenewedEvent;

/** Records that a connected customer was onboarded; connect syncs its contract budget from it. */
export class RecordConnectedCustomerOnboardedCommand implements CommandHandler<
  Command<ConnectedCustomerOnboardedEventData>,
  ConnectedCustomerOnboardedEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_CONNECTED_CUSTOMER_ONBOARDED_COMMAND_TYPE,
    connectedCustomerOnboardedEventDataSchema,
    "Record that a connected customer was onboarded",
  );

  handle(command: Command<ConnectedCustomerOnboardedEventData>): ConnectedCustomerOnboardedEvent[] {
    const data = command.data;
    return [
      EventUtils.createEvent<ConnectedCustomerOnboardedEvent>({
        aggregateType: CONNECTED_BILLING_AGGREGATE_TYPE,
        aggregateId: data.organizationId,
        tenantId: createTenantId(command.tenantId),
        type: CONNECTED_CUSTOMER_ONBOARDED_EVENT_TYPE,
        version: CONNECTED_BILLING_EVENT_VERSION,
        data,
        metadata: {},
        occurredAt: data.occurredAt,
        idempotencyKey: `${data.organizationId}:connected_customer_onboarded:${data.operatorId}:${data.occurredAt}`,
      }),
    ];
  }

  static getAggregateId(payload: ConnectedCustomerOnboardedEventData): string {
    return payload.organizationId;
  }
}

/** Records that a connected customer renewed; connect resets, then syncs, its contract budget. */
export class RecordConnectedTermRenewedCommand implements CommandHandler<
  Command<ConnectedTermRenewedEventData>,
  ConnectedTermRenewedEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_CONNECTED_TERM_RENEWED_COMMAND_TYPE,
    connectedTermRenewedEventDataSchema,
    "Record that a connected customer renewed for a new term",
  );

  handle(command: Command<ConnectedTermRenewedEventData>): ConnectedTermRenewedEvent[] {
    const data = command.data;
    return [
      EventUtils.createEvent<ConnectedTermRenewedEvent>({
        aggregateType: CONNECTED_BILLING_AGGREGATE_TYPE,
        aggregateId: data.organizationId,
        tenantId: createTenantId(command.tenantId),
        type: CONNECTED_TERM_RENEWED_EVENT_TYPE,
        version: CONNECTED_BILLING_EVENT_VERSION,
        data,
        metadata: {},
        occurredAt: data.occurredAt,
        idempotencyKey: `${data.organizationId}:connected_term_renewed:${data.operatorId}:${data.occurredAt}`,
      }),
    ];
  }

  static getAggregateId(payload: ConnectedTermRenewedEventData): string {
    return payload.organizationId;
  }
}
