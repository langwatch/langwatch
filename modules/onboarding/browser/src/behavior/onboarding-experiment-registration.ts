/** Keeps posthog-js's super-property in step with the org's variant, so a
 * switch away from a variant does not carry it onto later events.
 * @see specs/analytics/posthog-guided-onboarding.feature */
import {
  experimentVariantFor,
  ONBOARDING_EXPERIMENT_PROPERTY,
  type OnboardingVariant,
} from "@langwatch/onboarding-contract";
import posthog from "posthog-js";

export function registerOnboardingExperiment(variant: OnboardingVariant | null | undefined): void {
  if (!variant) {
    posthog.unregister(ONBOARDING_EXPERIMENT_PROPERTY);
    return;
  }
  posthog.register({ [ONBOARDING_EXPERIMENT_PROPERTY]: experimentVariantFor(variant) });
}
