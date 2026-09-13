import posthog from "posthog-js";
import {
  ONBOARDING_EXPERIMENT_PROPERTY,
  onboardingExperimentVariant,
} from "~/server/onboarding/guided-onboarding.experiment";
import type { OnboardingVariant } from "~/server/schemas/sign-up-data.schema";

/**
 * Registers the onboarding experiment property with posthog-js, so every
 * event captured from the browser carries the organization's variant the
 * way the server events do. Nothing is registered for an organization
 * without a variant.
 *
 * @see specs/analytics/posthog-guided-onboarding.feature
 */
export function registerOnboardingExperiment(
  variant: OnboardingVariant | null | undefined,
): void {
  const experimentVariant = onboardingExperimentVariant(variant);
  if (!experimentVariant) return;
  posthog.register({ [ONBOARDING_EXPERIMENT_PROPERTY]: experimentVariant });
}
