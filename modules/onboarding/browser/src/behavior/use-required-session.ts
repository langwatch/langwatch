/**
 * Reads current user and session status without redirect logic (which belongs
 * to the shell).
 */

import { useOnboardingHost } from "../model/onboarding-host.ts";

export function useRequiredSession() {
  const host = useOnboardingHost();
  const status = host.sessionStatus();
  const user = host.currentUser();
  return {
    data: user ? { user } : null,
    status,
  };
}
