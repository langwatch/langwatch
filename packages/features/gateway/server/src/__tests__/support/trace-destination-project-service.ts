import type { PrismaClient } from "@langwatch/prisma-client/generated";
import {
  PROJECT_KIND,
  traceDestinationDecisionSchema,
  traceDestinationInputSchema,
  traceDestinationProjectSchema,
  type TraceDestinationDecision,
  type TraceDestinationInput,
  type TraceDestinationProject,
} from "@langwatch/project-contract";
import { TestProjectService } from "./test-project-service";

const DESTINATION_SELECT = {
  id: true,
  teamId: true,
  apiKey: true,
  archivedAt: true,
} as const;

/**
 * The trace-destination half of the Project contract, from seeded rows —
 * mirrors PrismaProjectRepository's queries and resolveTraceDestination's
 * ladder, since gateway-server depends on the Project CONTRACT only.
 */
export class TraceDestinationProjectService extends TestProjectService {
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

  override async tryGetTraceDestination(
    projectId: string,
  ): Promise<TraceDestinationProject | null> {
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
