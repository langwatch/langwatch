import type { PrismaClient } from "~/generated/prisma/client";
import { featureFlagService } from "~/server/featureFlag";
import { NOT_TARGETED } from "~/server/featureFlag/targeting";

/**
 * The gate over the custom-chart-playground surface: the page, its REST
 * routes, and the Langy skill that drives them all read the same flag, so
 * "can I use this feature" answers identically everywhere.
 *
 * Mirrors `~/server/analytics/lwql/access.ts`'s `LWQL_FLAG`/`lwqlEnabled`
 * pattern exactly, for the same reasons: one flag read in one place, keyed
 * on the project (a REST caller is an API key with no member behind it, so
 * the project is the only identity that can be distinct here), with the
 * project's organization resolved so an org-scoped targeting rule actually
 * matches.
 */
export const CUSTOM_CHART_PLAYGROUND_FLAG = "release_custom_chart_playground";

export async function customChartPlaygroundEnabled({
  prisma,
  projectId,
}: {
  prisma: PrismaClient;
  projectId: string;
}): Promise<boolean> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { team: { select: { organizationId: true } } },
  });
  const organizationId = project?.team?.organizationId;

  return featureFlagService.isEnabled(CUSTOM_CHART_PLAYGROUND_FLAG, {
    distinctId: projectId,
    projectId,
    organizationId: organizationId ?? NOT_TARGETED,
  });
}
