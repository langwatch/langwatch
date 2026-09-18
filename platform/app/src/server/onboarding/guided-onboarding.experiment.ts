/**
 * The PostHog side of the onboarding experiment, run without a PostHog
 * feature flag: the organization keeps the assignment
 * (`signupData.onboardingVariant`, set by the experiment_onboarding_langy_guided
 * flag at creation), and PostHog reads the variant from the
 * `$feature/<flag key>` property on the exposure event and on every metric
 * event. The classic onboarding is the baseline, which PostHog calls
 * `control`.
 *
 * Framework-free on purpose: the server events and the browser both import
 * it, so the property name and the mapping live in one place.
 *
 * @see specs/analytics/posthog-guided-onboarding.feature
 * @see dev/docs/adr/005-feature-flags.md
 */
import type { OnboardingVariant } from "~/server/schemas/sign-up-data.schema";

export const ONBOARDING_EXPERIMENT_FLAG_KEY =
  "experiment_onboarding_langy_guided";

export const ONBOARDING_EXPERIMENT_PROPERTY = `$feature/${ONBOARDING_EXPERIMENT_FLAG_KEY}`;

export type OnboardingExperimentVariant = "control" | "guided";

const EXPERIMENT_VARIANT: Record<
  OnboardingVariant,
  OnboardingExperimentVariant
> = {
  guided: "guided",
  classic: "control",
};

/** The PostHog variant name of an assignment, or null when there is none. */
export function onboardingExperimentVariant(
  variant: OnboardingVariant | null | undefined,
): OnboardingExperimentVariant | null {
  return variant ? EXPERIMENT_VARIANT[variant] : null;
}

/**
 * The property object to spread into an event's properties: the experiment
 * property for an organization with a recorded variant, nothing for one
 * without (self-hosted, or older than the experiment).
 */
export function onboardingExperimentProperties(
  variant: OnboardingVariant | null | undefined,
): Record<string, string> {
  const experimentVariant = onboardingExperimentVariant(variant);
  return experimentVariant
    ? { [ONBOARDING_EXPERIMENT_PROPERTY]: experimentVariant }
    : {};
}
