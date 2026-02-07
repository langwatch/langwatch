import type { PrismaClient } from "@prisma/client";
import type { ExperimentRunWorkflowVersion } from "./types";

/**
 * Fetch workflow version metadata from Prisma for a set of version IDs.
 *
 * Shared between ClickHouse and Elasticsearch experiment run backends
 * to avoid duplication.
 *
 * @param prisma - PrismaClient instance
 * @param projectId - The project ID to scope the query
 * @param versionIds - Array of workflow version IDs to look up
 * @returns Map of version ID to workflow version metadata
 */
export async function getVersionMap(
  prisma: PrismaClient,
  projectId: string,
  versionIds: string[],
): Promise<Record<string, ExperimentRunWorkflowVersion>> {
  if (versionIds.length === 0) {
    return {};
  }

  const versions = await prisma.workflowVersion.findMany({
    where: {
      projectId,
      id: { in: versionIds },
    },
    select: {
      id: true,
      version: true,
      commitMessage: true,
      author: {
        select: {
          name: true,
          image: true,
        },
      },
    },
  });

  const versionsMap: Record<string, (typeof versions)[number]> = {};
  for (const version of versions) {
    versionsMap[version.id] = version;
  }

  return versionsMap;
}
