import {
  TeamMembershipChangedError,
  TeamNotFoundError,
  TeamSlugConflictError,
  UserNotInOrganizationError,
  type OrganizationTeam,
  type OrganizationTeamPage,
} from "@langwatch/organization-contract";
import { TeamRepository } from "../team.repository.ts";
import type { MemoryOrganizationDatabase, MemoryTeamRow } from "./memory.organization.database.ts";

function toOrganizationTeam(row: MemoryTeamRow): OrganizationTeam {
  return { ...row };
}

/** In-memory `TeamRepository`, for tests and a memory-backed boot. */
export class MemoryTeamRepository extends TeamRepository {
  private constructor(private readonly memory: MemoryOrganizationDatabase) {
    super();
  }

  static create(options: { memory: MemoryOrganizationDatabase }): MemoryTeamRepository {
    return new MemoryTeamRepository(options.memory);
  }

  async get(input: { teamId: string; organizationId: string }): Promise<OrganizationTeam> {
    const team = this.memory.teams.get(input.teamId);
    if (!team || team.organizationId !== input.organizationId || team.archivedAt) {
      throw new TeamNotFoundError(input.teamId);
    }
    return toOrganizationTeam(team);
  }

  async getById(teamId: string): Promise<OrganizationTeam> {
    const team = this.memory.teams.get(teamId);
    if (!team || team.archivedAt) throw new TeamNotFoundError(teamId);
    return toOrganizationTeam(team);
  }

  async tryGetOrganizationId(input: { teamId: string }): Promise<string | null> {
    return this.memory.teams.get(input.teamId)?.organizationId ?? null;
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
    const all = this.activeTeamsOf(input.organizationId).sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
    const start = (input.page - 1) * input.limit;
    return {
      data: all.slice(start, start + input.limit).map(toOrganizationTeam),
      pagination: { page: input.page, limit: input.limit, total: all.length },
    };
  }

  async tryFindBySlug(input: {
    slug: string;
    organizationId: string;
  }): Promise<OrganizationTeam | null> {
    const team = this.activeTeamsOf(input.organizationId).find((row) => row.slug === input.slug);
    return team ? toOrganizationTeam(team) : null;
  }

  async listActive(input: {
    organizationId: string;
    visibleToUserId?: string;
  }): Promise<OrganizationTeam[]> {
    return this.activeTeamsOf(input.organizationId)
      .filter(
        (team) =>
          !input.visibleToUserId || !team.isPersonal || team.ownerUserId === input.visibleToUserId,
      )
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(toOrganizationTeam);
  }

  async create(input: {
    teamId: string;
    name: string;
    slug: string;
    organizationId: string;
  }): Promise<OrganizationTeam> {
    const duplicate = this.activeTeamsOf(input.organizationId).find(
      (row) => row.slug === input.slug,
    );
    if (duplicate) throw new TeamSlugConflictError();
    const now = new Date();
    const team: MemoryTeamRow = {
      id: input.teamId,
      name: input.name,
      slug: input.slug,
      organizationId: input.organizationId,
      isPersonal: false,
      ownerUserId: null,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.memory.teams.set(team.id, team);
    return toOrganizationTeam(team);
  }

  async update(input: {
    teamId: string;
    organizationId: string;
    name?: string;
  }): Promise<OrganizationTeam> {
    const team = await this.get(input);
    const row = this.memory.teams.get(team.id);
    if (!row) throw new TeamNotFoundError(input.teamId);
    if (input.name !== undefined) row.name = input.name;
    row.updatedAt = new Date();
    return toOrganizationTeam(row);
  }

  async archive(input: { teamId: string; organizationId: string }): Promise<OrganizationTeam> {
    const team = await this.get(input);
    const row = this.memory.teams.get(team.id);
    if (!row) throw new TeamNotFoundError(input.teamId);
    row.archivedAt = new Date();
    return toOrganizationTeam(row);
  }

  async getOrganizationMembers(input: {
    userIds: string[];
    organizationId: string;
    activeOnly?: boolean;
  }): Promise<string[]> {
    if (input.userIds.length === 0) return [];
    const found = new Set(
      this.memory.organizationUsers
        .filter(
          (row) =>
            row.organizationId === input.organizationId &&
            input.userIds.includes(row.userId) &&
            (!input.activeOnly || row.disabledAt === null),
        )
        .map((row) => row.userId),
    );
    const missing = input.userIds.find((userId) => !found.has(userId));
    if (missing) throw new UserNotInOrganizationError(missing);
    return input.userIds;
  }

  async memberOrganizationIds(input: {
    userId: string;
    organizationIds: string[];
    activeOnly?: boolean;
  }): Promise<string[]> {
    const member = new Set(
      this.memory.organizationUsers
        .filter(
          (row) =>
            row.userId === input.userId &&
            input.organizationIds.includes(row.organizationId) &&
            (input.activeOnly === false || row.disabledAt === null),
        )
        .map((row) => row.organizationId),
    );
    return input.organizationIds.filter((organizationId) => member.has(organizationId));
  }

  async fenceMembershipChange(input: {
    teamId: string;
    organizationId: string;
    expectedUpdatedAt: Date;
    name?: string;
  }): Promise<OrganizationTeam> {
    const row = this.memory.teams.get(input.teamId);
    if (!row || row.organizationId !== input.organizationId || row.archivedAt) {
      throw new TeamNotFoundError(input.teamId);
    }
    if (row.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()) {
      throw new TeamMembershipChangedError(input.teamId);
    }
    if (input.name !== undefined) row.name = input.name;
    row.updatedAt = new Date();
    return toOrganizationTeam(row);
  }

  private activeTeamsOf(organizationId: string): MemoryTeamRow[] {
    return [...this.memory.teams.values()].filter(
      (team) => team.organizationId === organizationId && team.archivedAt === null,
    );
  }
}
