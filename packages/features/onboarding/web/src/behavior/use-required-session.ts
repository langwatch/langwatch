/**
 * `useRequiredSession`, narrowed to what the welcome flow asks of it.
 *
 * The application hook carried a 200-line public-route table and a sign-in
 * redirect; neither travelled, for the reason the trace family gives — a
 * redirect is the shell's policy, and these addresses are reachable in front of
 * a session in more ways than one. What is left is the reading: who is here, and
 * whether that answer has arrived.
 */

import { useOnboardingHost } from "../model/onboarding-host";

export function useRequiredSession() {
  const host = useOnboardingHost();
  const status = host.sessionStatus();
  const user = host.currentUser();
  return {
    data: user ? { user } : null,
    status,
  };
}
