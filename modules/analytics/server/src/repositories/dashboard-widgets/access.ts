import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { ProjectApi } from "@langwatch/project-contract";

/**
 * The gate over the custom-chart-playground surface — page, REST routes and
 * the Langy skill all read this one flag, keyed on the project (a REST
 * caller is an API key with no member), mirroring `lwql/access.ts`'s pattern.
 */
export const CUSTOM_CHART_PLAYGROUND_FLAG = "release_custom_chart_playground";

/**
 * Whether the playground is on for this project, over the two peer APIs the
 * analytics app already holds rather than the monolith singleton and Prisma
 * client this read used until that singleton stopped existing.
 */
export async function customChartPlaygroundEnabled({
  featureFlags,
  projects,
  projectId,
}: {
  featureFlags: Pick<FeatureFlagApi, "isEnabled">;
  projects: Pick<ProjectApi, "findOrganizationId">;
  projectId: string;
}): Promise<boolean> {
  const organizationId = await projects.findOrganizationId(projectId);

  // The organization is omitted rather than nulled when the project has none:
  // an absent scope matches no rule naming it, which is the same answer the
  // opted-out marker used to carry, without the second way of spelling it.
  return featureFlags.isEnabled(CUSTOM_CHART_PLAYGROUND_FLAG, {
    kind: "project",
    projectId,
    ...(organizationId ? { organizationId } : {}),
  });
}
