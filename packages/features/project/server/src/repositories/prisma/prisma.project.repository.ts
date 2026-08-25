import {
  Prisma,
  type PrismaClient,
  type Project as PrismaProject,
  type Team as PrismaTeam,
} from "@langwatch/prisma-client/generated";
import {
  PROJECT_KIND,
  ProjectNotFoundError,
  internalProjectSchema,
  projectSchema,
  teamSchema,
  type ActiveProjectsByScopesInput,
  type CreateProjectInput,
  type InternalProject,
  type PaginatedProjects,
  type Project,
  type ProjectWithTeam,
  type SearchProjectsResult,
  type TraceSharingConfig,
  type UpdateProjectInput,
  type UpdateProjectMetadataInput,
} from "@langwatch/project-contract";
import type { ProjectDatabase } from "../../ports/project.port";
import {
  ProjectRepository,
  type ProjectWithOrgAdmin,
  type TouchCodingAgentActivityInput,
} from "../project.repository";

export class PrismaProjectRepository extends ProjectRepository {
  private constructor(private readonly prisma: PrismaClient) {
    super();
  }

  static create(database: ProjectDatabase): PrismaProjectRepository {
    return new PrismaProjectRepository(database as PrismaClient);
  }

  async tryFindInternalByOrganization(
    organizationId: string,
  ): Promise<InternalProject | null> {
    return this.mapInternal(
      await this.prisma.project.findFirst({
        where: {
          kind: PROJECT_KIND.INTERNAL_GOVERNANCE,
          team: { organizationId },
          archivedAt: null,
        },
      }),
    );
  }

  async tryFindInternalBySlug(slug: string): Promise<InternalProject | null> {
    return this.mapInternal(await this.prisma.project.findUnique({ where: { slug } }));
  }

  async createInternalOrFindWinner(input: {
    id: string;
    name: string;
    slug: string;
    apiKey: string;
    teamId: string;
  }): Promise<InternalProject> {
    try {
      return this.mapInternalRequired(
        await this.prisma.project.create({
          data: {
            ...input,
            kind: PROJECT_KIND.INTERNAL_GOVERNANCE,
            language: "internal",
            framework: "governance",
            traceSharingEnabled: false,
          },
        }),
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const winner = await this.prisma.project.findUnique({
          where: { slug: input.slug },
        });
        const mapped = this.mapInternal(winner);
        if (mapped) return mapped;
      }
      throw error;
    }
  }

  async isPresenceEnabled(projectId: string): Promise<boolean> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: {
        presenceEnabled: true,
        team: { select: { organization: { select: { presenceEnabled: true } } } },
      },
    });
    return Boolean(project?.presenceEnabled && project.team.organization.presenceEnabled);
  }

  async tryGetById(id: string): Promise<Project | null> {
    return this.mapProject(await this.prisma.project.findUnique({ where: { id } }));
  }

  async tryGetWithTeam(id: string): Promise<ProjectWithTeam | null> {
    const row = await this.prisma.project.findUnique({
      where: { id, archivedAt: null },
      include: { team: true },
    });
    if (!row) return null;
    const { team, ...projectRow } = row;
    return {
      ...this.mapProjectRequired(projectRow),
      team: this.mapTeamRequired(team),
    };
  }

  async updateMetadata({ id, data }: UpdateProjectMetadataInput): Promise<void> {
    await this.prisma.project.update({ where: { id }, data });
  }

  async touchCodingAgentSessionSeen(input: TouchCodingAgentActivityInput): Promise<void> {
    await this.prisma.project.updateMany({
      where: {
        id: input.projectId,
        archivedAt: null,
        OR: [
          { lastCodingAgentSessionAt: null },
          { lastCodingAgentSessionAt: { lte: input.staleBefore } },
        ],
      },
      data: { lastCodingAgentSessionAt: input.at },
    });
  }

  async touchCodingAgentPullRequestSeen(
    input: TouchCodingAgentActivityInput,
  ): Promise<void> {
    await this.prisma.project.updateMany({
      where: {
        id: input.projectId,
        archivedAt: null,
        OR: [
          { lastCodingAgentPullRequestAt: null },
          { lastCodingAgentPullRequestAt: { lte: input.staleBefore } },
        ],
      },
      data: { lastCodingAgentPullRequestAt: input.at },
    });
  }

  async tryGetWithOrgAdmin(id: string): Promise<ProjectWithOrgAdmin | null> {
    const project = await this.prisma.project.findUnique({
      where: { id },
      select: {
        firstMessage: true,
        team: {
          select: {
            organization: {
              select: {
                id: true,
                members: {
                  where: { role: "ADMIN" },
                  select: { userId: true },
                  orderBy: { createdAt: "asc" },
                  take: 1,
                },
              },
            },
          },
        },
      },
    });
    if (!project) return null;
    return {
      firstMessage: project.firstMessage,
      organizationId: project.team?.organization?.id ?? null,
      adminUserId: project.team?.organization?.members?.[0]?.userId ?? null,
    };
  }

  async tryGetTraceSharingConfig(id: string): Promise<TraceSharingConfig | null> {
    const project = await this.prisma.project.findUnique({
      where: { id },
      select: {
        traceSharingEnabled: true,
        team: { select: { organization: { select: { traceSharingEnabled: true } } } },
      },
    });
    if (!project) return null;
    return {
      orgEnabled: project.team.organization.traceSharingEnabled,
      projectEnabled: project.traceSharingEnabled,
    };
  }

  async searchByQuery(input: {
    query: string;
    organizationId?: string;
    limit?: number;
  }): Promise<SearchProjectsResult[]> {
    const where: Record<string, unknown> = {
      OR: [
        { id: { contains: input.query } },
        { name: { contains: input.query, mode: "insensitive" } },
        { slug: { contains: input.query, mode: "insensitive" } },
      ],
    };
    if (input.organizationId) where.team = { organizationId: input.organizationId };
    return this.prisma.project.findMany({
      where,
      select: { id: true, name: true, slug: true },
      take: input.limit ?? 20,
    });
  }

  async create(input: CreateProjectInput): Promise<Project> {
    return this.mapProjectRequired(await this.prisma.project.create({ data: input }));
  }

  async update(input: {
    id: string;
    organizationId: string;
    data: UpdateProjectInput;
  }): Promise<Project> {
    const result = await this.prisma.project.updateMany({
      where: {
        id: input.id,
        archivedAt: null,
        team: { organizationId: input.organizationId },
      },
      data: input.data,
    });
    if (result.count === 0) throw new ProjectNotFoundError("Project not found");
    return this.mapProjectRequired(
      await this.prisma.project.findUniqueOrThrow({ where: { id: input.id } }),
    );
  }

  async archive(input: { id: string; organizationId: string }): Promise<Project> {
    const result = await this.prisma.project.updateMany({
      where: {
        id: input.id,
        archivedAt: null,
        team: { organizationId: input.organizationId },
      },
      data: { archivedAt: new Date() },
    });
    if (result.count === 0) throw new ProjectNotFoundError("Project not found");
    return this.mapProjectRequired(
      await this.prisma.project.findUniqueOrThrow({ where: { id: input.id } }),
    );
  }

  async findAllByOrganization(input: {
    organizationId: string;
    page: number;
    limit: number;
    projectIds?: string[];
  }): Promise<PaginatedProjects> {
    const where = {
      archivedAt: null,
      team: { organizationId: input.organizationId },
      ...(input.projectIds ? { id: { in: input.projectIds } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.project.findMany({
        where,
        skip: (input.page - 1) * input.limit,
        take: input.limit,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      }),
      this.prisma.project.count({ where }),
    ]);
    return {
      data: rows.map((row) => this.mapProjectRequired(row)),
      pagination: { page: input.page, limit: input.limit, total },
    };
  }

  async findAllByTeam(input: {
    organizationId: string;
    teamId: string;
  }): Promise<Project[]> {
    const rows = await this.prisma.project.findMany({
      where: {
        teamId: input.teamId,
        archivedAt: null,
        kind: { not: PROJECT_KIND.INTERNAL_GOVERNANCE },
        team: { organizationId: input.organizationId },
      },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row) => this.mapProjectRequired(row));
  }

  async findActiveByScopes(input: ActiveProjectsByScopesInput): Promise<Project[]> {
    const rows = await this.prisma.project.findMany({
      where: {
        archivedAt: null,
        team: { organizationId: input.organizationId },
        ...(input.organizationWide
          ? {}
          : {
              OR: [
                ...(input.projectIds.length > 0
                  ? [{ id: { in: input.projectIds } }]
                  : []),
                ...(input.teamIds.length > 0 ? [{ teamId: { in: input.teamIds } }] : []),
              ],
            }),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.limit + 1,
    });
    return rows.map((row) => this.mapProjectRequired(row));
  }

  async tryFindBySlugInTeam(input: {
    slug: string;
    teamId: string;
  }): Promise<Project | null> {
    return this.mapProject(await this.prisma.project.findFirst({ where: input }));
  }

  tryFindActiveTeamInOrganization(input: {
    teamId: string;
    organizationId: string;
  }): Promise<{ id: string; isPersonal: boolean } | null> {
    return this.prisma.team.findFirst({
      where: { id: input.teamId, organizationId: input.organizationId, archivedAt: null },
      select: { id: true, isPersonal: true },
    });
  }
  private mapProject(row: PrismaProject | null): Project | null {
    return row ? projectSchema.parse(row) : null;
  }

  private mapProjectRequired(row: PrismaProject): Project {
    return projectSchema.parse(row);
  }

  private mapTeamRequired(row: PrismaTeam) {
    return teamSchema.parse(row);
  }

  private mapInternal(row: PrismaProject | null): InternalProject | null {
    if (!row || row.kind !== PROJECT_KIND.INTERNAL_GOVERNANCE) return null;
    return this.mapInternalRequired(row);
  }

  private mapInternalRequired(row: PrismaProject): InternalProject {
    return internalProjectSchema.parse({
      id: row.id,
      name: row.name,
      slug: row.slug,
      teamId: row.teamId,
      kind: row.kind,
      archivedAtMs: row.archivedAt?.getTime() ?? null,
      traceSharingEnabled: row.traceSharingEnabled,
    });
  }
}
