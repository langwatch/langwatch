/**
 * Factory for SuiteRunDependencies.
 *
 * Builds the validation dependencies needed by SuiteService.run()
 * from a PrismaClient instance. Centralizes the database queries
 * that were previously inline in the router.
 */

import type { PrismaClient } from "@prisma/client";
import type { SuiteRunDependencies } from "./suite.service";

/**
 * Look up the organizationId for a project by traversing project -> team -> organization.
 *
 * Returns null if the project does not exist or has no associated organization.
 */
export async function getOrganizationIdForProject({
  prisma,
  projectId,
}: {
  prisma: PrismaClient;
  projectId: string;
}): Promise<string | null> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { team: { include: { organization: true } } },
  });
  return project?.team?.organizationId ?? null;
}

/**
 * Create a SuiteRunDependencies object from a PrismaClient.
 *
 * Encapsulates the Prisma queries for validating scenario and target
 * references, so the router does not need to know the query details.
 */
export function createSuiteRunDependencies({
  prisma,
}: {
  prisma: PrismaClient;
}): SuiteRunDependencies {
  return {
    validateScenarioExists: async ({ id, projectId }) => {
      const scenario = await prisma.scenario.findFirst({
        where: { id, projectId, archivedAt: null },
      });
      return scenario !== null;
    },
    validateTargetExists: async ({ referenceId, type, projectId, organizationId }) => {
      if (type === "prompt") {
        const prompt = await prisma.llmPromptConfig.findFirst({
          where: {
            id: referenceId,
            deletedAt: null,
            OR: [
              { projectId },
              { organizationId, scope: "ORGANIZATION" },
            ],
          },
        });
        return prompt !== null;
      }
      if (type === "http") {
        const agent = await prisma.agent.findFirst({
          where: { id: referenceId, projectId, archivedAt: null },
        });
        return agent !== null;
      }
      return false;
    },
  };
}
