import posthog from "posthog-js";
import { useEffect } from "react";
import { usePublicEnv } from "./usePublicEnv";

/**
 * Module-level flag read by the `before_send` callback closure.
 * Updated by `setPostHogImpersonationState` (called from usePostHogIdentify).
 *
 * Using a module-level variable (not React state) because `before_send` is
 * configured once at `posthog.init` time and the closure must always read
 * the latest value without re-initialization.
 */
let _isImpersonating = false;

/**
 * Sets the impersonation state read by the PostHog `before_send` callback.
 * Called from usePostHogIdentify when the session changes.
 */
export function setPostHogImpersonationState(impersonating: boolean): void {
  _isImpersonating = impersonating;
}

/**
 * Returns the current impersonation state. Exposed for testing.
 * @internal
 */
export function getPostHogImpersonationState(): boolean {
  return _isImpersonating;
}

/**
 * PostHog `before_send` callback. Drops capture events during impersonation
 * but allows session recording ($snapshot) and feature flag requests through.
 *
 * Safety: This replaces the opt_out_capturing/opt_in_capturing approach that
 * caused a production outage (PR #2244 / #2398) by triggering a race condition
 * with session recording initialization.
 */
export function impersonationBeforeSend(
  event: { event: string } & Record<string, unknown>,
): typeof event | null {
  if (!_isImpersonating) return event;

  // Allow session recording events ($snapshot) through — these are captured
  // separately and should continue during impersonation for debugging.
  if (event.event === "$snapshot") return event;

  // Allow exception events through — error capture must remain active
  // during impersonation so admins can debug issues.
  if (event.event === "$exception") return event;

  // Drop all other capture events (autocapture, pageviews, custom events).
  // Feature flags use the /decide endpoint, not the capture path.
  return null;
}

export function usePostHog() {
  const publicEnv = usePublicEnv();

  useEffect(() => {
    if (!publicEnv.data) return;

    const posthogKey = publicEnv.data?.POSTHOG_KEY;
    const posthogHost = publicEnv.data?.POSTHOG_HOST;

    if (posthogKey) {
      // capture_pageview: "history_change" tells posthog-js to capture
      // $pageview on every History API navigation (pushState / popstate),
      // not just on initial page load. In posthog-js 1.369 this defaults
      // to true (initial load only) unless `defaults` is set to >=
      // '2025-05-24', so we set it explicitly to avoid silently dropping
      // SPA pageviews after the migration off Next.js.
      // We deliberately do NOT also call posthog.capture("$pageview") on
      // routeChangeComplete — letting posthog-js handle it avoids the
      // multiplier bug from the next-router compat layer (every mounted
      // useRouter() instance used to fan out one capture per consumer).
      posthog.init(posthogKey, {
        api_host: posthogHost ?? "https://eu.i.posthog.com",
        person_profiles: "always",
        autocapture: true,
        capture_pageview: "history_change",
        capture_exceptions: true,
        session_recording: {
          recordCrossOriginIframes: true,
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        before_send: impersonationBeforeSend as any,
        loaded: (posthog) => {
          // Explicitly expose `window.posthog` so the PostHog toolbar
          // (launched from the PostHog dashboard's "Toolbar" button)
          // can attach in any environment, not just development. The
          // posthog-js library sets this internally on most builds, but
          // bundlers and strict-mode wrappers can sometimes strip the
          // implicit global; the assignment is best-effort and has no
          // downside in environments where it's already set.
          if (typeof window !== "undefined") {
            (window as unknown as { posthog: typeof posthog }).posthog =
              posthog;
          }
          if (publicEnv.data?.NODE_ENV === "development") posthog.debug();
        },
      });
    }
  }, [publicEnv.data]);

  return publicEnv.data?.POSTHOG_KEY ? posthog : undefined;
}
