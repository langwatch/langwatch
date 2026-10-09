/**
 * The decision family a caller reaches with ids it already holds, not a
 * resolved scope: one question, "any of these", and two batch forms. Each
 * reads the principal's epoch-checked snapshot ONCE and answers every candidate from it.
 */
import { applyAggregateAdminGate, type AuthzPermission } from "@langwatch/authorization";
import {
  type AuthzEngine,
  scopeOrganizationId,
  type AuthzDecision,
  type AuthzPrincipalRef,
  type AuthzScopeRef,
  type CollectedGrants,
  AuthzScopeNotFoundError,
} from "@langwatch/authz-contract";

import type { AuthzCollectorService } from "./authz-collector.service.ts";
import type { AuthzGrantSnapshotService } from "./authz-grant-snapshot.service.ts";

type ScopeIds = {
  projectId?: string | undefined;
  teamId?: string | undefined;
  organizationId?: string | undefined;
};

type OrganizationRoleOrNull = CollectedGrants["organizationRole"];

/** The role the aggregate admin gate reads: a key acts with its owner's; a service key, none. */
function gateRoleOf({
  principal,
  grants,
  ownerGrants,
}: {
  principal: AuthzPrincipalRef;
  grants: CollectedGrants;
  ownerGrants: CollectedGrants | null;
}): OrganizationRoleOrNull {
  if (principal.type === "apiKey") return ownerGrants?.organizationRole ?? null;
  return grants.organizationRole;
}

/** ADR-177 decision 5: whether a project of this kind is closed to this organization role. */
function isClosedAggregate({
  kind,
  organizationRole,
}: {
  kind: string | undefined;
  organizationRole: OrganizationRoleOrNull;
}): boolean {
  return !applyAggregateAdminGate({ decision: { permitted: true, organizationRole }, kind })
    .permitted;
}

type AuthzIdDecisionsOptions = {
  engine: AuthzEngine;
  collector: AuthzCollectorService;
  snapshots: AuthzGrantSnapshotService;
  /** The owning service's own resolution, so both seams read the same most-specific-first order. */
  getScope: (ids: ScopeIds) => Promise<AuthzScopeRef>;
  recordDenial: (decision: AuthzDecision) => void;
};

export class AuthzIdDecisionsService {
  static create(deps: AuthzIdDecisionsOptions): AuthzIdDecisionsService {
    return new AuthzIdDecisionsService(deps);
  }

  private constructor(private readonly deps: AuthzIdDecisionsOptions) {}

  /**
   * The same question as `check`, asked with the ids a caller already holds instead of a
   * resolved scope ref.
   */
  async checkByIds({
    principal,
    permission,
    projectId,
    teamId,
    organizationId,
    ceiling = true,
  }: ScopeIds & {
    principal: AuthzPrincipalRef;
    permission: AuthzPermission;
    ceiling?: boolean;
  }): Promise<{
    allowed: boolean;
    organizationRole: OrganizationRoleOrNull;
    denialReason?: AuthzDecision["denialReason"];
  }> {
    let scope: AuthzScopeRef;
    try {
      scope = await this.deps.getScope({ projectId, teamId, organizationId });
    } catch (error) {
      if (AuthzScopeNotFoundError.is(error)) return { allowed: false, organizationRole: null };
      throw error;
    }

    const { grants, ownerGrants } = await this.deps.snapshots.collectWithOwnerCeiling({
      principal,
      organizationId: scopeOrganizationId(scope),
      ceiling,
    });
    const decision = this.deps.engine.decideWithCeiling({
      keyGrants: grants,
      ownerGrants,
      permission,
      scope,
      demoProjectId: this.deps.snapshots.findDemoProjectId(),
    });
    this.deps.recordDenial(decision);

    return {
      allowed: decision.allowed,
      organizationRole: grants.organizationRole,
      ...(decision.denialReason ? { denialReason: decision.denialReason } : {}),
    };
  }

  /**
   * "Any one of these is enough", in the order given, first allow wins. One
   * scope resolution and one collection serve every candidate — asking per
   * permission would re-query for an answer the first snapshot already holds.
   */
  async canAnyByIds({
    principal,
    permissions,
    projectId,
  }: {
    principal: AuthzPrincipalRef;
    permissions: readonly AuthzPermission[];
    projectId: string;
  }): Promise<{
    allowed: boolean;
    matchedPermission?: AuthzPermission;
    organizationRole: OrganizationRoleOrNull;
    denialReason?: AuthzDecision["denialReason"];
  }> {
    const scope = await this.deps.collector.findScopeRef({ projectId });
    if (!scope) {
      return { allowed: false, organizationRole: null };
    }

    // Same api-key owner ceiling every other decision path applies: an api-key principal is
    // capped at its owner's grants, so demoting the owner shrinks the key here too.
    // The owner ceiling is null for a user principal, and `decideWithCeiling` with a null
    // ceiling is a plain decide — so this is a no-op for the user callers this has today and
    // closes the hole before an api-key caller reaches it.
    const { grants, ownerGrants } = await this.deps.snapshots.collectWithOwnerCeiling({
      principal,
      organizationId: scopeOrganizationId(scope),
    });
    const demoProjectId = this.deps.snapshots.findDemoProjectId();
    let matched: AuthzPermission | undefined;
    let firstDenied: AuthzDecision | undefined;
    for (const permission of permissions) {
      const decision = this.deps.engine.decideWithCeiling({
        keyGrants: grants,
        ownerGrants,
        permission,
        scope,
        demoProjectId,
      });
      if (decision.allowed) {
        matched = permission;
        break;
      }

      firstDenied ??= decision;
    }
    const kind = scope.type === "project" ? scope.kind : undefined;
    if (
      matched &&
      isClosedAggregate({ kind, organizationRole: gateRoleOf({ principal, grants, ownerGrants }) })
    ) {
      return {
        allowed: false,
        organizationRole: grants.organizationRole,
        denialReason: "no-binding",
      };
    }

    const result: {
      allowed: boolean;
      matchedPermission?: AuthzPermission;
      organizationRole: OrganizationRoleOrNull;
      denialReason?: AuthzDecision["denialReason"];
    } = {
      allowed: matched !== undefined,
      organizationRole: grants.organizationRole,
    };
    if (matched) {
      result.matchedPermission = matched;
    } else if (firstDenied?.denialReason) {
      result.denialReason = firstDenied.denialReason;
    }

    return result;
  }

  /**
   * One permission across many scopes in one organization: one collection, N pure decisions.
   * Deciding per scope would turn a flat batch into a collect per scope, which is the
   * pool-starving fan-out this replaces.
   */
  async canBatchByIds({
    principal,
    permission,
    organizationId,
    teams,
    projects,
  }: {
    principal: AuthzPrincipalRef;
    permission: AuthzPermission;
    organizationId: string;
    teams: readonly { teamId: string }[];
    projects: readonly { projectId: string; teamId?: string | undefined }[];
  }): Promise<{
    teams: Map<string, boolean>;
    projects: Map<string, boolean>;
    organizationRole: OrganizationRoleOrNull;
  }> {
    const { byPermission, organizationRole } = await this.canBatchPermissionsByIds({
      principal,
      permissions: [permission],
      organizationId,
      teams,
      projects,
    });
    const decision = byPermission.get(permission) ?? {
      teams: new Map<string, boolean>(),
      projects: new Map<string, boolean>(),
    };

    return { ...decision, organizationRole };
  }

  /**
   * MANY permissions across many scopes in one organization — and still ONE collection.
   */
  async canBatchPermissionsByIds({
    principal,
    permissions,
    organizationId,
    teams,
    projects,
  }: {
    principal: AuthzPrincipalRef;
    permissions: readonly AuthzPermission[];
    organizationId: string;
    teams: readonly { teamId: string }[];
    projects: readonly { projectId: string; teamId?: string | undefined }[];
  }): Promise<{
    byPermission: Map<
      AuthzPermission,
      { teams: Map<string, boolean>; projects: Map<string, boolean> }
    >;
    organizationRole: OrganizationRoleOrNull;
  }> {
    // The api-key owner ceiling, off the same snapshot as the key's grants —
    // see `canAnyByIds`. Null for a user or service-key principal, and
    // `decideWithCeiling` with a null ceiling is a plain decide.
    const { grants, ownerGrants } = await this.deps.snapshots.collectWithOwnerCeiling({
      principal,
      organizationId,
    });
    const demoProjectId = this.deps.snapshots.findDemoProjectId();
    const allowedAt = (permission: AuthzPermission, scope: AuthzScopeRef | null): boolean =>
      scope
        ? this.deps.engine.decideWithCeiling({
            keyGrants: grants,
            ownerGrants,
            permission,
            scope,
            demoProjectId,
          }).allowed
        : false;

    const projectScopes = await Promise.all(
      projects.map(async ({ projectId, teamId }): Promise<[string, AuthzScopeRef | null]> => [
        projectId,
        teamId
          ? { type: "project", id: projectId, teamId, organizationId }
          : await this.deps.collector.findScopeRef({ projectId }),
      ]),
    );
    const projectAnswers = new Map(
      permissions.map((permission) => [
        permission,
        new Map(
          projectScopes.map(([projectId, scope]) => [projectId, allowedAt(permission, scope)]),
        ),
      ]),
    );
    const closed = await this.findClosedAggregates({
      organizationRole: gateRoleOf({ principal, grants, ownerGrants }),
      projectScopes: projectScopes.filter(([projectId]) =>
        [...projectAnswers.values()].some((answers) => answers.get(projectId)),
      ),
    });

    return {
      byPermission: new Map(
        permissions.map((permission) => [
          permission,
          {
            teams: new Map(
              teams.map(({ teamId }) => [
                teamId,
                allowedAt(permission, { type: "team", id: teamId, organizationId }),
              ]),
            ),
            projects: new Map(
              [...(projectAnswers.get(permission) ?? [])].map(([projectId, permitted]) => [
                projectId,
                permitted && !closed.has(projectId),
              ]),
            ),
          },
        ]),
      ),
      organizationRole: grants.organizationRole,
    };
  }

  /**
   * M8487-BATCH-GATE: the aggregates among these projects this role may not open, so a batch
   * never admits what a single check refuses. An admin pays no read; anyone else one lineage
   * read per project whose scope does not already carry its kind.
   */
  private async findClosedAggregates({
    organizationRole,
    projectScopes,
  }: {
    organizationRole: OrganizationRoleOrNull;
    projectScopes: readonly [string, AuthzScopeRef | null][];
  }): Promise<ReadonlySet<string>> {
    if (organizationRole === "ADMIN") return new Set();
    const closed = await Promise.all(
      projectScopes.map(async ([projectId, scope]) => {
        const known = scope?.type === "project" ? scope.kind : undefined;
        const kind = known ?? (await this.deps.collector.findScopeRef({ projectId }))?.kind;
        return isClosedAggregate({ kind, organizationRole }) ? [projectId] : [];
      }),
    );
    return new Set(closed.flat());
  }
}
