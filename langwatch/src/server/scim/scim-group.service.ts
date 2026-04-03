import { type Group, type PrismaClient } from "@prisma/client";
import { slugify } from "~/utils/slugify";
import type {
  ScimCreateGroupRequest,
  ScimError,
  ScimGroup,
  ScimListResponse,
  ScimPatchOperation,
  ScimPatchRequest,
  ScimReplaceGroupRequest,
} from "./scim.types";

/**
 * Handles SCIM 2.0 Group resources backed by the Group / GroupMembership tables.
 * Groups pushed from an IdP arrive here unmapped — admins assign role bindings
 * via the Groups settings page.
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

    const where = {
      organizationId,
      scimSource: { not: null as string | null },
      ...(displayNameFilter ? { name: displayNameFilter } : {}),
    };

    const [groups, totalCount] = await Promise.all([
      this.prisma.group.findMany({
        where,
        include: {
          members: {
            include: { user: { select: { id: true, email: true, name: true } } },
          },
        },
        skip: startIndex - 1,
        take: count,
        orderBy: { createdAt: "asc" },
      }),
      this.prisma.group.count({ where }),
    ]);

    return {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
      totalResults: totalCount,
      startIndex,
      itemsPerPage: count,
      Resources: groups.map((g) => this.toScimGroup(g, g.members)),
    };
  }

  async getGroup({
    externalScimId,
    organizationId,
  }: {
    externalScimId: string;
    organizationId: string;
  }): Promise<ScimGroup | ScimError> {
    const group = await this.findGroup({ externalScimId, organizationId });
    if (!group) return this.scimError({ status: "404", detail: "Group not found" });

    const members = await this.prisma.groupMembership.findMany({
      where: { groupId: group.id },
      include: { user: { select: { id: true, email: true, name: true } } },
    });

    return this.toScimGroup(group, members);
  }

  async createGroup({
    request,
    organizationId,
  }: {
    request: ScimCreateGroupRequest;
    organizationId: string;
  }): Promise<ScimGroup | ScimError> {
    const existing = await this.prisma.group.findFirst({
      where: { organizationId, name: request.displayName, scimSource: { not: null } },
    });
    if (existing) {
      return this.scimError({ status: "409", detail: "A group with this name already exists" });
    }

    const slug = await this.uniqueSlug(organizationId, request.displayName);
    const group = await this.prisma.group.create({
      data: {
        organizationId,
        name: request.displayName,
        slug,
        scimSource: "scim",
        externalId: (request as { externalId?: string }).externalId ?? null,
      },
    });

    if (request.members?.length) {
      await this.addMembers({
        groupId: group.id,
        organizationId,
        memberIds: request.members.map((m) => m.value),
      });
    }

    const members = await this.prisma.groupMembership.findMany({
      where: { groupId: group.id },
      include: { user: { select: { id: true, email: true, name: true } } },
    });

    return this.toScimGroup(group, members);
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
    const group = await this.findGroup({ externalScimId, organizationId });
    if (!group) return this.scimError({ status: "404", detail: "Group not found" });

    if (request.displayName !== group.name) {
      await this.prisma.group.update({
        where: { id: group.id },
        data: { name: request.displayName },
      });
    }

    const requestedIds = new Set((request.members ?? []).map((m) => m.value));
    const current = await this.prisma.groupMembership.findMany({ where: { groupId: group.id } });
    const currentIds = new Set(current.map((m) => m.userId));

    const toAdd = [...requestedIds].filter((id) => !currentIds.has(id));
    const toRemove = [...currentIds].filter((id) => !requestedIds.has(id));

    if (toAdd.length) await this.addMembers({ groupId: group.id, organizationId, memberIds: toAdd });
    if (toRemove.length) await this.removeMembers({ groupId: group.id, userIds: toRemove });

    const updatedGroup = await this.prisma.group.findUniqueOrThrow({ where: { id: group.id } });
    const members = await this.prisma.groupMembership.findMany({
      where: { groupId: group.id },
      include: { user: { select: { id: true, email: true, name: true } } },
    });

    return this.toScimGroup(updatedGroup, members);
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
    const group = await this.findGroup({ externalScimId, organizationId });
    if (!group) return this.scimError({ status: "404", detail: "Group not found" });

    for (const operation of patchRequest.Operations) {
      await this.applyPatch({ group, operation, organizationId });
    }

    const updatedGroup = await this.prisma.group.findUniqueOrThrow({ where: { id: group.id } });
    const members = await this.prisma.groupMembership.findMany({
      where: { groupId: group.id },
      include: { user: { select: { id: true, email: true, name: true } } },
    });

    return this.toScimGroup(updatedGroup, members);
  }

  async deleteGroup({
    externalScimId,
    organizationId,
  }: {
    externalScimId: string;
    organizationId: string;
  }): Promise<ScimError | null> {
    const group = await this.findGroup({ externalScimId, organizationId });
    if (!group) return this.scimError({ status: "404", detail: "Group not found" });

    await this.prisma.groupMembership.deleteMany({ where: { groupId: group.id } });
    await this.prisma.roleBinding.deleteMany({ where: { groupId: group.id } });
    await this.prisma.group.delete({ where: { id: group.id } });

    return null;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async findGroup({
    externalScimId,
    organizationId,
  }: {
    externalScimId: string;
    organizationId: string;
  }): Promise<Group | null> {
    return this.prisma.group.findFirst({
      where: { id: externalScimId, organizationId },
    });
  }

  private async addMembers({
    groupId,
    organizationId,
    memberIds,
  }: {
    groupId: string;
    organizationId: string;
    memberIds: string[];
  }): Promise<void> {
    const orgMembers = await this.prisma.organizationUser.findMany({
      where: { organizationId, userId: { in: memberIds } },
      select: { userId: true },
    });
    const validIds = new Set(orgMembers.map((m) => m.userId));

    for (const userId of memberIds) {
      if (!validIds.has(userId)) continue;
      await this.prisma.groupMembership.upsert({
        where: { userId_groupId: { userId, groupId } },
        update: {},
        create: { userId, groupId },
      });
    }
  }

  private async removeMembers({
    groupId,
    userIds,
  }: {
    groupId: string;
    userIds: string[];
  }): Promise<void> {
    await this.prisma.groupMembership.deleteMany({
      where: { groupId, userId: { in: userIds } },
    });
  }

  private async applyPatch({
    group,
    operation,
    organizationId,
  }: {
    group: Group;
    operation: ScimPatchOperation;
    organizationId: string;
  }): Promise<void> {
    if (operation.op === "add" && operation.path === "members") {
      const ids = this.extractMemberIds(operation.value);
      if (ids.length) await this.addMembers({ groupId: group.id, organizationId, memberIds: ids });
      return;
    }

    if (operation.op === "remove" && operation.path?.startsWith("members")) {
      const ids = this.extractMemberIdsFromPath(operation.path, operation.value);
      if (ids.length) await this.removeMembers({ groupId: group.id, userIds: ids });
      return;
    }

    if (operation.op === "replace") {
      if (operation.path === "displayName" && typeof operation.value === "string") {
        await this.prisma.group.update({ where: { id: group.id }, data: { name: operation.value } });
        return;
      }

      // Full member replace (path="members" or no path with members in value)
      const members = this.extractMemberIds(
        operation.path === "members"
          ? operation.value
          : (operation.value as Record<string, unknown> | undefined)?.members,
      );
      const current = await this.prisma.groupMembership.findMany({ where: { groupId: group.id } });
      const requestedIds = new Set(members);
      const currentIds = new Set(current.map((m) => m.userId));

      const toAdd = members.filter((id) => !currentIds.has(id));
      const toRemove = [...currentIds].filter((id) => !requestedIds.has(id));

      if (toAdd.length) await this.addMembers({ groupId: group.id, organizationId, memberIds: toAdd });
      if (toRemove.length) await this.removeMembers({ groupId: group.id, userIds: toRemove });
    }
  }

  private async uniqueSlug(organizationId: string, name: string): Promise<string> {
    const base = slugify(name, { lower: true, strict: true }) || "group";
    let slug = base;
    let i = 1;
    while (await this.prisma.group.findFirst({ where: { organizationId, slug } })) {
      slug = `${base}-${i++}`;
    }
    return slug;
  }

  private toScimGroup(
    group: Group,
    members: Array<{ userId: string; user: { id: string; email: string | null; name: string | null } }>,
  ): ScimGroup {
    return {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
      id: group.id,
      displayName: group.name,
      members: members.map((m) => ({
        value: m.userId,
        display: m.user.email ?? m.user.name ?? undefined,
      })),
      meta: {
        resourceType: "Group",
        created: group.createdAt.toISOString(),
        lastModified: group.updatedAt.toISOString(),
      },
    };
  }

  private parseDisplayNameFilter(filter?: string): string | null {
    if (!filter) return null;
    const match = filter.match(/^displayName\s+eq\s+"([^"]+)"$/);
    return match?.[1] ?? null;
  }

  private extractMemberIds(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
      .filter((m): m is { value: string } => typeof m === "object" && m !== null && "value" in m && typeof (m as { value: unknown }).value === "string")
      .map((m) => (m as { value: string }).value);
  }

  private extractMemberIdsFromPath(path: string, value: unknown): string[] {
    // Okta: members[value eq "userId"]
    const match = path.match(/members\[value\s+eq\s+"([^"]+)"\]/);
    if (match?.[1]) return [match[1]];
    return this.extractMemberIds(value);
  }

  private scimError({ status, detail }: { status: string; detail: string }): ScimError {
    return {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status,
      detail,
    };
  }
}
