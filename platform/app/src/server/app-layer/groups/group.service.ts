import type {
  Group,
  GroupMembership,
  RoleBinding,
  RoleBindingScopeType,
  TeamUserRole,
} from "@prisma/client";
import { generate } from "@langwatch/ksuid";
import { slugify } from "~/utils/slugify";
import { KSUID_RESOURCES } from "~/utils/constants";
import type {
  GroupRepository,
  GroupWithDetails,
  GroupWithMembers,
  PaginatedResult,
} from "./repositories/group.repository";

export class GroupNotFoundError extends Error {
  name = "GroupNotFoundError" as const;
}

export class ScimManagedGroupError extends Error {
  name = "ScimManagedGroupError" as const;
}

export class UserNotInOrganizationError extends Error {
  name = "UserNotInOrganizationError" as const;
}

export class BindingNotFoundError extends Error {
  name = "BindingNotFoundError" as const;
}

export class DuplicateMemberError extends Error {
  name = "DuplicateMemberError" as const;
}

export class ScopeNotInOrganizationError extends Error {
  name = "ScopeNotInOrganizationError" as const;
}

export class GroupRestService {
  constructor(readonly repo: GroupRepository) {}

  async listByOrganization(params: {
    organizationId: string;
    page: number;
    limit: number;
  }): Promise<PaginatedResult<GroupWithDetails>> {
    return this.repo.findAllByOrganization(params);
  }

  async getById({
    id,
    organizationId,
  }: {
    id: string;
    organizationId: string;
  }): Promise<GroupWithMembers | null> {
    return this.repo.findById({ id, organizationId });
  }

  async create({
    organizationId,
    name,
    bindings,
    memberIds,
  }: {
    organizationId: string;
    name: string;
    bindings?: Array<{
      role: TeamUserRole;
      customRoleId?: string;
      scopeType: RoleBindingScopeType;
      scopeId: string;
    }>;
    memberIds?: string[];
  }): Promise<Group> {
    const baseSlug = slugify(name, { lower: true, strict: true });
    const slug = await this.repo.findUniqueSlug({
      organizationId,
      baseSlug,
    });

    const groupId = generate(KSUID_RESOURCES.GROUP).toString();

    const bindingInputs = (bindings ?? []).map((b) => ({
      id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
      organizationId,
      groupId,
      role: b.role,
      customRoleId:
        b.role === ("CUSTOM" as TeamUserRole)
          ? (b.customRoleId ?? null)
          : null,
      scopeType: b.scopeType,
      scopeId: b.scopeId,
    }));

    return this.repo.createAtomic({
      group: { id: groupId, organizationId, name, slug },
      bindings: bindingInputs,
      memberIds: memberIds ?? [],
    });
  }

  async rename({
    id,
    organizationId,
    name,
  }: {
    id: string;
    organizationId: string;
    name: string;
  }): Promise<Group> {
    const group = await this.repo.findGroupOnly({ id, organizationId });
    if (!group) throw new GroupNotFoundError("Group not found");
    if (group.scimSource) {
      throw new ScimManagedGroupError(
        "Cannot rename a SCIM-managed group",
      );
    }

    const baseSlug = slugify(name, { lower: true, strict: true });
    const slug = await this.repo.findUniqueSlug({
      organizationId,
      baseSlug,
      excludeId: id,
    });

    const renamed = await this.repo.rename({ id, organizationId, name, slug });
    if (!renamed) throw new GroupNotFoundError("Group not found");
    return renamed;
  }

  async delete({
    id,
    organizationId,
  }: {
    id: string;
    organizationId: string;
  }): Promise<void> {
    const group = await this.repo.findGroupOnly({ id, organizationId });
    if (!group) throw new GroupNotFoundError("Group not found");

    await this.repo.deleteAllMemberships({ groupId: id });
    await this.repo.deleteAllBindings({ groupId: id });
    await this.repo.delete({ id, organizationId });
  }

  async getMembers({ groupId }: { groupId: string }) {
    return this.repo.findMembers({ groupId });
  }

  async addMember({
    groupId,
    organizationId,
    userId,
  }: {
    groupId: string;
    organizationId: string;
    userId: string;
  }): Promise<GroupMembership> {
    const group = await this.repo.findGroupOnly({
      id: groupId,
      organizationId,
    });
    if (!group) throw new GroupNotFoundError("Group not found");
    if (group.scimSource) {
      throw new ScimManagedGroupError(
        "Cannot manually add members to a SCIM-managed group",
      );
    }

    const isOrgMember = await this.repo.isUserInOrganization({
      userId,
      organizationId,
    });
    if (!isOrgMember) {
      throw new UserNotInOrganizationError(
        "User must belong to the organization before joining a group",
      );
    }

    try {
      return await this.repo.addMember({ groupId, userId });
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as { code: string }).code === "P2002"
      ) {
        throw new DuplicateMemberError("User is already a member of this group");
      }
      throw error;
    }
  }

  async removeMember({
    groupId,
    organizationId,
    userId,
  }: {
    groupId: string;
    organizationId: string;
    userId: string;
  }): Promise<void> {
    const group = await this.repo.findGroupOnly({
      id: groupId,
      organizationId,
    });
    if (!group) throw new GroupNotFoundError("Group not found");
    if (group.scimSource) {
      throw new ScimManagedGroupError(
        "Cannot manually remove members from a SCIM-managed group",
      );
    }

    await this.repo.removeMember({ groupId, userId });
  }

  async getBindings({ groupId }: { groupId: string }) {
    return this.repo.findBindings({ groupId });
  }

  async addBinding({
    groupId,
    organizationId,
    role,
    customRoleId,
    scopeType,
    scopeId,
  }: {
    groupId: string;
    organizationId: string;
    role: TeamUserRole;
    customRoleId?: string;
    scopeType: RoleBindingScopeType;
    scopeId: string;
  }): Promise<RoleBinding> {
    const group = await this.repo.findGroupOnly({
      id: groupId,
      organizationId,
    });
    if (!group) throw new GroupNotFoundError("Group not found");

    const scopeValid = await this.repo.validateScopeInOrganization({
      organizationId,
      scopeType,
      scopeId,
    });
    if (!scopeValid) {
      throw new ScopeNotInOrganizationError(
        "Scope does not belong to this organization",
      );
    }

    return this.repo.createBinding({
      id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
      organizationId,
      groupId,
      role,
      customRoleId:
        role === ("CUSTOM" as TeamUserRole)
          ? (customRoleId ?? null)
          : null,
      scopeType,
      scopeId,
    });
  }

  async removeBinding({
    bindingId,
    organizationId,
  }: {
    bindingId: string;
    organizationId: string;
  }): Promise<void> {
    const binding = await this.repo.findBinding({
      id: bindingId,
      organizationId,
    });
    if (!binding) throw new BindingNotFoundError("Binding not found");

    await this.repo.deleteBinding({ id: bindingId });
  }
}
