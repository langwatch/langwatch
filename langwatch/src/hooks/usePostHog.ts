import posthog from "posthog-js";
import { useEffect } from "react";
import { usePublicEnv } from "./usePublicEnv";

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
        loaded: (posthog) => {
          // Explicitly expose `window.posthog` so the PostHog toolbar
          // (launched from the PostHog dashboard's "Toolbar" button)
          // can attach in any environment, not just development. The
          // posthog-js library sets this internally on most builds, but
          // bundlers and strict-mode wrappers can sometimes strip the
          // implicit global; the assignment is best-effort and has no
          // downside in environments where it's already set. rchaves
          // hit a missing window.posthog dogfooding the PR.
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
