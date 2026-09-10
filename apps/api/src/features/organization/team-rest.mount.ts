/**
 * Binds the teams REST declaration to this process's organization door,
 * with the authorization and project services the family needs to list
 * members and projects.
 */
import type { OrganizationApi } from "@langwatch/organization-contract";
import { createTeamRest } from "@langwatch/organization-server";
import type { AuthzService } from "@langwatch/authz-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import type { MountableRestApp } from "@langwatch/api/rest";

import type { ApiRestRuntime } from "../../app-rest/api-rest.runtime.ts";

/**
 * Mounts `/api/teams` behind this process's organization credential,
 * with the authorization service for member bindings and the project service
 * for team project listings.
 */
export function mountTeamsRest(
  runtime: ApiRestRuntime,
  options: Readonly<{
    organization: () => OrganizationApi;
    authz: () => AuthzService;
    projects: () => ProjectApi;
  }>,
): MountableRestApp {
  const teamRest = createTeamRest({
    authz: options.authz,
    projects: options.projects,
  });

  return runtime.mount(teamRest.router(), options.organization, {});
}
