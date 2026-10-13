import type { Command, CommandHandler } from "@langwatch/eventing";
import { createTenantId, defineCommandSchema, EventUtils } from "@langwatch/eventing";
import {
  GUIDED_ONBOARDING_TURN_FAILED_EVENT_TYPE,
  GUIDED_ONBOARDING_TURN_FAILED_EVENT_VERSION,
  LANGY_GUIDED_ONBOARDING_AGGREGATE_TYPE,
} from "@langwatch/langy-contract";

import {
  RECORD_GUIDED_ONBOARDING_TURN_FAILED_COMMAND_TYPE,
  type GuidedOnboardingTurnFailedEvent,
  type RecordGuidedOnboardingTurnFailedCommandData,
  recordGuidedOnboardingTurnFailedCommandDataSchema,
} from "./langy-guided-onboarding.events.ts";

/** Records one failed guided turn; the same source event sent twice is one fact. */
export class RecordGuidedOnboardingTurnFailedCommand implements CommandHandler<
  Command<RecordGuidedOnboardingTurnFailedCommandData>,
  GuidedOnboardingTurnFailedEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_GUIDED_ONBOARDING_TURN_FAILED_COMMAND_TYPE,
    recordGuidedOnboardingTurnFailedCommandDataSchema,
    "Record a failed turn of the guided onboarding conversation",
  );

  handle(
    command: Command<RecordGuidedOnboardingTurnFailedCommandData>,
  ): GuidedOnboardingTurnFailedEvent[] {
    const data = command.data;
    return [
      EventUtils.createEvent<GuidedOnboardingTurnFailedEvent>({
        aggregateType: LANGY_GUIDED_ONBOARDING_AGGREGATE_TYPE,
        aggregateId: data.conversationId,
        tenantId: createTenantId(command.tenantId),
        type: GUIDED_ONBOARDING_TURN_FAILED_EVENT_TYPE,
        version: GUIDED_ONBOARDING_TURN_FAILED_EVENT_VERSION,
        data,
        metadata: {},
        occurredAt: data.occurredAt,
        idempotencyKey: `guided-turn-failed:${data.sourceEventId}`,
      }),
    ];
  }

  static getAggregateId(payload: RecordGuidedOnboardingTurnFailedCommandData): string {
    return payload.conversationId;
  }
}
