import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";

/**
 * The experimental gate over the whole LangWatchQL surface: one flag,
 * checked server-side at both boundaries (tRPC `availability` and the REST
 * route), so the browser can't flip it and skipping the check changes nothing.
 */
export const LWQL_FLAG = "release_lwql_workbench";

/**
 * The experimental gate over the eval functions — the judged columns. Named
 * here rather than imported: LangWatchQL must recognise and refuse eval
 * syntax whether or not the Instant Evals module is installed.
 */
export const INSTANT_EVALS_FLAG = "release_instant_evals";

/**
 * Whether the LangWatchQL surface is open to this project. Both boundaries
 * ask through here: org-scoped rules fail closed with no organization, and
 * the distinct identity is always the *project* — never the member.
 */
export async function lwqlEnabled({
  featureFlags,
  projectId,
  projects,
}: {
  featureFlags: FeatureFlagApi;
  projectId: string;
  projects: ProjectApi;
}): Promise<boolean> {
  const organizationId = await projects.getOrganizationId(projectId);

  return featureFlags.isEnabled(LWQL_FLAG, {
    kind: "project",
    projectId,
    organizationId,
  });
}

/**
 * Whether this project may call an eval function: the flag, or the
 * organization's own switch. The flag is asked first and the switch only
 * when it says no; fails closed when the project names no organization.
 */
export async function instantEvalsEnabled({
  featureFlags,
  projectId,
  projects,
  organizations,
}: {
  featureFlags: FeatureFlagApi;
  projectId: string;
  projects: ProjectApi;
  organizations: Pick<OrganizationApi, "isInstantEvalsOptedIn">;
}): Promise<boolean> {
  const organizationId = await projects.getOrganizationId(projectId);

  const released = await featureFlags.isEnabled(INSTANT_EVALS_FLAG, {
    kind: "project",
    projectId,
    organizationId,
  });
  if (released) return true;
  if (!organizationId) return false;
  return organizations.isInstantEvalsOptedIn({ organizationId });
}
