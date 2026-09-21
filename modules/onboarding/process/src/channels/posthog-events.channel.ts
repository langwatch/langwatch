/**
 * The product-analytics side of guided onboarding: one event per step,
 * tracked against the user so it joins the browser person.
 * @see specs/features/onboarding/guided-onboarding-variant.feature
 */

export interface PostHogEventInput {
  readonly userId: string;
  readonly event: string;
  readonly properties?: Record<string, unknown>;
}

export interface PostHogEventsChannel {
  /** Fire and forget: a write that produced this event must not fail on it. */
  track(input: PostHogEventInput): void;
}
