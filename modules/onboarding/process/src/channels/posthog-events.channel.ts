/**
 * The product-analytics side of guided onboarding: one event per step,
 * tracked against the user so it joins the browser person.
 * @see specs/features/onboarding/guided-onboarding-variant.feature
 */

export interface PostHogEventInput {
  readonly userId: string;
  readonly event: string;
  readonly properties?: Readonly<Record<string, unknown>>;
  /** PostHog keeps one event per uuid, so a redelivered source event is counted once. */
  readonly uuid?: string;
}

export interface PostHogEventsChannel {
  /** Fire and forget: a write that produced this event must not fail on it. */
  track(input: PostHogEventInput): void;
}
