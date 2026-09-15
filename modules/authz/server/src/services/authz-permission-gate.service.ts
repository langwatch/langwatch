/**
 * Answering a permission question for a person or an api key, and refusing when the answer is
 * no. Every method here composes the decision seams rather than reaching the collector: the
 * one place a denial becomes an error, so the error a caller sees names the permission that
 * was missing and the scope it was missing in.
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
  tryResolveScope: (ids: {
    projectId?: string | undefined;
    teamId?: string | undefined;
    organizationId?: string | undefined;
  }) => Promise<AuthzScopeRef | null>;
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
    let scope: AuthzScopeRef | null = null;
    if (declaredScope?.tier === "project") {
      scope = await this.deps.tryResolveScope({ projectId: declaredScope.id });
    } else if (declaredScope?.tier === "team") {
      scope = await this.deps.tryResolveScope({ teamId: declaredScope.id });
    } else if (declaredScope?.tier === "organization") {
      scope = await this.deps.tryResolveScope({ organizationId: declaredScope.id });
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
    const scope = await this.deps.tryResolveScope({ projectId });
    if (scope?.type !== "project" || scope.organizationId !== organizationId) {
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
