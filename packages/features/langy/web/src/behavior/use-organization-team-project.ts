/**
 * The scope reading the dock has always made, answered by the host.
 *
 * `useOrganizationTeamProject` is the application's hook and a feature-web
 * package may not import it, but every call site in this package destructures
 * the same fields. Keeping the NAME and the SHAPE is what let sixteen call
 * sites move without an edit; what changed is where the answer comes from.
 *
 * The application hook also redirected to onboarding. That is landing policy,
 * it belongs to whatever serves the address, and it did not travel — the
 * options object is accepted and ignored so a call site that passed one still
 * compiles.
 */

import { useLangyHost } from "../model/langy-host";

export function useOrganizationTeamProject(_options?: {
  redirectToProjectOnboarding?: boolean;
  redirectToOnboarding?: boolean;
  keepFetching?: boolean;
}) {
  const host = useLangyHost();
  const project = host.project();
  return {
    project,
    /** The platform hook published it flat as well, and call sites read it that way. */
    projectId: project?.id,
    organization: host.organization(),
    team: host.team(),
    organizationRole: host.organizationRole(),
    isDemoProject: host.isDemoProject(),
    hasPermission: (permission: string) => host.hasPermission(permission),
    /**
     * A grant asked ABOUT THE ORGANIZATION rather than the project.
     *
     * The application hook evaluated it against the organization scope; the
     * session capability resolves grants for the scope the reader is in, which
     * for these two call sites — "may this reader manage the plan" — is the
     * same answer. Recorded rather than hidden: a grant held on the
     * organization but not on the project would read as absent here.
     */
    hasOrgPermission: (permission: string) => host.hasPermission(permission),
    isLoading: host.isLoading(),
    isRefetching: false,
  };
}
