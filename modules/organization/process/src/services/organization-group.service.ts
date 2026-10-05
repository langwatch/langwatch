import type { AuthzApi } from "@langwatch/authz-contract";
import {
  GroupBindingNotFoundError,
  ScimManagedGroupError,
  addOrganizationGroupGrantInputSchema,
  addOrganizationGroupMemberInputSchema,
  applyOrganizationGroupEditsInputSchema,
  changeOrganizationGroupMemberInputSchema,
  createOrganizationGroupInputSchema,
  deleteOrganizationGroupInputSchema,
  getOrganizationGroupInputSchema,
  listMemberOrganizationGroupsInputSchema,
  listOrganizationGroupsInputSchema,
  removeOrganizationGroupGrantInputSchema,
  renameOrganizationGroupInputSchema,
  type AddOrganizationGroupGrantInput,
  type ApplyOrganizationGroupEditsInput,
  type AddOrganizationGroupMemberInput,
  type ChangeOrganizationGroupMemberInput,
  type CreateOrganizationGroupInput,
  type DeleteOrganizationGroupInput,
  type GetOrganizationGroupInput,
  type ListMemberOrganizationGroupsInput,
  type ListOrganizationGroupsInput,
  type OrganizationGroup,
  type OrganizationGroupGrant,
  type OrganizationGroupDetails,
  type OrganizationGroupPage,
  type OrganizationGroupSummary,
  type RemoveOrganizationGroupGrantInput,
  type RenameOrganizationGroupInput,
} from "@langwatch/organization-contract";

import type { GroupRepository } from "../repositories/group.repository.ts";
import type { TeamRepository } from "../repositories/team.repository.ts";
import type { GroupIdentity } from "./group-identity.service.ts";

/**
 * Groups: the named sets of people an organization binds to scopes, and the bindings
 * themselves. Composed by `OrganizationService`, which is the only caller.
 */
export type OrganizationGroupDependencies = {
  groups: GroupRepository;
  groupIdentities: GroupIdentity;
  teams: TeamRepository;
  authz: AuthzApi;
  grants: AuthzApi;
};

import { OrganizationGrantCeilingService } from "./organization-grant-ceiling.service.ts";
import { OrganizationGroupGrantService } from "./organization-group-grant.service.ts";

export class OrganizationGroupService {
  static create(dependencies: OrganizationGroupDependencies): OrganizationGroupService {
    return new OrganizationGroupService(dependencies);
  }

  private readonly bindings: OrganizationGroupGrantService;

  private constructor(private readonly dependencies: OrganizationGroupDependencies) {
    this.bindings = OrganizationGroupGrantService.create(dependencies);
  }

  private get groups(): GroupRepository {
    return this.dependencies.groups;
  }

  private get groupIdentities(): GroupIdentity {
    return this.dependencies.groupIdentities;
  }

  private get teams(): TeamRepository {
    return this.dependencies.teams;
  }

  private get authz(): AuthzApi {
    return this.dependencies.authz;
  }

  private get grants(): AuthzApi {
    return this.dependencies.grants;
  }

  async getGroup(input: GetOrganizationGroupInput): Promise<OrganizationGroupDetails> {
    const parsed = getOrganizationGroupInputSchema.parse(input);
    const [group, members, bindings] = await Promise.all([
      this.groups.get(parsed),
      this.groups.findMembers(parsed),
      this.bindings.readGroupBindings(parsed),
    ]);

    return { ...group, members, grants: bindings };
  }

  async listGroups(input: ListOrganizationGroupsInput): Promise<OrganizationGroupPage> {
    const parsed = listOrganizationGroupsInputSchema.parse(input);
    const [page, bindings] = await Promise.all([
      this.groups.listAll(parsed),
      this.authz.listOrganizationBindings({
        organizationId: parsed.organizationId,
      }),
    ]);
    const bindingsByGroup = this.bindings.groupBindingsByGroup(bindings);

    return {
      ...page,
      data: page.data.map((group) => ({
        ...group,
        grants: bindingsByGroup.get(group.id) ?? [],
      })),
    };
  }

  async listGroupsForMember(
    input: ListMemberOrganizationGroupsInput,
  ): Promise<OrganizationGroupSummary[]> {
    const parsed = listMemberOrganizationGroupsInputSchema.parse(input);
    const [groups, bindings] = await Promise.all([
      this.groups.findForMember(parsed),
      this.authz.listOrganizationBindings({
        organizationId: parsed.organizationId,
      }),
    ]);
    const bindingsByGroup = this.bindings.groupBindingsByGroup(bindings);

    return groups.map((group) => ({
      ...group,
      grants: bindingsByGroup.get(group.id) ?? [],
    }));
  }

  async createGroup(input: CreateOrganizationGroupInput): Promise<OrganizationGroup> {
    const parsed = createOrganizationGroupInputSchema.parse(input);
    const memberIds = [...new Set(parsed.memberIds ?? [])];
    await this.teams.getOrganizationMembers({
      organizationId: parsed.organizationId,
      userIds: memberIds,
    });
    const bindings = parsed.grants ?? [];
    await this.bindings.validateGroupBindings(parsed.organizationId, bindings);
    await OrganizationGrantCeilingService.create(this.grants).assertWithinCaller({
      organizationId: parsed.organizationId,
      caller: parsed.caller,
      grants: bindings,
    });
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
        caller: parsed.caller,
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

  async addGroupMember(input: AddOrganizationGroupMemberInput): Promise<void> {
    const parsed = addOrganizationGroupMemberInputSchema.parse(input);
    const group = await this.groups.get(parsed);
    if (group.scimSource) {
      throw new ScimManagedGroupError(group.id);
    }
    await OrganizationGrantCeilingService.create(this.grants).assertWithinCaller({
      organizationId: parsed.organizationId,
      caller: parsed.caller,
      grants: await this.bindings.readGroupBindings(parsed),
    });

    await this.teams.getOrganizationMembers({
      organizationId: parsed.organizationId,
      userIds: [parsed.userId],
    });
    await this.groups.addMember(parsed);
    await this.grants.invalidateOrganization({ organizationId: parsed.organizationId });
  }

  async removeGroupMember(input: ChangeOrganizationGroupMemberInput): Promise<void> {
    const parsed = changeOrganizationGroupMemberInputSchema.parse(input);
    const group = await this.groups.get(parsed);
    if (group.scimSource) {
      throw new ScimManagedGroupError(group.id);
    }

    await this.groups.removeMember(parsed);
    await this.grants.invalidateOrganization({ organizationId: parsed.organizationId });
  }

  async listGroupBindings(input: GetOrganizationGroupInput): Promise<OrganizationGroupGrant[]> {
    const parsed = getOrganizationGroupInputSchema.parse(input);
    await this.groups.get(parsed);

    return this.bindings.readGroupBindings(parsed);
  }

  async addGroupGrant(input: AddOrganizationGroupGrantInput): Promise<OrganizationGroupGrant> {
    const parsed = addOrganizationGroupGrantInputSchema.parse(input);
    await this.groups.get(parsed);
    await this.bindings.validateGroupBindings(parsed.organizationId, [parsed.grant]);
    const write = this.bindings.groupBindingWrite(parsed.groupId, parsed.grant);
    await this.grants.attachBindings({
      organizationId: parsed.organizationId,
      bindings: [write],
      caller: parsed.caller,
      actor: parsed.actor,
      onDuplicate: "attach",
    });

    return {
      id: write.bindingId,
      role: write.role,
      customRoleId: write.customRoleId,
      customRoleName: null,
      scopeType: write.scopeType,
      scopeId: write.scopeId,
    };
  }

  async removeGroupGrant(input: RemoveOrganizationGroupGrantInput): Promise<void> {
    const parsed = removeOrganizationGroupGrantInputSchema.parse(input);
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
        id === parsed.grantId &&
        groupId !== null &&
        (parsed.groupId === undefined || groupId === parsed.groupId),
    );
    if (!rawBinding?.groupId) {
      throw new GroupBindingNotFoundError(parsed.grantId);
    }

    await this.groups.get({
      organizationId: parsed.organizationId,
      groupId: rawBinding.groupId,
    });
    const binding = this.bindings.toGroupBinding(rawBinding);
    await this.bindings.assertGroupScopes(parsed.organizationId, [binding]);
    await this.grants.revokeBindings({
      organizationId: parsed.organizationId,
      bindingIds: [parsed.grantId],
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
    await this.bindings.validateGroupBindings(parsed.organizationId, parsed.grantsToCreate);
    await OrganizationGrantCeilingService.create(this.grants).assertWithinCaller({
      organizationId: parsed.organizationId,
      caller: parsed.caller,
      grants: parsed.grantsToCreate,
    });
    const currentBindings = await this.bindings.readGroupBindings(parsed);
    const deletedIds = new Set(parsed.grantIdsToRevoke);
    const bindingsToDelete = currentBindings.filter(({ id }) => deletedIds.has(id));
    if (memberIdsToAdd.length > 0) {
      // New members receive what the group keeps holding, so the caller must hold it too.
      await OrganizationGrantCeilingService.create(this.grants).assertWithinCaller({
        organizationId: parsed.organizationId,
        caller: parsed.caller,
        grants: currentBindings.filter(({ id }) => !deletedIds.has(id)),
      });
    }
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
    if (memberIdsToAdd.length > 0 || parsed.memberUserIdsToRemove.length > 0) {
      // A membership is not a grant write, so it bumps the grants cache's epoch itself.
      await this.grants.invalidateOrganization({ organizationId: parsed.organizationId });
    }
    if (parsed.grantsToCreate.length > 0) {
      await this.grants.attachBindings({
        organizationId: parsed.organizationId,
        bindings: parsed.grantsToCreate.map((binding) =>
          this.bindings.groupBindingWrite(parsed.groupId, binding),
        ),
        caller: parsed.caller,
        actor: parsed.actor,
        onDuplicate: "skip",
      });
    }
  }
}
