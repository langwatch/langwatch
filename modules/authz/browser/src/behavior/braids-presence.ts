/**
 * Whether braids exist where the reader stands, for the settings menu while `release_braids`
 * is off (Alex, 2026-11-18; braids-release-flag.feature). The shell renders it outside the
 * authz screens' client, so it reads through the host's rpc.
 */

import { trpcQueryKey } from "@langwatch/api/web";
import { useUiHostServices, useUiRpc, useUiScope } from "@langwatch/browser-host/capabilities";
import { useUiFlags } from "@langwatch/browser-host/feature-flag";
import { FrontendFlags } from "@langwatch/feature-flag-contract";
import { useQuery } from "@tanstack/react-query";

const ORGANIZATION_BRAIDS_PROCEDURE = "authz.listOrganizationBraids";
const PROJECT_BRAIDS_PROCEDURE = "authz.listBraids";

type ProjectBraidsRead = { intoOtherProjects: unknown[]; fromOtherProjects: unknown[] };

/** Organisation admins ask the whole organisation; anyone else the project in scope. */
export function useBraidsPresent(): boolean {
  const { session } = useUiHostServices();
  const rpc = useUiRpc();
  const { organizationId, projectId } = useUiScope().activeScope();
  const unreleased = useUiFlags().flag(FrontendFlags.release_braids) === false;
  const seesOrganization =
    unreleased &&
    organizationId !== null &&
    session.hasOrganizationPermission("organization:manage");

  const organizationInput = { organizationId: organizationId ?? "" };
  const organization = useQuery({
    queryKey: trpcQueryKey(ORGANIZATION_BRAIDS_PROCEDURE, {
      input: organizationInput,
      type: "query",
    }),
    queryFn: () =>
      rpc.query(ORGANIZATION_BRAIDS_PROCEDURE, organizationInput) as Promise<unknown[]>,
    enabled: unreleased && seesOrganization,
    retry: false,
  });
  const projectInput = { projectId: projectId ?? "" };
  const project = useQuery({
    queryKey: trpcQueryKey(PROJECT_BRAIDS_PROCEDURE, { input: projectInput, type: "query" }),
    queryFn: () => rpc.query(PROJECT_BRAIDS_PROCEDURE, projectInput) as Promise<ProjectBraidsRead>,
    enabled: unreleased && !seesOrganization && projectId !== null,
    retry: false,
  });

  if (!unreleased) return false;
  if (seesOrganization) return (organization.data?.length ?? 0) > 0;
  const braids = project.data;
  return !!braids && braids.intoOtherProjects.length + braids.fromOtherProjects.length > 0;
}
