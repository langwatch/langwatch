/**
 * Factory for SuiteRunDependencies.
 *
 * Builds the resolution dependencies needed by SuiteService.run()
 * from a PrismaClient instance. Centralizes the database queries
 * that were previously inline in the router.
 */

import type { PrismaClient } from "@prisma/client";
import type { SuiteRunDependencies } from "./suite.service";

/** Result of resolving a list of references against the database */
export interface ResolvedReferences {
  active: string[];
  archived: string[];
  missing: string[];
}

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
 * Encapsulates the Prisma queries for resolving scenario and target
 * references, so the router does not need to know the query details.
 */
export function createSuiteRunDependencies({
  prisma,
}: {
  prisma: PrismaClient;
}): SuiteRunDependencies {
  return {
    resolveScenarioReferences: async ({ ids, projectId }) => {
      const active: string[] = [];
      const archived: string[] = [];
      const missing: string[] = [];

      for (const id of ids) {
        const scenario = await prisma.scenario.findFirst({
          where: { id, projectId },
          select: { id: true, archivedAt: true },
        });
        if (!scenario) {
          missing.push(id);
        } else if (scenario.archivedAt) {
          archived.push(id);
        } else {
          active.push(id);
        }
      }

      return { active, archived, missing };
    },

    resolveTargetReferences: async ({ targets, projectId, organizationId }) => {
      const active: string[] = [];
      const archived: string[] = [];
      const missing: string[] = [];

      for (const target of targets) {
        if (target.type === "prompt") {
          const prompt = await prisma.llmPromptConfig.findFirst({
            where: {
              id: target.referenceId,
              deletedAt: null,
              OR: [
                { projectId },
                { organizationId, scope: "ORGANIZATION" },
              ],
            },
          });
          if (prompt) {
            active.push(target.referenceId);
          } else {
            missing.push(target.referenceId);
          }
        } else if (target.type === "http") {
          const agent = await prisma.agent.findFirst({
            where: { id: target.referenceId, projectId },
            select: { id: true, archivedAt: true },
          });
          if (!agent) {
            missing.push(target.referenceId);
          } else if (agent.archivedAt) {
            archived.push(target.referenceId);
          } else {
            active.push(target.referenceId);
          }
        } else {
          missing.push(target.referenceId);
        }
      }

      return { active, archived, missing };
    },
  };
}
