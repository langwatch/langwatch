/**
 * Answering a permission question for a person or an api key, and refusing
 * when the answer is no. This is the one place a denial becomes an error,
 * so the caller sees the permission and scope that were missing.
 */
import {
  LiteMemberRestrictedError,
  PermissionDeniedError,
  ProjectPermissionDeniedError,
  type ApiKeyPermissionCheck,
  type ApiKeyProjectDecision,
  type AuthzCanAnyByIdsInput,
  type AuthzCanAnyByIdsOutput,
  type AuthzCheckByIdsInput,
  type AuthzCheckByIdsOutput,
  type AuthzDeclaredScopeId,
  type AuthzGetApiKeyProjectDecisionInput,
  type AuthzGetDecisionInput,
  type AuthzGetProjectAnyDecisionInput,
  type AuthzPermission,
  type AuthzPrincipalRef,
  type AuthzRequireProjectPermissionInput,
  type AuthzScopeRef,
  type Authorized,
  type BindingScopeTier,
  type PermissionDecision,
  type PermissionScopeArg,
  type TierOfScopeArg,
  AuthzScopeNotFoundError,
} from "@langwatch/authz-contract";

type ScopeIds = {
  projectId?: string | undefined;
  teamId?: string | undefined;
  organizationId?: string | undefined;
};

/** The decision seams this gate composes, all owned by the service that constructs it. */
type AuthzPermissionGateOptions = {
  authorize: <Tier extends BindingScopeTier, Permission extends AuthzPermission>(input: {
    principal: AuthzPrincipalRef;
    permission: Permission;
    scope: Extract<AuthzScopeRef, { type: Tier }>;
  }) => Promise<Authorized<Tier, Permission>>;
  can: (input: {
    principal: AuthzPrincipalRef;
    permission: AuthzPermission;
    scope: AuthzScopeRef;
  }) => Promise<boolean>;
  canAnyByIds: (args: AuthzCanAnyByIdsInput) => Promise<AuthzCanAnyByIdsOutput>;
  checkByIds: (args: AuthzCheckByIdsInput) => Promise<AuthzCheckByIdsOutput>;
  getScope: (ids: {
    projectId?: string | undefined;
    teamId?: string | undefined;
    organizationId?: string | undefined;
  }) => Promise<AuthzScopeRef>;
  tryScopeOf: (
    scope: Partial<Record<"projectId" | "teamId" | "organizationId", string>>,
  ) => AuthzDeclaredScopeId | null;
};

export class AuthzPermissionGateService {
  static create(deps: AuthzPermissionGateOptions): AuthzPermissionGateService {
    return new AuthzPermissionGateService(deps);
  }

  private constructor(private readonly deps: AuthzPermissionGateOptions) {}

  async getDecision({
    userId,
    permission,
    scope,
  }: AuthzGetDecisionInput): Promise<PermissionDecision> {
    const ids: ScopeIds = {};
    if (scope.tier === "project") {
      ids.projectId = scope.id;
    }

    if (scope.tier === "team") {
      ids.teamId = scope.id;
    }

    if (scope.tier === "organization") {
      ids.organizationId = scope.id;
    }

    const result = await this.deps.checkByIds({
      principal: { type: "user", id: userId },
      permission,
      ...ids,
    });

    return {
      permitted: result.allowed,
      organizationRole: result.organizationRole,
      ...(result.denialReason ? { denialReason: result.denialReason } : {}),
    };
  }

  async getProjectAnyDecision({
    userId,
    projectId,
    permissions,
  }: AuthzGetProjectAnyDecisionInput): Promise<PermissionDecision> {
    const result = await this.deps.canAnyByIds({
      principal: { type: "user", id: userId },
      projectId,
      permissions,
    });

    return {
      permitted: result.allowed,
      organizationRole: result.organizationRole,
      ...(result.denialReason ? { denialReason: result.denialReason } : {}),
    };
  }

  async hasPermission<Permission extends AuthzPermission>(
    check: {
      userId: string;
      permission: Permission;
    } & PermissionScopeArg<Permission>,
  ): Promise<boolean> {
    const scope = this.deps.tryScopeOf(check);
    if (!scope) {
      return false;
    }

    const decision = await this.getDecision({
      userId: check.userId,
      permission: check.permission,
      scope,
    });

    return decision.permitted;
  }

  async authorizePermission<
    Permission extends AuthzPermission,
    ScopeArg extends PermissionScopeArg<Permission>,
  >(
    check: { userId: string; permission: Permission } & ScopeArg,
  ): Promise<Authorized<TierOfScopeArg<ScopeArg>, Permission>> {
    const declaredScope = this.deps.tryScopeOf(check);
    let scope: AuthzScopeRef | undefined;
    try {
      if (declaredScope?.tier === "project") {
        scope = await this.deps.getScope({ projectId: declaredScope.id });
      } else if (declaredScope?.tier === "team") {
        scope = await this.deps.getScope({ teamId: declaredScope.id });
      } else if (declaredScope?.tier === "organization") {
        scope = await this.deps.getScope({ organizationId: declaredScope.id });
      }
    } catch (error) {
      if (!AuthzScopeNotFoundError.is(error)) throw error;
    }

    if (!scope || scope.type === "resource") {
      throw new PermissionDeniedError({
        permission: check.permission,
        scope: {
          type: declaredScope?.tier ?? "project",
          id: declaredScope?.id ?? "unresolved",
        },
        denialReason: "no-binding",
      });
    }

    const witness = await this.deps.authorize({
      principal: { type: "user", id: check.userId },
      permission: check.permission,
      scope,
    });

    return witness as Authorized<TierOfScopeArg<ScopeArg>, Permission>;
  }

  async authorizeProjectPermission({
    userId,
    projectId,
    permission,
  }: AuthzRequireProjectPermissionInput): Promise<void> {
    const result = await this.deps.checkByIds({
      principal: { type: "user", id: userId },
      projectId,
      permission,
    });
    if (result.allowed) {
      return;
    }

    if (result.organizationRole === "EXTERNAL") {
      throw new LiteMemberRestrictedError(permission.split(":")[0] ?? "unknown");
    }

    throw new ProjectPermissionDeniedError(permission);
  }

  async hasApiKeyPermission({
    apiKeyId,
    organizationId,
    scope,
    permission,
  }: ApiKeyPermissionCheck): Promise<boolean> {
    let resolvedScope: AuthzScopeRef;
    if (scope.type === "project") {
      resolvedScope = {
        type: "project",
        id: scope.id,
        teamId: scope.teamId,
        organizationId,
      };
    } else if (scope.type === "team") {
      resolvedScope = { type: "team", id: scope.id, organizationId };
    } else {
      resolvedScope = { type: "organization", id: scope.id };
    }

    return this.deps.can({
      principal: { type: "apiKey", id: apiKeyId },
      permission,
      scope: resolvedScope,
    });
  }

  async getApiKeyProjectDecision({
    apiKeyId,
    organizationId,
    projectId,
    permission,
  }: AuthzGetApiKeyProjectDecisionInput): Promise<ApiKeyProjectDecision> {
    let scope: AuthzScopeRef;
    try {
      scope = await this.deps.getScope({ projectId });
    } catch (error) {
      if (AuthzScopeNotFoundError.is(error)) return { outcome: "project_not_found" };
      throw error;
    }
    if (scope.type !== "project" || scope.organizationId !== organizationId) {
      return { outcome: "project_not_found" };
    }

    const allowed = await this.deps.can({
      principal: { type: "apiKey", id: apiKeyId },
      permission,
      scope,
    });

    return allowed
      ? {
          outcome: "allowed",
          scope: {
            projectId: scope.id,
            teamId: scope.teamId,
            organizationId: scope.organizationId,
          },
        }
      : { outcome: "denied" };
  }
}
