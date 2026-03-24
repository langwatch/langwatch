import { TeamUserRole, type PrismaClient, type Team, type TeamUser } from "@prisma/client";
import type {
  ScimGroup,
  ScimListResponse,
  ScimError,
  ScimCreateGroupRequest,
  ScimReplaceGroupRequest,
  ScimPatchRequest,
} from "./scim.types";

/**
 * Maps between SCIM 2.0 Group resources and LangWatch Team models.
 * Groups are linked to teams via externalScimId. SCIM operations
 * only affect team membership — deletion unlinks rather than
 * removing the team.
 */
export class ScimGroupService {
  constructor(private readonly prisma: PrismaClient) {}

  static create(prisma: PrismaClient): ScimGroupService {
    return new ScimGroupService(prisma);
  }

  async listGroups({
    organizationId,
    filter,
    startIndex = 1,
    count = 100,
  }: {
    organizationId: string;
    filter?: string;
    startIndex?: number;
    count?: number;
  }): Promise<ScimListResponse<ScimGroup>> {
    const displayNameFilter = this.parseDisplayNameFilter(filter);

    const where: Record<string, unknown> = {
      organizationId,
      externalScimId: { not: null },
      archivedAt: null,
    };

    if (displayNameFilter) {
      where.name = displayNameFilter;
    }

    const [teams, totalCount] = await Promise.all([
      this.prisma.team.findMany({
        where,
        include: {
          members: {
            include: { user: true },
          },
        },
        skip: startIndex - 1,
        take: count,
      }),
      this.prisma.team.count({ where }),
    ]);

    return {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
      totalResults: totalCount,
      startIndex,
      itemsPerPage: count,
      Resources: teams.map((t) => this.toScimGroup(t, t.members)),
    };
  }

  async getGroup({
    externalScimId,
    organizationId,
  }: {
    externalScimId: string;
    organizationId: string;
  }): Promise<ScimGroup | ScimError> {
    const team = await this.findTeamByScimId({ externalScimId, organizationId });

    if (!team) {
      return this.scimError({ status: "404", detail: "Group not found" });
    }

    const members = await this.prisma.teamUser.findMany({
      where: { teamId: team.id },
      include: { user: true },
    });

    return this.toScimGroup(team, members);
  }

  async createGroup({
    request,
    organizationId,
  }: {
    request: ScimCreateGroupRequest;
    organizationId: string;
  }): Promise<ScimGroup | ScimError> {
    // Check if a group with this displayName is already mapped
    const existing = await this.prisma.team.findFirst({
      where: {
        organizationId,
        name: request.displayName,
        externalScimId: { not: null },
      },
    });

    if (existing) {
      return this.scimError({ status: "409", detail: "A group with this name is already mapped" });
    }

    // Find an unmapped team with matching name, or return error
    const team = await this.prisma.team.findFirst({
      where: {
        organizationId,
        name: request.displayName,
        externalScimId: null,
        archivedAt: null,
      },
    });

    if (!team) {
      return this.scimError({
        status: "404",
        detail: `No unmapped team found with name "${request.displayName}". Create the team first in LangWatch, then push the group.`,
      });
    }

    // Link the team to the SCIM group using a generated ID
    const scimId = team.id;
    await this.prisma.team.update({
      where: { id: team.id },
      data: { externalScimId: scimId },
    });

    // Add any members from the request
    if (request.members?.length) {
      await this.addMembersToTeam({
        teamId: team.id,
        organizationId,
        memberIds: request.members.map((m) => m.value),
      });
    }

    const members = await this.prisma.teamUser.findMany({
      where: { teamId: team.id },
      include: { user: true },
    });

    return this.toScimGroup({ ...team, externalScimId: scimId }, members);
  }

  async replaceGroup({
    externalScimId,
    organizationId,
    request,
  }: {
    externalScimId: string;
    organizationId: string;
    request: ScimReplaceGroupRequest;
  }): Promise<ScimGroup | ScimError> {
    const team = await this.findTeamByScimId({ externalScimId, organizationId });

    if (!team) {
      return this.scimError({ status: "404", detail: "Group not found" });
    }

    // Update team name if changed
    if (request.displayName !== team.name) {
      await this.prisma.team.update({
        where: { id: team.id },
        data: { name: request.displayName },
      });
    }

    // Replace membership: get current members, compute diff
    const currentMembers = await this.prisma.teamUser.findMany({
      where: { teamId: team.id },
    });

    const requestedUserIds = new Set((request.members ?? []).map((m) => m.value));
    const currentUserIds = new Set(currentMembers.map((m) => m.userId));

    // Add new members
    const toAdd = [...requestedUserIds].filter((id) => !currentUserIds.has(id));
    if (toAdd.length > 0) {
      await this.addMembersToTeam({ teamId: team.id, organizationId, memberIds: toAdd });
    }

    // Remove members no longer in the group (protect last admin)
    const toRemove = [...currentUserIds].filter((id) => !requestedUserIds.has(id));
    await this.removeMembersFromTeam({ teamId: team.id, userIds: toRemove });

    const updatedMembers = await this.prisma.teamUser.findMany({
      where: { teamId: team.id },
      include: { user: true },
    });

    return this.toScimGroup(team, updatedMembers);
  }

  async updateGroup({
    externalScimId,
    organizationId,
    patchRequest,
  }: {
    externalScimId: string;
    organizationId: string;
    patchRequest: ScimPatchRequest;
  }): Promise<ScimGroup | ScimError> {
    const team = await this.findTeamByScimId({ externalScimId, organizationId });

    if (!team) {
      return this.scimError({ status: "404", detail: "Group not found" });
    }

    for (const operation of patchRequest.Operations) {
      if (operation.op === "add" && operation.path === "members") {
        const members = this.extractMemberIds(operation.value);
        if (members.length > 0) {
          await this.addMembersToTeam({ teamId: team.id, organizationId, memberIds: members });
        }
      } else if (operation.op === "remove" && operation.path?.startsWith("members")) {
        const memberIds = this.extractMemberIdsFromPath(operation.path, operation.value);
        if (memberIds.length > 0) {
          await this.removeMembersFromTeam({ teamId: team.id, userIds: memberIds });
        }
      } else if (operation.op === "replace") {
        if (operation.path === "displayName" && typeof operation.value === "string") {
          await this.prisma.team.update({
            where: { id: team.id },
            data: { name: operation.value },
          });
        } else if (operation.path === "members" || !operation.path) {
          // Full member replace
          const members = this.extractMemberIds(
            operation.path === "members" ? operation.value : (operation.value as Record<string, unknown> | undefined)?.members
          );
          const currentMembers = await this.prisma.teamUser.findMany({
            where: { teamId: team.id },
          });
          const requestedIds = new Set(members);
          const currentIds = new Set(currentMembers.map((m) => m.userId));

          const toAdd = members.filter((id) => !currentIds.has(id));
          const toRemove = [...currentIds].filter((id) => !requestedIds.has(id));

          if (toAdd.length > 0) {
            await this.addMembersToTeam({ teamId: team.id, organizationId, memberIds: toAdd });
          }
          if (toRemove.length > 0) {
            await this.removeMembersFromTeam({ teamId: team.id, userIds: toRemove });
          }
        }
      }
    }

    const updatedMembers = await this.prisma.teamUser.findMany({
      where: { teamId: team.id },
      include: { user: true },
    });

    return this.toScimGroup(team, updatedMembers);
  }

  async deleteGroup({
    externalScimId,
    organizationId,
  }: {
    externalScimId: string;
    organizationId: string;
  }): Promise<ScimError | null> {
    const team = await this.findTeamByScimId({ externalScimId, organizationId });

    if (!team) {
      return this.scimError({ status: "404", detail: "Group not found" });
    }

    // Unlink only — don't delete or archive the team
    await this.prisma.team.update({
      where: { id: team.id },
      data: { externalScimId: null },
    });

    return null;
  }

  private async findTeamByScimId({
    externalScimId,
    organizationId,
  }: {
    externalScimId: string;
    organizationId: string;
  }): Promise<Team | null> {
    return this.prisma.team.findFirst({
      where: {
        organizationId,
        externalScimId,
        archivedAt: null,
      },
    });
  }

  private async addMembersToTeam({
    teamId,
    organizationId,
    memberIds,
  }: {
    teamId: string;
    organizationId: string;
    memberIds: string[];
  }): Promise<void> {
    // Only add users who are members of the organization
    const orgMembers = await this.prisma.organizationUser.findMany({
      where: {
        organizationId,
        userId: { in: memberIds },
      },
    });
    const validUserIds = new Set(orgMembers.map((m) => m.userId));

    for (const userId of memberIds) {
      if (!validUserIds.has(userId)) continue;

      const existing = await this.prisma.teamUser.findUnique({
        where: { userId_teamId: { userId, teamId } },
      });

      if (!existing) {
        await this.prisma.teamUser.create({
          data: {
            userId,
            teamId,
            role: TeamUserRole.MEMBER,
          },
        });
      }
    }
  }

  private async removeMembersFromTeam({
    teamId,
    userIds,
  }: {
    teamId: string;
    userIds: string[];
  }): Promise<void> {
    for (const userId of userIds) {
      // Protect the last admin
      const member = await this.prisma.teamUser.findUnique({
        where: { userId_teamId: { userId, teamId } },
      });

      if (!member) continue;

      if (member.role === TeamUserRole.ADMIN) {
        const adminCount = await this.prisma.teamUser.count({
          where: { teamId, role: TeamUserRole.ADMIN },
        });
        if (adminCount <= 1) continue; // Skip — can't remove last admin
      }

      await this.prisma.teamUser.delete({
        where: { userId_teamId: { userId, teamId } },
      });
    }
  }

  private extractMemberIds(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value
        .filter((m): m is { value: string } => typeof m === "object" && m !== null && typeof m.value === "string")
        .map((m) => m.value);
    }
    return [];
  }

  private extractMemberIdsFromPath(path: string, value: unknown): string[] {
    // Okta format: members[value eq "userId"]
    const match = path.match(/members\[value\s+eq\s+"([^"]+)"\]/);
    if (match?.[1]) {
      return [match[1]];
    }

    // Azure AD format: uses value array
    return this.extractMemberIds(value);
  }

  private toScimGroup(
    team: Team,
    members: Array<TeamUser & { user: { id: string; email: string | null; name: string | null } }>,
  ): ScimGroup {
    return {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
      id: team.externalScimId ?? team.id,
      displayName: team.name,
      members: members.map((m) => ({
        value: m.userId,
        display: m.user.email ?? m.user.name ?? undefined,
      })),
      meta: {
        resourceType: "Group",
        created: team.createdAt.toISOString(),
        lastModified: team.updatedAt.toISOString(),
      },
    };
  }

  private parseDisplayNameFilter(filter?: string): string | null {
    if (!filter) return null;
    const match = filter.match(/^displayName\s+eq\s+"([^"]+)"$/);
    return match?.[1] ?? null;
  }

  private scimError({ status, detail }: { status: string; detail: string }): ScimError {
    return {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status,
      detail,
    };
  }
}
