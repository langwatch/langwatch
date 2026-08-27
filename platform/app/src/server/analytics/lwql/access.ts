import type { FeatureFlagService } from "@langwatch/feature-flag-contract";
import type { ProjectService } from "@langwatch/project-contract";

/**
 * The experimental gate over the whole LangWatchQL surface.
 *
 * One flag, checked server-side at both boundaries, so the browser cannot flip
 * it: the tRPC router's `availability` answers false while it is off — which is
 * what hides the navigation entry and the page — and the REST route refuses
 * outright, so a caller who skips the availability question gets the same
 * answer.
 */
export const LWQL_FLAG = "release_lwql_workbench";

/**
 * Whether the LangWatchQL surface is open to this project.
 *
 * Both boundaries ask through here rather than reading the flag themselves,
 * for two reasons.
 *
 * The organization resolution below is easy to get wrong and expensive to
 * notice: the flag store's organization-scoped rules fail closed when the
 * calling context has no organization, so a gate that omits it leaves a rule
 * enabling the surface for an organization unable to ever match.
 *
 * And the distinct identity is the *project*, never the member. A REST caller
 * is an API key with no member behind it, so it could only ever be the project
 * there; making the workbench differ would let a percentage or distinct-ID
 * rule open Custom query for one member of a project and close it for their
 * teammate — and open the API for a project whose UI is dark, or the reverse.
 * The flag gates a surface, and the surface belongs to the project.
 */
export async function lwqlEnabled({
  featureFlags,
  projectId,
  projects,
}: {
  featureFlags: FeatureFlagService;
  projectId: string;
  projects: ProjectService;
}): Promise<boolean> {
  const organizationId = await projects.getOrganizationId(projectId);

  return featureFlags.isEnabled(LWQL_FLAG, {
    kind: "project",
    projectId,
    organizationId,
  });
}
