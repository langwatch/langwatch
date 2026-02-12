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
    validateTargetExists: async ({ referenceId, type, projectId }) => {
      if (type === "prompt") {
        const prompt = await prisma.llmPromptConfig.findFirst({
          where: { id: referenceId, projectId, deletedAt: null },
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
