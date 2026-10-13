import { EventSchema } from "@langwatch/eventing";
import {
  GUIDED_ONBOARDING_RECORDED_EVENT_TYPE,
  GUIDED_ONBOARDING_RECORDED_EVENT_VERSION,
  guidedOnboardingRecordedEventDataSchema,
} from "@langwatch/onboarding-contract";
import { z } from "zod";

export const RECORD_GUIDED_ONBOARDING_COMMAND_TYPE = "lw.guided_onboarding.record" as const;

export const recordGuidedOnboardingCommandDataSchema = guidedOnboardingRecordedEventDataSchema;
export type RecordGuidedOnboardingCommandData = z.infer<
  typeof recordGuidedOnboardingCommandDataSchema
>;

export const guidedOnboardingRecordedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(GUIDED_ONBOARDING_RECORDED_EVENT_TYPE),
  version: z.literal(GUIDED_ONBOARDING_RECORDED_EVENT_VERSION),
  data: guidedOnboardingRecordedEventDataSchema,
});
export type GuidedOnboardingRecordedEvent = z.infer<typeof guidedOnboardingRecordedEventSchema>;
export type GuidedOnboardingLifecycleEvent = GuidedOnboardingRecordedEvent;
