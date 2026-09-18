/**
 * The one instrumentation capability — the browser twin of a channel
 * (ARCHITECTURE.md §10.1). A module emits named events through it and never
 * imports posthog, gtag or a tracing SDK; the shell composes the destinations.
 */

import { useOptionalUiCapabilities } from "./capabilities.ts";

/**
 * One thing a reader did, as the emitting module knows it. The destination
 * name is `boundary.action.name` with the absent parts dropped, which is the
 * spelling every instrumentation destination already receives.
 */
export type UiAnalyticsEvent = {
  /** What the event is about — the noun, in the module's own vocabulary. */
  name: string;
  /** What happened to it: `clicked`, `submitted`, `opened`. */
  action?: string;
  /**
   * The surface the event happened on. Left absent by a module that has no
   * opinion, and filled by whatever boundary the shell mounted above it.
   */
  boundary?: string;
  /** The event's own facts. Never a secret, never a raw identifier. */
  attributes?: Readonly<Record<string, unknown>>;
};

/** Where a module's named events go. */
export abstract class UiAnalytics {
  abstract track(event: UiAnalyticsEvent): void;
}

/**
 * Drops every event. An absent destination is not a composition fault the
 * way an absent session is: registering none has always dropped events
 * silently, and telemetry must never be what breaks a screen.
 */
class InertUiAnalytics extends UiAnalytics {
  track(): void {
    // Deliberately nothing.
  }
}

/** What a composition that installed no analytics destination reads as. */
export const INERT_UI_ANALYTICS: UiAnalytics = new InertUiAnalytics();

/**
 * The analytics capability above this screen. A screen mounted outside the
 * shell reads the inert one rather than crashing, the same way
 * {@link useUiDeployment} degrades.
 */
export function useUiAnalytics(): UiAnalytics {
  return useOptionalUiCapabilities()?.analytics ?? INERT_UI_ANALYTICS;
}
