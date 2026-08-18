import { DuplicateBindingError } from "@langwatch/authz-server";
import { generate } from "@langwatch/ksuid";
import type {
  Group,
  GroupMembership,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import type { LedgerActor } from "~/server/app-layer/authz/ledger";
import { PersonalWorkspaceNotManagedHereError } from "~/server/app-layer/teams/team.service";
import type { RoleService } from "~/server/role";
import { RoleNotAssignableError } from "~/server/role/errors";
import { RoleBindingAlreadyExistsError } from "~/server/role-bindings/errors";
import { KSUID_RESOURCES } from "~/utils/constants";
import { slugify } from "~/utils/slugify";
import {
  BindingNotFoundError,
  CustomRoleRequiredError,
  DuplicateMemberError,
  GroupNotFoundError,
  GroupRoleNotAssignableError,
  ScimManagedGroupError,
  ScopeNotInOrganizationError,
  UserNotInOrganizationError,
} from "./errors";
import type {
  CreatedBinding,
  GroupRepository,
  GroupWithDetails,
  GroupWithMembers,
  PaginatedResult,
} from "./repositories/group.repository";

export class GroupRestService {
  readonly repo: GroupRepository;
  private readonly roleService: RoleService;

  constructor({
    repo,
    roleService,
  }: {
    repo: GroupRepository;
    roleService: RoleService;
  }) {
    this.repo = repo;
    this.roleService = roleService;
  }

  /**
   * A CUSTOM binding is only as trustworthy as the role it points at, and the
   * resolver grants whatever that role says, so the ids are validated here,
   * before anything persists: they must exist, belong to this organization,
   * and be user-created roles (an API key's private `system_api_key` role is
   * never assignable to a group). Same rule the tRPC group router applies.
   *
   * The scope matters as well as the role: an organization-exclusive
   * permission never resolves from a team or project binding, so a group
   * binding carrying one below organization scope is refused rather than
   * stored as a grant that does nothing.
   */
  private async assertCustomRolesAssignable({
    organizationId,
    bindings,
  }: {
    organizationId: string;
    bindings: Array<{
      role: TeamUserRole;
      customRoleId?: string;
      scopeType: RoleBindingScopeType;
    }>;
  }): Promise<void> {
    const customBindings = bindings.filter(
      (binding) => binding.role === ("CUSTOM" as TeamUserRole),
    );
    if (customBindings.length === 0) return;

    if (customBindings.some((binding) => !binding.customRoleId)) {
      throw new CustomRoleRequiredError();
    }

    const customRoleIds = [
      ...new Set(
        customBindings.map((binding) => binding.customRoleId as string),
      ),
    ];
    try {
      await this.roleService.validateRolesAssignable({
        roleIds: customRoleIds,
        organizationId,
      });
    } catch (error) {
      // `RoleService` is shared with surfaces that predate the code contract,
      // so it still refuses with a plain error. Named here rather than there,
      // so this family answers with a code without changing what the others
      // already publish.
      if (error instanceof RoleNotAssignableError) {
        throw new GroupRoleNotAssignableError(customRoleIds[0]);
      }
      throw error;
    }
    await this.roleService.assertNoOrgExclusivePermissionsBelowOrgScope({
      organizationId,
      customBindings: customBindings.map((binding) => ({
        customRoleId: binding.customRoleId as string,
        scopeType: binding.scopeType,
      })),
    });
  }

  /**
   * A personal team holds exactly its owner, which is why plan limits exempt
   * it. A group binding would make it multi-member by proxy while it still
   * counts as nobody's, so group bindings never point at one.
   *
   * Handed on as a handled error so the REST boundary answers 403 with a code.
   * It used to be a plain `Error`, which `handleGroupError` had nowhere to put,
   * so a caller naming a personal scope was told the server had fallen over.
   */
  private async assertNoPersonalTeamScope(
    scopes: Array<{ scopeType: RoleBindingScopeType; scopeId: string }>,
  ): Promise<void> {
    if (await this.repo.anyScopeIsPersonalTeam(scopes)) {
      throw new PersonalWorkspaceNotManagedHereError();
    }
  }

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
    actor,
  }: {
    organizationId: string;
    name: string;
    actor: LedgerActor;
    bindings?: Array<{
      role: TeamUserRole;
      customRoleId?: string;
      scopeType: RoleBindingScopeType;
      scopeId: string;
    }>;
    memberIds?: string[];
  }): Promise<Group> {
    const uniqueMemberIds = [...new Set(memberIds ?? [])];
    const allMembersInOrganization = await this.repo.areUsersInOrganization({
      organizationId,
      userIds: uniqueMemberIds,
    });
    if (!allMembersInOrganization) {
      throw new UserNotInOrganizationError();
    }
    await this.assertCustomRolesAssignable({
      organizationId,
      bindings: bindings ?? [],
    });

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
        b.role === ("CUSTOM" as TeamUserRole) ? (b.customRoleId ?? null) : null,
      scopeType: b.scopeType,
      scopeId: b.scopeId,
    }));

    // Every scope must belong to this organization, the same check
    // `addBinding` makes. Without it a group created with bindings could reach
    // another organization's team or project.
    for (const binding of bindingInputs) {
      const scopeValid = await this.repo.validateScopeInOrganization({
        organizationId,
        scopeType: binding.scopeType,
        scopeId: binding.scopeId,
      });
      if (!scopeValid) {
        throw new ScopeNotInOrganizationError(binding.scopeType);
      }
    }
    await this.assertNoPersonalTeamScope(bindingInputs);

    return this.repo.createAtomic({
      group: { id: groupId, organizationId, name, slug },
      bindings: bindingInputs,
      memberIds: memberIds ?? [],
      actor,
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
    if (!group) throw new GroupNotFoundError();
    if (group.scimSource) {
      throw new ScimManagedGroupError(id);
    }

    const baseSlug = slugify(name, { lower: true, strict: true });
    const slug = await this.repo.findUniqueSlug({
      organizationId,
      baseSlug,
      excludeId: id,
    });

    const renamed = await this.repo.rename({ id, organizationId, name, slug });
    if (!renamed) throw new GroupNotFoundError();
    return renamed;
  }

  async delete({
    id,
    organizationId,
    actor,
    evenIfDirectoryManaged = false,
  }: {
    id: string;
    organizationId: string;
    actor: LedgerActor;
    /**
     * Whether a directory-owned group may be deleted anyway. The API surface
     * says no: a caller automating against it cannot be asked. The settings
     * page says yes, because it asks first — its confirmation reads "This
     * SCIM group will be re-created by your IdP on next sync. Delete anyway?"
     * and the admin answers it.
     */
    evenIfDirectoryManaged?: boolean;
  }): Promise<void> {
    const group = await this.repo.findGroupOnly({ id, organizationId });
    if (!group) throw new GroupNotFoundError();
    // Deleting is the most destructive thing that can happen to a group the
    // directory owns: every grant it carries goes with it, and the next sync
    // pushes the group back without them.
    if (group.scimSource && !evenIfDirectoryManaged) {
      throw new ScimManagedGroupError(id);
    }

    // The grants go first, so the deny is enforced before the group row
    // that carries them disappears.
    await this.repo.deleteAllBindings({ groupId: id, organizationId, actor });
    await this.repo.deleteAllMemberships({ groupId: id });
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
    if (!group) throw new GroupNotFoundError();
    if (group.scimSource) {
      throw new ScimManagedGroupError(groupId);
    }

    const isOrgMember = await this.repo.isUserInOrganization({
      userId,
      organizationId,
    });
    if (!isOrgMember) {
      throw new UserNotInOrganizationError(userId);
    }

    try {
      return await this.repo.addMember({ groupId, userId });
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as { code: string }).code === "P2002"
      ) {
        throw new DuplicateMemberError(userId);
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
    if (!group) throw new GroupNotFoundError();
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
    actor,
  }: {
    groupId: string;
    organizationId: string;
    role: TeamUserRole;
    customRoleId?: string;
    scopeType: RoleBindingScopeType;
    scopeId: string;
    actor: LedgerActor;
  }): Promise<CreatedBinding> {
    const group = await this.repo.findGroupOnly({
      id: groupId,
      organizationId,
    });
    if (!group) throw new GroupNotFoundError();

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

    await this.assertCustomRolesAssignable({
      organizationId,
      bindings: [{ role, customRoleId, scopeType }],
    });
    await this.assertNoPersonalTeamScope([{ scopeType, scopeId }]);

    try {
      return await this.repo.createBinding(
        {
          id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
          organizationId,
          groupId,
          role,
          customRoleId:
            role === ("CUSTOM" as TeamUserRole) ? (customRoleId ?? null) : null,
          scopeType,
          scopeId,
        },
        { actor },
      );
    } catch (error) {
      // The repository rejects duplicate identities rather than skipping
      // them: a skipped duplicate would return a binding id for a row that
      // was never created.
      if (error instanceof DuplicateBindingError) {
        throw new RoleBindingAlreadyExistsError({
          meta: { scopeType, scopeId },
        });
      }
      throw error;
    }
  }

  async removeBinding({
    bindingId,
    organizationId,
    actor,
  }: {
    bindingId: string;
    organizationId: string;
    actor: LedgerActor;
  }): Promise<void> {
    const binding = await this.repo.findBinding({
      id: bindingId,
      organizationId,
    });
    if (!binding) throw new BindingNotFoundError();
    await this.assertNoPersonalTeamScope([binding]);

    await this.repo.deleteBinding({ id: bindingId, organizationId, actor });
  }
}
