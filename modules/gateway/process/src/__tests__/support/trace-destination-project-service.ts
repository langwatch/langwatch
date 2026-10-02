import type { PrismaClient } from "@langwatch/prisma-client/generated";
import {
  PROJECT_KIND,
  type ProjectApi,
  traceDestinationDecisionSchema,
  traceDestinationInputSchema,
  traceDestinationProjectSchema,
  type TraceDestinationDecision,
  type TraceDestinationInput,
  type TraceDestinationProject,
} from "@langwatch/project-contract";

import { TestProjectApi } from "./test-project-api.ts";

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
export class TraceDestinationProjectService extends TestProjectApi {
  constructor(private readonly prisma: PrismaClient) {
    super();
  }

  override async resolveTraceDestination(
    input: TraceDestinationInput,
  ): Promise<TraceDestinationDecision> {
    const parsed = traceDestinationInputSchema.parse(input);
    if (parsed.traceProjectId) {
      const project = await this.findLive(parsed.organizationId, parsed.traceProjectId);
      return traceDestinationDecisionSchema.parse(
        project ? { outcome: "resolved", project } : { outcome: "unknown" },
      );
    }

    if (parsed.projectScopeIds.length === 1) {
      const project = await this.findLive(parsed.organizationId, parsed.projectScopeIds[0]!);
      if (project) {
        return traceDestinationDecisionSchema.parse({ outcome: "resolved", project });
      }
    }

    const governance = await this.findOldestGovernance(parsed.organizationId);
    if (!governance) return { outcome: "no_destination" };

    const alternatives = await this.prisma.project.count({
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
  }

  override async findWithTeam(id: string): ReturnType<ProjectApi["findWithTeam"]> {
    // The generated row types JSON columns wider than the contract's JSONType;
    // the rows these suites write carry no JSON.
    return (await this.prisma.project.findUnique({
      where: { id },
      include: { team: true },
    })) as Awaited<ReturnType<ProjectApi["findWithTeam"]>>;
  }

  override async findTraceDestination(projectId: string): Promise<TraceDestinationProject | null> {
    const row = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: DESTINATION_SELECT,
    });
    return row ? traceDestinationProjectSchema.parse(row) : null;
  }

  override async listTraceDestinations(projectIds: string[]): Promise<TraceDestinationProject[]> {
    if (projectIds.length === 0) return [];
    const rows = await this.prisma.project.findMany({
      where: { id: { in: projectIds } },
      select: DESTINATION_SELECT,
    });
    const byId = new Map(rows.map((row) => [row.id, traceDestinationProjectSchema.parse(row)]));
    return projectIds.flatMap((projectId) => {
      const project = byId.get(projectId);
      return project ? [project] : [];
    });
  }

  override async listIdsByOrganization(
    input: Parameters<ProjectApi["listIdsByOrganization"]>[0],
  ): ReturnType<ProjectApi["listIdsByOrganization"]> {
    const rows = await this.prisma.project.findMany({
      where: { team: { organizationId: input.organizationId } },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  override async listNamesByIds(
    input: Parameters<ProjectApi["listNamesByIds"]>[0],
  ): ReturnType<ProjectApi["listNamesByIds"]> {
    const rows = await this.prisma.project.findMany({
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
  }

  private async findLive(
    organizationId: string,
    projectId: string,
  ): Promise<TraceDestinationProject | null> {
    const row = await this.prisma.project.findFirst({
      where: { id: projectId, team: { organizationId }, archivedAt: null },
      select: DESTINATION_SELECT,
    });
    return row ? traceDestinationProjectSchema.parse(row) : null;
  }

  private async findOldestGovernance(
    organizationId: string,
  ): Promise<TraceDestinationProject | null> {
    const row = await this.prisma.project.findFirst({
      where: {
        kind: PROJECT_KIND.INTERNAL_GOVERNANCE,
        team: { organizationId },
        archivedAt: null,
      },
      select: DESTINATION_SELECT,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    return row ? traceDestinationProjectSchema.parse(row) : null;
  }
}
