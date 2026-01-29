import { useSession } from "next-auth/react";
import type { FrontendFeatureFlag } from "../server/featureFlag/frontendFeatureFlags";

/**
 * Hook to check if a feature flag is enabled for the current user.
 * Feature flags are loaded from the session (populated by the backend).
 *
 * @returns A function that checks if a flag is enabled.
 */
export function useHasFeature() {
  const { data: session } = useSession();

  return (flag: FrontendFeatureFlag): boolean => {
    return session?.user?.enabledFeatures?.includes(flag) ?? false;
  };
}
