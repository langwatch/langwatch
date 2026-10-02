import type { PrismaClient } from "@langwatch/prisma-client/generated";
import {
  PROJECT_KIND,
  type ProjectApi,
  traceDestinationDecisionSchema,
  traceDestinationInputSchema,
  traceDestinationProjectSchema,
  type TraceDestinationProject,
} from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";

const DESTINATION_SELECT = {
  id: true,
  teamId: true,
  archivedAt: true,
} as const;

/**
 * The Project reads the gateway makes (trace destinations and a project with
 * its team), from seeded rows: mirrors PrismaProjectRepository's queries and
 * resolveTraceDestination's ladder, since gateway depends on the contract only.
 */
export function createTraceDestinationProjects(prisma: PrismaClient): ProjectApi {
  const findLive = async (
    organizationId: string,
    projectId: string,
  ): Promise<TraceDestinationProject | null> => {
    const row = await prisma.project.findFirst({
      where: { id: projectId, team: { organizationId }, archivedAt: null },
      select: DESTINATION_SELECT,
    });
    return row ? traceDestinationProjectSchema.parse(row) : null;
  };

  const findOldestGovernance = async (
    organizationId: string,
  ): Promise<TraceDestinationProject | null> => {
    const row = await prisma.project.findFirst({
      where: {
        kind: PROJECT_KIND.INTERNAL_GOVERNANCE,
        team: { organizationId },
        archivedAt: null,
      },
      select: DESTINATION_SELECT,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    return row ? traceDestinationProjectSchema.parse(row) : null;
  };

  return createApiFixture<ProjectApi>(
    {
      async resolveTraceDestination(input) {
        const parsed = traceDestinationInputSchema.parse(input);
        if (parsed.traceProjectId) {
          const project = await findLive(parsed.organizationId, parsed.traceProjectId);
          return traceDestinationDecisionSchema.parse(
            project ? { outcome: "resolved", project } : { outcome: "unknown" },
          );
        }

        if (parsed.projectScopeIds.length === 1) {
          const project = await findLive(parsed.organizationId, parsed.projectScopeIds[0]!);
          if (project) {
            return traceDestinationDecisionSchema.parse({ outcome: "resolved", project });
          }
        }

        const governance = await findOldestGovernance(parsed.organizationId);
        if (!governance) return { outcome: "no_destination" };

        const alternatives = await prisma.project.count({
          where: {
            team: { organizationId: parsed.organizationId },
            kind: { not: PROJECT_KIND.INTERNAL_GOVERNANCE },
            archivedAt: null,
          },
        });
        return traceDestinationDecisionSchema.parse(
          alternatives > 0
            ? { outcome: "ambiguous", projectScopeCount: parsed.projectScopeIds.length }
            : { outcome: "resolved", project: governance },
        );
      },

      async findWithTeam(id) {
        // The generated row types JSON columns wider than the contract's JSONType;
        // the rows these suites write carry no JSON.
        return (await prisma.project.findUnique({
          where: { id },
          include: { team: true },
        })) as Awaited<ReturnType<ProjectApi["findWithTeam"]>>;
      },

      async findTraceDestination(projectId) {
        const row = await prisma.project.findUnique({
          where: { id: projectId },
          select: DESTINATION_SELECT,
        });
        return row ? traceDestinationProjectSchema.parse(row) : null;
      },

      async listTraceDestinations(projectIds) {
        if (projectIds.length === 0) return [];
        const rows = await prisma.project.findMany({
          where: { id: { in: projectIds } },
          select: DESTINATION_SELECT,
        });
        const byId = new Map(rows.map((row) => [row.id, traceDestinationProjectSchema.parse(row)]));
        return projectIds.flatMap((projectId) => {
          const project = byId.get(projectId);
          return project ? [project] : [];
        });
      },

      async listIdsByOrganization(input) {
        const rows = await prisma.project.findMany({
          where: { team: { organizationId: input.organizationId } },
          select: { id: true },
        });
        return rows.map((row) => row.id);
      },

      async listNamesByIds(input) {
        const rows = await prisma.project.findMany({
          where: { id: { in: input.projectIds } },
          include: { team: { select: { organizationId: true } } },
        });
        return rows.map((row) => ({
          id: row.id,
          name: row.name,
          slug: row.slug,
          teamId: row.teamId,
          organizationId: row.team.organizationId,
          isPersonal: false,
          ownerUserId: null,
        }));
      },
    },
    "TraceDestinationProjects",
  );
}
