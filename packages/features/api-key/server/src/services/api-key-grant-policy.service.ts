import { ApiKeyScopeViolationError } from "@langwatch/api-key-contract";
import type { AuthzPermission } from "@langwatch/authz-contract";
import { apiKeyPermissionSchema, type ApiKeyScope } from "@langwatch/api-key-contract";
import type { ApiKeyRepository } from "../repositories/api-key.repository";
import type { ApiKeyDependencies } from "./api-key.service";

type ResolvedScope =
  | { type: "organization"; id: string; organizationId: string }
  | { type: "team"; id: string; organizationId: string }
  | { type: "project"; id: string; teamId: string; organizationId: string };

export class ApiKeyGrantPolicyService {
  static create(
    options: ApiKeyDependencies & { repository: ApiKeyRepository },
  ): ApiKeyGrantPolicyService {
    return new ApiKeyGrantPolicyService(options.repository, options);
  }

  private constructor(
    private readonly repository: ApiKeyRepository,
    private readonly options: ApiKeyDependencies,
  ) {}

  async ensureCallerIsOrgMember(input: { userId: string; organizationId: string }): Promise<void> {
    const allowed = await this.options.authz.hasPermission({
      userId: input.userId,
      organizationId: input.organizationId,
      permission: "organization:view",
    });
    if (!allowed) {
      throw new ApiKeyScopeViolationError("Not a member of this organization");
    }
  }

  async assertSelectionWithinCeiling(input: {
    userId: string;
    organizationId: string;
    bindings: Array<ApiKeyScope & { role: "CUSTOM" }>;
    permissions: string[];
  }): Promise<void> {
    await this.ensureCallerIsOrgMember(input);
    for (const binding of input.bindings) {
      await this.validateScope(binding, input.organizationId);
    }
    await this.assertCeiling(input.userId, input.organizationId, input.bindings, input.permissions);
  }

  async isOrgAdmin(input: { userId: string; organizationId: string }): Promise<boolean> {
    const bindings = await this.options.authz.listUserBindings(input);
    return bindings.some(
      (binding) =>
        binding.scopeType === "ORGANIZATION" &&
        binding.scopeId === input.organizationId &&
        binding.role === "ADMIN",
    );
  }

  async isOrgAdminApiKey(input: { apiKeyId: string; organizationId: string }): Promise<boolean> {
    const bindings = await this.options.authz.listScopeBindings({
      organizationId: input.organizationId,
      scopeType: "ORGANIZATION",
      scopeIds: [input.organizationId],
    });
    return bindings.some(
      (binding) => binding.apiKeyId === input.apiKeyId && binding.role === "ADMIN",
    );
  }

  tryValidatePermissionSelection(input: {
    bindings: ApiKeyScope[];
    permissionMode: string;
    permissions?: string[];
  }): string[] | undefined {
    const hasCustomBinding = input.bindings.some((binding) => binding.role === "CUSTOM");
    const hasPermissions = Boolean(input.permissions?.length);
    const isRestricted = input.permissionMode === "restricted";

    if (isRestricted || hasCustomBinding || hasPermissions) {
      if (!isRestricted) {
        throw new ApiKeyScopeViolationError(
          "CUSTOM permissions require permissionMode 'restricted'",
        );
      }
      if (!hasCustomBinding) {
        throw new ApiKeyScopeViolationError("restricted mode requires at least one CUSTOM binding");
      }
      if (!hasPermissions) {
        throw new ApiKeyScopeViolationError("CUSTOM bindings require at least one permission");
      }
    }

    for (const permission of input.permissions ?? []) {
      if (!apiKeyPermissionSchema.safeParse(permission).success) {
        throw new ApiKeyScopeViolationError(
          `Invalid permission format "${permission}" — must match resource:action`,
        );
      }
    }

    return input.permissions?.length ? [...input.permissions].sort() : void 0;
  }

  async assertPersonalScopesOwnedBy(input: {
    scopes: ApiKeyScope[];
    organizationId: string;
    ownerUserId: string | null;
  }): Promise<void> {
    for (const scope of input.scopes) {
      if (scope.scopeType === "ORGANIZATION") {
        continue;
      }
      const personal = await this.repository.tryFindPersonalWorkspaceOwner({
        organizationId: input.organizationId,
        scopeId: scope.scopeId,
      });
      if (personal && personal.ownerUserId !== input.ownerUserId) {
        throw new ApiKeyScopeViolationError(
          "Personal workspace scopes may only be granted to their owner",
        );
      }
    }
  }

  async validateScope(binding: ApiKeyScope, organizationId: string): Promise<ResolvedScope> {
    if (binding.scopeType === "ORGANIZATION") {
      if (binding.scopeId !== organizationId) {
        throw new ApiKeyScopeViolationError(
          "Organization scope must match the API key's organization",
        );
      }
      return { type: "organization", id: organizationId, organizationId };
    }
    if (binding.scopeType === "TEAM") {
      try {
        await this.options.organizations.getTeam({
          organizationId,
          teamId: binding.scopeId,
        });
      } catch {
        throw new ApiKeyScopeViolationError(
          `Team ${binding.scopeId} not found in this organization`,
        );
      }
      return { type: "team", id: binding.scopeId, organizationId };
    }
    const project = await this.options.projects.getWithTeam(binding.scopeId);
    if (project.archivedAt || project.team.organizationId !== organizationId) {
      throw new ApiKeyScopeViolationError(`Project ${binding.scopeId} not found or archived`);
    }
    return {
      type: "project",
      id: binding.scopeId,
      teamId: project.team.id,
      organizationId,
    };
  }

  async assertCeiling(
    userId: string,
    organizationId: string,
    bindings: ApiKeyScope[],
    permissions: string[],
  ): Promise<void> {
    for (const binding of bindings) {
      const scope = await this.validateScope(binding, organizationId);
      const checks = await this.permissionsForBinding(binding, organizationId, permissions);
      for (const permission of checks) {
        const authzScope = this.authzScope(scope, organizationId);
        const allowed = await this.options.authz.can({
          principal: { type: "user", id: userId },
          permission: permission as AuthzPermission,
          scope: authzScope,
        });
        if (!allowed) {
          throw new ApiKeyScopeViolationError(
            `Cannot grant permission ${permission} beyond the owner's ceiling`,
          );
        }
      }
    }
  }

  private authzScope(scope: ResolvedScope, organizationId: string) {
    if (scope.type === "organization") {
      return { type: "organization" as const, id: scope.id };
    }
    if (scope.type === "team") {
      return { type: "team" as const, id: scope.id, organizationId };
    }
    return {
      type: "project" as const,
      id: scope.id,
      teamId: scope.teamId,
      organizationId,
    };
  }

  private async permissionsForBinding(
    binding: ApiKeyScope,
    organizationId: string,
    rawPermissions: string[],
  ): Promise<string[]> {
    if (binding.role !== "CUSTOM") {
      return [
        binding.role === "ADMIN"
          ? binding.scopeType === "ORGANIZATION"
            ? "organization:manage"
            : "project:manage"
          : binding.role === "MEMBER"
            ? binding.scopeType === "ORGANIZATION"
              ? "organization:view"
              : "project:update"
            : "project:view",
      ];
    }
    if (rawPermissions.length > 0) {
      return [...rawPermissions].sort();
    }
    if (!binding.customRoleId) {
      throw new ApiKeyScopeViolationError("CUSTOM role requires a customRoleId");
    }
    const role = (await this.options.authz.listUserCreatedRoles({ organizationId })).find(
      (candidate) => candidate.id === binding.customRoleId,
    );
    if (
      !role ||
      !Array.isArray(role.permissions) ||
      !role.permissions.every((permission): permission is string => typeof permission === "string")
    ) {
      throw new ApiKeyScopeViolationError(
        `Custom role ${binding.customRoleId} not found or has malformed permissions`,
      );
    }
    return [...role.permissions].sort();
  }

  async writeBindings(input: {
    apiKeyId: string;
    organizationId: string;
    bindings: ApiKeyScope[];
    permissions?: string[];
    actor: { type: "user" | "system"; id: string | null };
    replace?: boolean;
    roleId?: string;
  }): Promise<ApiKeyScope[]> {
    let bindings = input.bindings;
    if (input.permissions?.length) {
      const roleId = input.roleId ?? `apikey:${input.apiKeyId}`;
      await this.options.grants.defineRole({
        organizationId: input.organizationId,
        roleId,
        name: `apikey:${input.apiKeyId}`,
        permissions: [...input.permissions].sort(),
        kind: "system_api_key",
        actor: input.actor,
      });
      bindings = bindings.map((binding) =>
        binding.role === "CUSTOM" ? { ...binding, customRoleId: roleId } : binding,
      );
    }

    const attached = await this.options.grants.attachBindings({
      organizationId: input.organizationId,
      bindings: bindings.map((binding) => ({
        bindingId: this.options.bindingIds.generateBindingId(),
        principal: { apiKeyId: input.apiKeyId },
        role: binding.role,
        customRoleId: binding.role === "CUSTOM" ? (binding.customRoleId ?? null) : null,
        scopeType: binding.scopeType,
        scopeId: binding.scopeId,
      })),
      actor: input.actor,
      source: "grants-service",
      onDuplicate: "skip",
    });
    if (input.replace) {
      // A duplicate is an existing binding the caller asked for again, so it is
      // just as much a keeper as a fresh one — an edit that resubmits the key's
      // current scopes attaches nothing and would otherwise revoke the lot.
      const keep = [...attached.attached, ...attached.duplicates];
      await this.options.grants.revokeBindingsWhere({
        organizationId: input.organizationId,
        where: {
          apiKeyId: input.apiKeyId,
          ...(keep.length ? { id: { notIn: keep } } : {}),
        },
        actor: input.actor,
        reason: "api key grants replaced",
      });
    }
    return bindings;
  }
}
