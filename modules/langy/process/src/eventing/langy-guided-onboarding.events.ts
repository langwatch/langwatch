import { EventSchema } from "@langwatch/eventing";
import {
  GUIDED_ONBOARDING_TURN_FAILED_EVENT_TYPE,
  GUIDED_ONBOARDING_TURN_FAILED_EVENT_VERSION,
  guidedOnboardingTurnFailedEventDataSchema,
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
