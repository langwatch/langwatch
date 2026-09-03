import {
  TeamNotFoundError,
  TeamMembershipChangedError,
  TeamSlugConflictError,
  UserNotInOrganizationError,
  type OrganizationTeam,
  type OrganizationTeamPage,
} from "@langwatch/organization-contract";
import { Prisma, type PrismaClient } from "@langwatch/prisma-client/generated";
import { TeamRepository } from "../team.repository";

const teamSelect = {
  id: true,
  name: true,
  slug: true,
  organizationId: true,
  isPersonal: true,
  ownerUserId: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

export class PrismaTeamRepository extends TeamRepository {
  private constructor(private readonly database: PrismaClient) {
    super();
  }

  static create(database: PrismaClient): PrismaTeamRepository {
    return new PrismaTeamRepository(database);
  }

  async get(input: { teamId: string; organizationId: string }): Promise<OrganizationTeam> {
    const team = await this.database.team.findFirst({
      where: {
        id: input.teamId,
        organizationId: input.organizationId,
        archivedAt: null,
      },
      select: teamSelect,
    });
    if (!team) throw new TeamNotFoundError(input.teamId);
    return team;
  }

  async getById(teamId: string): Promise<OrganizationTeam> {
    const team = await this.database.team.findFirst({
      where: { id: teamId, archivedAt: null },
      select: teamSelect,
    });
    if (!team) throw new TeamNotFoundError(teamId);
    return team;
  }

  async tryGetOrganizationId({ teamId }: { teamId: string }): Promise<string | null> {
    const team = await this.database.team.findUnique({
      where: { id: teamId },
      select: { organizationId: true },
    });
    return team?.organizationId ?? null;
  }

  async getBySlug(input: { slug: string; organizationId: string }): Promise<OrganizationTeam> {
    const team = await this.tryFindBySlug(input);
    if (!team) throw new TeamNotFoundError(input.slug);
    return team;
  }

  async list(input: {
    organizationId: string;
    page: number;
    limit: number;
  }): Promise<OrganizationTeamPage> {
    const where = { organizationId: input.organizationId, archivedAt: null };
    const [data, total] = await Promise.all([
      this.database.team.findMany({
        where,
        select: teamSelect,
        skip: (input.page - 1) * input.limit,
        take: input.limit,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      }),
      this.database.team.count({ where }),
    ]);
    return {
      data,
      pagination: { page: input.page, limit: input.limit, total },
    };
  }

  tryFindBySlug(input: { slug: string; organizationId: string }): Promise<OrganizationTeam | null> {
    return this.database.team.findFirst({
      where: {
        slug: input.slug,
        organizationId: input.organizationId,
        archivedAt: null,
      },
      select: teamSelect,
    });
  }

  listActive(input: {
    organizationId: string;
    visibleToUserId?: string;
  }): Promise<OrganizationTeam[]> {
    return this.database.team.findMany({
      where: {
        organizationId: input.organizationId,
        archivedAt: null,
        ...(input.visibleToUserId
          ? {
              OR: [{ isPersonal: false }, { isPersonal: true, ownerUserId: input.visibleToUserId }],
            }
          : {}),
      },
      select: teamSelect,
      orderBy: [{ name: "asc" }, { id: "asc" }],
    });
  }

  async create(input: {
    teamId: string;
    name: string;
    slug: string;
    organizationId: string;
  }): Promise<OrganizationTeam> {
    try {
      return await this.database.team.create({
        data: {
          id: input.teamId,
          name: input.name,
          slug: input.slug,
          organizationId: input.organizationId,
        },
        select: teamSelect,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new TeamSlugConflictError();
      }
      throw error;
    }
  }

  async update(input: {
    teamId: string;
    organizationId: string;
    name?: string;
  }): Promise<OrganizationTeam> {
    const result = await this.database.team.updateMany({
      where: {
        id: input.teamId,
        organizationId: input.organizationId,
        archivedAt: null,
      },
      data: input.name === undefined ? {} : { name: input.name },
    });
    if (result.count === 0) throw new TeamNotFoundError(input.teamId);
    return this.get(input);
  }

  async archive(input: { teamId: string; organizationId: string }): Promise<OrganizationTeam> {
    const result = await this.database.team.updateMany({
      where: {
        id: input.teamId,
        organizationId: input.organizationId,
        archivedAt: null,
      },
      data: { archivedAt: new Date() },
    });
    if (result.count === 0) throw new TeamNotFoundError(input.teamId);
    const team = await this.database.team.findFirst({
      where: { id: input.teamId, organizationId: input.organizationId },
      select: teamSelect,
    });
    if (!team) throw new TeamNotFoundError(input.teamId);
    return team;
  }

  async getOrganizationMembers(input: {
    userIds: string[];
    organizationId: string;
    activeOnly?: boolean;
  }): Promise<string[]> {
    if (input.userIds.length === 0) return [];
    const memberships = await this.database.organizationUser.findMany({
      where: {
        organizationId: input.organizationId,
        userId: { in: input.userIds },
        ...(input.activeOnly ? { disabledAt: null } : {}),
      },
      select: { userId: true },
    });
    const found = new Set(memberships.map(({ userId }) => userId));
    const missing = input.userIds.find((userId) => !found.has(userId));
    if (missing) throw new UserNotInOrganizationError(missing);
    return memberships.map(({ userId }) => userId);
  }

  async memberOrganizationIds(input: {
    userId: string;
    organizationIds: string[];
    activeOnly?: boolean;
  }): Promise<string[]> {
    if (input.organizationIds.length === 0) return [];
    const memberships = await this.database.organizationUser.findMany({
      where: {
        userId: input.userId,
        organizationId: { in: input.organizationIds },
        ...(input.activeOnly === false ? {} : { disabledAt: null }),
      },
      select: { organizationId: true },
    });
    const member = new Set(memberships.map(({ organizationId }) => organizationId));
    return input.organizationIds.filter((organizationId) => member.has(organizationId));
  }

  async fenceMembershipChange(input: {
    teamId: string;
    organizationId: string;
    expectedUpdatedAt: Date;
    name?: string;
    removeLegacyUserId?: string;
  }): Promise<OrganizationTeam> {
    return this.database.$transaction(async (transaction) => {
      const result = await transaction.team.updateMany({
        where: {
          id: input.teamId,
          organizationId: input.organizationId,
          archivedAt: null,
          updatedAt: input.expectedUpdatedAt,
        },
        data: {
          ...(input.name === undefined ? {} : { name: input.name }),
          updatedAt: new Date(),
        },
      });
      if (result.count === 0) {
        throw new TeamMembershipChangedError(input.teamId);
      }
      if (input.removeLegacyUserId) {
        await transaction.teamUser.deleteMany({
          where: {
            teamId: input.teamId,
            userId: input.removeLegacyUserId,
          },
        });
      }
      const team = await transaction.team.findFirst({
        where: {
          id: input.teamId,
          organizationId: input.organizationId,
          archivedAt: null,
        },
        select: teamSelect,
      });
      if (!team) throw new TeamNotFoundError(input.teamId);
      return team;
    });
  }
}
