// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  BILLING_AUDIT_RECORDED_EVENT_TYPE,
  BILLING_LIFECYCLE_AGGREGATE_TYPE,
  BILLING_LIFECYCLE_EVENT_VERSION,
  CHECKOUT_COMPLETED_EVENT_TYPE,
  PLAN_LIMIT_ALERT_SENT_EVENT_TYPE,
  CHECKOUT_CURRENCY_SELECTED_EVENT_TYPE,
  PRICING_MODEL_CHANGED_EVENT_TYPE,
  SEAT_CHECKOUT_PAID_EVENT_TYPE,
  SEAT_CHECKOUTS_ABANDONED_EVENT_TYPE,
  SUBSCRIPTION_CHANGED_EVENT_TYPE,
  SUBSCRIPTION_STARTED_EVENT_TYPE,
  USAGE_BILLING_CHANGED_EVENT_TYPE,
} from "@langwatch/enterprise-billing-contract";
import type { Command, CommandHandler } from "@langwatch/eventing";
import { createTenantId, defineCommandSchema, EventUtils } from "@langwatch/eventing";

import {
  RECORD_BILLING_AUDIT_COMMAND_TYPE,
  RECORD_CHECKOUT_COMPLETED_COMMAND_TYPE,
  RECORD_SUBSCRIPTION_CHANGED_COMMAND_TYPE,
  RECORD_SUBSCRIPTION_STARTED_COMMAND_TYPE,
  RECORD_USAGE_BILLING_CHANGED_COMMAND_TYPE,
  type BillingAuditRecordedEvent,
  type CheckoutCompletedEvent,
  type RecordBillingAuditCommandData,
  type RecordCheckoutCompletedCommandData,
  type RecordSubscriptionChangedCommandData,
  type RecordSubscriptionStartedCommandData,
  type RecordUsageBillingChangedCommandData,
  type SubscriptionChangedEvent,
  type SubscriptionStartedEvent,
  type UsageBillingChangedEvent,
  recordBillingAuditCommandDataSchema,
  recordCheckoutCompletedCommandDataSchema,
  recordSubscriptionChangedCommandDataSchema,
  recordSubscriptionStartedCommandDataSchema,
  recordUsageBillingChangedCommandDataSchema,
  RECORD_PLAN_LIMIT_ALERT_SENT_COMMAND_TYPE,
  type PlanLimitAlertSentEvent,
  type RecordPlanLimitAlertSentCommandData,
  recordPlanLimitAlertSentCommandDataSchema,
  RECORD_CHECKOUT_CURRENCY_SELECTED_COMMAND_TYPE,
  type CheckoutCurrencySelectedEvent,
  type RecordCheckoutCurrencySelectedCommandData,
  recordCheckoutCurrencySelectedCommandDataSchema,
  RECORD_PRICING_MODEL_CHANGED_COMMAND_TYPE,
  type PricingModelChangedEvent,
  type RecordPricingModelChangedCommandData,
  recordPricingModelChangedCommandDataSchema,
  RECORD_SEAT_CHECKOUT_PAID_COMMAND_TYPE,
  type SeatCheckoutPaidEvent,
  type RecordSeatCheckoutPaidCommandData,
  recordSeatCheckoutPaidCommandDataSchema,
  RECORD_SEAT_CHECKOUTS_ABANDONED_COMMAND_TYPE,
  type SeatCheckoutsAbandonedEvent,
  type RecordSeatCheckoutsAbandonedCommandData,
  recordSeatCheckoutsAbandonedCommandDataSchema,
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

/** Records a platform operator's billing command for audit-log, keyed by its own audit id. */
export class RecordBillingAuditCommand implements CommandHandler<
  Command<RecordBillingAuditCommandData>,
  BillingAuditRecordedEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_BILLING_AUDIT_COMMAND_TYPE,
    recordBillingAuditCommandDataSchema,
    "Record a platform operator's billing command for the audit log",
  );

  handle(command: Command<RecordBillingAuditCommandData>): BillingAuditRecordedEvent[] {
    const data = command.data;
    return [
      EventUtils.createEvent<BillingAuditRecordedEvent>({
        aggregateType: BILLING_LIFECYCLE_AGGREGATE_TYPE,
        aggregateId: data.tenantId,
        tenantId: createTenantId(command.tenantId),
        type: BILLING_AUDIT_RECORDED_EVENT_TYPE,
        version: BILLING_LIFECYCLE_EVENT_VERSION,
        data,
        metadata: {},
        occurredAt: data.occurredAt,
        idempotencyKey: data.idempotencyKey,
      }),
    ];
  }

  static getAggregateId(payload: RecordBillingAuditCommandData): string {
    return payload.tenantId;
  }
}

/** Records that the plan-limit alert went; keyed by the instant it went. */
export class RecordPlanLimitAlertSentCommand implements CommandHandler<
  Command<RecordPlanLimitAlertSentCommandData>,
  PlanLimitAlertSentEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_PLAN_LIMIT_ALERT_SENT_COMMAND_TYPE,
    recordPlanLimitAlertSentCommandDataSchema,
    "Record that billing sent an organization's plan-limit alert",
  );

  handle(command: Command<RecordPlanLimitAlertSentCommandData>): PlanLimitAlertSentEvent[] {
    const data = command.data;
    return [
      EventUtils.createEvent<PlanLimitAlertSentEvent>({
        aggregateType: BILLING_LIFECYCLE_AGGREGATE_TYPE,
        aggregateId: data.organizationId,
        tenantId: createTenantId(command.tenantId),
        type: PLAN_LIMIT_ALERT_SENT_EVENT_TYPE,
        version: BILLING_LIFECYCLE_EVENT_VERSION,
        data,
        metadata: {},
        occurredAt: data.occurredAt,
        idempotencyKey: `${data.organizationId}:plan_limit_alert_sent:${data.sentAt}`,
      }),
    ];
  }

  static getAggregateId(payload: RecordPlanLimitAlertSentCommandData): string {
    return payload.organizationId;
  }
}

/** Records the currency a completed checkout chose for the organization. */
export class RecordCheckoutCurrencySelectedCommand implements CommandHandler<
  Command<RecordCheckoutCurrencySelectedCommandData>,
  CheckoutCurrencySelectedEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_CHECKOUT_CURRENCY_SELECTED_COMMAND_TYPE,
    recordCheckoutCurrencySelectedCommandDataSchema,
    "Record the currency a completed checkout chose",
  );

  handle(
    command: Command<RecordCheckoutCurrencySelectedCommandData>,
  ): CheckoutCurrencySelectedEvent[] {
    const data = command.data;
    return [
      EventUtils.createEvent<CheckoutCurrencySelectedEvent>({
        aggregateType: BILLING_LIFECYCLE_AGGREGATE_TYPE,
        aggregateId: data.organizationId,
        tenantId: createTenantId(command.tenantId),
        type: CHECKOUT_CURRENCY_SELECTED_EVENT_TYPE,
        version: BILLING_LIFECYCLE_EVENT_VERSION,
        data,
        metadata: {},
        occurredAt: data.occurredAt,
        idempotencyKey: `${data.organizationId}:checkout_currency_selected:${data.currency}:${data.occurredAt}`,
      }),
    ];
  }

  static getAggregateId(payload: RecordCheckoutCurrencySelectedCommandData): string {
    return payload.organizationId;
  }
}

/** Records the pricing model the organization is now billed on. */
export class RecordPricingModelChangedCommand implements CommandHandler<
  Command<RecordPricingModelChangedCommandData>,
  PricingModelChangedEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_PRICING_MODEL_CHANGED_COMMAND_TYPE,
    recordPricingModelChangedCommandDataSchema,
    "Record the pricing model an organization is billed on",
  );

  handle(command: Command<RecordPricingModelChangedCommandData>): PricingModelChangedEvent[] {
    const data = command.data;
    return [
      EventUtils.createEvent<PricingModelChangedEvent>({
        aggregateType: BILLING_LIFECYCLE_AGGREGATE_TYPE,
        aggregateId: data.organizationId,
        tenantId: createTenantId(command.tenantId),
        type: PRICING_MODEL_CHANGED_EVENT_TYPE,
        version: BILLING_LIFECYCLE_EVENT_VERSION,
        data,
        metadata: {},
        occurredAt: data.occurredAt,
        idempotencyKey: `${data.organizationId}:pricing_model_changed:${data.pricingModel}:${data.occurredAt}`,
      }),
    ];
  }

  static getAggregateId(payload: RecordPricingModelChangedCommandData): string {
    return payload.organizationId;
  }
}

/** Records that a seat checkout was paid; one event per subscription row, however often it is sent. */
export class RecordSeatCheckoutPaidCommand implements CommandHandler<
  Command<RecordSeatCheckoutPaidCommandData>,
  SeatCheckoutPaidEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_SEAT_CHECKOUT_PAID_COMMAND_TYPE,
    recordSeatCheckoutPaidCommandDataSchema,
    "Record that a seat checkout was paid",
  );

  handle(command: Command<RecordSeatCheckoutPaidCommandData>): SeatCheckoutPaidEvent[] {
    const data = command.data;
    return [
      EventUtils.createEvent<SeatCheckoutPaidEvent>({
        aggregateType: BILLING_LIFECYCLE_AGGREGATE_TYPE,
        aggregateId: data.organizationId,
        tenantId: createTenantId(command.tenantId),
        type: SEAT_CHECKOUT_PAID_EVENT_TYPE,
        version: BILLING_LIFECYCLE_EVENT_VERSION,
        data,
        metadata: {},
        occurredAt: data.occurredAt,
        idempotencyKey: `${data.organizationId}:seat_checkout_paid:${data.subscriptionId}`,
      }),
    ];
  }

  static getAggregateId(payload: RecordSeatCheckoutPaidCommandData): string {
    return payload.organizationId;
  }
}

/** Records that seat checkouts were abandoned; keyed by the subscription rows they left. */
export class RecordSeatCheckoutsAbandonedCommand implements CommandHandler<
  Command<RecordSeatCheckoutsAbandonedCommandData>,
  SeatCheckoutsAbandonedEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_SEAT_CHECKOUTS_ABANDONED_COMMAND_TYPE,
    recordSeatCheckoutsAbandonedCommandDataSchema,
    "Record that seat checkouts were abandoned",
  );

  handle(command: Command<RecordSeatCheckoutsAbandonedCommandData>): SeatCheckoutsAbandonedEvent[] {
    const data = command.data;
    return [
      EventUtils.createEvent<SeatCheckoutsAbandonedEvent>({
        aggregateType: BILLING_LIFECYCLE_AGGREGATE_TYPE,
        aggregateId: data.organizationId,
        tenantId: createTenantId(command.tenantId),
        type: SEAT_CHECKOUTS_ABANDONED_EVENT_TYPE,
        version: BILLING_LIFECYCLE_EVENT_VERSION,
        data,
        metadata: {},
        occurredAt: data.occurredAt,
        idempotencyKey: `${data.organizationId}:seat_checkouts_abandoned:${data.subscriptionIds.join(",")}`,
      }),
    ];
  }

  static getAggregateId(payload: RecordSeatCheckoutsAbandonedCommandData): string {
    return payload.organizationId;
  }
}
