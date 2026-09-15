import {
  GroupMemberAlreadyAddedError,
  GroupMembershipNotFoundError,
  GroupNotFoundError,
  ScimManagedGroupError,
  type OrganizationGroup,
  type OrganizationGroupMember,
} from "@langwatch/organization-contract";
import { GroupRepository, type OrganizationGroupWithMemberCount } from "../group.repository.ts";
import type { MemoryGroupRow, MemoryOrganizationDatabase } from "./memory.organization.database.ts";

function toGroup(row: MemoryGroupRow): OrganizationGroup {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    slug: row.slug,
    externalId: row.externalId,
    scimSource: row.scimSource,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** In-memory `GroupRepository`, for tests and a memory-backed boot. Member
 * profiles (name/email/image) are not held in memory: every member answers
 * only its id, which is what the two callers this backend serves need. */
export class MemoryGroupRepository extends GroupRepository {
  private constructor(private readonly memory: MemoryOrganizationDatabase) {
    super();
  }

  static create(options: { memory: MemoryOrganizationDatabase }): MemoryGroupRepository {
    return new MemoryGroupRepository(options.memory);
  }

  async get(input: { groupId: string; organizationId: string }): Promise<OrganizationGroup> {
    const group = this.find(input);
    if (!group) throw new GroupNotFoundError(input.groupId);
    return toGroup(group);
  }

  async list(input: { organizationId: string; page: number; limit: number }): Promise<{
    data: OrganizationGroupWithMemberCount[];
    pagination: { page: number; limit: number; total: number };
  }> {
    const all = this.groupsOf(input.organizationId).sort((a, b) => a.name.localeCompare(b.name));
    const start = (input.page - 1) * input.limit;
    return {
      data: all
        .slice(start, start + input.limit)
        .map((row) => ({ ...toGroup(row), memberCount: row.memberIds.size })),
      pagination: { page: input.page, limit: input.limit, total: all.length },
    };
  }

  async listForMember(input: {
    organizationId: string;
    userId: string;
  }): Promise<OrganizationGroupWithMemberCount[]> {
    return this.groupsOf(input.organizationId)
      .filter((row) => row.memberIds.has(input.userId))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((row) => ({ ...toGroup(row), memberCount: row.memberIds.size }));
  }

  async listMembers(input: {
    groupId: string;
    organizationId: string;
  }): Promise<OrganizationGroupMember[]> {
    const group = this.find(input);
    if (!group) return [];
    return [...group.memberIds].map((userId) => ({
      userId,
      name: null,
      email: null,
      image: null,
    }));
  }

  async listMembersForGroups(input: {
    groupIds: string[];
    organizationId: string;
  }): Promise<Map<string, OrganizationGroupMember[]>> {
    const result = new Map<string, OrganizationGroupMember[]>();
    for (const groupId of input.groupIds) {
      result.set(
        groupId,
        await this.listMembers({ groupId, organizationId: input.organizationId }),
      );
    }
    return result;
  }

  async nextAvailableSlug(input: {
    organizationId: string;
    baseSlug: string;
    excludeGroupId?: string;
  }): Promise<string> {
    let candidate = input.baseSlug;
    let suffix = 2;
    const taken = new Set(
      this.groupsOf(input.organizationId)
        .filter((row) => row.id !== input.excludeGroupId)
        .map((row) => row.slug),
    );
    while (taken.has(candidate)) candidate = `${input.baseSlug}-${suffix++}`;
    return candidate;
  }

  async create(input: {
    groupId: string;
    organizationId: string;
    name: string;
    slug: string;
    memberIds: string[];
  }): Promise<OrganizationGroup> {
    const now = new Date();
    const row: MemoryGroupRow = {
      id: input.groupId,
      organizationId: input.organizationId,
      name: input.name,
      slug: input.slug,
      externalId: null,
      scimSource: null,
      memberIds: new Set(input.memberIds),
      createdAt: now,
      updatedAt: now,
    };
    this.memory.groups.set(row.id, row);
    return toGroup(row);
  }

  async rename(input: {
    groupId: string;
    organizationId: string;
    name: string;
    slug: string;
  }): Promise<OrganizationGroup> {
    const row = this.find(input);
    if (!row) throw new GroupNotFoundError(input.groupId);
    row.name = input.name;
    row.slug = input.slug;
    row.updatedAt = new Date();
    return toGroup(row);
  }

  async delete(input: { groupId: string; organizationId: string }): Promise<void> {
    const row = this.find(input);
    if (!row) throw new GroupNotFoundError(input.groupId);
    this.memory.groups.delete(row.id);
  }

  async addMember(input: {
    groupId: string;
    organizationId: string;
    userId: string;
  }): Promise<void> {
    const row = this.find(input);
    if (!row) throw new GroupNotFoundError(input.groupId);
    if (row.memberIds.has(input.userId)) throw new GroupMemberAlreadyAddedError(input.userId);
    row.memberIds.add(input.userId);
  }

  async removeMember(input: {
    groupId: string;
    organizationId: string;
    userId: string;
  }): Promise<void> {
    const row = this.find(input);
    if (!row) throw new GroupNotFoundError(input.groupId);
    if (!row.memberIds.delete(input.userId)) {
      throw new GroupMembershipNotFoundError(input.userId);
    }
  }

  async applyEdits(input: {
    groupId: string;
    organizationId: string;
    rename?: { name: string; slug: string } | null;
    memberUserIdsToAdd: string[];
    memberUserIdsToRemove: string[];
  }): Promise<void> {
    const row = this.find(input);
    if (!row) throw new GroupNotFoundError(input.groupId);
    if (
      row.scimSource &&
      (input.rename || input.memberUserIdsToAdd.length > 0 || input.memberUserIdsToRemove.length > 0)
    ) {
      throw new ScimManagedGroupError(input.groupId);
    }
    if (input.rename) {
      row.name = input.rename.name;
      row.slug = input.rename.slug;
    }
    for (const userId of input.memberUserIdsToRemove) row.memberIds.delete(userId);
    for (const userId of input.memberUserIdsToAdd) row.memberIds.add(userId);
    row.updatedAt = new Date();
  }

  private groupsOf(organizationId: string): MemoryGroupRow[] {
    return [...this.memory.groups.values()].filter((row) => row.organizationId === organizationId);
  }

  private find(input: { groupId: string; organizationId: string }): MemoryGroupRow | undefined {
    const row = this.memory.groups.get(input.groupId);
    return row && row.organizationId === input.organizationId ? row : undefined;
  }
}
