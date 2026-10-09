import type { UiAnalytics } from "@langwatch/browser-host/analytics";
/** Keeps the analytics super-property in step with the org's variant, so a
 * switch away from a variant does not carry it onto later events.
 * @see specs/analytics/posthog-guided-onboarding.feature */
import {
  experimentVariantFor,
  ONBOARDING_EXPERIMENT_PROPERTY,
  type OnboardingVariant,
} from "@langwatch/onboarding-contract";

export function registerOnboardingExperiment({
  analytics,
  variant,
}: {
  analytics: UiAnalytics;
  variant: OnboardingVariant | null | undefined;
}): void {
  if (!variant) {
    analytics.unregister(ONBOARDING_EXPERIMENT_PROPERTY);
    return;
  }
  analytics.register({ [ONBOARDING_EXPERIMENT_PROPERTY]: experimentVariantFor(variant) });
}
