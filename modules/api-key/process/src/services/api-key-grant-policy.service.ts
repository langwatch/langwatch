import {
  ApiKeyScopeViolationError,
  apiKeyPermissionFormatSchema,
  type ApiKeyScope,
} from "@langwatch/api-key-contract";
import type { AuthzPermission } from "@langwatch/authorization";
import type {
  AuthzAccessBinding,
  AuthzAttachOutcome,
  AuthzGrantCaller,
  AuthzPrincipalRef,
} from "@langwatch/authz-contract";
import { Temporal, fromDate, nowInstant } from "@langwatch/time";

import type { ApiKeyDependencies } from "./api-key.service.ts";

type ResolvedScope =
  | { type: "organization"; id: string; organizationId: string }
  | { type: "team"; id: string; organizationId: string }
  | { type: "project"; id: string; teamId: string; organizationId: string };

function builtInRolePermission(binding: ApiKeyScope): string {
  const organizationScoped = binding.scopeType === "ORGANIZATION";
  if (binding.role === "ADMIN")
    return organizationScoped ? "organization:manage" : "project:manage";
  if (binding.role === "MEMBER") return organizationScoped ? "organization:view" : "project:update";
  return "project:view";
}

/** A grant past its end moment is listed (the Access page shows it) but confers nothing. */
function isLive(binding: AuthzAccessBinding): boolean {
  return (
    !binding.expiresAt || Temporal.Instant.compare(fromDate(binding.expiresAt), nowInstant()) > 0
  );
}

export class ApiKeyGrantPolicyService {
  static create(options: ApiKeyDependencies): ApiKeyGrantPolicyService {
    return new ApiKeyGrantPolicyService(options);
  }

  private constructor(private readonly options: ApiKeyDependencies) {}

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
    bindings: (ApiKeyScope & { role: "CUSTOM" })[];
    permissions: string[];
  }): Promise<void> {
    await this.ensureCallerIsOrgMember(input);
    for (const binding of input.bindings) {
      await this.validateScope(binding, input.organizationId);
    }

    await this.assertCeiling({ ...input, principal: { type: "user", id: input.userId } });
  }

  async isOrgAdmin(input: { userId: string; organizationId: string }): Promise<boolean> {
    const bindings = await this.options.authz.listUserBindings(input);

    return bindings.some(
      (binding) =>
        isLive(binding) &&
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
      (binding) =>
        isLive(binding) && binding.apiKeyId === input.apiKeyId && binding.role === "ADMIN",
    );
  }

  findValidatedPermissions(input: {
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
      if (!apiKeyPermissionFormatSchema.validate(permission)) {
        throw new ApiKeyScopeViolationError(
          `Invalid permission format "${String(permission)}" — must match resource:action`,
        );
      }
    }

    return input.permissions?.length ? [...input.permissions].toSorted() : void 0;
  }

  /**
   * A personal workspace admits no principal but its owner. The one exception is a key the
   * platform mints for a run nobody started: it has no owner and acts as the system.
   */
  async assertPersonalScopesOwnedBy(input: {
    scopes: ApiKeyScope[];
    organizationId: string;
    ownerUserId: string | null;
    isSystemManaged: boolean;
  }): Promise<void> {
    if (input.isSystemManaged && input.ownerUserId === null) return;
    for (const scope of input.scopes) {
      if (scope.scopeType === "ORGANIZATION") {
        continue;
      }

      const personal = await this.options.projects.findPersonalWorkspaceOwner({
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

  /** Refuses any binding `principal` does not itself hold; a personal key holds key ∩ owner. */
  async assertCeiling({
    principal,
    organizationId,
    bindings,
    permissions,
  }: {
    principal: AuthzPrincipalRef;
    organizationId: string;
    bindings: ApiKeyScope[];
    permissions: string[];
  }): Promise<void> {
    for (const binding of bindings) {
      const scope = await this.validateScope(binding, organizationId);
      const checks = await this.permissionsForBinding(binding, organizationId, permissions);
      for (const permission of checks) {
        const authzScope = this.authzScope(scope, organizationId);
        const allowed = await this.options.authz.can({
          principal,
          permission: permission as AuthzPermission,
          scope: authzScope,
        });
        if (!allowed) {
          throw new ApiKeyScopeViolationError(
            `Cannot grant permission ${permission} beyond what the granting credential holds`,
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
      return [builtInRolePermission(binding)];
    }

    if (rawPermissions.length > 0) {
      return [...rawPermissions].toSorted();
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

    return [...role.permissions].toSorted();
  }

  async writeBindings(input: {
    apiKeyId: string;
    organizationId: string;
    bindings: ApiKeyScope[];
    permissions?: string[];
    actor: { type: "user" | "system"; id: string | null };
    /** Who answers for the grants: the person creating or editing the key, else `system`. */
    caller: AuthzGrantCaller;
    replace?: boolean;
    roleId?: string;
  }): Promise<ApiKeyScope[]> {
    let bindings = input.bindings;
    const ownRoleId = input.permissions?.length
      ? (input.roleId ?? `apikey:${input.apiKeyId}`)
      : null;
    if (ownRoleId) {
      await this.options.grants.defineRole({
        organizationId: input.organizationId,
        roleId: ownRoleId,
        name: `apikey:${input.apiKeyId}`,
        permissions: [...(input.permissions ?? [])].toSorted(),
        kind: "system_api_key",
        actor: input.actor,
        requireProjection: true,
      });
      bindings = bindings.map((binding) =>
        binding.role === "CUSTOM" ? { ...binding, customRoleId: ownRoleId } : binding,
      );
    }

    // The key's own role (kind system_api_key) is assignable by no person, so its bindings were
    // bounded by assertCeiling before this; every other binding meets authz's central ceiling.
    const isOwnRole = (binding: ApiKeyScope) =>
      ownRoleId !== null && binding.role === "CUSTOM" && binding.customRoleId === ownRoleId;
    const answered = await this.attach({
      ...input,
      bindings: bindings.filter((binding) => !isOwnRole(binding)),
    });
    const ownRole = await this.attach({
      ...input,
      bindings: bindings.filter(isOwnRole),
      caller: { type: "system" },
    });
    if (input.replace) {
      // A duplicate is an existing binding the caller asked for again, so it is
      // just as much a keeper as a fresh one — an edit that resubmits the key's
      // current scopes attaches nothing and would otherwise revoke the lot.
      const keep = [answered, ownRole].flatMap((outcome) => [
        ...outcome.attached,
        ...outcome.duplicates,
      ]);
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
  private async attach(input: {
    apiKeyId: string;
    organizationId: string;
    bindings: ApiKeyScope[];
    actor: { type: "user" | "system"; id: string | null };
    caller: AuthzGrantCaller;
  }): Promise<AuthzAttachOutcome> {
    if (input.bindings.length === 0) return { attached: [], duplicates: [] };

    return this.options.grants.attachBindings({
      organizationId: input.organizationId,
      bindings: input.bindings.map((binding) => ({
        bindingId: this.options.bindingIds.generateBindingId(),
        principal: { apiKeyId: input.apiKeyId },
        role: binding.role,
        customRoleId: binding.role === "CUSTOM" ? (binding.customRoleId ?? null) : null,
        scopeType: binding.scopeType,
        scopeId: binding.scopeId,
      })),
      caller: input.caller,
      actor: input.actor,
      source: "grants-service",
      onDuplicate: "skip",
      // Both callers act on these rows next: a create activates the credential,
      // and a replace revokes whatever the attach did not keep. A durable
      // append that is not yet readable would hand out a token the resolver
      // refuses, or drop the grants the key already had.
      requireProjection: true,
    });
  }
}
