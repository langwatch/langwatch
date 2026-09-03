/**
 * The scope reading these screens have always made, answered by the host.
 *
 * `useOrganizationTeamProject` is the application's hook and a feature-web
 * package may not import it, but every call site here destructures the same four
 * fields — `organization`, `organizations`, `project` and `isLoading`. Keeping
 * the NAME and the SHAPE is what let those call sites move without an edit.
 *
 * The application hook also redirected a reader with no organization into
 * onboarding. That is landing policy and belongs to whatever serves the address
 * — and on THESE addresses it would be a loop, since this is where such a reader
 * is being sent. It did not travel; the options object is accepted and ignored
 * so a call site that passed one still compiles.
 */

import { useOnboardingHost } from "../model/onboarding-host";

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
