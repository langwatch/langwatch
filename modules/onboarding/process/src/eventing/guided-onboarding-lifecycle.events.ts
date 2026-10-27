import { EventSchema } from "@langwatch/eventing";
import {
  GUIDED_ONBOARDING_RECORDED_EVENT_TYPE,
  GUIDED_ONBOARDING_RECORDED_EVENT_VERSION,
  guidedOnboardingRecordedEventDataSchema,
  ONBOARDING_VARIANT_ASSIGNED_EVENT_TYPE,
  ONBOARDING_VARIANT_ASSIGNED_EVENT_VERSION,
  onboardingVariantAssignedEventDataSchema,
} from "@langwatch/onboarding-contract";
import { z } from "zod";

export const RECORD_GUIDED_ONBOARDING_COMMAND_TYPE = "lw.guided_onboarding.record" as const;
export const RECORD_ONBOARDING_VARIANT_ASSIGNED_COMMAND_TYPE =
  "lw.guided_onboarding.record_variant_assigned" as const;

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

export const recordOnboardingVariantAssignedCommandDataSchema =
  onboardingVariantAssignedEventDataSchema;
export type RecordOnboardingVariantAssignedCommandData = z.infer<
  typeof recordOnboardingVariantAssignedCommandDataSchema
>;

export const onboardingVariantAssignedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(ONBOARDING_VARIANT_ASSIGNED_EVENT_TYPE),
  version: z.literal(ONBOARDING_VARIANT_ASSIGNED_EVENT_VERSION),
  data: onboardingVariantAssignedEventDataSchema,
});
export type OnboardingVariantAssignedEvent = z.infer<typeof onboardingVariantAssignedEventSchema>;

export type GuidedOnboardingLifecycleEvent =
  | GuidedOnboardingRecordedEvent
  | OnboardingVariantAssignedEvent;
