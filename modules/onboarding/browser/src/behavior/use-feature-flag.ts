/**
 * useFeatureFlag wrapper keeping pending state to hold first screen until
 * governance flag resolves. Targeting argument ignored.
 */

import { useOnboardingHost } from "../model/onboarding-host.ts";

export function useFeatureFlag(
  flag: string,
  _targets?: { projectId?: string | null; organizationId?: string | null },
): { enabled: boolean; isLoading: boolean } {
  return useOnboardingHost().featureFlag(flag);
}
