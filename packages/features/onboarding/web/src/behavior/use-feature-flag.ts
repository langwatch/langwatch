/**
 * `useFeatureFlag`, over the host's tri-state reading.
 *
 * The pending state is kept rather than collapsed to `false`, and that is the
 * whole reason this is a port method: the welcome flow HOLDS its first screen
 * while the governance fork flag is in flight, because advancing early takes the
 * pre-fork path and then silently skips a required screen when the flag
 * resolves enabled.
 *
 * The targeting argument is accepted and ignored. Onboarding runs before either
 * scope exists — the platform call site says so in as many words by naming both
 * targets as absent — so there is nothing for the host to narrow by.
 */

import { useOnboardingHost } from "../model/onboarding-host";

export function useFeatureFlag(
  flag: string,
  _targets?: { projectId?: string | null; organizationId?: string | null },
): { enabled: boolean; isLoading: boolean } {
  return useOnboardingHost().featureFlag(flag);
}
