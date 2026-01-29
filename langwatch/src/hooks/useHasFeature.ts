import { useSession } from "next-auth/react";
import type { FrontendFeatureFlag } from "../server/featureFlag/frontendFeatureFlags";

/**
 * Hook to check if a feature flag is enabled for the current user.
 * Feature flags are loaded from the session (populated by the backend).
 *
 * @returns A function that checks if a flag is enabled.
 *          If projectId is provided, checks project-level flags.
 *          Otherwise, checks user-level flags.
 */
export function useHasFeature() {
  const { data: session } = useSession();

  console.log("session", session);

  return (flag: FrontendFeatureFlag, projectId?: string): boolean => {
    if (projectId) {
      return (
        session?.user?.projectFeatures?.[projectId]?.includes(flag) ?? false
      );
    }
    return session?.user?.enabledFeatures?.includes(flag) ?? false;
  };
}
