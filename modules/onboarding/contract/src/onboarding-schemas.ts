/**
 * What sign-up collects, and where a guided onboarding stands on the organization.
 * @see specs/features/onboarding/guided-onboarding-variant.feature
 */
import { z } from "zod";

import { ATTRIBUTION_FIELDS, type AttributionField } from "./onboarding-attribution.ts";
import { guidedPathSchema } from "./onboarding-guided-paths.ts";

/**
 * Which onboarding a user went through after sign-up: the guided one, where
 * Langy takes over the screen, or the classic wizard. Recorded on the
 * organization at creation so every later milestone can be split by it.
 */
export const onboardingVariantSchema = z.enum(["guided", "classic"]);
export type OnboardingVariant = z.infer<typeof onboardingVariantSchema>;

/**
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
  /**
   * The virtual key the gateway tour minted, so the kickoff brief can name it
   * and Langy can show its secret once more through the secret snippet card.
   * The secret itself is never here: `virtualKeyRevealId` reads it once.
   */
  virtualKeyName: z.string().optional(),
  virtualKeyPreview: z.string().optional(),
  virtualKeyRevealId: z.string().optional(),
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
export type SignUpData = z.infer<typeof signUpDataSchema>;

/**
 * Reads the guided block out of a stored sign-up data value. Anything that is
 * not the expected shape reads as the empty default: a hand-edited row must
 * not turn the welcome flow into an error.
 */
export function parseGuidedOnboardingState(signupData: unknown): GuidedOnboardingState {
  const block =
    signupData && typeof signupData === "object"
      ? (signupData as Record<string, unknown>).guidedOnboarding
      : undefined;
  const parsed = guidedOnboardingStateSchema.safeParse(block);
  return parsed.success ? parsed.data : EMPTY_GUIDED_ONBOARDING_STATE;
}

export function parseOnboardingVariant(signupData: unknown): OnboardingVariant | null {
  const variant =
    signupData && typeof signupData === "object"
      ? (signupData as Record<string, unknown>).onboardingVariant
      : undefined;
  return variant === "guided" || variant === "classic" ? variant : null;
}
