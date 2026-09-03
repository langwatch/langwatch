/**
 * ADR-092 §2 — the one resolver. Pure functions over a CollectedGrants
 * snapshot: COLLECT happens in the app's collector (Prisma), everything here
 * is deterministic and unit-testable without a database.
 *
 * The rules are split across siblings and this file holds only the walk
 * ORDER, which is the part worth reading first:
 *
 *   types.ts     the vocabulary (scopes, principals, grants, decisions)
 *   scope.ts     the scope chain and resource-grant audiences
 *   matchers.ts  what one binding / legacy row / resource grant MEANS
 *   walk.ts      the ordered steps, one function each, over DecideContext
 *
 * Stage-A contract: reproduce today's tRPC-path semantics EXACTLY, one
 * implementation replacing five. Deliberate legacy quirks are tagged
 * `LEGACY-QUIRK(<stage>)` with the migration stage that removes them —
 * the shadow comparison depends on this engine matching legacy behaviour,
 * warts and all.
 */
import { scopeChain, type ScopeChainLink } from "./scope";
import type {
  AuthzDecision,
  AuthzScopeRef,
  CollectedBinding,
  CollectedGrants,
  ResourceGrant,
} from "./authz";
import {
  bindingsStep,
  type DecideContext,
  demoProjectStep,
  denyStep,
  legacyTeamFallbackStep,
  organizationMembershipGateStep,
  organizationRoleFloorStep,
  resourceGrantStep,
} from "./walk";

/**
 * The one resolver, as a service class (app-layer idiom). Stateless and
 * pure by construction: every method is a function of its arguments alone,
 * so one instance serves any number of callers and tests construct it
 * freely.
 */
export class AuthzEngine {
  decide({
    grants,
    permission,
    scope,
    demoProjectId,
    resourceGrants,
  }: {
    grants: CollectedGrants;
    permission: string;
    scope: AuthzScopeRef;
    /** Pass process.env.DEMO_PROJECT_ID; parameterised for purity. */
    demoProjectId?: string | null;
    /** ADR-092 §8 — grants at the resource tier, collected for `scope`'s
     *  resource links (collectResourceGrants). Ignored for non-resource
     *  scopes. */
    resourceGrants?: readonly ResourceGrant[];
  }): AuthzDecision {
    const chain = scopeChain(scope);
    const context: DecideContext = {
      grants,
      permission,
      scope,
      demoProjectId,
      resourceGrants,
      chain,
      chainBindings: grants.bindings.filter((binding) =>
        chain.some(
          (link) => link.scopeType === binding.scopeType && link.scopeId === binding.scopeId,
        ),
      ),
      base: {
        permission,
        scope,
        principal: grants.principal,
        audience: "member",
      },
    };

    // The order IS the contract — each step answers or defers to the next.
    return (
      demoProjectStep(context) ??
      organizationMembershipGateStep(context) ??
      organizationRoleFloorStep(context) ??
      bindingsStep(context) ??
      legacyTeamFallbackStep(context) ??
      resourceGrantStep(context) ??
      denyStep(context)
    );
  }

  /**
   * ADR-092 §9 — the API-key owner ceiling as engine algebra:
   * effective(key) = grants(key) ∩ grants(owner). Service keys (no owner)
   * have no ceiling.
   */
  decideWithCeiling({
    keyGrants,
    ownerGrants,
    permission,
    scope,
    demoProjectId,
    resourceGrants,
  }: {
    keyGrants: CollectedGrants;
    ownerGrants: CollectedGrants | null;
    permission: string;
    scope: AuthzScopeRef;
    demoProjectId?: string | null;
    resourceGrants?: readonly ResourceGrant[];
  }): AuthzDecision {
    const keyDecision = this.decide({
      grants: keyGrants,
      permission,
      scope,
      demoProjectId,
      resourceGrants,
    });
    if (!keyDecision.allowed || !ownerGrants) return keyDecision;

    const ownerDecision = this.decide({
      grants: ownerGrants,
      permission,
      scope,
      demoProjectId,
      resourceGrants,
    });
    if (ownerDecision.allowed) return keyDecision;

    return {
      ...keyDecision,
      allowed: false,
      via: undefined,
      matchedBinding: undefined,
      denialReason: "owner-ceiling",
    };
  }

  private explainBindingLine({
    binding,
    chain,
    decision,
  }: {
    binding: CollectedBinding;
    chain: readonly ScopeChainLink[];
    decision: AuthzDecision;
  }): string {
    const who = binding.viaGroupId ? ` (via group ${binding.viaGroupId})` : "";
    const label = `${binding.customRoleId ? `custom:${binding.customRoleId}` : binding.role.toLowerCase()} @ ${binding.scopeType.toLowerCase()} ${binding.scopeId}${who}`;
    const onChain = chain.some(
      (link) => link.scopeType === binding.scopeType && link.scopeId === binding.scopeId,
    );
    if (!onChain) return `  - ${label} — filtered out: not on this scope chain`;
    const matched =
      decision.matchedBinding === binding
        ? "GRANTS the permission"
        : `does not grant ${decision.permission}`;
    return `  - ${label} — ${matched}`;
  }

  explain({ decision, grants }: { decision: AuthzDecision; grants: CollectedGrants }): string[] {
    const lines: string[] = [];
    const scopeLabel = `${decision.scope.type} ${decision.scope.id}`;
    lines.push(`${decision.allowed ? "GRANTED" : "DENIED"} ${decision.permission} @ ${scopeLabel}`);

    if (decision.via === "demo-project") {
      lines.push("granted: demo project (read-only demo-viewer set)");
      return lines;
    }
    if (decision.via === "org-role-floor") {
      lines.push("granted: every organization member holds this permission");
      return lines;
    }
    if (decision.via === "resource-grant") {
      lines.push(
        "granted: a resource-tier grant on this resource (or a shareable ancestor) covers it",
      );
      return lines;
    }

    const chain = scopeChain(decision.scope);
    lines.push(`collected ${grants.bindings.length} binding(s):`);
    for (const binding of grants.bindings) {
      lines.push(this.explainBindingLine({ binding, chain, decision }));
    }
    if (grants.bindings.length === 0 && grants.legacyTeamMemberships.length > 0) {
      lines.push(
        `  - legacy team membership fallback consulted (${grants.legacyTeamMemberships.length} team(s))`,
      );
    }
    if (!decision.allowed) {
      lines.push(`denial reason: ${decision.denialReason ?? "unknown"}`);
    }
    return lines;
  }
}
