import type { GuidedOnboardingState } from "~/server/schemas/sign-up-data.schema";

/**
 * What happened to an organization's guided onboarding, emitted after every
 * write of its state. Product analytics and the nurturing platform subscribe
 * here, so the procedures that write the state never know about either.
 */
export type GuidedOnboardingEvent =
  | "paths_selected"
  | "provider_connected"
  | "provider_skipped"
  | "tour_completed"
  | "tour_skipped"
  | "tour_replayed"
  | "path_begun"
  | "path_completed"
  | "conversation_attached";

export interface GuidedOnboardingEventInput {
  organizationId: string;
  /** Absent when the write came through a project credential with no user. */
  userId: string | undefined;
  event: GuidedOnboardingEvent;
  /** What the event carries beyond the state: the path, the provider. */
  payload: Record<string, string | string[] | number | undefined>;
  /** The guided state after the write. */
  state: GuidedOnboardingState;
}

/**
 * Fan-out point for every guided onboarding event. Fire and forget: a
 * subscriber that fails must not fail the write that produced the event.
 */
export function onGuidedOnboardingEvent(
  _input: GuidedOnboardingEventInput,
): void {
  // Subscribers (PostHog server events, Customer.io traits and campaign
  // triggers) attach here.
}
