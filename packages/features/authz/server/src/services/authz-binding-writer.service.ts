import {
  ApiKeyNotInOrganizationError,
  AuthzLiteMemberViewerOnlyError,
  AuthzPersonalWorkspaceNotManagedHereError,
  bindingScopeCanGrantPermission,
  CustomRoleIdRequiredError,
  CustomRoleNotAssignableError,
  DuplicateGrantError,
  GroupNotInOrganizationError,
  OrgExclusivePermissionScopeError,
  RoleBindingNotFoundError,
  RoleBindingPrincipalInvalidError,
  ScopeNotInOrganizationError,
  UserNotInOrganizationError,
  type AuthzApplyMemberBindingsInput,
  type AuthzBindingMutationSuccess,
  type AuthzBindingWrite,
  type AuthzCreateBindingInput,
  type AuthzCreateBindingOutput,
  type AuthzLedgerBindingPrincipal,
  type AuthzUpdateBindingInput,
  type AuthzDeleteBindingInput,
  type OrganizationRole,
  type RoleBindingScopeType,
} from "@langwatch/authz-contract";
import type { AuthzCompatibilityLedgerPort } from "../ports/authz-compatibility-ledger.port";
import type {
  AuthzBindingRepository,
  AuthzBindingScopeRow,
} from "../repositories/authz-binding.repository";

export class AuthzBindingWriterService {
  static create(options: {
    bindings: AuthzBindingRepository;
    ledger: AuthzCompatibilityLedgerPort;
    newBindingId: () => string;
  }): AuthzBindingWriterService {
    return new AuthzBindingWriterService(options);
  }

  private constructor(
    private readonly options: {
      bindings: AuthzBindingRepository;
      ledger: AuthzCompatibilityLedgerPort;
      newBindingId: () => string;
    },
  ) {}

  async create(input: AuthzCreateBindingInput): Promise<AuthzCreateBindingOutput> {
    const principal = this.principalOf(input);
    const scopeRows = await this.validateScopes({
      organizationId: input.organizationId,
      scopes: [input],
    });
    this.assertNoPersonalScope(scopeRows);
    const { organizationRole } = await this.validatePrincipal({
      organizationId: input.organizationId,
      userId: input.userId,
      groupId: input.groupId,
      apiKeyId: input.apiKeyId,
    });
    await this.validateRoles({
      organizationId: input.organizationId,
      bindings: [input],
    });
    this.assertLiteMemberCeiling({
      organizationRole,
      bindings: [input],
      scopeRows,
    });

    const bindingId = this.options.newBindingId();
    try {
      await this.options.ledger.attachBindings({
        organizationId: input.organizationId,
        bindings: [
          {
            bindingId,
            principal,
            role: input.role,
            customRoleId: input.role === "CUSTOM" ? (input.customRoleId ?? null) : null,
            scopeType: input.scopeType,
            scopeId: input.scopeId,
          },
        ],
        actor: input.actor,
        onDuplicate: "reject",
      });
    } catch (error) {
      this.rethrowDuplicate(error, {
        scopeType: input.scopeType,
        scopeId: input.scopeId,
      });
    }

    return { id: bindingId };
  }

  async update(input: AuthzUpdateBindingInput): Promise<AuthzCreateBindingOutput> {
    const binding = await this.options.bindings.tryFindBinding(input);
    if (!binding) {
      throw new RoleBindingNotFoundError(input.bindingId);
    }

    const scopeRows = await this.validateScopes({
      organizationId: input.organizationId,
      scopes: [binding],
    });
    this.assertNoPersonalScope(scopeRows);
    await this.validateRoles({
      organizationId: input.organizationId,
      bindings: [
        {
          role: input.role,
          customRoleId: input.customRoleId,
          scopeType: binding.scopeType,
          scopeId: binding.scopeId,
        },
      ],
    });

    if (binding.userId) {
      const organizationRole = await this.options.bindings.tryFindOrganizationRole({
        organizationId: input.organizationId,
        userId: binding.userId,
      });
      if (organizationRole) {
        this.assertLiteMemberCeiling({
          organizationRole,
          bindings: [{ ...binding, role: input.role }],
          scopeRows,
        });
      }
    }

    try {
      await this.options.ledger.changeBindingRole({
        organizationId: input.organizationId,
        bindingId: input.bindingId,
        role: input.role,
        customRoleId: input.role === "CUSTOM" ? (input.customRoleId ?? null) : null,
        actor: input.actor,
      });
    } catch (error) {
      this.rethrowDuplicate(error, {
        scopeType: binding.scopeType,
        scopeId: binding.scopeId,
      });
    }

    return { id: input.bindingId };
  }

  async delete(input: AuthzDeleteBindingInput): Promise<AuthzBindingMutationSuccess> {
    const binding = await this.options.bindings.tryFindBinding(input);
    if (!binding) {
      throw new RoleBindingNotFoundError(input.bindingId);
    }

    const scopeRows = await this.validateScopes({
      organizationId: input.organizationId,
      scopes: [binding],
    });
    this.assertNoPersonalScope(scopeRows);
    await this.options.ledger.revokeBindings({
      organizationId: input.organizationId,
      bindingIds: [input.bindingId],
      actor: input.actor,
    });

    return { success: true };
  }

  async applyMemberBindings(
    input: AuthzApplyMemberBindingsInput,
  ): Promise<AuthzBindingMutationSuccess> {
    const { organizationRole } = await this.validatePrincipal({
      organizationId: input.organizationId,
      userId: input.userId,
    });
    const createScopeRows = await this.validateScopes({
      organizationId: input.organizationId,
      scopes: input.bindingsToCreate,
    });
    this.assertNoPersonalScope(createScopeRows);
    await this.validateRoles({
      organizationId: input.organizationId,
      bindings: input.bindingsToCreate,
    });
    this.assertLiteMemberCeiling({
      organizationRole,
      bindings: input.bindingsToCreate,
      scopeRows: createScopeRows,
    });

    const deletions = await this.options.bindings.findDirectUserBindings({
      organizationId: input.organizationId,
      userId: input.userId,
      bindingIds: input.bindingIdsToDelete,
    });
    if (deletions.length > 0) {
      const deleteScopeRows = await this.validateScopes({
        organizationId: input.organizationId,
        scopes: deletions,
      });
      this.assertNoPersonalScope(deleteScopeRows);
      await this.options.ledger.revokeBindings({
        organizationId: input.organizationId,
        bindingIds: deletions.map((binding) => binding.id),
        actor: input.actor,
      });
    }

    if (input.bindingsToCreate.length > 0) {
      await this.options.ledger.attachBindings({
        organizationId: input.organizationId,
        bindings: input.bindingsToCreate.map((binding) => ({
          bindingId: this.options.newBindingId(),
          principal: { userId: input.userId },
          role: binding.role,
          customRoleId: binding.role === "CUSTOM" ? (binding.customRoleId ?? null) : null,
          scopeType: binding.scopeType,
          scopeId: binding.scopeId,
        })),
        actor: input.actor,
        onDuplicate: "skip",
      });
    }

    return { success: true };
  }

  private principalOf(input: AuthzCreateBindingInput): AuthzLedgerBindingPrincipal {
    const principals = [input.userId, input.groupId, input.apiKeyId].filter((id): id is string =>
      Boolean(id),
    );
    if (principals.length !== 1) {
      throw new RoleBindingPrincipalInvalidError();
    }

    if (input.userId) {
      return { userId: input.userId };
    }

    if (input.groupId) {
      return { groupId: input.groupId };
    }

    if (input.apiKeyId) {
      return { apiKeyId: input.apiKeyId };
    }

    throw new RoleBindingPrincipalInvalidError();
  }

  private async validatePrincipal(input: {
    organizationId: string;
    userId?: string;
    groupId?: string;
    apiKeyId?: string;
  }): Promise<{ organizationRole: OrganizationRole | null }> {
    if (input.userId) {
      const role = await this.options.bindings.tryFindOrganizationRole({
        organizationId: input.organizationId,
        userId: input.userId,
      });
      if (!role) {
        throw new UserNotInOrganizationError(input.userId);
      }

      return { organizationRole: role };
    }

    if (input.groupId) {
      const inOrganization = await this.options.bindings.isGroupInOrganization({
        organizationId: input.organizationId,
        groupId: input.groupId,
      });
      if (!inOrganization) {
        throw new GroupNotInOrganizationError(input.groupId);
      }
    }

    if (input.apiKeyId) {
      const inOrganization = await this.options.bindings.isApiKeyInOrganization({
        organizationId: input.organizationId,
        apiKeyId: input.apiKeyId,
      });
      if (!inOrganization) {
        throw new ApiKeyNotInOrganizationError(input.apiKeyId);
      }
    }

    return { organizationRole: null };
  }

  private async validateScopes({
    organizationId,
    scopes,
  }: {
    organizationId: string;
    scopes: ReadonlyArray<{
      scopeType: RoleBindingScopeType;
      scopeId: string;
    }>;
  }): Promise<AuthzBindingScopeRow[]> {
    if (scopes.length === 0) {
      return [];
    }

    const rows = await this.options.bindings.findScopeRows({
      organizationId,
      scopes,
    });
    const known = new Set(rows.map((row) => `${row.type}:${row.id}`));
    const unknown = scopes.find((scope) => !known.has(`${scope.scopeType}:${scope.scopeId}`));
    if (unknown) {
      throw new ScopeNotInOrganizationError(unknown.scopeType);
    }

    return rows;
  }

  private assertNoPersonalScope(scopeRows: readonly AuthzBindingScopeRow[]): void {
    const personal = scopeRows.find((row) => row.personalWorkspaceName !== null);
    if (personal) {
      throw new AuthzPersonalWorkspaceNotManagedHereError(personal.personalWorkspaceName);
    }
  }

  private async validateRoles({
    organizationId,
    bindings,
  }: {
    organizationId: string;
    bindings: readonly AuthzBindingWrite[];
  }): Promise<void> {
    const customBindings = bindings.filter((binding) => {
      if (binding.role !== "CUSTOM") {
        return false;
      }

      if (!binding.customRoleId) {
        throw new CustomRoleIdRequiredError();
      }

      return true;
    });
    const roleIds = [
      ...new Set(
        customBindings.flatMap((binding) => (binding.customRoleId ? [binding.customRoleId] : [])),
      ),
    ];
    if (roleIds.length === 0) {
      return;
    }

    const roles = await this.options.bindings.findAssignableRoles({
      organizationId,
      roleIds,
    });
    const rolesById = new Map(roles.map((role) => [role.id, role]));
    const missingRoleId = roleIds.find((roleId) => !rolesById.has(roleId));
    if (missingRoleId) {
      throw new CustomRoleNotAssignableError(missingRoleId);
    }

    for (const binding of customBindings) {
      if (binding.scopeType === "ORGANIZATION" || !binding.customRoleId) {
        continue;
      }

      const role = rolesById.get(binding.customRoleId);
      const permissions = Array.isArray(role?.permissions)
        ? role.permissions.filter(
            (permission): permission is string => typeof permission === "string",
          )
        : [];
      const exclusivePermission = permissions.find(
        (permission) =>
          !bindingScopeCanGrantPermission({
            scopeType: binding.scopeType,
            permission,
          }),
      );
      if (exclusivePermission) {
        throw new OrgExclusivePermissionScopeError(exclusivePermission, binding.scopeType);
      }
    }
  }

  private assertLiteMemberCeiling({
    organizationRole,
    bindings,
    scopeRows,
  }: {
    organizationRole: OrganizationRole | null;
    bindings: ReadonlyArray<Pick<AuthzBindingWrite, "role" | "scopeType" | "scopeId">>;
    scopeRows: readonly AuthzBindingScopeRow[];
  }): void {
    if (organizationRole !== "EXTERNAL") {
      return;
    }

    const offending = bindings.find(
      (binding) => binding.scopeType === "ORGANIZATION" || binding.role !== "VIEWER",
    );
    if (!offending) {
      return;
    }

    const scopeName = scopeRows.find((row) => row.id === offending.scopeId)?.name;

    throw new AuthzLiteMemberViewerOnlyError(scopeName ?? null);
  }

  private rethrowDuplicate(error: unknown, meta: Record<string, unknown>): never {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "role_binding_already_exists"
    ) {
      throw new DuplicateGrantError(meta);
    }

    throw error;
  }
}
