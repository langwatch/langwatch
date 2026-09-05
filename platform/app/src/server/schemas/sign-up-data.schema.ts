import { z } from "zod";
import { guidedPathSchema } from "~/features/guided-onboarding/paths";
import { ATTRIBUTION_FIELDS, type AttributionField } from "~/utils/attribution";

/**
 * Which onboarding a user went through after sign-up: the guided one, where
 * Langy takes over the screen, or the classic wizard. Recorded on the
 * organization at creation so every later milestone can be split by it.
 */
export const onboardingVariantSchema = z.enum(["guided", "classic"]);
export type OnboardingVariant = z.infer<typeof onboardingVariantSchema>;

/**
 * Where a guided onboarding stands, kept on the organization so a reload or a
 * second device continues where it stopped. Instants are ISO strings because
 * the block lives in a JSON column.
 *
 * `paths` keeps the picks in the order they were made: the first pick is the
 * one set up now. `currentPath` is the path being guided, `donePaths` the
 * ones whose setup completed.
 */
export const guidedOnboardingStateSchema = z.object({
  paths: z.array(guidedPathSchema).default([]),
  currentPath: guidedPathSchema.optional(),
  donePaths: z.array(guidedPathSchema).default([]),
  provider: z.string().optional(),
  providerModel: z.string().optional(),
  tourCompletedAt: z.string().optional(),
  tourSkippedAt: z.string().optional(),
  providerSkippedAt: z.string().optional(),
  conversationId: z.string().optional(),
  tourReplays: z.number().int().nonnegative().optional(),
});
export type GuidedOnboardingState = z.infer<typeof guidedOnboardingStateSchema>;

export const EMPTY_GUIDED_ONBOARDING_STATE: GuidedOnboardingState = {
  paths: [],
  donePaths: [],
};

const attributionShape = ATTRIBUTION_FIELDS.reduce(
  (acc, field) => {
    acc[field] = z.string().optional().nullable();
    return acc;
  },
  {} as Record<AttributionField, z.ZodNullable<z.ZodOptional<z.ZodString>>>,
);

/**
 * Input schema for organization signup data
 */
export const signUpDataSchema = z.object({
  usage: z.string().optional().nullable(),
  solution: z.string().optional().nullable(),
  terms: z.boolean().optional(),
  companyType: z.string().optional().nullable(),
  companySize: z.string().optional().nullable(),
  projectType: z.string().optional().nullable(),
  howDidYouHearAboutUs: z.string().optional().nullable(),
  otherCompanyType: z.string().optional().nullable(),
  otherProjectType: z.string().optional().nullable(),
  otherHowDidYouHearAboutUs: z.string().optional().nullable(),
  yourRole: z.string().optional().nullable(),
  featureUsage: z.string().optional().nullable(),
  onboardingVariant: onboardingVariantSchema.optional().nullable(),
  guidedOnboarding: guidedOnboardingStateSchema.optional().nullable(),
  ...attributionShape,
});
