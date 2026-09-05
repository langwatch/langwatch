/**
 * The PostHog side of the guided onboarding: one server event per step,
 * tracked against the user so it joins the browser person, each one setting
 * the onboarding person properties the A/B analysis splits by.
 *
 * @see specs/analytics/posthog-guided-onboarding.feature
 */
import { trackServerEvent } from "~/server/posthog";
import type {
  GuidedOnboardingState,
  OnboardingVariant,
} from "~/server/schemas/sign-up-data.schema";
import type {
  AttributedGuidedOnboardingEvent,
  GuidedOnboardingEvent,
} from "./guided-onboarding.events";

const POSTHOG_EVENT: Record<GuidedOnboardingEvent, string | null> = {
  paths_selected: "guided_onboarding_paths_selected",
  provider_connected: "guided_onboarding_provider_connected",
  provider_skipped: "guided_onboarding_provider_skipped",
  tour_completed: "guided_onboarding_tour_completed",
  tour_skipped: "guided_onboarding_tour_skipped",
  tour_replayed: "guided_onboarding_tour_replayed",
  path_begun: "guided_onboarding_path_begun",
  path_completed: "guided_onboarding_path_completed",
  conversation_attached: null,
};

/**
 * The person properties every guided event refreshes. A guided event only
 * ever comes from the guided variant, so the variant is a constant here.
 */
export function guidedOnboardingPersonProperties(
  state: GuidedOnboardingState,
): Record<string, unknown> {
  return {
    onboarding_variant: "guided",
    onboarding_paths: state.paths,
    onboarding_primary_path: state.paths[0],
  };
}

/**
 * Only the named fields of the payload reach PostHog: the payload is a bag
 * the service fills, and nothing but the provider name and the model may
 * leave the process for a provider connection.
 */
function eventProperties({
  event,
  payload,
  state,
}: AttributedGuidedOnboardingEvent): Record<string, unknown> {
  switch (event) {
    case "paths_selected":
      return { paths: state.paths, primary_path: state.paths[0] };
    case "provider_connected":
      return { provider: payload.provider, model: payload.model };
    case "tour_completed":
    case "tour_skipped":
    case "tour_replayed":
      return { path: state.currentPath };
    case "path_begun":
    case "path_completed":
      return { path: payload.path };
    default:
      return {};
  }
}

export function trackGuidedOnboardingEvent(
  input: AttributedGuidedOnboardingEvent,
): void {
  const event = POSTHOG_EVENT[input.event];
  if (!event) return;

  trackServerEvent({
    userId: input.userId,
    event,
    properties: {
      ...eventProperties(input),
      organization_id: input.organizationId,
      $set: guidedOnboardingPersonProperties(input.state),
    },
  });
}

/**
 * Tracked once, when the organization is created, for both variants: this is
 * the event the funnel starts from on either side of the experiment.
 */
export function trackOnboardingVariantAssigned({
  userId,
  organizationId,
  variant,
}: {
  userId: string;
  organizationId: string;
  variant: OnboardingVariant;
}): void {
  trackServerEvent({
    userId,
    event: "onboarding_variant_assigned",
    properties: {
      variant,
      organization_id: organizationId,
      $set: { onboarding_variant: variant },
    },
  });
}
