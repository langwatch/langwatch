import { RoleBindingScopeType, TeamUserRole, type PrismaClient, type Project } from "@prisma/client";
import type {
  CreateProjectInput,
  CreateTeamWithBindingInput,
  PaginatedResult,
  PresenceConfig,
  ProjectRepository,
  ProjectWithOrgAdmin,
  ProjectWithTeam,
  SearchProjectsResult,
  UpdateProjectInput,
  UpdateProjectMetadataInput,
} from "./project.repository";

export class PrismaProjectRepository implements ProjectRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async getById(id: string): Promise<Project | null> {
    return this.prisma.project.findUnique({ where: { id } });
  }

  async getWithTeam(id: string): Promise<ProjectWithTeam | null> {
    return this.prisma.project.findUnique({
      where: { id, archivedAt: null },
      include: { team: true },
    });
  }

  async updateMetadata({ id, data }: UpdateProjectMetadataInput): Promise<void> {
    await this.prisma.project.update({ where: { id }, data });
  }

  async getWithOrgAdmin(id: string): Promise<ProjectWithOrgAdmin | null> {
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

    const org = project.team?.organization;
    return {
      firstMessage: project.firstMessage,
      organizationId: org?.id ?? null,
      adminUserId: org?.members?.[0]?.userId ?? null,
    };
  }

  async getPresenceConfig(id: string): Promise<PresenceConfig | null> {
    const project = await this.prisma.project.findUnique({
      where: { id },
      select: {
        presenceEnabled: true,
        team: {
          select: { organization: { select: { presenceEnabled: true } } },
        },
      },
    });
    if (!project) return null;
    return {
      orgEnabled: project.team.organization.presenceEnabled,
      projectEnabled: project.presenceEnabled,
    };
  }

  async searchByQuery({
    query,
    organizationId,
    limit = 20,
  }: {
    query: string;
    organizationId?: string;
    limit?: number;
  }): Promise<SearchProjectsResult[]> {
    const where: Record<string, unknown> = {
      OR: [
        { id: { contains: query } },
        { name: { contains: query, mode: "insensitive" } },
        { slug: { contains: query, mode: "insensitive" } },
      ],
    };

    if (organizationId) {
      where.team = { organizationId };
    }

    return this.prisma.project.findMany({
      where,
      select: { id: true, name: true, slug: true },
      take: limit,
    });
  }

  async create(data: CreateProjectInput): Promise<Project> {
    return this.prisma.project.create({ data });
  }

  async update({
    id,
    organizationId,
    data,
  }: {
    id: string;
    organizationId: string;
    data: UpdateProjectInput;
  }): Promise<Project | null> {
    const where = { id, archivedAt: null, team: { organizationId } };
    const result = await this.prisma.project.updateMany({ where, data });
    if (result.count === 0) return null;
    return this.prisma.project.findUnique({ where: { id } });
  }

  async archive({
    id,
    organizationId,
  }: {
    id: string;
    organizationId: string;
  }): Promise<Project | null> {
    const where = { id, archivedAt: null, team: { organizationId } };
    const result = await this.prisma.project.updateMany({
      where,
      data: { archivedAt: new Date() },
    });
    if (result.count === 0) return null;
    return this.prisma.project.findUnique({ where: { id } });
  }

  async findAllByOrganization({
    organizationId,
    page,
    limit,
  }: {
    organizationId: string;
    page: number;
    limit: number;
  }): Promise<PaginatedResult<Project>> {
    const where = { archivedAt: null, team: { organizationId } };
    const [data, total] = await Promise.all([
      this.prisma.project.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      }),
      this.prisma.project.count({ where }),
    ]);
    return { data, pagination: { page, limit, total } };
  }

  async findBySlugInTeam({
    slug,
    teamId,
  }: {
    slug: string;
    teamId: string;
  }): Promise<Project | null> {
    return this.prisma.project.findFirst({ where: { slug, teamId } });
  }

  async teamBelongsToOrganization({
    teamId,
    organizationId,
  }: {
    teamId: string;
    organizationId: string;
  }): Promise<boolean> {
    const team = await this.prisma.team.findFirst({
      where: { id: teamId, organizationId },
      select: { id: true },
    });
    return !!team;
  }

  async findActiveTeamInOrganization({
    teamId,
    organizationId,
  }: {
    teamId: string;
    organizationId: string;
  }): Promise<{ id: string } | null> {
    return this.prisma.team.findFirst({
      where: { id: teamId, organizationId, archivedAt: null },
      select: { id: true },
    });
  }

  async createTeamWithRoleBinding(input: CreateTeamWithBindingInput): Promise<{ id: string }> {
    const team = await this.prisma.team.create({
      data: {
        id: input.teamId,
        name: input.teamName,
        slug: input.teamSlug,
        organizationId: input.organizationId,
      },
    });

    await this.prisma.roleBinding.create({
      data: {
        id: input.roleBindingId,
        organizationId: input.organizationId,
        userId: input.userId,
        role: TeamUserRole.ADMIN,
        scopeType: RoleBindingScopeType.TEAM,
        scopeId: team.id,
      },
    });

    return team;
  }

  async createTeam(input: {
    teamId: string;
    teamName: string;
    teamSlug: string;
    organizationId: string;
  }): Promise<{ id: string }> {
    return this.prisma.team.create({
      data: {
        id: input.teamId,
        name: input.teamName,
        slug: input.teamSlug,
        organizationId: input.organizationId,
      },
    });
  }
}
