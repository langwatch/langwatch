import type { Command, CommandHandler } from "@langwatch/eventing";
import { createTenantId, defineCommandSchema, EventUtils } from "@langwatch/eventing";
import {
  GUIDED_ONBOARDING_AGGREGATE_TYPE,
  GUIDED_ONBOARDING_RECORDED_EVENT_TYPE,
  GUIDED_ONBOARDING_RECORDED_EVENT_VERSION,
} from "@langwatch/onboarding-contract";

import {
  RECORD_GUIDED_ONBOARDING_COMMAND_TYPE,
  type GuidedOnboardingRecordedEvent,
  type RecordGuidedOnboardingCommandData,
  recordGuidedOnboardingCommandDataSchema,
} from "./guided-onboarding-lifecycle.events.ts";

/** Records one signalling guided write; the same write sent twice is one event. */
export class RecordGuidedOnboardingCommand implements CommandHandler<
  Command<RecordGuidedOnboardingCommandData>,
  GuidedOnboardingRecordedEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_GUIDED_ONBOARDING_COMMAND_TYPE,
    recordGuidedOnboardingCommandDataSchema,
    "Record a guided onboarding state write",
  );

  handle(command: Command<RecordGuidedOnboardingCommandData>): GuidedOnboardingRecordedEvent[] {
    const data = command.data;
    return [
      EventUtils.createEvent<GuidedOnboardingRecordedEvent>({
        aggregateType: GUIDED_ONBOARDING_AGGREGATE_TYPE,
        aggregateId: data.organizationId,
        tenantId: createTenantId(command.tenantId),
        type: GUIDED_ONBOARDING_RECORDED_EVENT_TYPE,
        version: GUIDED_ONBOARDING_RECORDED_EVENT_VERSION,
        data,
        metadata: {},
        occurredAt: data.occurredAt,
        idempotencyKey: `${data.tenantId}:${data.organizationId}:${data.event}:${data.occurredAt}`,
      }),
    ];
  }

  static getAggregateId(payload: RecordGuidedOnboardingCommandData): string {
    return payload.organizationId;
  }
}
