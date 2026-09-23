// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** One product-analytics event, attributed to whoever the event is about. */
export interface ProductAnalyticsEvent {
  readonly distinctId: string;
  readonly event: string;
  readonly properties: Readonly<Record<string, unknown>>;
}

/** Cloud's own product-analytics sink. A channel is per module, never shared. */
export interface ProductAnalyticsChannel {
  /** Fire and forget: whatever produced the event must not fail on it. */
  capture(event: ProductAnalyticsEvent): void;
}
