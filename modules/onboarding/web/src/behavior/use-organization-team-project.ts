/**
 * Returns organization/project scope from the host with a stable shape to prevent
 * redirect loops and maintain backward compatibility.
 */

import { useOnboardingHost } from "../model/onboarding-host.ts";

export function useOrganizationTeamProject(_options?: {
  redirectToProjectOnboarding?: boolean;
  redirectToOnboarding?: boolean;
  keepFetching?: boolean;
}) {
  const scope = useOnboardingHost().scope();
  return {
    organization: scope.organization,
    organizations: scope.organizations,
    project: scope.project,
    isLoading: scope.isLoading,
    isRefetching: false,
  };
}
