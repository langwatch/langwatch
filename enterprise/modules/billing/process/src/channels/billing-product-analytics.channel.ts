// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** One product-analytics event about a person, keyed by the user id the browser identifies. */
export interface BillingProductAnalyticsEvent {
  readonly userId: string;
  readonly event: string;
  readonly properties?: Record<string, unknown>;
}

/**
 * Billing's product-analytics sink. A channel is per module: nurturing and onboarding hold
 * their own. `track` throws when the client cannot be built, and the caller reports it.
 */
export abstract class BillingProductAnalyticsChannel {
  abstract track(input: BillingProductAnalyticsEvent): void;
}

/** Where server-side product analytics goes: the PostHog project key, and its host. */
export type BillingProductAnalyticsTarget = Readonly<{ key: string; host?: string }>;
