import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { ProjectApi } from "@langwatch/project-contract";

/**
 * The experimental gate over the whole LangWatchQL surface: one flag,
 * checked server-side at both boundaries (tRPC `availability` and the REST
 * route), so the browser can't flip it and skipping the check changes nothing.
 */
export const LWQL_FLAG = "release_lwql_workbench";

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
