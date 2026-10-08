// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  BILLING_LIFECYCLE_AGGREGATE_TYPE,
  BILLING_LIFECYCLE_EVENT_VERSION,
  CHECKOUT_COMPLETED_EVENT_TYPE,
  SUBSCRIPTION_CHANGED_EVENT_TYPE,
  SUBSCRIPTION_STARTED_EVENT_TYPE,
  USAGE_BILLING_CHANGED_EVENT_TYPE,
} from "@langwatch/enterprise-billing-contract";
import type { Command, CommandHandler } from "@langwatch/eventing";
import { createTenantId, defineCommandSchema, EventUtils } from "@langwatch/eventing";

import {
  RECORD_CHECKOUT_COMPLETED_COMMAND_TYPE,
  RECORD_SUBSCRIPTION_CHANGED_COMMAND_TYPE,
  RECORD_SUBSCRIPTION_STARTED_COMMAND_TYPE,
  RECORD_USAGE_BILLING_CHANGED_COMMAND_TYPE,
  type CheckoutCompletedEvent,
  type RecordCheckoutCompletedCommandData,
  type RecordSubscriptionChangedCommandData,
  type RecordSubscriptionStartedCommandData,
  type RecordUsageBillingChangedCommandData,
  type SubscriptionChangedEvent,
  type SubscriptionStartedEvent,
  type UsageBillingChangedEvent,
  recordCheckoutCompletedCommandDataSchema,
  recordSubscriptionChangedCommandDataSchema,
  recordSubscriptionStartedCommandDataSchema,
  recordUsageBillingChangedCommandDataSchema,
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

/** Records that a subscription became active; one event per transition, keyed by its instant. */
export class RecordSubscriptionStartedCommand implements CommandHandler<
  Command<RecordSubscriptionStartedCommandData>,
  SubscriptionStartedEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_SUBSCRIPTION_STARTED_COMMAND_TYPE,
    recordSubscriptionStartedCommandDataSchema,
    "Record that an organization's subscription became active",
  );

  handle(command: Command<RecordSubscriptionStartedCommandData>): SubscriptionStartedEvent[] {
    const data = command.data;
    return [
      EventUtils.createEvent<SubscriptionStartedEvent>({
        aggregateType: BILLING_LIFECYCLE_AGGREGATE_TYPE,
        aggregateId: data.organizationId,
        tenantId: createTenantId(command.tenantId),
        type: SUBSCRIPTION_STARTED_EVENT_TYPE,
        version: BILLING_LIFECYCLE_EVENT_VERSION,
        data,
        metadata: {},
        occurredAt: data.occurredAt,
        idempotencyKey: `${data.organizationId}:${data.subscriptionId}:subscription_started:${data.occurredAt}`,
      }),
    ];
  }

  static getAggregateId(payload: RecordSubscriptionStartedCommandData): string {
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

/**
 * Records whether the meter bills an organization. A real fact is keyed by its answer and stamp; a
 * catch-up fact by its read instant (ADR-174 decision 17), so a re-run is a new fact the store keeps.
 */
export class RecordUsageBillingChangedCommand implements CommandHandler<
  Command<RecordUsageBillingChangedCommandData>,
  UsageBillingChangedEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_USAGE_BILLING_CHANGED_COMMAND_TYPE,
    recordUsageBillingChangedCommandDataSchema,
    "Record whether the meter bills an organization",
  );

  handle(command: Command<RecordUsageBillingChangedCommandData>): UsageBillingChangedEvent[] {
    const data = command.data;
    return [
      EventUtils.createEvent<UsageBillingChangedEvent>({
        aggregateType: BILLING_LIFECYCLE_AGGREGATE_TYPE,
        aggregateId: data.organizationId,
        tenantId: createTenantId(command.tenantId),
        type: USAGE_BILLING_CHANGED_EVENT_TYPE,
        version: BILLING_LIFECYCLE_EVENT_VERSION,
        data,
        metadata: {},
        occurredAt: data.occurredAt,
        idempotencyKey: usageBillingChangedKeyOf(data),
      }),
    ];
  }

  static getAggregateId(payload: RecordUsageBillingChangedCommandData): string {
    return payload.organizationId;
  }
}

export function usageBillingChangedKeyOf({
  organizationId,
  usageBilled,
  occurredAt,
  fromCatchUp,
}: RecordUsageBillingChangedCommandData): string {
  return fromCatchUp
    ? `${organizationId}:usage-billed:catch-up:${occurredAt}`
    : `${organizationId}:usage-billed:${usageBilled}:${occurredAt}`;
}
