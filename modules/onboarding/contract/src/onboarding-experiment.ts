/**
 * The PostHog side of the onboarding experiment, run as an organization
 * assignment rather than a per-read flag lookup.
 *
 * @see dev/docs/adr/005-feature-flags.md
 */
import type { OnboardingVariant } from "./onboarding-schemas.ts";

export const ONBOARDING_EXPERIMENT_FLAG_KEY = "experiment_onboarding_langy_guided";

export const ONBOARDING_EXPERIMENT_PROPERTY = `$feature/${ONBOARDING_EXPERIMENT_FLAG_KEY}`;

export type OnboardingExperimentVariant = "control" | "guided";

const EXPERIMENT_VARIANT: Record<OnboardingVariant, OnboardingExperimentVariant> = {
  guided: "guided",
  classic: "control",
};

/** The PostHog variant name of a recorded assignment. Total over the enum. */
export function experimentVariantFor(variant: OnboardingVariant): OnboardingExperimentVariant {
  return EXPERIMENT_VARIANT[variant];
}

/**
 * The property object to spread into an event's properties: the experiment
 * property for an organization with a recorded variant, nothing for one
 * without (self-hosted, or older than the experiment).
 */
export function onboardingExperimentProperties(
  variant: OnboardingVariant | null | undefined,
): Record<string, string> {
  if (!variant) return {};
  return { [ONBOARDING_EXPERIMENT_PROPERTY]: experimentVariantFor(variant) };
}
