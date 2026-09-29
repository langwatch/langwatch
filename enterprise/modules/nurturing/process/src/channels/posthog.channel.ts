/**
 * Nurturing's product-analytics sink: one fire-and-forget track call per
 * milestone. Separate from `modules/onboarding`'s PostHog channel: a
 * channel is per module, never shared across a module boundary.
 */
export interface PostHogEventInput {
  readonly userId: string;
  readonly event: string;
  readonly properties?: Record<string, unknown>;
}

/** A PostHog group's properties, as main's checkout set its organization's. */
export interface PostHogGroupInput {
  readonly groupType: string;
  readonly groupKey: string;
  readonly properties: Record<string, unknown>;
}

export abstract class PostHogChannel {
  /** Fire and forget: a milestone that produced this event must not fail on it. */
  abstract track(input: PostHogEventInput): void;
  /** Fire and forget, as `track`. */
  abstract groupIdentify(input: PostHogGroupInput): void;
}

/** Where server-side product analytics goes: the PostHog project key, and its host. */
export type ProductAnalyticsTarget = Readonly<{ key: string; host?: string }>;
