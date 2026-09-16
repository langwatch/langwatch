import { NOT_TARGETED } from "@langwatch/feature-flag-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
// TODO(merge-analytics-port): `featureFlagService` is a monolith singleton with
// no module-shape equivalent. Escalated in .claude/handoffs/merge-analytics-port.md —
// resolving it changes this function's signature, and modules/trace owns the caller.
import { featureFlagService } from "~/server/featureFlag";

/**
 * The gate over the custom-chart-playground surface — page, REST routes and
 * the Langy skill all read this one flag, keyed on the project (a REST
 * caller is an API key with no member), mirroring `lwql/access.ts`'s pattern.
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
