import {
  ApiKeyNotInOrganizationError,
  AuthzLiteMemberViewerOnlyError,
  AuthzPersonalWorkspaceNotManagedHereError,
  bindingScopeCanGrantPermission,
  CustomRoleIdRequiredError,
  CustomRoleNotAssignableError,
  GrantExceedsCallerPermissionsError,
  GrantLimitReachedError,
  GroupNotInOrganizationError,
  OrgExclusivePermissionScopeError,
  RoleBindingNotFoundError,
  RoleBindingPrincipalInvalidError,
  ScopeNotInOrganizationError,
  type AuthzApplyMemberBindingsInput,
  type AuthzBindingMutationSuccess,
  type AuthzBindingWrite,
  type AuthzCreateBindingInput,
  type AuthzCreateBindingOutput,
  type AuthzLedgerBindingPrincipal,
  type AuthzPrincipalRef,
  type AuthzService,
  type AuthzUpdateBindingInput,
  type AuthzDeleteBindingInput,
  type OrganizationRole,
  type GrantScopeTier,
} from "@langwatch/authz-contract";
// One class, one status: an organization's membership is the organization
// feature's fact, and every surface answers this refusal 422.
import {
  CannotDemoteLastAdminError,
  CannotRemoveLastAdminError,
  UserNotInOrganizationError,
} from "@langwatch/organization-contract";
import { fromDate, nowInstant } from "@langwatch/time";

import type { AuthzCompatibilityLedger } from "../app/authz.app.ts";
import type {
  AuthzManagedGrantRepository,
  AuthzBindingScopeRow,
} from "../repositories/authz-managed-grant.repository.ts";
import {
  GRANT_LIMIT_PER_ORGANIZATION,
  isGrantLimitReached,
  isLastOrganizationAdmin,
  permissionsConferred,
} from "../rules/grant-escalation.rules.ts";
import { AuthzGrantGuardsService } from "./authz-grant-guards.service.ts";

/** The reads the writer's guards ask of the permission side. */
export type AuthzGrantWriterPermissions = Pick<
  AuthzService,
  "findPermissionsBeyondCaller" | "listManagedBindingsForOrganization"
>;

const WIRE_SCOPE = { ORGANIZATION: "organization", TEAM: "team", PROJECT: "project" } as const;

function assertScopeCanGrantRole({
  binding,
  rolesById,
}: {
  binding: AuthzBindingWrite;
  rolesById: ReadonlyMap<string, readonly string[]>;
}): void {
  if (binding.scopeType === "ORGANIZATION" || !binding.customRoleId) {
    return;
  }

  const permissions = rolesById.get(binding.customRoleId) ?? [];
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

export class AuthzGrantWriterService {
  static create(options: {
    bindings: AuthzManagedGrantRepository;
    ledger: AuthzCompatibilityLedger;
    newBindingId: () => string;
    permissions: AuthzGrantWriterPermissions;
  }): AuthzGrantWriterService {
    return new AuthzGrantWriterService(options);
  }

  private constructor(
    private readonly options: {
      bindings: AuthzManagedGrantRepository;
      ledger: AuthzCompatibilityLedger;
      newBindingId: () => string;
      permissions: AuthzGrantWriterPermissions;
    },
  ) {}

  async create(input: AuthzCreateBindingInput): Promise<AuthzCreateBindingOutput> {
    const expiresAtMs = input.expiresAt ? fromDate(input.expiresAt).epochMilliseconds : undefined;
    AuthzGrantGuardsService.assertExpiryInFuture({
      expiresAtMs,
      nowMs: nowInstant().epochMilliseconds,
      meta: { scopeType: input.scopeType, scopeId: input.scopeId },
    });
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
    const rolesById = await this.validateRoles({
      organizationId: input.organizationId,
      bindings: [input],
    });
    this.assertLiteMemberCeiling({
      organizationRole,
      bindings: [input],
      scopeRows,
    });
    await this.assertWithinCaller({
      organizationId: input.organizationId,
      caller: input.caller,
      bindings: [input],
      rolesById,
    });
    await this.assertUnderGrantLimit({ organizationId: input.organizationId });

    const bindingId = this.options.newBindingId();
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
          ...(expiresAtMs !== undefined ? { expiresAtMs } : {}),
        },
      ],
      actor: input.actor,
      onDuplicate: "attach",
    });

    return { id: bindingId };
  }

  async update(input: AuthzUpdateBindingInput): Promise<AuthzCreateBindingOutput> {
    const binding = await this.options.bindings.findBinding(input);
    if (!binding) {
      throw new RoleBindingNotFoundError(input.bindingId);
    }

    const scopeRows = await this.validateScopes({
      organizationId: input.organizationId,
      scopes: [binding],
    });
    this.assertNoPersonalScope(scopeRows);
    const changed = {
      role: input.role,
      customRoleId: input.customRoleId,
      scopeType: binding.scopeType,
      scopeId: binding.scopeId,
    };
    const rolesById = await this.validateRoles({
      organizationId: input.organizationId,
      bindings: [changed],
    });
    await this.assertWithinCaller({
      organizationId: input.organizationId,
      caller: input.caller,
      bindings: [changed],
      rolesById,
    });
    if (input.role !== "ADMIN") {
      await this.assertNotLastAdmin({
        organizationId: input.organizationId,
        bindingId: input.bindingId,
        refusal: () => new CannotDemoteLastAdminError(),
      });
    }

    if (binding.userId) {
      const organizationRole = await this.options.bindings.findOrganizationRole({
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

    await this.options.ledger.changeBindingRole({
      organizationId: input.organizationId,
      bindingId: input.bindingId,
      role: input.role,
      customRoleId: input.role === "CUSTOM" ? (input.customRoleId ?? null) : null,
      actor: input.actor,
    });

    return { id: input.bindingId };
  }

  async delete(input: AuthzDeleteBindingInput): Promise<AuthzBindingMutationSuccess> {
    const binding = await this.options.bindings.findBinding(input);
    if (!binding) {
      throw new RoleBindingNotFoundError(input.bindingId);
    }

    const scopeRows = await this.validateScopes({
      organizationId: input.organizationId,
      scopes: [binding],
    });
    this.assertNoPersonalScope(scopeRows);
    await this.assertNotLastAdmin({
      organizationId: input.organizationId,
      bindingId: input.bindingId,
      refusal: () => new CannotRemoveLastAdminError(),
    });
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
    const rolesById = await this.validateRoles({
      organizationId: input.organizationId,
      bindings: input.bindingsToCreate,
    });
    this.assertLiteMemberCeiling({
      organizationRole,
      bindings: input.bindingsToCreate,
      scopeRows: createScopeRows,
    });
    await this.assertWithinCaller({
      organizationId: input.organizationId,
      caller: input.caller,
      bindings: input.bindingsToCreate,
      rolesById,
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
      const role = await this.options.bindings.findOrganizationRole({
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
    scopes: readonly {
      scopeType: GrantScopeTier;
      scopeId: string;
    }[];
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
  }): Promise<ReadonlyMap<string, readonly string[]>> {
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
      return new Map();
    }

    const roles = await this.options.bindings.findAssignableRoles({
      organizationId,
      roleIds,
    });
    const rolesById = new Map(
      roles.map((role) => [
        role.id,
        Array.isArray(role.permissions)
          ? role.permissions.filter(
              (permission): permission is string => typeof permission === "string",
            )
          : [],
      ]),
    );
    const missingRoleId = roleIds.find((roleId) => !rolesById.has(roleId));
    if (missingRoleId) {
      throw new CustomRoleNotAssignableError(missingRoleId);
    }

    for (const binding of customBindings) {
      assertScopeCanGrantRole({ binding, rolesById });
    }

    return rolesById;
  }

  /** Every door's one escalation check: a binding never confers what the caller lacks there. */
  private async assertWithinCaller({
    organizationId,
    caller,
    bindings,
    rolesById,
  }: {
    organizationId: string;
    caller: AuthzPrincipalRef;
    bindings: readonly AuthzBindingWrite[];
    rolesById: ReadonlyMap<string, readonly string[]>;
  }): Promise<void> {
    for (const binding of bindings) {
      const missing = await this.options.permissions.findPermissionsBeyondCaller({
        organizationId,
        caller,
        scope: { type: WIRE_SCOPE[binding.scopeType], id: binding.scopeId },
        permissions: [
          ...permissionsConferred({
            role: binding.role,
            scopeType: binding.scopeType,
            customPermissions: rolesById.get(binding.customRoleId ?? "") ?? [],
          }),
        ],
      });
      if (missing.length > 0) throw new GrantExceedsCallerPermissionsError(missing);
    }
  }

  // ponytail: counts through the full listing; a count query when organisations near the cap.
  private async assertUnderGrantLimit({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<void> {
    const rows = await this.options.permissions.listManagedBindingsForOrganization({
      organizationId,
    });
    if (isGrantLimitReached({ existing: rows.length })) {
      throw new GrantLimitReachedError(GRANT_LIMIT_PER_ORGANIZATION);
    }
  }

  private async assertNotLastAdmin({
    organizationId,
    bindingId,
    refusal,
  }: {
    organizationId: string;
    bindingId: string;
    refusal: () => Error;
  }): Promise<void> {
    const rows = await this.options.permissions.listManagedBindingsForOrganization({
      organizationId,
    });
    if (
      isLastOrganizationAdmin({ rows, grantId: bindingId, nowMs: nowInstant().epochMilliseconds })
    ) {
      throw refusal();
    }
  }

  private assertLiteMemberCeiling({
    organizationRole,
    bindings,
    scopeRows,
  }: {
    organizationRole: OrganizationRole | null;
    bindings: readonly Pick<AuthzBindingWrite, "role" | "scopeType" | "scopeId">[];
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
}
