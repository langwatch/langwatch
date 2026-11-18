/**
 * Whether braids already exist where the reader stands, for the settings menu while
 * `release_braids` is off (Alex, 2026-11-18): an admin must find a braid to end it.
 * Spec: modules/authz/specs/braids-release-flag.feature. Lent to the shell as a capability.
 */

import { useUiHostServices, useUiScope } from "@langwatch/browser-host/capabilities";
import { useUiFlags } from "@langwatch/browser-host/feature-flag";
import { FrontendFlags } from "@langwatch/feature-flag-contract";

import { authzApi } from "./authz-api.ts";

/** Organisation admins ask the whole organisation; anyone else the project in scope. */
export function useBraidsPresent(): boolean {
  const { session } = useUiHostServices();
  const { organizationId, projectId } = useUiScope().activeScope();
  const unreleased = useUiFlags().flag(FrontendFlags.release_braids) === false;
  const seesOrganization =
    organizationId !== null && session.hasOrganizationPermission("organization:manage");

  const organization = authzApi.authz.listOrganizationBraids.useQuery(
    { organizationId: organizationId ?? "" },
    { enabled: unreleased && seesOrganization, retry: false },
  );
  const project = authzApi.authz.listBraids.useQuery(
    { projectId: projectId ?? "" },
    { enabled: unreleased && !seesOrganization && projectId !== null, retry: false },
  );

  if (!unreleased) return false;
  if (seesOrganization) return (organization.data?.length ?? 0) > 0;
  const braids = project.data;
  return !!braids && braids.intoOtherProjects.length + braids.fromOtherProjects.length > 0;
}
