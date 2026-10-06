/** One decision against one collected snapshot: decided, logged when denied, explained on ask. */
import { ALL_PERMISSIONS, type AuthzPermission } from "@langwatch/authorization";
import {
  scopeOrganizationId,
  type AuthzDecision,
  type AuthzEngine,
  type AuthzPrincipalRef,
  type AuthzScopeRef,
  type CollectedGrants,
} from "@langwatch/authz-contract";
import { createLogger } from "@langwatch/observability";

import type { AuthzGrantSnapshotService } from "./authz-grant-snapshot.service.ts";

const decisions = createLogger("langwatch:authz:decisions");

export class AuthzDecisionService {
  static create({
    engine,
    snapshots,
  }: {
    engine: AuthzEngine;
    snapshots: AuthzGrantSnapshotService;
  }): AuthzDecisionService {
    return new AuthzDecisionService(engine, snapshots);
  }

  private constructor(
    private readonly engine: AuthzEngine,
    private readonly snapshots: AuthzGrantSnapshotService,
  ) {}

  /**
   * check() plus the collected snapshot - for adapters that must also surface legacy context
   * fields (the tRPC middleware sets ctx.organizationRole from it). For an api-key principal
   * the snapshot returned is the KEY's, not the owner's: the owner only ever caps.
   */
  async checkDetailed({
    principal,
    permission,
    scope,
  }: {
    principal: AuthzPrincipalRef;
    permission: AuthzPermission;
    scope: AuthzScopeRef;
  }): Promise<{
    decision: AuthzDecision;
    grants: CollectedGrants;
  }> {
    const organizationId = scopeOrganizationId(scope);
    const [grants, resourceGrants, ownerGrants] = await Promise.all([
      this.snapshots.collectCached({ principal, organizationId }),
      this.snapshots.findResourceGrantsFor(scope),
      this.snapshots.findOwnerGrantsFor({ principal, organizationId }),
    ]);
    const decision = this.engine.decideWithCeiling({
      keyGrants: grants,
      ownerGrants,
      permission,
      scope,
      demoProjectId: this.snapshots.findDemoProjectId(),
      resourceGrants,
    });
    this.recordDenial(decision);

    return { decision, grants };
  }

  /**
   * The caller's full effective permission set at a scope — the frontend's single source of
   * truth (useCan). Computed by testing the whole registry against one collected snapshot:
   * pure decides over ~126 permissions.
   */
  async effectivePermissions({
    principal,
    scope,
  }: {
    principal: AuthzPrincipalRef;
    scope: AuthzScopeRef;
  }): Promise<AuthzPermission[]> {
    const organizationId = scopeOrganizationId(scope);
    const [grants, resourceGrants, ownerGrants] = await Promise.all([
      this.snapshots.collectCached({ principal, organizationId }),
      this.snapshots.findResourceGrantsFor(scope),
      this.snapshots.findOwnerGrantsFor({ principal, organizationId }),
    ]);
    const demo = this.snapshots.findDemoProjectId();

    return ALL_PERMISSIONS.filter(
      (permission) =>
        this.engine.decideWithCeiling({
          keyGrants: grants,
          ownerGrants,
          permission,
          scope,
          demoProjectId: demo,
          resourceGrants,
        }).allowed,
    );
  }

  /**
   * ADR-092 §6 — render the walk for a decision against the CURRENT grant
   * snapshot, not the one the decision was made against: a grant write between the decision
   * and this call changes the rendered walk.
   */
  async explainDecision({ decision }: { decision: AuthzDecision }): Promise<string[]> {
    const grants = await this.snapshots.collectCached({
      principal: decision.principal,
      organizationId: scopeOrganizationId(decision.scope),
    });

    return this.engine.explain({ decision, grants });
  }

  /**
   * ADR-092 §6 step RECORD, as far as it goes today: one structured line per
   * DENY, carrying the five facts a mismatch investigation starts from.
   */
  recordDenial(decision: AuthzDecision): void {
    if (decision.allowed) {
      return;
    }

    decisions.info(
      {
        principalType: decision.principal.type,
        principalId: decision.principal.type === "anonymous" ? undefined : decision.principal.id,
        permission: decision.permission,
        scopeType: decision.scope.type,
        scopeId: decision.scope.id,
        denialReason: decision.denialReason,
      },
      "authz decision denied",
    );
  }
}
