import type { Named } from "@langwatch/module";
import { z } from "zod";

import { guidedPathSchema } from "./onboarding-guided-paths.ts";
import { guidedOnboardingStateSchema } from "./onboarding-schemas.ts";

/** Guided onboarding's lifecycle facts, which peers react to from their own side (§9). */
export const GUIDED_ONBOARDING_LIFECYCLE_PIPELINE_NAME = "guided_onboarding_lifecycle" as const;
export const GUIDED_ONBOARDING_AGGREGATE_TYPE = "guided_onboarding" as const;
export const GUIDED_ONBOARDING_RECORDED_EVENT_TYPE = "lw.guided_onboarding.recorded" as const;
export const GUIDED_ONBOARDING_RECORDED_EVENT_VERSION = "2026-09-30" as const;

/** The guided events a peer hears of: every step of the guide that is not bookkeeping. */
export const guidedOnboardingRecordedEventNameSchema = z.enum([
  "paths_selected",
  "path_begun",
  "provider_connected",
  "provider_skipped",
  "tour_completed",
  "tour_skipped",
  "tour_replayed",
  "path_completed",
]);
export type GuidedOnboardingRecordedEventName = z.infer<
  typeof guidedOnboardingRecordedEventNameSchema
>;

/** The state as far as a peer reads it: no conversation and no key reveal ride the event. */
const guidedOnboardingRecordedStateSchemaDefinition = guidedOnboardingStateSchema.pick({
  paths: true,
  currentPath: true,
  donePaths: true,
  provider: true,
  tourCompletedAt: true,
  tourSkippedAt: true,
});
export interface GuidedOnboardingRecordedStateSchema extends Named<
  typeof guidedOnboardingRecordedStateSchemaDefinition
> {}
export const guidedOnboardingRecordedStateSchema: GuidedOnboardingRecordedStateSchema =
  guidedOnboardingRecordedStateSchemaDefinition;

/** One signalling guided write, attributed to a person, with the state it left behind. */
const guidedOnboardingRecordedEventDataSchemaDefinition = z.object({
  tenantId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
  organizationId: z.string().min(1),
  userId: z.string().min(1),
  event: guidedOnboardingRecordedEventNameSchema,
  payload: z.record(z.string(), z.union([z.string(), z.array(z.string()), z.number()])),
  previousPaths: z.array(guidedPathSchema),
  state: guidedOnboardingRecordedStateSchema,
});
export interface GuidedOnboardingRecordedEventDataSchema extends Named<
  typeof guidedOnboardingRecordedEventDataSchemaDefinition
> {}
export const guidedOnboardingRecordedEventDataSchema: GuidedOnboardingRecordedEventDataSchema =
  guidedOnboardingRecordedEventDataSchemaDefinition;
export type GuidedOnboardingRecordedEventData = z.infer<
  typeof guidedOnboardingRecordedEventDataSchema
>;
