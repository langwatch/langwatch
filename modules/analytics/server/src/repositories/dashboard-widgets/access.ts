import { NOT_TARGETED, type FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { ProjectApi } from "@langwatch/project-contract";

/**
 * The gate over the custom-chart-playground surface — page, REST routes and
 * the Langy skill all read this one flag, keyed on the project (a REST
 * caller is an API key with no member), mirroring `lwql/access.ts`'s pattern.
 */
export const CUSTOM_CHART_PLAYGROUND_FLAG = "release_custom_chart_playground";

/**
 * Whether the playground is on for this project. Both collaborators are peer
 * APIs the analytics app already holds: the flag registry answers the
 * targeting question, and the project family answers which organization the
 * project belongs to. It read a monolith `featureFlagService` singleton and
 * a `PrismaClient` until that singleton stopped existing, which left this
 * module unable to answer the question at all — every dashboard-widgets
 * request died on `assertCustomChartPlaygroundEnabled is not callable` and
 * the caller was told "an unknown error occurred" (apidiff run 20260916-r8).
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

  return featureFlags.isEnabled(CUSTOM_CHART_PLAYGROUND_FLAG, {
    distinctId: projectId,
    projectId,
    organizationId: organizationId ?? NOT_TARGETED,
  });
}
