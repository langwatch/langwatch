import { z } from "zod";

import { guidedPathSchema } from "./onboarding-guided-paths.ts";
import { guidedOnboardingStateSchema } from "./onboarding-schemas.ts";

/** Guided onboarding's lifecycle facts, which peers react to from their own side (§9). */
export const GUIDED_ONBOARDING_LIFECYCLE_PIPELINE_NAME = "guided_onboarding_lifecycle" as const;
export const GUIDED_ONBOARDING_AGGREGATE_TYPE = "guided_onboarding" as const;
export const GUIDED_ONBOARDING_RECORDED_EVENT_TYPE = "lw.guided_onboarding.recorded" as const;
export const GUIDED_ONBOARDING_RECORDED_EVENT_VERSION = "2026-09-30" as const;

/** The guided events a peer hears of: the picks, and the steps that finish something. */
export const guidedOnboardingRecordedEventNameSchema = z.enum([
  "paths_selected",
  "path_begun",
  "provider_connected",
  "tour_completed",
  "tour_skipped",
  "path_completed",
]);
export type GuidedOnboardingRecordedEventName = z.infer<
  typeof guidedOnboardingRecordedEventNameSchema
>;

/** The state as far as a peer reads it: no conversation and no key reveal ride the event. */
export const guidedOnboardingRecordedStateSchema = guidedOnboardingStateSchema.pick({
  paths: true,
  donePaths: true,
  provider: true,
  tourCompletedAt: true,
  tourSkippedAt: true,
});

/** One signalling guided write, attributed to a person, with the state it left behind. */
export const guidedOnboardingRecordedEventDataSchema = z.object({
  tenantId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
  organizationId: z.string().min(1),
  userId: z.string().min(1),
  event: guidedOnboardingRecordedEventNameSchema,
  payload: z.record(z.string(), z.union([z.string(), z.array(z.string()), z.number()])),
  previousPaths: z.array(guidedPathSchema),
  state: guidedOnboardingRecordedStateSchema,
});
export type GuidedOnboardingRecordedEventData = z.infer<
  typeof guidedOnboardingRecordedEventDataSchema
>;
