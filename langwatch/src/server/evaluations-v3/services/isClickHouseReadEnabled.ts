import type { PrismaClient } from "@prisma/client";

/**
 * Check if the ClickHouse read path is enabled for evaluations data.
 *
 * Uses the `featureClickHouseDataSourceEvaluations` project flag.
 * Shared between ClickHouseExperimentRunService and ClickHouseEvaluationService.
 *
 * Note: This is the **read** flag. The **write** flag
 * (`featureEventSourcingEvaluationIngestion`) is checked in dispatch.ts separately.
 */
export async function isClickHouseReadEnabled(
  prisma: PrismaClient,
  projectId: string,
): Promise<boolean> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { featureClickHouseDataSourceEvaluations: true },
  });

  return project?.featureClickHouseDataSourceEvaluations === true;
}
