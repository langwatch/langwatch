import type { Command, CommandHandler } from "@langwatch/eventing";
import { createTenantId, defineCommandSchema, EventUtils } from "@langwatch/eventing";
import {
  USAGE_LIMIT_CLEARED_EVENT_TYPE,
  USAGE_LIMIT_REACHED_EVENT_TYPE,
  USAGE_MONTH_COUNTED_EVENT_TYPE,
} from "@langwatch/usage-contract";

import type { UsageCountingService } from "../services/usage-counting.service.ts";
import {
  type CountMonthCommandData,
  countMonthCommandDataSchema,
  type RecordLimitDecisionCommandData,
  recordLimitDecisionCommandDataSchema,
  USAGE_AGGREGATE_TYPE,
  USAGE_EVENT_VERSION,
  type UsageEvent,
} from "./usage.events.ts";

/** Counts the organization's month and records it; the limit is decided from the event. */
export class CountMonthCommand implements CommandHandler<
  Command<CountMonthCommandData>,
  UsageEvent
> {
  static readonly schema = defineCommandSchema(
    "lw.usage.count_month",
    countMonthCommandDataSchema,
    "Count an organization's month",
  );

  private constructor(private readonly counting: UsageCountingService) {}

  static create({ counting }: { counting: UsageCountingService }): CountMonthCommand {
    return new CountMonthCommand(counting);
  }

  async handle(command: Command<CountMonthCommandData>): Promise<UsageEvent[]> {
    const { organizationId, month, occurredAt } = command.data;
    const data = await this.counting.countMonth({ organizationId, month, occurredAt });
    return [
      EventUtils.createEvent<UsageEvent>({
        aggregateType: USAGE_AGGREGATE_TYPE,
        aggregateId: organizationId,
        tenantId: createTenantId(command.tenantId),
        type: USAGE_MONTH_COUNTED_EVENT_TYPE,
        version: USAGE_EVENT_VERSION,
        data,
        metadata: {},
        occurredAt,
      }),
    ];
  }

  static getAggregateId(payload: CountMonthCommandData): string {
    return payload.organizationId;
  }

  static getSpanAttributes(payload: CountMonthCommandData): Record<string, string> {
    return {
      "payload.organization.id": payload.organizationId,
      "payload.usage.month": payload.month,
    };
  }
}

/** Records a refused-organizations decision; keyed so a redelivery records it once. */
export class RecordLimitDecisionCommand implements CommandHandler<
  Command<RecordLimitDecisionCommandData>,
  UsageEvent
> {
  static readonly schema = defineCommandSchema(
    "lw.usage.record_limit_decision",
    recordLimitDecisionCommandDataSchema,
    "Record a usage limit decision",
  );

  async handle(command: Command<RecordLimitDecisionCommandData>): Promise<UsageEvent[]> {
    const { decision, tenantId: _tenantId, ...data } = command.data;
    return [
      EventUtils.createEvent<UsageEvent>({
        aggregateType: USAGE_AGGREGATE_TYPE,
        aggregateId: data.organizationId,
        tenantId: createTenantId(command.tenantId),
        type:
          decision === "reached" ? USAGE_LIMIT_REACHED_EVENT_TYPE : USAGE_LIMIT_CLEARED_EVENT_TYPE,
        version: USAGE_EVENT_VERSION,
        data,
        metadata: {},
        occurredAt: data.occurredAt,
        idempotencyKey: `${data.organizationId}:${data.month}:${decision}:${data.occurredAt}`,
      }),
    ];
  }

  static getAggregateId(payload: RecordLimitDecisionCommandData): string {
    return payload.organizationId;
  }

  static getSpanAttributes(payload: RecordLimitDecisionCommandData): Record<string, string> {
    return {
      "payload.organization.id": payload.organizationId,
      "payload.usage.decision": payload.decision,
    };
  }
}
