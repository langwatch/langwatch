/**
 * Orgless readers: a new customer to the bootstrap screen, an admin back from an SSO test sign-in
 * to its outcome (specs/identity/sso-activation.feature). Server-answered; null while asked.
 */
export function resolveOrglessDestination({
  isPending,
  isTestArrival,
}: {
  isPending: boolean;
  isTestArrival: boolean;
}): string | null {
  if (isPending) return null;
  if (isTestArrival) return "/auth/sso-test-complete";
  return "/onboarding/welcome";
}
