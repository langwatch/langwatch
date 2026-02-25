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
      const scenarios = await prisma.scenario.findMany({
        where: { id: { in: ids }, projectId },
        select: { id: true, archivedAt: true },
      });

      const lookup = new Map(scenarios.map((s) => [s.id, s]));

      const active: string[] = [];
      const archived: string[] = [];
      const missing: string[] = [];

      for (const id of ids) {
        const scenario = lookup.get(id);
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
      const promptIds = targets
        .filter((t) => t.type === "prompt")
        .map((t) => t.referenceId);
      const agentIds = targets
        .filter((t) => t.type === "http")
        .map((t) => t.referenceId);

      const [prompts, agents] = await Promise.all([
        promptIds.length > 0
          ? prisma.llmPromptConfig.findMany({
              where: {
                id: { in: promptIds },
                deletedAt: null,
                OR: [
                  { projectId },
                  { organizationId, scope: "ORGANIZATION" },
                ],
              },
              select: { id: true },
            })
          : Promise.resolve([]),
        agentIds.length > 0
          ? prisma.agent.findMany({
              where: { id: { in: agentIds }, projectId },
              select: { id: true, archivedAt: true },
            })
          : Promise.resolve([]),
      ]);

      const promptLookup = new Set(prompts.map((p) => p.id));
      const agentLookup = new Map(agents.map((a) => [a.id, a]));

      const active: string[] = [];
      const archived: string[] = [];
      const missing: string[] = [];

      for (const target of targets) {
        if (target.type === "prompt") {
          if (promptLookup.has(target.referenceId)) {
            active.push(target.referenceId);
          } else {
            missing.push(target.referenceId);
          }
        } else if (target.type === "http") {
          const agent = agentLookup.get(target.referenceId);
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
