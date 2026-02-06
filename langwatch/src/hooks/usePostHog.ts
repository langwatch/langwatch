import { useSession } from "next-auth/react";
import { useRouter } from "next/router";
import posthog from "posthog-js";
import { useEffect, useRef } from "react";
import { usePublicEnv } from "./usePublicEnv";

export function usePostHog() {
  const router = useRouter();
  const publicEnv = usePublicEnv();
  const { data: session } = useSession();
  const identifiedUserRef = useRef<string | null>(null);

  // Extract project slug from URL (e.g., /my-project/messages -> "my-project")
  const projectSlug = typeof router.query.project === "string" 
    ? router.query.project 
    : undefined;

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

  // Identify user when session is available
  useEffect(() => {
    if (!publicEnv.data?.POSTHOG_KEY) return;
    if (!posthog.__loaded) return;
    
    const userId = session?.user?.id;
    
    // Only identify if we have a user and haven't already identified them
    if (userId && identifiedUserRef.current !== userId) {
      posthog.identify(userId, {
        email: session?.user?.email ?? undefined,
        name: session?.user?.name ?? undefined,
      });
      identifiedUserRef.current = userId;
    }
    
    // Reset identification if user logs out
    if (!userId && identifiedUserRef.current) {
      posthog.reset();
      identifiedUserRef.current = null;
    }
  }, [session?.user?.id, session?.user?.email, session?.user?.name, publicEnv.data?.POSTHOG_KEY]);

  // Update person properties when project context changes
  useEffect(() => {
    if (!publicEnv.data?.POSTHOG_KEY) return;
    if (!posthog.__loaded) return;
    if (!session?.user?.id) return;
    
    // Set project context as a person property that updates with navigation
    if (projectSlug) {
      posthog.people.set({
        current_project_slug: projectSlug,
      });
    }
  }, [projectSlug, session?.user?.id, publicEnv.data?.POSTHOG_KEY]);

  return publicEnv.data?.POSTHOG_KEY ? posthog : undefined;
}
