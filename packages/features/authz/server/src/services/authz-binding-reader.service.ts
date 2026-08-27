import {
  builtinRolePermissions,
  roleKeyForTeamRole,
  type AuthzAccessBinding,
  type AuthzAccessBreakdownInput,
  type AuthzAccessBreakdownOutput,
  type AuthzLegacyAccessNoticeInput,
  type AuthzListManagedBindingsForOrganizationInput,
  type AuthzListManagedBindingsForOrganizationOutput,
  type AuthzListManagedBindingsForUserInput,
  type AuthzListManagedBindingsForUserOutput,
  type OrganizationRole,
} from "@langwatch/authz-contract";
import type { AuthzBindingRepository } from "../repositories/authz-binding.repository";
import type { AuthzListingRepository } from "../repositories/authz-listing.repository";

export class AuthzBindingReaderService {
  static create(options: {
    bindings: AuthzBindingRepository;
    listing: AuthzListingRepository;
  }): AuthzBindingReaderService {
    return new AuthzBindingReaderService(options);
  }

  private constructor(
    private readonly options: {
      bindings: AuthzBindingRepository;
      listing: AuthzListingRepository;
    },
  ) {}

  async wouldFirstBindingDisableLegacyAccess(
    input: AuthzLegacyAccessNoticeInput,
  ): Promise<boolean> {
    const [hasBinding, hasLegacyMembership] = await Promise.all([
      this.options.bindings.hasBindingsForUser(input),
      this.options.bindings.hasLegacySharedTeamMembership(input),
    ]);

    return !hasBinding && hasLegacyMembership;
  }

  async listForUser({
    organizationId,
    userId,
  }: AuthzListManagedBindingsForUserInput): Promise<AuthzListManagedBindingsForUserOutput> {
    const bindings = await this.options.listing.findUserBindings({
      organizationId,
      userId,
    });
    const scopes = await this.scopeContext({ organizationId, bindings });

    return bindings
      .filter((binding) => !scopes.personalIds.has(binding.scopeId))
      .map((binding) => ({
        id: binding.id,
        userId: binding.userId,
        role: binding.role,
        customRoleId: binding.customRoleId,
        customRoleName: binding.customRole?.name ?? null,
        scopeType: binding.scopeType,
        scopeId: binding.scopeId,
        scopeName: scopes.names.get(binding.scopeId) ?? null,
        createdAt: binding.createdAt,
      }));
  }

  async listForOrganization({
    organizationId,
  }: AuthzListManagedBindingsForOrganizationInput): Promise<AuthzListManagedBindingsForOrganizationOutput> {
    const bindings = await this.options.listing.findOrganizationBindings({
      organizationId,
    });
    const scopes = await this.scopeContext({ organizationId, bindings });
    const manageable = bindings.filter((binding) => !scopes.personalIds.has(binding.scopeId));
    const groupIds = manageable.flatMap((binding) => (binding.groupId ? [binding.groupId] : []));
    const memberships = await this.options.bindings.findGroupMembers({
      organizationId,
      groupIds,
    });
    const membersByGroup = new Map<string, string[]>();
    for (const membership of memberships) {
      const members = membersByGroup.get(membership.groupId) ?? [];
      members.push(membership.userId);
      membersByGroup.set(membership.groupId, members);
    }

    return manageable.map((binding) => ({
      id: binding.id,
      userId: binding.userId,
      userName: binding.user?.name ?? null,
      userEmail: binding.user?.email ?? null,
      userImage: binding.user?.image ?? null,
      groupId: binding.groupId,
      groupName: binding.group?.name ?? null,
      groupScimSource: binding.group?.scimSource ?? null,
      apiKeyId: binding.apiKeyId,
      apiKeyName: binding.apiKey?.name ?? null,
      role: binding.role,
      customRoleId: binding.customRoleId,
      customRoleName: binding.customRole?.name ?? null,
      scopeType: binding.scopeType,
      scopeId: binding.scopeId,
      scopeName: scopes.names.get(binding.scopeId) ?? null,
      memberUserIds: binding.groupId ? (membersByGroup.get(binding.groupId) ?? []) : [],
      createdAt: binding.createdAt,
    }));
  }

  async getAccessBreakdown({
    organizationId,
    userId,
    userName,
    userEmail,
  }: AuthzAccessBreakdownInput): Promise<AuthzAccessBreakdownOutput> {
    const [organizationRole, groupMemberships] = await Promise.all([
      this.options.bindings.tryFindOrganizationRole({ organizationId, userId }),
      this.options.bindings.findUserGroups({ organizationId, userId }),
    ]);
    const groupIds = groupMemberships.map((membership) => membership.groupId);
    const bindings = await this.options.listing.findUserAndGroupBindings({
      organizationId,
      userId,
      groupIds,
    });
    const scopes = await this.scopeContext({ organizationId, bindings });
    const bindingSummary = (binding: AuthzAccessBinding) => ({
      id: binding.id,
      role: binding.role,
      customRoleName: binding.customRole?.name ?? null,
      scopeType: binding.scopeType,
      scopeId: binding.scopeId,
      scopeName: scopes.names.get(binding.scopeId) ?? null,
      permissions: this.permissionsForBinding(binding),
    });
    const groupBindings = new Map<string, AuthzAccessBinding[]>();
    for (const binding of bindings) {
      if (!binding.groupId) {
        continue;
      }

      const rows = groupBindings.get(binding.groupId) ?? [];
      rows.push(binding);
      groupBindings.set(binding.groupId, rows);
    }

    const orgRole = organizationRole ?? "MEMBER";

    return {
      user: {
        id: userId,
        name: userName,
        email: userEmail,
        orgRole,
        orgRolePermissions: this.permissionsForOrganizationRole(orgRole),
      },
      groups: groupMemberships.map((membership) => ({
        id: membership.group.id,
        name: membership.group.name,
        slug: membership.group.slug,
        scimSource: membership.group.scimSource,
        bindings: (groupBindings.get(membership.groupId) ?? []).map(bindingSummary),
      })),
      directBindings: bindings.filter((binding) => binding.userId === userId).map(bindingSummary),
    };
  }

  private async scopeContext({
    organizationId,
    bindings,
  }: {
    organizationId: string;
    bindings: ReadonlyArray<Pick<AuthzAccessBinding, "scopeType" | "scopeId">>;
  }): Promise<{ names: Map<string, string>; personalIds: Set<string> }> {
    const rows = await this.options.bindings.findScopeRows({
      organizationId,
      scopes: bindings,
    });
    const names = new Map(rows.map((row) => [row.id, row.name]));
    const personalIds = new Set(
      rows.filter((row) => row.personalWorkspaceName !== null).map((row) => row.id),
    );

    return { names, personalIds };
  }

  private permissionsForBinding(binding: AuthzAccessBinding): string[] {
    if (binding.role === "CUSTOM" && binding.customRole) {
      return Array.isArray(binding.customRole.permissions)
        ? binding.customRole.permissions.filter(
            (permission): permission is string => typeof permission === "string",
          )
        : [];
    }

    if (binding.scopeType === "ORGANIZATION") {
      const organizationRole = this.organizationRoleForBinding(binding);

      return this.permissionsForOrganizationRole(organizationRole);
    }

    return [...builtinRolePermissions(roleKeyForTeamRole(binding.role))];
  }

  private organizationRoleForBinding(binding: AuthzAccessBinding): OrganizationRole {
    if (binding.role === "ADMIN") {
      return "ADMIN";
    }

    if (binding.role === "MEMBER") {
      return "MEMBER";
    }

    return "EXTERNAL";
  }

  private permissionsForOrganizationRole(role: OrganizationRole): string[] {
    return [...builtinRolePermissions(role === "ADMIN" ? "org-admin" : "org-member")];
  }
}
