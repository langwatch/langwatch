/**
 * The PostHog side of guided onboarding: one server event per step, tracked
 * against the user, each setting the person properties the A/B split reads.
 * @see specs/features/onboarding/guided-onboarding-variant.feature
 */
import {
  onboardingExperimentProperties,
  type GuidedOnboardingState,
} from "@langwatch/onboarding-contract";

export type GuidedOnboardingEvent =
  | "paths_selected"
  | "provider_connected"
  | "provider_skipped"
  | "tour_completed"
  | "tour_skipped"
  | "tour_replayed"
  | "path_begun"
  | "path_completed"
  | "conversation_attached"
  | "virtual_key_minted";

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
  virtual_key_minted: null,
};

/** The person properties every guided event refreshes. */
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
}: {
  event: GuidedOnboardingEvent;
  payload: Record<string, string | string[] | number | undefined>;
  state: GuidedOnboardingState;
}): Record<string, unknown> {
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

/** What one guided write resolves to: a PostHog send, or nothing to track. */
export type GuidedOnboardingTrackedEvent =
  | { readonly tracked: true; readonly name: string; readonly properties: Record<string, unknown> }
  | { readonly tracked: false };

/** The PostHog send for a guided event, `$set` included, or `tracked: false`. */
export function guidedOnboardingTrackedEvent({
  event,
  payload,
  state,
  organizationId,
}: {
  event: GuidedOnboardingEvent;
  payload: Record<string, string | string[] | number | undefined>;
  state: GuidedOnboardingState;
  organizationId: string;
}): GuidedOnboardingTrackedEvent {
  const name = POSTHOG_EVENT[event];
  if (!name) return { tracked: false };

  return {
    tracked: true,
    name,
    properties: {
      ...eventProperties({ event, payload, state }),
      ...onboardingExperimentProperties("guided"),
      organization_id: organizationId,
      $set: guidedOnboardingPersonProperties(state),
    },
  };
}
