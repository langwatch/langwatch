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
      // posthog-js auto-captures $pageview on History API navigation in SPAs
      // (capture_pageview defaults to "history_change"). We deliberately do not
      // also call posthog.capture("$pageview") on routeChangeComplete — doing
      // both used to double-count, and prior to the next-router compat dedup
      // it multiplied pageviews by every mounted useRouter() consumer.
      posthog.init(posthogKey, {
        api_host: posthogHost ?? "https://eu.i.posthog.com",
        person_profiles: "always",
        autocapture: true,
        capture_exceptions: true,
        session_recording: {
          recordCrossOriginIframes: true,
        },
        loaded: (posthog) => {
          if (publicEnv.data?.NODE_ENV === "development") posthog.debug();
        },
      });
    }
  }, [publicEnv.data]);

  return publicEnv.data?.POSTHOG_KEY ? posthog : undefined;
}
