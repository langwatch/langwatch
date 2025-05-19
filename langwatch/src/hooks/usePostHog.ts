import { useEffect } from "react";
import posthog from "posthog-js";
import { useRouter } from "next/router";
import { usePublicEnv } from "./usePublicEnv";

export function usePostHog() {
  const router = useRouter();
  const publicEnv = usePublicEnv();

  useEffect(() => {
    if (!publicEnv.data) return;

    const posthogKey = publicEnv.data?.POSTHOG_KEY;
    const posthogHost = publicEnv.data?.POSTHOG_HOST;

    if (posthogKey) {
      posthog.init(posthogKey, {
        api_host: posthogHost ?? "https://eu.i.posthog.com",
        person_profiles: "always",
        loaded: (posthog) => {
          if (publicEnv.data?.NODE_ENV === "development") posthog.debug();
        },
      });

      const handleRouteChange = () => posthog?.capture("$pageview");

      router.events.on("routeChangeComplete", handleRouteChange);

      return () => {
        router.events.off("routeChangeComplete", handleRouteChange);
      };
    }
  }, [publicEnv.data, router.events]);

  return publicEnv.data?.POSTHOG_KEY ? posthog : undefined;
}
