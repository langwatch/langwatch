/**
 * Answering a permission question for a person or an api key, and refusing
 * when the answer is no. This is the one place a denial becomes an error,
 * so the caller sees the permission and scope that were missing.
 */
import {
  AccessNotGrantedError,
  DeveloperSeatRestrictedError,
  LiteMemberRestrictedError,
  PermissionDeniedError,
  ProjectPermissionDeniedError,
  type Actor,
  type Authorization,
  type AuthorizationPurpose,
  type AuthzDeclaredScopeId,
  type AuthzGetDecisionInput,
  type AuthzGetProjectAnyDecisionInput,
  type AuthzPermission,
  type DeclaredScopeTier,
  type PermissionDecision,
  type PermissionScopeArg,
  type TierOfScopeArg,
} from "@langwatch/authorization";
import {
  type ApiKeyPermissionCheck,
  type ApiKeyProjectDecision,
  type AuthzCanAnyByIdsInput,
  type AuthzCanAnyByIdsOutput,
  type AuthzCheckByIdsInput,
  type AuthzCheckByIdsOutput,
  type AuthzDecision,
  type AuthzGetApiKeyProjectDecisionInput,
  type AuthzPrincipalRef,
  type AuthzRequireProjectPermissionInput,
  type AuthzScopeRef,
  type Authorized,
  AuthzScopeNotFoundError,
} from "@langwatch/authz-contract";

import type { AuthorizationService } from "./authorization.service.ts";
import type { AuthzAggregateReadAuditService } from "./authz-aggregate-read-audit.service.ts";
import type { AuthzCollectorService } from "./authz-collector.service.ts";

type ScopeIds = {
  projectId?: string | undefined;
  teamId?: string | undefined;
  organizationId?: string | undefined;
};

/** The decision seams this gate composes, all owned by the service that constructs it. */
type AuthzPermissionGateOptions = {
  check: (args: {
    principal: AuthzPrincipalRef;
    permission: AuthzPermission;
    scope: AuthzScopeRef;
  }) => Promise<AuthzDecision>;
  proofs: Pick<AuthorizationService, "authorize">;
  collector: Pick<AuthzCollectorService, "findScopeRef">;
  /** Records a user's read of an aggregate (ADR-177 decision 9); omitted = not audited. */
  aggregateReads?: Pick<AuthzAggregateReadAuditService, "auditRead">;
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
};

export class AuthzPermissionGateService {
  static create(deps: AuthzPermissionGateOptions): AuthzPermissionGateService {
    return new AuthzPermissionGateService(deps);
  }

  private constructor(private readonly deps: AuthzPermissionGateOptions) {}

  /**
   * Decides one permission and mints its witness, or refuses. With a proof on a project, one
   * engine pass decides and mints, and a read across shared grants into an aggregate is audited.
   */
  async authorize<Tier extends DeclaredScopeTier, Permission extends AuthzPermission>({
    principal,
    permission,
    scope,
    proof,
  }: {
    principal: AuthzPrincipalRef;
    permission: Permission;
    scope: Extract<AuthzScopeRef, { type: Tier }>;
    proof?: Readonly<{ actor: Actor; purpose: AuthorizationPurpose }>;
  }): Promise<Authorized<Tier, Permission> & Readonly<{ authorization: Authorization | null }>> {
    const resolved: AuthzScopeRef = scope;
    if (proof && resolved.type === "project") {
      // One engine pass decides and mints; the door does not evaluate the grants twice.
      const authorization = await this.deps.proofs
        .authorize({
          actor: proof.actor,
          principal,
          permission,
          scope: { projectId: resolved.id },
          purpose: proof.purpose,
        })
        .catch((error: unknown) => {
          if (!(error instanceof AccessNotGrantedError)) throw error;
          throw new PermissionDeniedError({ permission, scope, denialReason: "no-grant" });
        });
      const witness = this.mintAuthorizationWitness({
        tier: "project",
        id: resolved.id,
        permission,
      });
      await this.deps.aggregateReads?.auditRead({
        actor: proof.actor,
        authorization,
        projectId: resolved.id,
        findScope: () => this.deps.collector.findScopeRef({ projectId: resolved.id }),
      });

      return { ...(witness as Authorized<Tier, Permission>), authorization };
    }

    const decision = await this.deps.check({ principal, permission, scope });
    if (!decision.allowed) {
      throw new PermissionDeniedError({
        permission,
        scope,
        denialReason: decision.denialReason ?? "no-grant",
      });
    }

    const authorizedScope = scope as { type: Tier; id: string };

    return {
      ...this.mintAuthorizationWitness({
        tier: authorizedScope.type,
        id: authorizedScope.id,
        permission,
      }),
      authorization: null,
    };
  }

  private mintAuthorizationWitness<
    Tier extends DeclaredScopeTier,
    Permission extends AuthzPermission,
  >({
    tier,
    id,
    permission,
  }: {
    tier: Tier;
    id: string;
    permission: Permission;
  }): Authorized<Tier, Permission> {
    return { permission, scope: { tier, id } } as Authorized<Tier, Permission>;
  }

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
    const scope = this.tryScopeOf(check);
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
    const declaredScope = this.tryScopeOf(check);
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
        denialReason: "no-grant",
      });
    }

    const witness: Authorized<DeclaredScopeTier, Permission> = await this.authorize({
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
    if (result.organizationRole === "DEVELOPER") {
      throw new DeveloperSeatRestrictedError(permission.split(":")[0] ?? "unknown");
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

  /** Fail closed if an untyped caller bypasses the exclusive scope argument. */
  private tryScopeOf(
    scope: Partial<Record<"projectId" | "teamId" | "organizationId", string>>,
  ): AuthzDeclaredScopeId | null {
    if (scope.projectId) {
      return { tier: "project", id: scope.projectId };
    }

    if (scope.teamId) {
      return { tier: "team", id: scope.teamId };
    }

    if (scope.organizationId) {
      return { tier: "organization", id: scope.organizationId };
    }

    return null;
  }
}
