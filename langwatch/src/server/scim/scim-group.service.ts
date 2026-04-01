import { TeamUserRole, type PrismaClient, type ScimGroupMapping } from "@prisma/client";
import type {
  ScimGroup,
  ScimListResponse,
  ScimError,
  ScimCreateGroupRequest,
  ScimReplaceGroupRequest,
  ScimPatchRequest,
} from "./scim.types";
import { resolveHighestRole } from "./scim-role-resolver";

/**
 * Maps between SCIM 2.0 Group resources and LangWatch ScimGroupMapping records.
 * Groups are stored as mappings that can optionally link to a Team + Role.
 * Member operations track provenance via ScimGroupMembership and only create
 * TeamUser records when the mapping has been linked to a team.
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
    };

    if (displayNameFilter) {
      where.externalGroupName = displayNameFilter;
    }

    const [mappings, totalCount] = await Promise.all([
      this.prisma.scimGroupMapping.findMany({
        where,
        include: {
          memberships: {
            include: { user: true },
          },
        },
        skip: startIndex - 1,
        take: count,
      }),
      this.prisma.scimGroupMapping.count({ where }),
    ]);

    return {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
      totalResults: totalCount,
      startIndex,
      itemsPerPage: count,
      Resources: mappings.map((m) => this.toScimGroup(m, m.memberships)),
    };
  }

  async getGroup({
    externalScimId,
    organizationId,
  }: {
    externalScimId: string;
    organizationId: string;
  }): Promise<ScimGroup | ScimError> {
    const mapping = await this.findMappingByScimId({ externalScimId, organizationId });

    if (!mapping) {
      return this.scimError({ status: "404", detail: "Group not found" });
    }

    const memberships = await this.prisma.scimGroupMembership.findMany({
      where: { scimGroupMappingId: mapping.id },
      include: { user: true },
    });

    return this.toScimGroup(mapping, memberships);
  }

  async createGroup({
    request,
    organizationId,
  }: {
    request: ScimCreateGroupRequest;
    organizationId: string;
  }): Promise<ScimGroup | ScimError> {
    // Check if a mapping with this displayName already exists
    const existing = await this.prisma.scimGroupMapping.findFirst({
      where: {
        organizationId,
        externalGroupName: request.displayName,
      },
    });

    if (existing) {
      return this.scimError({ status: "409", detail: "A group with this name is already mapped" });
    }

    // Create the ScimGroupMapping record (unmapped — no team or role)
    const mapping = await this.prisma.scimGroupMapping.create({
      data: {
        organizationId,
        externalGroupId: request.displayName,
        externalGroupName: request.displayName,
      },
    });

    // If members are in the request, process them (will be no-op for unmapped)
    if (request.members?.length) {
      await this.addMembersToMapping({
        mappingId: mapping.id,
        organizationId,
        memberIds: request.members.map((m) => m.value),
      });
    }

    return this.toScimGroup(mapping, []);
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
    const mapping = await this.findMappingByScimId({ externalScimId, organizationId });

    if (!mapping) {
      return this.scimError({ status: "404", detail: "Group not found" });
    }

    // Update displayName if changed
    if (request.displayName !== mapping.externalGroupName) {
      await this.prisma.scimGroupMapping.update({
        where: { id: mapping.id },
        data: { externalGroupName: request.displayName },
      });
    }

    // If unmapped, just return success with mapping data
    if (!mapping.teamId || !mapping.role) {
      return this.toScimGroup(mapping, []);
    }

    // Replace membership: get current memberships, compute diff
    const currentMemberships = await this.prisma.scimGroupMembership.findMany({
      where: { scimGroupMappingId: mapping.id },
    });

    const requestedUserIds = new Set((request.members ?? []).map((m) => m.value));
    const currentUserIds = new Set(currentMemberships.map((m) => m.userId));

    // Add new members
    const toAdd = [...requestedUserIds].filter((id) => !currentUserIds.has(id));
    if (toAdd.length > 0) {
      await this.addMembersToMapping({
        mappingId: mapping.id,
        organizationId,
        memberIds: toAdd,
      });
    }

    // Remove members no longer in the group
    const toRemove = [...currentUserIds].filter((id) => !requestedUserIds.has(id));
    if (toRemove.length > 0) {
      await this.removeMembersFromMapping({
        mapping,
        userIds: toRemove,
      });
    }

    const updatedMemberships = await this.prisma.scimGroupMembership.findMany({
      where: { scimGroupMappingId: mapping.id },
      include: { user: true },
    });

    return this.toScimGroup(mapping, updatedMemberships);
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
    const mapping = await this.findMappingByScimId({ externalScimId, organizationId });

    if (!mapping) {
      return this.scimError({ status: "404", detail: "Group not found" });
    }

    for (const operation of patchRequest.Operations) {
      if (operation.op === "add" && operation.path === "members") {
        const members = this.extractMemberIds(operation.value);
        if (members.length > 0) {
          await this.addMembersToMapping({
            mappingId: mapping.id,
            organizationId,
            memberIds: members,
          });
        }
      } else if (operation.op === "remove" && operation.path?.startsWith("members")) {
        const memberIds = this.extractMemberIdsFromPath(operation.path, operation.value);
        if (memberIds.length > 0) {
          await this.removeMembersFromMapping({
            mapping,
            userIds: memberIds,
          });
        }
      } else if (operation.op === "replace") {
        if (operation.path === "displayName" && typeof operation.value === "string") {
          await this.prisma.scimGroupMapping.update({
            where: { id: mapping.id },
            data: { externalGroupName: operation.value },
          });
        } else if (operation.path === "members" || !operation.path) {
          // Full member replace — only if mapped
          if (!mapping.teamId || !mapping.role) continue;

          const members = this.extractMemberIds(
            operation.path === "members" ? operation.value : (operation.value as Record<string, unknown> | undefined)?.members
          );
          const currentMemberships = await this.prisma.scimGroupMembership.findMany({
            where: { scimGroupMappingId: mapping.id },
          });
          const requestedIds = new Set(members);
          const currentIds = new Set(currentMemberships.map((m) => m.userId));

          const toAdd = members.filter((id) => !currentIds.has(id));
          const toRemove = [...currentIds].filter((id) => !requestedIds.has(id));

          if (toAdd.length > 0) {
            await this.addMembersToMapping({
              mappingId: mapping.id,
              organizationId,
              memberIds: toAdd,
            });
          }
          if (toRemove.length > 0) {
            await this.removeMembersFromMapping({
              mapping,
              userIds: toRemove,
            });
          }
        }
      }
    }

    const updatedMemberships = await this.prisma.scimGroupMembership.findMany({
      where: { scimGroupMappingId: mapping.id },
      include: { user: true },
    });

    return this.toScimGroup(mapping, updatedMemberships);
  }

  async deleteGroup({
    externalScimId,
    organizationId,
  }: {
    externalScimId: string;
    organizationId: string;
  }): Promise<ScimError | null> {
    const mapping = await this.findMappingByScimId({ externalScimId, organizationId });

    if (!mapping) {
      return this.scimError({ status: "404", detail: "Group not found" });
    }

    // Get all memberships for this mapping
    const memberships = await this.prisma.scimGroupMembership.findMany({
      where: { scimGroupMappingId: mapping.id },
    });

    // For each user, handle team membership cleanup
    if (mapping.teamId) {
      for (const membership of memberships) {
        // Check if user has memberships from OTHER mappings to the same team
        const otherMemberships = await this.prisma.scimGroupMembership.findMany({
          where: {
            userId: membership.userId,
            scimGroupMappingId: { not: mapping.id },
            scimGroupMapping: { teamId: mapping.teamId },
          },
          include: { scimGroupMapping: true },
        });

        if (otherMemberships.length > 0) {
          // Recalculate role from remaining mappings
          const roles = otherMemberships
            .map((m) => m.scimGroupMapping.role)
            .filter((r): r is TeamUserRole => r !== null);

          if (roles.length > 0) {
            const effectiveRole = resolveHighestRole(roles);
            await this.prisma.teamUser.update({
              where: {
                userId_teamId: {
                  userId: membership.userId,
                  teamId: mapping.teamId,
                },
              },
              data: { role: effectiveRole },
            });
          }
        } else {
          // No other mappings — remove TeamUser
          await this.prisma.teamUser.deleteMany({
            where: {
              userId: membership.userId,
              teamId: mapping.teamId,
            },
          });
        }
      }
    }

    // Delete the mapping (cascades to ScimGroupMembership)
    await this.prisma.scimGroupMapping.delete({
      where: { id: mapping.id },
    });

    return null;
  }

  /**
   * Finds a ScimGroupMapping by its id (used as the SCIM resource ID).
   */
  private async findMappingByScimId({
    externalScimId,
    organizationId,
  }: {
    externalScimId: string;
    organizationId: string;
  }): Promise<ScimGroupMapping | null> {
    return this.prisma.scimGroupMapping.findFirst({
      where: {
        id: externalScimId,
        organizationId,
      },
    });
  }

  /**
   * Adds members to a mapping. If the mapping has a teamId+role, also creates
   * TeamUser records. If the user already exists in the team via another mapping,
   * recalculates the effective role.
   */
  private async addMembersToMapping({
    mappingId,
    organizationId,
    memberIds,
  }: {
    mappingId: string;
    organizationId: string;
    memberIds: string[];
  }): Promise<void> {
    const mapping = await this.prisma.scimGroupMapping.findUnique({
      where: { id: mappingId },
    });

    if (!mapping) return;

    // If unmapped, do nothing
    if (!mapping.teamId || !mapping.role) return;

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

      // Create ScimGroupMembership
      await this.prisma.scimGroupMembership.upsert({
        where: {
          scimGroupMappingId_userId: {
            scimGroupMappingId: mappingId,
            userId,
          },
        },
        update: {},
        create: {
          scimGroupMappingId: mappingId,
          userId,
        },
      });

      // Check if user already has a TeamUser record
      const existingTeamUser = await this.prisma.teamUser.findUnique({
        where: { userId_teamId: { userId, teamId: mapping.teamId } },
      });

      if (existingTeamUser) {
        // Recalculate effective role across all mappings for this user+team
        await this.recalculateUserTeamRole({ userId, teamId: mapping.teamId });
      } else {
        // Create TeamUser with the mapping's role
        await this.prisma.teamUser.create({
          data: {
            userId,
            teamId: mapping.teamId,
            role: mapping.role,
          },
        });
      }
    }
  }

  /**
   * Removes members from a mapping. If the user has no other ScimGroupMembership
   * records for the same team, also removes the TeamUser record. Otherwise
   * recalculates the effective role.
   */
  private async removeMembersFromMapping({
    mapping,
    userIds,
  }: {
    mapping: ScimGroupMapping;
    userIds: string[];
  }): Promise<void> {
    if (!mapping.teamId) return;

    for (const userId of userIds) {
      // Delete the ScimGroupMembership
      await this.prisma.scimGroupMembership.deleteMany({
        where: {
          scimGroupMappingId: mapping.id,
          userId,
        },
      });

      // Check if user has memberships from OTHER mappings to the same team
      const otherMemberships = await this.prisma.scimGroupMembership.findMany({
        where: {
          userId,
          scimGroupMappingId: { not: mapping.id },
          scimGroupMapping: { teamId: mapping.teamId },
        },
        include: { scimGroupMapping: true },
      });

      if (otherMemberships.length > 0) {
        // Recalculate role from remaining mappings
        await this.recalculateUserTeamRole({ userId, teamId: mapping.teamId });
      } else {
        // No other mappings — remove TeamUser
        await this.prisma.teamUser.deleteMany({
          where: {
            userId,
            teamId: mapping.teamId,
          },
        });
      }
    }
  }

  /**
   * Recalculates a user's effective team role based on all ScimGroupMappings
   * that target the team and have a ScimGroupMembership for the user.
   * Uses resolveHighestRole to pick the most permissive role.
   */
  private async recalculateUserTeamRole({
    userId,
    teamId,
  }: {
    userId: string;
    teamId: string;
  }): Promise<void> {
    const mappingsForUserAndTeam = await this.prisma.scimGroupMembership.findMany({
      where: {
        userId,
        scimGroupMapping: { teamId },
      },
      include: { scimGroupMapping: true },
    });

    const roles = mappingsForUserAndTeam
      .map((m) => m.scimGroupMapping.role)
      .filter((r): r is TeamUserRole => r !== null);

    if (roles.length === 0) return;

    const effectiveRole = resolveHighestRole(roles);

    await this.prisma.teamUser.update({
      where: { userId_teamId: { userId, teamId } },
      data: { role: effectiveRole },
    });
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

  /**
   * Converts a ScimGroupMapping to a SCIM Group response.
   * For mapped groups, includes member data from ScimGroupMembership.
   * For unmapped groups, returns empty members.
   */
  private toScimGroup(
    mapping: ScimGroupMapping,
    memberships: Array<{ userId: string; user: { id: string; email: string | null; name: string | null } }>,
  ): ScimGroup {
    return {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
      id: mapping.id,
      displayName: mapping.externalGroupName,
      members: memberships.map((m) => ({
        value: m.userId,
        display: m.user.email ?? m.user.name ?? undefined,
      })),
      meta: {
        resourceType: "Group",
        created: mapping.createdAt.toISOString(),
        lastModified: mapping.updatedAt.toISOString(),
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
