import { EventSchema } from "@langwatch/eventing";
import {
  GUIDED_ONBOARDING_TURN_FAILED_EVENT_TYPE,
  GUIDED_ONBOARDING_TURN_FAILED_EVENT_VERSION,
  guidedOnboardingTurnFailedEventDataSchema,
  LANGY_FIRST_MESSAGE_SEEN_EVENT_TYPE,
  LANGY_FIRST_MESSAGE_SEEN_EVENT_VERSION,
  langyFirstMessageSeenEventDataSchema,
} from "@langwatch/langy-contract";
import { z } from "zod";

export const RECORD_GUIDED_ONBOARDING_TURN_FAILED_COMMAND_TYPE =
  "lw.langy_guided_onboarding.record_turn_failed" as const;

export const recordGuidedOnboardingTurnFailedCommandDataSchema =
  guidedOnboardingTurnFailedEventDataSchema;
export type RecordGuidedOnboardingTurnFailedCommandData = z.infer<
  typeof recordGuidedOnboardingTurnFailedCommandDataSchema
>;

export const guidedOnboardingTurnFailedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(GUIDED_ONBOARDING_TURN_FAILED_EVENT_TYPE),
  version: z.literal(GUIDED_ONBOARDING_TURN_FAILED_EVENT_VERSION),
  data: guidedOnboardingTurnFailedEventDataSchema,
});
export type GuidedOnboardingTurnFailedEvent = z.infer<typeof guidedOnboardingTurnFailedEventSchema>;

export const RECORD_LANGY_FIRST_MESSAGE_SEEN_COMMAND_TYPE =
  "lw.langy_guided_onboarding.record_first_message_seen" as const;

export const recordLangyFirstMessageSeenCommandDataSchema = langyFirstMessageSeenEventDataSchema;
export type RecordLangyFirstMessageSeenCommandData = z.infer<
  typeof recordLangyFirstMessageSeenCommandDataSchema
>;

export const langyFirstMessageSeenEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(LANGY_FIRST_MESSAGE_SEEN_EVENT_TYPE),
  version: z.literal(LANGY_FIRST_MESSAGE_SEEN_EVENT_VERSION),
  data: langyFirstMessageSeenEventDataSchema,
});
export type LangyFirstMessageSeenEvent = z.infer<typeof langyFirstMessageSeenEventSchema>;
