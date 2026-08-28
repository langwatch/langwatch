import {
  type PrismaClient,
  type Project,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import {
  type GrantsLedgerWriter,
  grantsLedgerWriter,
} from "~/server/app-layer/authz/ledger";
import type {
  CreateProjectInput,
  CreateTeamWithBindingInput,
  PaginatedResult,
  PresenceConfig,
  ProjectRepository,
  ProjectWithOrgAdmin,
  ProjectWithTeam,
  SearchProjectsResult,
  TouchCodingAgentActivityInput,
  TraceSharingConfig,
  UpdateProjectInput,
  UpdateProjectMetadataInput,
} from "./project.repository";

export class PrismaProjectRepository implements ProjectRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly writer: GrantsLedgerWriter = grantsLedgerWriter(),
  ) {}

  async getById(id: string): Promise<Project | null> {
    return this.prisma.project.findUnique({ where: { id } });
  }

  async getWithTeam(id: string): Promise<ProjectWithTeam | null> {
    return this.prisma.project.findUnique({
      where: { id, archivedAt: null },
      include: { team: true },
    });
  }

  async updateMetadata({
    id,
    data,
  }: UpdateProjectMetadataInput): Promise<void> {
    await this.prisma.project.update({ where: { id }, data });
  }

  /**
   * `updateMany` rather than `update`, and that is the guard rather than a
   * style choice. `update` addresses one row by its primary key and throws
   * when the extra predicates exclude it, so the "still recent, skip it" case
   * would arrive as an error on the hot path. `updateMany` answers the same
   * question with a count, and the staleness predicate rides in the same
   * statement as the write: two concurrent folds cannot both read "stale" and
   * both write, because there is no read.
   */
  async touchCodingAgentSessionSeen({
    projectId,
    at,
    staleBefore,
  }: TouchCodingAgentActivityInput): Promise<void> {
    await this.prisma.project.updateMany({
      where: {
        id: projectId,
        // An archived project shows no rail links, so a late fold must not
        // stamp activity that would make one look current again.
        archivedAt: null,
        OR: [
          { lastCodingAgentSessionAt: null },
          { lastCodingAgentSessionAt: { lte: staleBefore } },
        ],
      },
      data: { lastCodingAgentSessionAt: at },
    });
  }

  async touchCodingAgentPullRequestSeen({
    projectId,
    at,
    staleBefore,
  }: TouchCodingAgentActivityInput): Promise<void> {
    await this.prisma.project.updateMany({
      where: {
        id: projectId,
        archivedAt: null,
        OR: [
          { lastCodingAgentPullRequestAt: null },
          { lastCodingAgentPullRequestAt: { lte: staleBefore } },
        ],
      },
      data: { lastCodingAgentPullRequestAt: at },
    });
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

  async getTraceSharingConfig(id: string): Promise<TraceSharingConfig | null> {
    const project = await this.prisma.project.findUnique({
      where: { id },
      select: {
        traceSharingEnabled: true,
        team: {
          select: { organization: { select: { traceSharingEnabled: true } } },
        },
      },
    });
    if (!project) return null;
    return {
      orgEnabled: project.team.organization.traceSharingEnabled,
      projectEnabled: project.traceSharingEnabled,
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
    projectIds,
  }: {
    organizationId: string;
    page: number;
    limit: number;
    projectIds?: string[];
  }): Promise<PaginatedResult<Project>> {
    const where = {
      archivedAt: null,
      team: { organizationId },
      kind: { not: "internal_governance" },
      ...(projectIds ? { id: { in: projectIds } } : {}),
    };
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

  async findActiveTeamInOrganization({
    teamId,
    organizationId,
  }: {
    teamId: string;
    organizationId: string;
  }): Promise<{ id: string; isPersonal: boolean } | null> {
    return this.prisma.team.findFirst({
      where: { id: teamId, organizationId, archivedAt: null },
      select: { id: true, isPersonal: true },
    });
  }

  async createTeamWithRoleBinding(
    input: CreateTeamWithBindingInput,
  ): Promise<{ id: string }> {
    const team = await this.prisma.team.create({
      data: {
        id: input.teamId,
        name: input.teamName,
        slug: input.teamSlug,
        organizationId: input.organizationId,
      },
    });

    // The team row is not a grant fact; the creator's admin grant on it is,
    // so it is emitted as a command once the scope it points at exists.
    await this.writer.attachBindings({
      organizationId: input.organizationId,
      bindings: [
        {
          bindingId: input.roleBindingId,
          principal: { userId: input.userId },
          role: TeamUserRole.ADMIN,
          customRoleId: null,
          scopeType: RoleBindingScopeType.TEAM,
          scopeId: team.id,
        },
      ],
      actor: { type: "user", id: input.userId },
      onDuplicate: "skip",
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
