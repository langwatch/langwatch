// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  BILLING_LIFECYCLE_AGGREGATE_TYPE,
  BILLING_LIFECYCLE_EVENT_VERSION,
  CHECKOUT_COMPLETED_EVENT_TYPE,
  SUBSCRIPTION_CHANGED_EVENT_TYPE,
} from "@langwatch/enterprise-billing-contract";
import type { Command, CommandHandler } from "@langwatch/eventing";
import { createTenantId, defineCommandSchema, EventUtils } from "@langwatch/eventing";

import {
  RECORD_CHECKOUT_COMPLETED_COMMAND_TYPE,
  RECORD_SUBSCRIPTION_CHANGED_COMMAND_TYPE,
  type CheckoutCompletedEvent,
  type RecordCheckoutCompletedCommandData,
  type RecordSubscriptionChangedCommandData,
  type SubscriptionChangedEvent,
  recordCheckoutCompletedCommandDataSchema,
  recordSubscriptionChangedCommandDataSchema,
} from "./billing-lifecycle.events.ts";

/** Records that an organization's subscription state changed. */
export class RecordSubscriptionChangedCommand implements CommandHandler<
  Command<RecordSubscriptionChangedCommandData>,
  SubscriptionChangedEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_SUBSCRIPTION_CHANGED_COMMAND_TYPE,
    recordSubscriptionChangedCommandDataSchema,
    "Record that an organization's subscription changed",
  );

  handle(command: Command<RecordSubscriptionChangedCommandData>): SubscriptionChangedEvent[] {
    const data = command.data;
    return [
      EventUtils.createEvent<SubscriptionChangedEvent>({
        aggregateType: BILLING_LIFECYCLE_AGGREGATE_TYPE,
        aggregateId: data.organizationId,
        tenantId: createTenantId(command.tenantId),
        type: SUBSCRIPTION_CHANGED_EVENT_TYPE,
        version: BILLING_LIFECYCLE_EVENT_VERSION,
        data,
        metadata: {},
        occurredAt: data.occurredAt,
        idempotencyKey: `${data.organizationId}:subscription:${data.hasSubscription}:${data.occurredAt}`,
      }),
    ];
  }

  static getAggregateId(payload: RecordSubscriptionChangedCommandData): string {
    return payload.organizationId;
  }
}

/** Records that a checkout completed; one event per subscription, however often it is sent. */
export class RecordCheckoutCompletedCommand implements CommandHandler<
  Command<RecordCheckoutCompletedCommandData>,
  CheckoutCompletedEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_CHECKOUT_COMPLETED_COMMAND_TYPE,
    recordCheckoutCompletedCommandDataSchema,
    "Record that a checkout completed",
  );

  handle(command: Command<RecordCheckoutCompletedCommandData>): CheckoutCompletedEvent[] {
    const data = command.data;
    return [
      EventUtils.createEvent<CheckoutCompletedEvent>({
        aggregateType: BILLING_LIFECYCLE_AGGREGATE_TYPE,
        aggregateId: data.organizationId,
        tenantId: createTenantId(command.tenantId),
        type: CHECKOUT_COMPLETED_EVENT_TYPE,
        version: BILLING_LIFECYCLE_EVENT_VERSION,
        data,
        metadata: {},
        occurredAt: data.occurredAt,
        idempotencyKey: `${data.organizationId}:${data.subscriptionId}:checkout_completed`,
      }),
    ];
  }

  static getAggregateId(payload: RecordCheckoutCompletedCommandData): string {
    return payload.organizationId;
  }
}
