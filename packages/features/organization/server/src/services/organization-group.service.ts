import {
  DuplicateBindingError,
  type AuthzGrantsService,
  type AuthzService,
} from "@langwatch/authz-contract";
import {
  GroupBindingAlreadyExistsError,
  GroupBindingNotFoundError,
  ScimManagedGroupError,
  addOrganizationGroupBindingInputSchema,
  applyOrganizationGroupEditsInputSchema,
  changeOrganizationGroupMemberInputSchema,
  createOrganizationGroupInputSchema,
  deleteOrganizationGroupInputSchema,
  getOrganizationGroupInputSchema,
  listMemberOrganizationGroupsInputSchema,
  listOrganizationGroupsInputSchema,
  removeOrganizationGroupBindingInputSchema,
  renameOrganizationGroupInputSchema,
  type AddOrganizationGroupBindingInput,
  type ApplyOrganizationGroupEditsInput,
  type ChangeOrganizationGroupMemberInput,
  type CreateOrganizationGroupInput,
  type DeleteOrganizationGroupInput,
  type GetOrganizationGroupInput,
  type ListMemberOrganizationGroupsInput,
  type ListOrganizationGroupsInput,
  type OrganizationGroup,
  type OrganizationGroupBinding,
  type OrganizationGroupDetails,
  type OrganizationGroupPage,
  type OrganizationGroupSummary,
  type RemoveOrganizationGroupBindingInput,
  type RenameOrganizationGroupInput,
} from "@langwatch/organization-contract";
import type { GroupIdentityPort } from "../ports/organization.port";
import type { GroupRepository } from "../repositories/group.repository";
import type { TeamRepository } from "../repositories/team.repository";

/**
 * Groups: the named sets of people an organization binds to scopes, and the bindings
 * themselves. Composed by `OrganizationService`, which is the only caller.
 */
export type OrganizationGroupDependencies = {
  groups: GroupRepository;
  groupIdentities: GroupIdentityPort;
  teams: TeamRepository;
  authz: AuthzService;
  grants: AuthzGrantsService;
};

import { OrganizationGroupBindingService } from "./organization-group-binding.service";

export class OrganizationGroupService {
  static create(dependencies: OrganizationGroupDependencies): OrganizationGroupService {
    return new OrganizationGroupService(dependencies);
  }

  private readonly bindings: OrganizationGroupBindingService;

  private constructor(private readonly dependencies: OrganizationGroupDependencies) {
    this.bindings = OrganizationGroupBindingService.create(dependencies);
  }

  private get groups(): GroupRepository {
    return this.dependencies.groups;
  }

  private get groupIdentities(): GroupIdentityPort {
    return this.dependencies.groupIdentities;
  }

  private get teams(): TeamRepository {
    return this.dependencies.teams;
  }

  private get authz(): AuthzService {
    return this.dependencies.authz;
  }

  private get grants(): AuthzGrantsService {
    return this.dependencies.grants;
  }

  async getGroup(input: GetOrganizationGroupInput): Promise<OrganizationGroupDetails> {
    const parsed = getOrganizationGroupInputSchema.parse(input);
    const [group, members, bindings] = await Promise.all([
      this.groups.get(parsed),
      this.groups.listMembers(parsed),
      this.bindings.readGroupBindings(parsed),
    ]);

    return { ...group, members, bindings };
  }

  async listGroups(input: ListOrganizationGroupsInput): Promise<OrganizationGroupPage> {
    const parsed = listOrganizationGroupsInputSchema.parse(input);
    const [page, bindings] = await Promise.all([
      this.groups.list(parsed),
      this.authz.listOrganizationBindings({
        organizationId: parsed.organizationId,
      }),
    ]);
    const bindingsByGroup = this.bindings.groupBindingsByGroup(bindings);

    return {
      ...page,
      data: page.data.map((group) => ({
        ...group,
        bindings: bindingsByGroup.get(group.id) ?? [],
      })),
    };
  }

  async listGroupsForMember(
    input: ListMemberOrganizationGroupsInput,
  ): Promise<OrganizationGroupSummary[]> {
    const parsed = listMemberOrganizationGroupsInputSchema.parse(input);
    const [groups, bindings] = await Promise.all([
      this.groups.listForMember(parsed),
      this.authz.listOrganizationBindings({
        organizationId: parsed.organizationId,
      }),
    ]);
    const bindingsByGroup = this.bindings.groupBindingsByGroup(bindings);

    return groups.map((group) => ({
      ...group,
      bindings: bindingsByGroup.get(group.id) ?? [],
    }));
  }

  async createGroup(input: CreateOrganizationGroupInput): Promise<OrganizationGroup> {
    const parsed = createOrganizationGroupInputSchema.parse(input);
    const memberIds = [...new Set(parsed.memberIds ?? [])];
    await this.teams.getOrganizationMembers({
      organizationId: parsed.organizationId,
      userIds: memberIds,
    });
    const bindings = parsed.bindings ?? [];
    await this.bindings.validateGroupBindings(parsed.organizationId, bindings);
    const baseSlug = this.groupIdentities.slugify(parsed.name);
    const slug = await this.groups.nextAvailableSlug({
      organizationId: parsed.organizationId,
      baseSlug,
    });
    const group = await this.groups.create({
      groupId: this.groupIdentities.createGroupId(),
      organizationId: parsed.organizationId,
      name: parsed.name,
      slug,
      memberIds,
    });
    if (bindings.length > 0) {
      await this.grants.attachBindings({
        organizationId: parsed.organizationId,
        bindings: bindings.map((binding) => this.bindings.groupBindingWrite(group.id, binding)),
        actor: parsed.actor,
        onDuplicate: "skip",
      });
    }

    return group;
  }

  async renameGroup(input: RenameOrganizationGroupInput): Promise<OrganizationGroup> {
    const parsed = renameOrganizationGroupInputSchema.parse(input);
    const group = await this.groups.get(parsed);
    if (group.scimSource) {
      throw new ScimManagedGroupError(group.id);
    }

    const slug = await this.groups.nextAvailableSlug({
      organizationId: parsed.organizationId,
      baseSlug: this.groupIdentities.slugify(parsed.name),
      excludeGroupId: parsed.groupId,
    });

    return this.groups.rename({ ...parsed, slug });
  }

  async deleteGroup(input: DeleteOrganizationGroupInput): Promise<void> {
    const parsed = deleteOrganizationGroupInputSchema.parse(input);
    const group = await this.groups.get(parsed);
    if (group.scimSource && !parsed.allowScimManaged) {
      throw new ScimManagedGroupError(group.id);
    }

    await this.grants.revokeBindingsWhere({
      organizationId: parsed.organizationId,
      where: { groupId: parsed.groupId },
      actor: parsed.actor,
      reason: "group deleted",
    });
    await this.groups.delete(parsed);
  }

  async addGroupMember(input: ChangeOrganizationGroupMemberInput): Promise<void> {
    const parsed = changeOrganizationGroupMemberInputSchema.parse(input);
    const group = await this.groups.get(parsed);
    if (group.scimSource) {
      throw new ScimManagedGroupError(group.id);
    }

    await this.teams.getOrganizationMembers({
      organizationId: parsed.organizationId,
      userIds: [parsed.userId],
    });
    await this.groups.addMember(parsed);
  }

  async removeGroupMember(input: ChangeOrganizationGroupMemberInput): Promise<void> {
    const parsed = changeOrganizationGroupMemberInputSchema.parse(input);
    const group = await this.groups.get(parsed);
    if (group.scimSource) {
      throw new ScimManagedGroupError(group.id);
    }

    await this.groups.removeMember(parsed);
  }

  async listGroupBindings(input: GetOrganizationGroupInput): Promise<OrganizationGroupBinding[]> {
    const parsed = getOrganizationGroupInputSchema.parse(input);
    await this.groups.get(parsed);

    return this.bindings.readGroupBindings(parsed);
  }

  async addGroupBinding(
    input: AddOrganizationGroupBindingInput,
  ): Promise<OrganizationGroupBinding> {
    const parsed = addOrganizationGroupBindingInputSchema.parse(input);
    await this.groups.get(parsed);
    await this.bindings.validateGroupBindings(parsed.organizationId, [parsed.binding]);
    const write = this.bindings.groupBindingWrite(parsed.groupId, parsed.binding);
    try {
      await this.grants.attachBindings({
        organizationId: parsed.organizationId,
        bindings: [write],
        actor: parsed.actor,
        onDuplicate: "reject",
      });
    } catch (error) {
      if (
        error instanceof DuplicateBindingError ||
        (typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "role_binding_already_exists")
      ) {
        throw new GroupBindingAlreadyExistsError();
      }

      throw error;
    }

    return {
      id: write.bindingId,
      role: write.role,
      customRoleId: write.customRoleId,
      customRoleName: null,
      scopeType: write.scopeType,
      scopeId: write.scopeId,
    };
  }

  async removeGroupBinding(input: RemoveOrganizationGroupBindingInput): Promise<void> {
    const parsed = removeOrganizationGroupBindingInputSchema.parse(input);
    const rawBindings = parsed.groupId
      ? await this.authz.listGroupBindings({
          organizationId: parsed.organizationId,
          groupId: parsed.groupId,
        })
      : await this.authz.listOrganizationBindings({
          organizationId: parsed.organizationId,
        });
    const rawBinding = rawBindings.find(
      ({ id, groupId }) =>
        id === parsed.bindingId &&
        groupId !== null &&
        (parsed.groupId === undefined || groupId === parsed.groupId),
    );
    if (!rawBinding?.groupId) {
      throw new GroupBindingNotFoundError(parsed.bindingId);
    }

    await this.groups.get({
      organizationId: parsed.organizationId,
      groupId: rawBinding.groupId,
    });
    const binding = this.bindings.toGroupBinding(rawBinding);
    await this.bindings.assertGroupScopes(parsed.organizationId, [binding]);
    await this.grants.revokeBindings({
      organizationId: parsed.organizationId,
      bindingIds: [parsed.bindingId],
      actor: parsed.actor,
      reason: "group binding removed",
    });
  }

  async applyGroupEdits(input: ApplyOrganizationGroupEditsInput): Promise<void> {
    const parsed = applyOrganizationGroupEditsInputSchema.parse(input);
    const group = await this.groups.get(parsed);
    if (
      group.scimSource &&
      (parsed.rename ||
        parsed.memberUserIdsToAdd.length > 0 ||
        parsed.memberUserIdsToRemove.length > 0)
    ) {
      throw new ScimManagedGroupError(group.id);
    }

    const memberIdsToAdd = [...new Set(parsed.memberUserIdsToAdd)];
    await this.teams.getOrganizationMembers({
      organizationId: parsed.organizationId,
      userIds: memberIdsToAdd,
    });
    await this.bindings.validateGroupBindings(parsed.organizationId, parsed.bindingsToCreate);
    const currentBindings = await this.bindings.readGroupBindings(parsed);
    const deletedIds = new Set(parsed.bindingIdsToDelete);
    const bindingsToDelete = currentBindings.filter(({ id }) => deletedIds.has(id));
    await this.bindings.assertGroupScopes(parsed.organizationId, bindingsToDelete);
    if (bindingsToDelete.length > 0) {
      await this.grants.revokeBindings({
        organizationId: parsed.organizationId,
        bindingIds: bindingsToDelete.map(({ id }) => id),
        actor: parsed.actor,
      });
    }

    const rename = parsed.rename
      ? {
          name: parsed.rename.name,
          slug: await this.groups.nextAvailableSlug({
            organizationId: parsed.organizationId,
            baseSlug: this.groupIdentities.slugify(parsed.rename.name),
            excludeGroupId: parsed.groupId,
          }),
        }
      : parsed.rename;
    await this.groups.applyEdits({
      groupId: parsed.groupId,
      organizationId: parsed.organizationId,
      rename,
      memberUserIdsToAdd: memberIdsToAdd,
      memberUserIdsToRemove: [...new Set(parsed.memberUserIdsToRemove)],
    });
    if (parsed.bindingsToCreate.length > 0) {
      await this.grants.attachBindings({
        organizationId: parsed.organizationId,
        bindings: parsed.bindingsToCreate.map((binding) =>
          this.bindings.groupBindingWrite(parsed.groupId, binding),
        ),
        actor: parsed.actor,
        onDuplicate: "skip",
      });
    }
  }
}
