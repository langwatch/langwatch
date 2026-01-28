import { useSession } from "next-auth/react";
import type { FrontendFeatureFlag } from "../server/featureFlag/frontendFeatureFlags";

/**
 * Hook to check if a feature flag is enabled for the current user.
 * Feature flags are loaded from the session (populated by the backend).
 */
export function useHasFeature() {
  const { data: session } = useSession();

  return (flag: FrontendFeatureFlag): boolean =>
    session?.user?.enabledFeatures?.includes(flag) ?? false;
}
