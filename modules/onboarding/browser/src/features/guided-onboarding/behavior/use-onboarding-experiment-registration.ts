/**
 * Keeps posthog-js's experiment property in step with the organization the
 * guided onboarding host is mounted for, so every browser-captured event
 * carries it the way the server's events do.
 * @see specs/analytics/posthog-guided-onboarding.feature
 */
import { useEffect } from "react";

import { registerOnboardingExperiment } from "../../../behavior/onboarding-experiment-registration.ts";
import { useGuidedOnboarding } from "./use-guided-onboarding.ts";

export function useOnboardingExperimentRegistration(): void {
  const { variant, organizationId } = useGuidedOnboarding();

  useEffect(() => {
    registerOnboardingExperiment(variant);
  }, [organizationId, variant]);
}
