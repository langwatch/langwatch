/**
 * The scope reading the explorer has always made, answered by the host.
 *
 * `useOrganizationTeamProject` is the application's hook and a feature-web
 * package may not import it, but every call site in this package destructures the
 * same six fields — `project`, `organization`, `team`, `organizationRole`,
 * `hasPermission` and `isLoading`. Keeping the NAME and the SHAPE is what let those call sites move
 * without an edit; what changed is where the answer comes from.
 *
 * The application hook also redirected to onboarding and bounced a reader with
 * no organization. That is landing policy, it belongs to whatever serves the
 * address, and it did not travel — the options object is accepted and ignored
 * so a call site that passed one still compiles.
 */

import { useTraceHost } from "./trace-host";

export function useOrganizationTeamProject(_options?: {
  redirectToProjectOnboarding?: boolean;
  redirectToOnboarding?: boolean;
  keepFetching?: boolean;
}) {
  const host = useTraceHost();
  const project = host.project();
  return {
    project,
    organization: host.organization(),
    team: host.team(),
    organizationRole: host.organizationRole(),
    hasPermission: (permission: string) => host.hasPermission(permission),
    isLoading: host.isLoading(),
    isRefetching: false,
  };
}
