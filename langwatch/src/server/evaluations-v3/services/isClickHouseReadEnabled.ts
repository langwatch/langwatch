import type { PrismaClient } from "@prisma/client";
import { createLogger } from "~/utils/logger/server";

const logger = createLogger("langwatch:evaluations:clickhouse-read-enabled");

/** Set of projectIds for which the misconfiguration warning has already been logged */
const warnedProjects = new Set<string>();

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
    select: {
      featureClickHouseDataSourceEvaluations: true,
      featureEventSourcingEvaluationIngestion: true,
    },
  });

  const readEnabled = project?.featureClickHouseDataSourceEvaluations === true;

  // Warn if read flag is ON but write flag is OFF — CH table may be empty
  if (
    readEnabled &&
    !project?.featureEventSourcingEvaluationIngestion &&
    !warnedProjects.has(projectId)
  ) {
    warnedProjects.add(projectId);
    logger.warn(
      { projectId },
      "ClickHouse read flag (featureClickHouseDataSourceEvaluations) is ON but write flag (featureEventSourcingEvaluationIngestion) is OFF — CH table may be empty, evaluations could show as missing",
    );
  }

  return readEnabled;
}
