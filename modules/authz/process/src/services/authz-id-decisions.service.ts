/**
 * The decision family a caller reaches with ids it already holds, not a
 * resolved scope: one question, "any of these", and two batch forms. Each
 * collects the principal's grants ONCE and answers every candidate from it.
 */
import {
  type AuthzEngine,
  scopeOrganizationId,
  type AuthzDecision,
  type AuthzPermission,
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

    const scopeOrg = scopeOrganizationId(scope);
    const pass = this.deps.collector.beginPass();
    const [grants, ownerGrants] = await Promise.all([
      this.deps.collector.collectGrants({
        principal,
        organizationId: scopeOrg,
        reader: pass,
      }),
      ceiling
        ? this.deps.snapshots.findOwnerGrantsFor({
            principal,
            organizationId: scopeOrg,
            reader: pass,
          })
        : Promise.resolve(null),
    ]);
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
    // `ownerGrantsFor` returns null for a user principal, and `decideWithCeiling` with a null
    // ceiling is a plain decide — so this is a no-op for the user callers this has today and
    // closes the hole before an api-key caller reaches it.
    const scopeOrg = scopeOrganizationId(scope);
    const pass = this.deps.collector.beginPass();
    const [grants, ownerGrants] = await Promise.all([
      this.deps.collector.collectGrants({
        principal,
        organizationId: scopeOrg,
        reader: pass,
      }),
      this.deps.snapshots.findOwnerGrantsFor({
        principal,
        organizationId: scopeOrg,
        reader: pass,
      }),
    ]);
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
    const pass = this.deps.collector.beginPass();
    const [grants, ownerGrants] = await Promise.all([
      this.deps.collector.collectGrants({
        principal,
        organizationId,
        reader: pass,
      }),
      this.deps.snapshots.findOwnerGrantsFor({ principal, organizationId, reader: pass }),
    ]);
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
              projectScopes.map(([projectId, scope]) => [projectId, allowedAt(permission, scope)]),
            ),
          },
        ]),
      ),
      organizationRole: grants.organizationRole,
    };
  }
}
